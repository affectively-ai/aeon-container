'use aeon';

import type {
  ContainerExecuteResult,
  ContainerLanguage,
} from '../services/types';
import { LOCAL_LOCK_OWNER_ID, parseLanguageAlias } from './aeon-ide-helpers';

export type IdeCliLevel = 'info' | 'ok' | 'warn' | 'error';

export interface IdeAction {
  id: string;
  label: string;
  hint: string;
  keywords: string[];
  run: () => void;
}

interface BuildIdeActionsOptions {
  effectiveLockOwnerId: string | null;
  runCode: () => Promise<ContainerExecuteResult>;
  appendCliEntry: (text: string, level?: IdeCliLevel) => void;
  formatDocument: () => void;
  formatWorkspace: () => void;
  triggerLintPass: () => void;
  lintWorkspace: () => void;
  buildFile: () => void;
  buildWorkspace: () => void;
  emitStaticAnalysisPlan: () => void;
  undoRevision: () => void;
  redoRevision: () => void;
  restorePreviewRevision: () => void;
  jumpToLatestRevision: () => void;
  scrubberPlaybackActive: boolean;
  scrubberPlaybackSpeed: number;
  startScrubberPlayback: () => void;
  pauseScrubberPlayback: () => void;
  setScrubberPlaybackSpeed: (speed: number) => void;
  toggleLock: () => void;
  overrideLock: () => void;
  openCli: () => void;
  applyLanguageSelection: (language: ContainerLanguage) => void;
  createSnapshot: () => void;
  showReceipts: () => void;
  repoIngest: () => void;
  repoRefresh: () => void;
  repoStatus: () => void;
  repoSymbols: (query?: string) => void;
  toggleDiagnosticsStrip: () => void;
  scaffoldFluxApp: () => void;
  scaffoldMcpServer: () => void;
}

interface ExecuteIdeCliCommandOptions {
  rawCommand: string;
  effectiveLockOwnerId: string | null;
  appendCliEntry: (text: string, level?: IdeCliLevel) => void;
  runCode: () => Promise<ContainerExecuteResult>;
  triggerLintPass: () => void;
  formatDocument: () => void;
  formatWorkspace: () => void;
  lintWorkspace: () => void;
  buildFile: () => void;
  buildWorkspace: () => void;
  scrubberPlaybackActive: boolean;
  startScrubberPlayback: () => void;
  pauseScrubberPlayback: () => void;
  setScrubberPlaybackSpeed: (speed: number) => void;
  toggleLock: () => void;
  overrideLock: () => void;
  undoRevision: () => void;
  redoRevision: () => void;
  restorePreviewRevision: () => void;
  jumpToLatestRevision: () => void;
  applyLanguageSelection: (language: ContainerLanguage) => void;
  jumpToLine: (line: number) => void;
  emitStaticAnalysisPlan: () => void;
  openActionLauncher: () => void;
  clearCliEntries: () => void;
  clearLogs: () => void;
  createSnapshot: () => void;
  showReceipts: () => void;
  repoIngest: () => void;
  repoRefresh: () => void;
  repoStatus: () => void;
  repoSymbols: (query?: string) => void;
  toggleDiagnosticsStrip: () => void;
  scaffoldFluxApp: () => void;
  scaffoldMcpServer: () => void;
}

interface HandleIdeKeyboardShortcutOptions {
  actionLauncherOpen: boolean;
  toggleCliPanel: () => void;
  openActionLauncher: () => void;
  openSymbolPicker: () => void;
  closeActionLauncher: () => void;
  openCli: () => void;
  runCode: () => Promise<ContainerExecuteResult>;
  save: () => Promise<void>;
  undoRevision: () => void;
  redoRevision: () => void;
  toggleLock: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

export function buildIdeActions({
  effectiveLockOwnerId,
  runCode,
  appendCliEntry,
  formatDocument,
  formatWorkspace,
  triggerLintPass,
  lintWorkspace,
  buildFile,
  buildWorkspace,
  emitStaticAnalysisPlan,
  undoRevision,
  redoRevision,
  restorePreviewRevision,
  jumpToLatestRevision,
  scrubberPlaybackActive,
  scrubberPlaybackSpeed,
  startScrubberPlayback,
  pauseScrubberPlayback,
  setScrubberPlaybackSpeed,
  toggleLock,
  overrideLock,
  openCli,
  applyLanguageSelection,
  createSnapshot,
  showReceipts,
  repoIngest,
  repoRefresh,
  repoStatus,
  repoSymbols,
  toggleDiagnosticsStrip,
  scaffoldFluxApp,
  scaffoldMcpServer,
}: BuildIdeActionsOptions): IdeAction[] {
  const nextReplaySpeed =
    scrubberPlaybackSpeed >= 4
      ? 0.5
      : scrubberPlaybackSpeed >= 2
      ? 4
      : scrubberPlaybackSpeed >= 1
      ? 2
      : 1;
  const lockLabel =
    effectiveLockOwnerId === LOCAL_LOCK_OWNER_ID
      ? 'Release edit lock'
      : 'Claim edit lock';

  return [
    {
      id: 'run',
      label: 'Run code',
      hint: 'Execute current buffer',
      keywords: ['run', 'execute'],
      run: () => {
        void runCode().then((result) => {
          appendCliEntry(
            `Run finished: ${
              result.outcome
            } (${result.execution_time_ms.toFixed(1)}ms)`,
            result.outcome === 'OUTCOME_OK' ? 'ok' : 'warn'
          );
        });
      },
    },
    {
      id: 'format',
      label: 'Format document',
      hint: 'Normalize indentation and spacing',
      keywords: ['format', 'prettify', 'style'],
      run: formatDocument,
    },
    {
      id: 'format-workspace',
      label: 'Format workspace',
      hint: 'Format all code files in this workspace',
      keywords: ['format', 'workspace', 'all'],
      run: formatWorkspace,
    },
    {
      id: 'scaffold-flux-app',
      label: 'Scaffold Aeon Flux App',
      hint: 'Initialize an edge-native app template',
      keywords: ['scaffold', 'init', 'create', 'flux', 'template'],
      run: scaffoldFluxApp,
    },
    {
      id: 'scaffold-mcp-server',
      label: 'Scaffold MCP Server',
      hint: 'Initialize an MCP server template',
      keywords: ['scaffold', 'mcp', 'create', 'server', 'template'],
      run: scaffoldMcpServer,
    },
    {
      id: 'lint',
      label: 'Lint now',
      hint: 'Trigger streamed lint pass',
      keywords: ['lint', 'diagnostics', 'problems'],
      run: triggerLintPass,
    },
    {
      id: 'lint-workspace',
      label: 'Lint workspace',
      hint: 'Run diagnostics summary for all files',
      keywords: ['lint', 'workspace', 'all', 'diagnostics'],
      run: lintWorkspace,
    },
    {
      id: 'build-file',
      label: 'Build file',
      hint: 'Run build readiness checks for active file',
      keywords: ['build', 'file', 'compile'],
      run: buildFile,
    },
    {
      id: 'build-workspace',
      label: 'Build workspace',
      hint: 'Run build readiness checks across workspace',
      keywords: ['build', 'workspace', 'compile', 'all'],
      run: buildWorkspace,
    },
    {
      id: 'plan-static-analysis',
      label: 'Plan static analysis',
      hint: 'Generate language-aware analysis checklist',
      keywords: ['plan', 'analysis', 'static', 'audit'],
      run: emitStaticAnalysisPlan,
    },
    {
      id: 'undo',
      label: 'Undo revision',
      hint: 'Move one snapshot backward',
      keywords: ['undo', 'timeline'],
      run: undoRevision,
    },
    {
      id: 'redo',
      label: 'Redo revision',
      hint: 'Move one snapshot forward',
      keywords: ['redo', 'timeline'],
      run: redoRevision,
    },
    {
      id: 'restore',
      label: 'Restore preview revision',
      hint: 'Commit selected timeline state',
      keywords: ['restore', 'revision', 'time travel'],
      run: restorePreviewRevision,
    },
    {
      id: 'latest',
      label: 'Jump to latest revision',
      hint: 'Exit preview mode',
      keywords: ['latest', 'live', 'revision'],
      run: jumpToLatestRevision,
    },
    {
      id: 'replay-toggle',
      label: scrubberPlaybackActive
        ? 'Pause scrub replay'
        : 'Play scrub replay',
      hint: 'Animate timeline preview',
      keywords: ['replay', 'scrubber', 'timeline', 'play', 'pause'],
      run: scrubberPlaybackActive
        ? pauseScrubberPlayback
        : startScrubberPlayback,
    },
    {
      id: 'replay-speed',
      label: `Replay speed (${scrubberPlaybackSpeed}x)`,
      hint: `Cycle speed to ${nextReplaySpeed}x`,
      keywords: ['replay', 'speed', 'scrubber'],
      run: () => setScrubberPlaybackSpeed(nextReplaySpeed),
    },
    {
      id: 'lock',
      label: lockLabel,
      hint: 'Toggle collaborative lock',
      keywords: ['lock', 'unlock', 'collaboration'],
      run: toggleLock,
    },
    {
      id: 'lock-override',
      label: 'Override lock',
      hint: 'Force lease takeover (UCAN capability required)',
      keywords: ['lock', 'override', 'lease'],
      run: overrideLock,
    },
    {
      id: 'snapshot',
      label: 'Create D1 snapshot',
      hint: 'Persist current workspace snapshot',
      keywords: ['snapshot', 'd1', 'persist'],
      run: createSnapshot,
    },
    {
      id: 'receipts',
      label: 'Show receipts',
      hint: 'Query execution/lock receipts',
      keywords: ['receipt', 'zk', 'audit'],
      run: showReceipts,
    },
    {
      id: 'repo-ingest',
      label: 'Repo ingest (local)',
      hint: 'Index active workspace file into D1',
      keywords: ['repo', 'ingest', 'index', 'd1'],
      run: repoIngest,
    },
    {
      id: 'repo-refresh',
      label: 'Repo refresh',
      hint: 'Request indexed repo refresh',
      keywords: ['repo', 'refresh', 'index'],
      run: repoRefresh,
    },
    {
      id: 'repo-status',
      label: 'Repo status',
      hint: 'Show active repo ingest/index status',
      keywords: ['repo', 'status', 'index'],
      run: repoStatus,
    },
    {
      id: 'repo-symbols',
      label: 'Repo symbols',
      hint: 'List indexed symbols for active repo',
      keywords: ['repo', 'symbols', 'index', 'search'],
      run: () => repoSymbols(),
    },
    {
      id: 'toggle-diagnostics',
      label: 'Toggle diagnostics strip',
      hint: 'Show/hide right-side marker strip',
      keywords: ['diagnostics', 'strip', 'lint'],
      run: toggleDiagnosticsStrip,
    },
    {
      id: 'open-cli',
      label: 'Open action CLI',
      hint: 'Focus command line at bottom',
      keywords: ['cli', 'terminal', 'console'],
      run: openCli,
    },
    {
      id: 'lang-ts',
      label: 'Language: TypeScript',
      hint: 'Switch active language',
      keywords: ['language', 'typescript', 'ts'],
      run: () => applyLanguageSelection('typescript'),
    },
    {
      id: 'lang-go',
      label: 'Language: Go',
      hint: 'Switch active language',
      keywords: ['language', 'go', 'golang'],
      run: () => applyLanguageSelection('go'),
    },
    {
      id: 'lang-py',
      label: 'Language: Python',
      hint: 'Switch active language',
      keywords: ['language', 'python', 'py'],
      run: () => applyLanguageSelection('python'),
    },
  ];
}

export function executeIdeCliCommand({
  rawCommand,
  effectiveLockOwnerId,
  appendCliEntry,
  runCode,
  triggerLintPass,
  formatDocument,
  formatWorkspace,
  lintWorkspace,
  buildFile,
  buildWorkspace,
  scrubberPlaybackActive,
  startScrubberPlayback,
  pauseScrubberPlayback,
  setScrubberPlaybackSpeed,
  toggleLock,
  overrideLock,
  undoRevision,
  redoRevision,
  restorePreviewRevision,
  jumpToLatestRevision,
  applyLanguageSelection,
  jumpToLine,
  emitStaticAnalysisPlan,
  openActionLauncher,
  clearCliEntries,
  clearLogs,
  createSnapshot,
  showReceipts,
  repoIngest,
  repoRefresh,
  repoStatus,
  repoSymbols,
  toggleDiagnosticsStrip,
  scaffoldFluxApp,
  scaffoldMcpServer,
}: ExecuteIdeCliCommandOptions): void {
  const trimmed = rawCommand.trim();
  if (!trimmed) return;

  const [rawName, ...rawArgs] = trimmed.split(/\s+/);
  const command = rawName.toLowerCase();
  const firstArg = rawArgs[0]?.toLowerCase();

  if (command === 'help') {
    appendCliEntry(
      'Commands: help, run, scaffold [flux|mcp], lint [workspace], format [workspace], build [file|workspace], replay [play|pause|speed <0.5|1|2|4>], lock, unlock, lock override, snapshot, receipts, repo ingest, repo refresh, repo status, repo symbols [query], diagnostics, undo, redo, restore, latest, language <ts|go|py|js>, goto <line>, plan, actions, clear',
      'info'
    );
    return;
  }

  if (command === 'run') {
    void runCode().then((result) => {
      appendCliEntry(
        `Run: ${result.outcome} (${result.execution_time_ms.toFixed(1)}ms)`,
        result.outcome === 'OUTCOME_OK' ? 'ok' : 'warn'
      );
    });
    return;
  }

  if (command === 'scaffold' || command === 'init') {
    if (firstArg === 'mcp' || firstArg === 'server') {
      scaffoldMcpServer();
    } else {
      scaffoldFluxApp();
    }
    return;
  }

  if (command === 'lint') {
    if (firstArg === 'workspace' || firstArg === 'all') {
      lintWorkspace();
      return;
    }
    triggerLintPass();
    return;
  }

  if (command === 'format') {
    if (firstArg === 'workspace' || firstArg === 'all') {
      formatWorkspace();
      return;
    }
    formatDocument();
    return;
  }

  if (command === 'build') {
    if (!firstArg || firstArg === 'file') {
      buildFile();
      return;
    }
    if (firstArg === 'workspace' || firstArg === 'all') {
      buildWorkspace();
      return;
    }
    appendCliEntry('Usage: build [file|workspace]', 'warn');
    return;
  }

  if (command === 'replay') {
    if (!firstArg) {
      if (scrubberPlaybackActive) {
        pauseScrubberPlayback();
        appendCliEntry('Scrub replay paused.', 'ok');
      } else {
        startScrubberPlayback();
        appendCliEntry('Scrub replay started.', 'ok');
      }
      return;
    }

    if (firstArg === 'play') {
      startScrubberPlayback();
      appendCliEntry('Scrub replay started.', 'ok');
      return;
    }

    if (firstArg === 'pause' || firstArg === 'stop') {
      pauseScrubberPlayback();
      appendCliEntry('Scrub replay paused.', 'ok');
      return;
    }

    if (firstArg === 'speed') {
      const nextSpeed = Number.parseFloat(rawArgs[1] || '');
      if (!Number.isFinite(nextSpeed) || ![0.5, 1, 2, 4].includes(nextSpeed)) {
        appendCliEntry('Usage: replay speed <0.5|1|2|4>', 'warn');
        return;
      }
      setScrubberPlaybackSpeed(nextSpeed);
      return;
    }

    appendCliEntry('Usage: replay [play|pause|speed <0.5|1|2|4>]', 'warn');
    return;
  }

  if (command === 'lock') {
    if (firstArg === 'override') {
      overrideLock();
      appendCliEntry('Lock override requested.', 'ok');
      return;
    }
    if (effectiveLockOwnerId === LOCAL_LOCK_OWNER_ID) {
      appendCliEntry('Editor lock is already held by you.', 'info');
      return;
    }
    toggleLock();
    appendCliEntry('Edit lock requested.', 'ok');
    return;
  }

  if (command === 'unlock') {
    if (effectiveLockOwnerId !== LOCAL_LOCK_OWNER_ID) {
      appendCliEntry('You do not currently own the lock.', 'warn');
      return;
    }
    toggleLock();
    appendCliEntry('Edit lock released.', 'ok');
    return;
  }

  if (command === 'snapshot') {
    createSnapshot();
    return;
  }

  if (command === 'receipts') {
    showReceipts();
    return;
  }

  if (command === 'repo') {
    if (firstArg === 'ingest') {
      repoIngest();
      return;
    }
    if (firstArg === 'refresh') {
      repoRefresh();
      return;
    }
    if (firstArg === 'status') {
      repoStatus();
      return;
    }
    if (firstArg === 'symbols') {
      const query = rawArgs.slice(1).join(' ').trim();
      repoSymbols(query.length > 0 ? query : undefined);
      return;
    }
    appendCliEntry(
      'Usage: repo <ingest|refresh|status|symbols [query]>',
      'warn'
    );
    return;
  }

  if (command === 'diagnostics') {
    toggleDiagnosticsStrip();
    return;
  }

  if (command === 'undo') {
    undoRevision();
    appendCliEntry('Undo applied.', 'ok');
    return;
  }

  if (command === 'redo') {
    redoRevision();
    appendCliEntry('Redo applied.', 'ok');
    return;
  }

  if (command === 'restore') {
    restorePreviewRevision();
    appendCliEntry('Preview revision restored.', 'ok');
    return;
  }

  if (command === 'latest') {
    jumpToLatestRevision();
    appendCliEntry('Revision cursor moved to latest.', 'ok');
    return;
  }

  if (command === 'language' || command === 'lang') {
    const parsedLanguage = parseLanguageAlias(firstArg);
    if (!parsedLanguage) {
      appendCliEntry('Unknown language alias.', 'error');
      return;
    }
    applyLanguageSelection(parsedLanguage);
    return;
  }

  if (command === 'goto') {
    const line = Number.parseInt(rawArgs[0] || '', 10);
    if (!Number.isFinite(line)) {
      appendCliEntry('Usage: goto <line>', 'warn');
      return;
    }
    jumpToLine(line);
    appendCliEntry(`Jumped to line ${line}.`, 'ok');
    return;
  }

  if (command === 'plan') {
    emitStaticAnalysisPlan();
    return;
  }

  if (command === 'actions') {
    openActionLauncher();
    return;
  }

  if (command === 'clear') {
    clearCliEntries();
    clearLogs();
    return;
  }

  appendCliEntry(`Unknown command: ${command}`, 'error');
}

export function handleIdeKeyboardShortcut(
  event: KeyboardEvent,
  {
    actionLauncherOpen,
    toggleCliPanel,
    openActionLauncher,
    openSymbolPicker,
    closeActionLauncher,
    openCli,
    runCode,
    save,
    undoRevision,
    redoRevision,
    toggleLock,
  }: HandleIdeKeyboardShortcutOptions
): void {
  const key = event.key.toLowerCase();
  const withModifier = event.ctrlKey || event.metaKey;
  const isTextInput = isEditableTarget(event.target);

  if (withModifier && key === 'k') {
    event.preventDefault();
    openActionLauncher();
    return;
  }

  if (withModifier && event.shiftKey && key === 'o') {
    event.preventDefault();
    openSymbolPicker();
    return;
  }

  if (withModifier && key === 'j') {
    event.preventDefault();
    toggleCliPanel();
    return;
  }

  if (actionLauncherOpen && key === 'escape') {
    event.preventDefault();
    closeActionLauncher();
    return;
  }

  if (actionLauncherOpen) {
    return;
  }

  if (withModifier && event.key === 'Enter') {
    event.preventDefault();
    void runCode();
  }
  if (withModifier && key === 's') {
    event.preventDefault();
    void save();
  }
  if (withModifier && key === 'z' && !event.shiftKey) {
    event.preventDefault();
    undoRevision();
  }
  if (
    (withModifier && key === 'z' && event.shiftKey) ||
    (withModifier && key === 'y')
  ) {
    event.preventDefault();
    redoRevision();
  }
  if (withModifier && event.shiftKey && key === 'l') {
    event.preventDefault();
    toggleLock();
  }

  if (!withModifier && !isTextInput && key === '/') {
    event.preventDefault();
    openCli();
  }
}
