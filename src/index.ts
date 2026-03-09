/**
 * @affectively/aeon-container
 *
 * Browser sandbox, persistent filesystem, and IDE components for code execution.
 * Extracted from shared-ui to keep aeon-* code in the open-source namespace.
 */

// ── Services ────────────────────────────────────────────────────────
export { BrowserSandbox } from './services/browser-sandbox';
export { PersistentFS } from './services/persistent-fs';
export type { PersistentFSConfig } from './services/persistent-fs';
export { AgentRoomClient } from './services/agent-room-client';
export {
  createApiRoutes,
  type AeonContainerApiConfig,
} from './services/api-routes';
export {
  type DevWritebackConfig,
  DevWritebackManager,
} from './services/dev-writeback';
export { lintDocumentCore } from './services/streamed-lint-core';
export { StreamedLintClient } from './services/streamed-lint-client';
export type {
  ContainerExecuteResult,
  ContainerLanguage,
  FileEntry,
  ContainerLockState,
  ExecutionReceipt,
  RepoIngestInput,
  ContainerExecRequest,
  ContainerExecResponse,
  ContainerFSNode,
  AeonContainerEnv,
} from './services/types';

// ── Components ──────────────────────────────────────────────────────
export { AeonContainerIDE } from './components/AeonContainerIDE';
export { AeonIdeEditorPane } from './components/AeonIdeEditorPane';
export { AeonIdePanels } from './components/AeonIdePanels';
export { CapabilityBadge } from './components/CapabilityBadge';
export { ExecutionConsole } from './components/ExecutionConsole';
export type { ExecutionLogEntry } from './components/ExecutionConsole';
export { ExecutionToolbar } from './components/ExecutionToolbar';
export { FileTree } from './components/FileTree';

// ── Hooks ───────────────────────────────────────────────────────────
export { useAeonContainer } from './hooks/useAeonContainer';
export { useAgentRoomCollaboration } from './hooks/useAgentRoomCollaboration';
