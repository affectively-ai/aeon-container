/**
 * Browser QuickJS Sandbox — Isomorphic Code Execution
 *
 * Runs QuickJS WASM in the browser. Same execution interface as the
 * edge-workers AeonContainerSandbox but loads the browser-compatible
 * WASM build via quickjs-emscripten.
 *
 * Browser-first means: private (code never leaves the user's machine),
 * fast (no network roundtrip), and free (no worker compute cost).
 * Falls back to edge API when browser sandbox unavailable.
 */

import type {
  ContainerExecuteRequest,
  ContainerExecuteResult,
  ExecutionOutcome,
  AeonFSNode,
  FileEntry,
} from './types';
import { DEFAULT_TIMEOUT_MS, MAX_LOG_LINES, MAX_OUTPUT_SIZE } from './types';
import { joinContainerApiPath } from './api-routes';

interface AeonLogicSandboxModule {
  readonly runTlaSandbox: (sourceText: string) => {
    readonly report: unknown;
    readonly logs: readonly string[];
  };
}

function isAeonLogicSandboxModule(
  value: unknown
): value is AeonLogicSandboxModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { runTlaSandbox?: unknown }).runTlaSandbox === 'function'
  );
}

// ============================================
// BROWSER SANDBOX
// ============================================

export class BrowserSandbox {
  private static instance: BrowserSandbox | null = null;
  private quickJS: any = null;
  private loading: Promise<void> | null = null;
  private edgeFallbackUrl: string | null = null;

  private constructor() {
    /* singleton */
  }

  static getInstance(): BrowserSandbox {
    if (!BrowserSandbox.instance) {
      BrowserSandbox.instance = new BrowserSandbox();
    }
    return BrowserSandbox.instance;
  }

  /**
   * Configure edge API fallback URL.
   */
  setEdgeFallbackUrl(url: string): void {
    this.edgeFallbackUrl = url;
  }

  /**
   * Check if the browser sandbox is ready for execution.
   */
  isReady(): boolean {
    return this.quickJS !== null;
  }

  /**
   * Lazy-load QuickJS WASM. Only fetches the ~400KB binary on first call.
   */
  async ensureLoaded(): Promise<boolean> {
    if (this.quickJS) return true;
    if (this.loading) {
      await this.loading;
      return this.quickJS !== null;
    }

    this.loading = (async () => {
      try {
        const { getQuickJS } = await import('quickjs-emscripten');
        this.quickJS = await getQuickJS();
      } catch {
        // QuickJS WASM not available in this environment
        this.quickJS = null;
      }
    })();

    await this.loading;
    this.loading = null;
    return this.quickJS !== null;
  }

  /**
   * Execute code in the browser QuickJS sandbox.
   * Falls back to edge API if browser sandbox is unavailable.
   */
  async execute(
    request: ContainerExecuteRequest
  ): Promise<ContainerExecuteResult> {
    const language = request.language || 'javascript';

    if (language === 'tla') {
      return this.executeTlaInBrowser(request);
    }

    const ready = await this.ensureLoaded();

    if (!ready) {
      // Fall back to edge API
      if (this.edgeFallbackUrl) {
        return this.executeViaEdge(request);
      }
      return {
        outcome: 'OUTCOME_ERROR',
        output: '',
        error: 'QuickJS WASM not available and no edge fallback configured',
        logs: [],
        execution_time_ms: 0,
        language,
      };
    }

    return this.executeInBrowser(request);
  }

  private async executeTlaInBrowser(
    request: ContainerExecuteRequest
  ): Promise<ContainerExecuteResult> {
    const startTime = performance.now();
    const timeoutMs = request.timeout_ms || DEFAULT_TIMEOUT_MS;

    try {
      const { runTlaSandbox } = await this.loadAeonLogic();
      const sandboxResult = runTlaSandbox(request.code);

      const elapsed = performance.now() - startTime;
      if (elapsed > timeoutMs) {
        return {
          outcome: 'OUTCOME_TIMEOUT',
          output: '',
          error: `Execution timed out after ${timeoutMs}ms`,
          logs: [],
          execution_time_ms: elapsed,
          language: 'tla',
        };
      }

      return {
        outcome: 'OUTCOME_OK',
        output: JSON.stringify(sandboxResult.report, null, 2).slice(
          0,
          MAX_OUTPUT_SIZE
        ),
        logs: Array.from(sandboxResult.logs).slice(0, MAX_LOG_LINES),
        execution_time_ms: elapsed,
        language: 'tla',
      };
    } catch (err) {
      const elapsed = performance.now() - startTime;
      const error = err instanceof Error ? err.message : String(err);

      if (elapsed > timeoutMs) {
        return {
          outcome: 'OUTCOME_TIMEOUT',
          output: '',
          error: `Execution timed out after ${timeoutMs}ms`,
          logs: [],
          execution_time_ms: elapsed,
          language: 'tla',
        };
      }

      return {
        outcome: 'OUTCOME_ERROR',
        output: '',
        error,
        logs: [],
        execution_time_ms: elapsed,
        language: 'tla',
      };
    }
  }

  // ── Browser Execution ──────────────────────────────────────────

  private async executeInBrowser(
    request: ContainerExecuteRequest
  ): Promise<ContainerExecuteResult> {
    const startTime = performance.now();
    const language = request.language || 'javascript';
    const timeoutMs = request.timeout_ms || DEFAULT_TIMEOUT_MS;
    const logs: string[] = [];
    let output = '';

    // Only JavaScript/TypeScript can run directly in QuickJS.
    // TLA is handled by executeTlaInBrowser before this branch.
    if (language !== 'javascript' && language !== 'typescript') {
      return {
        outcome: 'OUTCOME_UNSUPPORTED_LANGUAGE',
        output: '',
        error: `Browser sandbox supports JavaScript/TypeScript via QuickJS and TLA via aeon-logic. Use edge API for ${language}.`,
        logs: [],
        execution_time_ms: performance.now() - startTime,
        language,
      };
    }

    const vm = this.quickJS.newContext();
    let outcome: ExecutionOutcome = 'OUTCOME_OK';
    let error: string | undefined;

    try {
      // Set up interrupt handler for timeout
      const deadline = Date.now() + timeoutMs;
      vm.runtime.setInterruptHandler(() => {
        if (Date.now() > deadline) {
          outcome = 'OUTCOME_TIMEOUT';
          return true; // interrupt execution
        }
        return false;
      });

      // Inject console object
      this.injectConsole(vm, logs);

      // Inject context variables
      if (request.context) {
        this.injectContext(vm, request.context);
      }

      // Inject virtual filesystem (__fs)
      if (request.filesystem) {
        this.injectFilesystem(vm, request.filesystem);
      }

      // Strip TypeScript type annotations (basic transform)
      const code =
        language === 'typescript'
          ? this.stripTypeAnnotations(request.code)
          : request.code;

      // Execute
      const result = vm.evalCode(code, 'aeon-container.js');

      if (result.error) {
        const errorVal = vm.dump(result.error);
        result.error.dispose();
        error =
          typeof errorVal === 'object'
            ? JSON.stringify(errorVal)
            : String(errorVal);
        if (outcome === 'OUTCOME_OK') {
          outcome = 'OUTCOME_ERROR';
        }
      } else {
        const value = vm.dump(result.value);
        result.value.dispose();
        if (value !== undefined) {
          output =
            typeof value === 'object'
              ? JSON.stringify(value, null, 2)
              : String(value);
        }
      }
    } catch (err) {
      outcome = 'OUTCOME_ERROR';
      error = err instanceof Error ? err.message : String(err);
    } finally {
      vm.dispose();
    }

    // Combine console output with return value
    const consoleOutput = logs.join('\n');
    const fullOutput = consoleOutput
      ? output
        ? `${consoleOutput}\n${output}`
        : consoleOutput
      : output;

    return {
      outcome,
      output: fullOutput.slice(0, MAX_OUTPUT_SIZE),
      error,
      logs: logs.slice(0, MAX_LOG_LINES),
      execution_time_ms: performance.now() - startTime,
      language,
    };
  }

  // ── Console Injection ──────────────────────────────────────────

  private injectConsole(vm: any, logs: string[]): void {
    const consoleObj = vm.newObject();

    const makeLogFn = (prefix: string) => {
      const fn = vm.newFunction(prefix, (...args: any[]) => {
        const values = args.map((a: any) => {
          const val = vm.dump(a);
          return typeof val === 'object' ? JSON.stringify(val) : String(val);
        });
        const line =
          prefix === 'log'
            ? values.join(' ')
            : `[${prefix.toUpperCase()}] ${values.join(' ')}`;
        if (logs.length < MAX_LOG_LINES) {
          logs.push(line);
        }
      });
      vm.setProp(consoleObj, prefix, fn);
      fn.dispose();
    };

    makeLogFn('log');
    makeLogFn('warn');
    makeLogFn('error');
    makeLogFn('info');
    makeLogFn('debug');

    vm.setProp(vm.global, 'console', consoleObj);
    consoleObj.dispose();
  }

  // ── Context Injection ──────────────────────────────────────────

  private injectContext(vm: any, context: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(context)) {
      const jsonStr = JSON.stringify(value);
      const result = vm.evalCode(
        `globalThis[${JSON.stringify(key)}] = ${jsonStr};`
      );
      if (result.error) {
        result.error.dispose();
      } else {
        result.value.dispose();
      }
    }
  }

  // ── Filesystem Injection ───────────────────────────────────────

  private injectFilesystem(
    vm: any,
    filesystem: AeonFSNode | { files?: FileEntry[] }
  ): void {
    // Flatten the tree into a simple path→content map for the sandbox
    const files =
      'type' in filesystem
        ? this.flattenFS(filesystem)
        : this.flattenFileEntries(filesystem.files ?? []);
    const fsJson = JSON.stringify(files);

    const fsResult = vm.evalCode(`
      globalThis.__fs = {
        _files: ${fsJson},
        readFile(path) {
          const content = this._files[path];
          if (content === undefined) throw new Error('File not found: ' + path);
          return content;
        },
        writeFile(path, content) {
          this._files[path] = content;
        },
        listDir(dirPath) {
          const prefix = dirPath.endsWith('/') ? dirPath : dirPath + '/';
          const entries = new Set();
          for (const p of Object.keys(this._files)) {
            if (p.startsWith(prefix)) {
              const rest = p.slice(prefix.length);
              const first = rest.split('/')[0];
              if (first) entries.add(first);
            }
          }
          return Array.from(entries);
        },
        exists(path) {
          return this._files[path] !== undefined;
        },
        deleteFile(path) {
          delete this._files[path];
        }
      };
    `);
    if (fsResult.error) {
      fsResult.error.dispose();
    } else {
      fsResult.value.dispose();
    }
  }

  private flattenFS(node: AeonFSNode): Record<string, string> {
    const files: Record<string, string> = {};
    if (node.type === 'file' && node.content !== undefined) {
      files[node.path] = node.content;
    }
    if (node.children) {
      for (const child of node.children) {
        Object.assign(files, this.flattenFS(child));
      }
    }
    return files;
  }

  private flattenFileEntries(entries: FileEntry[]): Record<string, string> {
    const files: Record<string, string> = {};
    for (const entry of entries) {
      if (entry.type === 'directory' || entry.isDirectory) {
        continue;
      }
      const entryPath =
        typeof entry.path === 'string'
          ? entry.path
          : `/${entry.name ?? 'file'}`;
      if (typeof entry.content === 'string') {
        files[entryPath] = entry.content;
      }
    }
    return files;
  }

  // ── TypeScript Strip ───────────────────────────────────────────

  /**
   * Basic TypeScript → JavaScript transform.
   * Strips type annotations, interfaces, and type imports.
   * For full TS support, the edge API should be used.
   */
  private stripTypeAnnotations(code: string): string {
    return (
      code
        // Remove type imports
        .replace(/import\s+type\s+\{[^}]*\}\s+from\s+['"][^'"]*['"]\s*;?/g, '')
        // Remove interface declarations
        .replace(/interface\s+\w+\s*\{[^}]*\}/g, '')
        // Remove type alias declarations
        .replace(/type\s+\w+\s*=\s*[^;]+;/g, '')
        // Remove type annotations from variables
        .replace(
          /:\s*(string|number|boolean|any|void|never|unknown|null|undefined)(\[\])?\s*(=|;|\)|,|\{)/g,
          '$3'
        )
        // Remove generic type parameters
        .replace(/<[^>]+>/g, '')
        // Remove 'as' type assertions
        .replace(/\s+as\s+\w+/g, '')
    );
  }

  private async loadAeonLogic(): Promise<AeonLogicSandboxModule> {
    try {
      const packageSpecifier = '@affectively/aeon-logic';
      const fromPackage = await import(packageSpecifier);
      if (isAeonLogicSandboxModule(fromPackage)) {
        return fromPackage;
      }
    } catch {
      // Continue to workspace fallbacks.
    }

    try {
      // Workspace source fallback for local tests where package exports are unavailable.
      const fromWorkspaceSource = await import('../../../aeon-logic/src/index');
      if (isAeonLogicSandboxModule(fromWorkspaceSource)) {
        return fromWorkspaceSource;
      }
    } catch {
      // Continue to dist fallback.
    }

    const fromWorkspaceDist = await import('../../../aeon-logic/dist/index.js');
    if (isAeonLogicSandboxModule(fromWorkspaceDist)) {
      return fromWorkspaceDist;
    }

    throw new Error(
      'aeon-logic runTlaSandbox export was not found in package, source, or dist fallback.'
    );
  }

  // ── Edge Fallback ──────────────────────────────────────────────

  private async executeViaEdge(
    request: ContainerExecuteRequest
  ): Promise<ContainerExecuteResult> {
    const startTime = performance.now();
    const edgeFallbackUrl = this.edgeFallbackUrl;

    try {
      if (!edgeFallbackUrl) {
        return {
          outcome: 'OUTCOME_ERROR',
          output: '',
          error: 'Edge fallback URL is not configured',
          logs: [],
          execution_time_ms: performance.now() - startTime,
          language: request.language || 'javascript',
        };
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (request.ucan) {
        headers['Authorization'] = `Bearer ${request.ucan}`;
      }

      const response = await fetch(
        joinContainerApiPath(edgeFallbackUrl, '/execute'),
        {
          method: 'POST',
          headers,
          body: JSON.stringify(request),
        }
      );

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          outcome: 'OUTCOME_ERROR',
          output: '',
          error: `Edge API error (${response.status}): ${errorBody}`,
          logs: [],
          execution_time_ms: performance.now() - startTime,
          language: request.language || 'javascript',
        };
      }

      return (await response.json()) as ContainerExecuteResult;
    } catch (err) {
      return {
        outcome: 'OUTCOME_ERROR',
        output: '',
        error: `Edge API unreachable: ${
          err instanceof Error ? err.message : String(err)
        }`,
        logs: [],
        execution_time_ms: performance.now() - startTime,
        language: request.language || 'javascript',
      };
    }
  }
}
