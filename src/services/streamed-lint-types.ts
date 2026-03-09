/**
 * Streamed linting protocol/types for AeonContainerIDE.
 */

import type { ContainerLanguage } from './types';

export type StreamedLintLanguage = ContainerLanguage;

export type StreamedLintSeverity = 'error' | 'warning' | 'info';

export type StreamedLintEngine = 'swc-wasm' | 'rules';

export interface StreamedLintDiagnostic {
  id: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: StreamedLintSeverity;
  source: string;
  code: string;
  message: string;
}

export interface StreamedLintStats {
  total: number;
  errors: number;
  warnings: number;
  infos: number;
  elapsedMs: number;
  engine: StreamedLintEngine;
  supportsWasm: boolean;
}

export interface StreamedLintRequestMessage {
  type: 'lint';
  requestId: string;
  version: number;
  path: string;
  language: StreamedLintLanguage;
  content: string;
  maxDiagnostics?: number;
}

export interface StreamedLintCancelMessage {
  type: 'cancel';
  requestId: string;
}

export interface StreamedLintStartedMessage {
  type: 'started';
  requestId: string;
  version: number;
  engine: StreamedLintEngine;
  supportsWasm: boolean;
}

export interface StreamedLintChunkMessage {
  type: 'chunk';
  requestId: string;
  version: number;
  diagnostics: StreamedLintDiagnostic[];
  progress: number;
}

export interface StreamedLintDoneMessage {
  type: 'done';
  requestId: string;
  version: number;
  stats: StreamedLintStats;
}

export interface StreamedLintErrorMessage {
  type: 'error';
  requestId: string;
  version: number;
  error: string;
}

export type StreamedLintWorkerInbound =
  | StreamedLintRequestMessage
  | StreamedLintCancelMessage;

export type StreamedLintWorkerOutbound =
  | StreamedLintStartedMessage
  | StreamedLintChunkMessage
  | StreamedLintDoneMessage
  | StreamedLintErrorMessage;
