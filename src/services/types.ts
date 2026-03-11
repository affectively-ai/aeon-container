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
  | 'tla'
  | 'go'
  | 'python'
  | 'lua'
  | 'rust';

export interface ContainerExecuteRequest {
  code: string;
  language: ContainerLanguage;
  timeout_ms?: number;
  memory_limit_bytes?: number;
  context?: Record<string, unknown>;
  filesystem?: AeonFSNode;
  ucan?: string;
  session_id?: string;
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
  execution_proof?: string;
  language: ContainerLanguage;
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
  | { can: 'aeon-container/lint'; with: string }
  | { can: 'aeon-container/build'; with: string }
  | { can: 'aeon-container/format'; with: string }
  | { can: 'aeon-container/lock/acquire'; with: string }
  | { can: 'aeon-container/lock/override'; with: string }
  | { can: 'aeon-container/repo/ingest'; with: string }
  | { can: 'aeon-container/repo/read'; with: string }
  | { can: 'aeon-container/share'; with: string }
  | { can: 'aeon-container/delegate'; with: string }
  | { can: 'aeon-container/logs/read'; with: string };

export interface ContainerLockState {
  container_id: string;
  owner_did: string | null;
  lease_id: string | null;
  acquired_at?: number;
  expires_at?: number;
  heartbeat_at?: number;
}

export interface ExecutionReceipt {
  id: string;
  container_id: string;
  session_id?: string;
  event_type: 'execution' | 'lock-acquire' | 'lock-release' | 'lock-override';
  actor_did: string;
  capability: string;
  proof_hash: string;
  witness_hash: string;
  created_at: number;
  metadata_json?: string;
}

export interface RepoIngestInput {
  container_id: string;
  source_type: 'github-public' | 'github-private' | 'local-import';
  repo_url?: string;
  repo_ref?: string;
  auth_token?: string;
  files?: Array<{
    path: string;
    content: string;
    language?: string;
  }>;
}

// ============================================
// EXECUTION LOG
// ============================================

export interface ExecutionLogEntry {
  id: string;
  session_id: string;
  executor_did: string;
  code_hash: string;
  language: ContainerLanguage;
  outcome: string;
  output_preview: string;
  logs_count: number;
  execution_time_ms: number;
  execution_proof?: string;
  created_at: number;
}

// ============================================
// FILE ENTRY (for persistent FS UI)
// ============================================

export interface FileEntry {
  path: string;
  name: string;
  type: 'file' | 'directory';
  language?: string;
  size?: number;
  lastModified?: number;
  dirty?: boolean;
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
