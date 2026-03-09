/**
 * Browser/client wrapper for streamed lint worker protocol.
 */

import { lintDocumentCore } from './streamed-lint-core';
import type {
  StreamedLintDiagnostic,
  StreamedLintDoneMessage,
  StreamedLintRequestMessage,
  StreamedLintStartedMessage,
  StreamedLintStats,
  StreamedLintWorkerOutbound,
  StreamedLintLanguage,
} from './streamed-lint-types';

interface StreamedLintCallbacks {
  onStarted?: (message: StreamedLintStartedMessage) => void;
  onChunk?: (diagnostics: StreamedLintDiagnostic[], progress: number) => void;
  onDone?: (stats: StreamedLintStats) => void;
  onError?: (errorMessage: string) => void;
}

interface StreamedLintRunConfig extends StreamedLintCallbacks {
  version: number;
  path: string;
  language: StreamedLintLanguage;
  content: string;
  maxDiagnostics?: number;
}

interface StreamedLintHandlerState {
  version: number;
  callbacks: StreamedLintCallbacks;
  canceled: boolean;
}

export interface StreamedLintHandle {
  requestId: string;
  cancel: () => void;
}

const FALLBACK_CHUNK_SIZE = 24;

export class StreamedLintClient {
  private worker: Worker | null = null;
  private handlers = new Map<string, StreamedLintHandlerState>();
  private disposed = false;

  constructor() {
    if (typeof Worker === 'undefined') {
      return;
    }

    try {
      this.worker = new Worker(
        new URL('./streamed-lint.worker.ts', import.meta.url),
        { type: 'module' }
      );
      this.worker.onmessage = (
        event: MessageEvent<StreamedLintWorkerOutbound>
      ) => {
        this.handleWorkerMessage(event.data);
      };
      this.worker.onerror = () => {
        // Keep IDE responsive if worker crashes: revert to fallback execution.
        this.worker = null;
      };
    } catch {
      this.worker = null;
    }
  }

  lint(config: StreamedLintRunConfig): StreamedLintHandle {
    const requestId = createRequestId();
    const handlerState: StreamedLintHandlerState = {
      version: config.version,
      callbacks: {
        onStarted: config.onStarted,
        onChunk: config.onChunk,
        onDone: config.onDone,
        onError: config.onError,
      },
      canceled: false,
    };
    this.handlers.set(requestId, handlerState);

    if (this.worker) {
      const request: StreamedLintRequestMessage = {
        type: 'lint',
        requestId,
        version: config.version,
        path: config.path,
        language: config.language,
        content: config.content,
        maxDiagnostics: config.maxDiagnostics,
      };
      this.worker.postMessage(request);
    } else {
      void this.runFallbackLint(requestId, config);
    }

    return {
      requestId,
      cancel: () => {
        const state = this.handlers.get(requestId);
        if (!state) return;
        state.canceled = true;
        if (this.worker) {
          this.worker.postMessage({
            type: 'cancel',
            requestId,
          });
        }
        this.handlers.delete(requestId);
      },
    };
  }

  dispose(): void {
    this.disposed = true;
    this.handlers.clear();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  private handleWorkerMessage(message: StreamedLintWorkerOutbound): void {
    if (this.disposed) return;
    const state = this.handlers.get(message.requestId);
    if (!state || state.canceled || state.version !== message.version) {
      return;
    }

    switch (message.type) {
      case 'started':
        state.callbacks.onStarted?.(message);
        break;
      case 'chunk':
        state.callbacks.onChunk?.(message.diagnostics, message.progress);
        break;
      case 'done':
        state.callbacks.onDone?.(message.stats);
        this.handlers.delete(message.requestId);
        break;
      case 'error':
        state.callbacks.onError?.(message.error);
        this.handlers.delete(message.requestId);
        break;
      default:
        break;
    }
  }

  private async runFallbackLint(
    requestId: string,
    config: StreamedLintRunConfig
  ): Promise<void> {
    const state = this.handlers.get(requestId);
    if (!state || this.disposed || state.canceled) return;
    const startedAt = Date.now();

    state.callbacks.onStarted?.({
      type: 'started',
      requestId,
      version: config.version,
      engine: 'rules',
      supportsWasm: false,
    });

    const output = lintDocumentCore({
      path: config.path,
      language: config.language,
      content: config.content,
      maxDiagnostics: config.maxDiagnostics ?? 240,
    });

    const total = output.diagnostics.length;
    const chunkCount = Math.ceil(total / FALLBACK_CHUNK_SIZE);

    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const latestState = this.handlers.get(requestId);
      if (!latestState || latestState.canceled) {
        this.handlers.delete(requestId);
        return;
      }

      const start = chunkIndex * FALLBACK_CHUNK_SIZE;
      const end = start + FALLBACK_CHUNK_SIZE;
      const chunk = output.diagnostics.slice(start, end);
      const progress = Math.min(1, end / Math.max(total, 1));
      latestState.callbacks.onChunk?.(chunk, progress);

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }

    const latestState = this.handlers.get(requestId);
    if (!latestState || latestState.canceled) {
      this.handlers.delete(requestId);
      return;
    }

    const doneMessage: StreamedLintDoneMessage = {
      type: 'done',
      requestId,
      version: config.version,
      stats: {
        total,
        errors: output.diagnostics.filter((item) => item.severity === 'error')
          .length,
        warnings: output.diagnostics.filter(
          (item) => item.severity === 'warning'
        ).length,
        infos: output.diagnostics.filter((item) => item.severity === 'info')
          .length,
        elapsedMs: Date.now() - startedAt,
        engine: output.engine,
        supportsWasm: output.supportsWasm,
      },
    };

    latestState.callbacks.onDone?.(doneMessage.stats);
    this.handlers.delete(requestId);
  }
}

function createRequestId(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `lint-${Date.now().toString(36)}-${random}`;
}
