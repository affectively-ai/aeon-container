/**
 * WebWorker entrypoint for streamed linting diagnostics.
 */

import initSwc, { parseSync } from '@swc/wasm-web';
import { lintDocumentCore } from './streamed-lint-core';
import type {
  StreamedLintRequestMessage,
  StreamedLintWorkerInbound,
  StreamedLintWorkerOutbound,
  StreamedLintStats,
} from './streamed-lint-types';

const CHUNK_SIZE = 24;

let swcReady: Promise<boolean> | null = null;
const canceledRequestIds = new Set<string>();

function postMessageToMain(message: StreamedLintWorkerOutbound): void {
  self.postMessage(message);
}

function sleepFrame(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function ensureSwcReady(): Promise<boolean> {
  if (swcReady) {
    return swcReady;
  }

  swcReady = (async () => {
    try {
      await initSwc();
      return true;
    } catch {
      return false;
    }
  })();

  return swcReady;
}

function isCancelled(requestId: string): boolean {
  return canceledRequestIds.has(requestId);
}

async function handleLintRequest(
  message: StreamedLintRequestMessage
): Promise<void> {
  const startedAt = Date.now();
  const supportsWasm =
    (message.language === 'javascript' || message.language === 'typescript') &&
    (await ensureSwcReady());

  postMessageToMain({
    type: 'started',
    requestId: message.requestId,
    version: message.version,
    engine: supportsWasm ? 'swc-wasm' : 'rules',
    supportsWasm,
  });

  if (isCancelled(message.requestId)) {
    canceledRequestIds.delete(message.requestId);
    return;
  }

  try {
    const lintOutput = lintDocumentCore({
      path: message.path,
      language: message.language,
      content: message.content,
      maxDiagnostics: message.maxDiagnostics ?? 240,
      parseWithSwc: supportsWasm
        ? (content, options) => parseSync(content, options)
        : undefined,
    });

    const diagnostics = lintOutput.diagnostics;
    const total = diagnostics.length;
    const chunkCount = Math.ceil(total / CHUNK_SIZE);

    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      if (isCancelled(message.requestId)) {
        canceledRequestIds.delete(message.requestId);
        return;
      }

      const start = chunkIndex * CHUNK_SIZE;
      const end = start + CHUNK_SIZE;
      const chunk = diagnostics.slice(start, end);
      const progress = Math.min(1, end / Math.max(total, 1));

      postMessageToMain({
        type: 'chunk',
        requestId: message.requestId,
        version: message.version,
        diagnostics: chunk,
        progress,
      });

      await sleepFrame();
    }

    const stats: StreamedLintStats = {
      total,
      errors: diagnostics.filter((item) => item.severity === 'error').length,
      warnings: diagnostics.filter((item) => item.severity === 'warning')
        .length,
      infos: diagnostics.filter((item) => item.severity === 'info').length,
      elapsedMs: Date.now() - startedAt,
      engine: lintOutput.engine,
      supportsWasm: lintOutput.supportsWasm,
    };

    postMessageToMain({
      type: 'done',
      requestId: message.requestId,
      version: message.version,
      stats,
    });
    canceledRequestIds.delete(message.requestId);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    postMessageToMain({
      type: 'error',
      requestId: message.requestId,
      version: message.version,
      error: errorMessage,
    });
    canceledRequestIds.delete(message.requestId);
  }
}

self.onmessage = (event: MessageEvent<StreamedLintWorkerInbound>) => {
  const message = event.data;
  if (!message) return;

  if (message.type === 'cancel') {
    canceledRequestIds.add(message.requestId);
    return;
  }

  void handleLintRequest(message);
};
