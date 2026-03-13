/**
 * Aeon Container Types — Shared between browser + edge runtimes
 *
 * Re-exports the canonical types from edge-workers for use in shared-ui.
 * These are pure TypeScript types with no runtime dependencies.
 */

// ============================================
// EXECUTION
// ============================================

export type ContainerLanguage =
  | 'javascript'
  | 'typescript'
  | 'go'
  | 'lua'
  | 'tla'
  | 'gnosis'
  | 'python'
  | 'rust';

export interface ContainerExecuteRequest {
  code: string;
  language: ContainerLanguage;
  session_id?: string;
  timeout_ms?: number;
  memory_limit_bytes?: number;
  mounts?: ContainerMount[];
  context?: {
    cwd?: string;
    env?: Record<string, string>;
    argv?: string[];
  };
  filesystem?: AeonFSNode | { files?: FileEntry[] };
  ucan?: unknown;
}

export type ExecutionOutcome =
  | 'OUTCOME_OK'
  | 'OUTCOME_TIMEOUT'
  | 'OUTCOME_ERROR'
  | 'OUTCOME_MEMORY_EXCEEDED'
  | 'OUTCOME_UNSUPPORTED_LANGUAGE';

export interface ContainerExecuteResult {
  outcome: ExecutionOutcome;
  output: string;
  error?: string;
  logs: string[];
  execution_time_ms: number;
  filesystem_changes?: AeonFSChange[];
  language: ContainerLanguage;
  ast?: unknown;
  b1?: number;
  buleyMeasure?: number;
  execution_proof?: unknown;
}

// ============================================
// VIRTUAL FILESYSTEM
// ============================================

export interface AeonFSNode {
  id: string;
  did: string;
  type: 'file' | 'directory' | 'module';
  name: string;
  path: string;
  content?: string;
  children?: AeonFSNode[];
  permissions: AeonFSPermission[];
  metadata: AeonFSMetadata;
}

export interface AeonFSMetadata {
  language?: string;
  lastModified: number;
  hash: string;
  encrypted?: boolean;
}

export interface AeonFSPermission {
  did: string;
  capabilities: ('read' | 'write' | 'execute')[];
  xpath?: string;
  ucanProof?: string;
}

export interface AeonFSChange {
  path: string;
  type: 'create' | 'modify' | 'delete';
  content?: string;
  previousHash?: string;
  newHash: string;
}

// ============================================
// UCAN CAPABILITIES
// ============================================

export type ContainerCapability =
  | { can: 'aeon-container/execute'; with: string }
  | { can: 'aeon-container/fs/read'; with: string }
  | { can: 'aeon-container/fs/write'; with: string }
  | { can: 'aeon-container/share'; with: string }
  | { can: 'aeon-container/delegate'; with: string }
  | { can: 'aeon-container/logs/read'; with: string };

export interface ContainerMount {
  path: string;
  target: string;
}

export interface FileEntry {
  name?: string;
  path: string;
  content?: string;
  size?: number;
  type?: 'file' | 'directory' | 'module';
  language?: string;
  dirty?: boolean;
  isDirectory?: boolean;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ContainerLockState {
  locked?: boolean;
  container_id?: string;
  owner_did?: string;
  ownerId?: string;
  expiresAt?: number;
  lease_id?: string;
  heartbeat_at?: string | number;
  [key: string]: unknown;
}

export interface ExecutionReceipt {
  id: string;
  status: 'ok' | 'error' | 'timeout';
  output?: string;
  error?: string;
  timestamp?: number;
  event_type?: string;
  created_at?: string | number;
  actor_did?: string;
  [key: string]: unknown;
}

export interface RepoIngestInput {
  container_id?: string;
  repoUrl: string;
  branch?: string;
  commit?: string;
  mountPath?: string;
  source_type?: string;
  [key: string]: unknown;
}

// ============================================
// CONSTANTS
// ============================================

export const MAX_CODE_SIZE = 100_000;
export const MAX_TIMEOUT_MS = 30_000;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MEMORY_LIMIT = 8 * 1024 * 1024;
export const MAX_LOG_LINES = 1000;
export const MAX_OUTPUT_SIZE = 1024 * 1024;
export const OUTPUT_PREVIEW_LENGTH = 500;
