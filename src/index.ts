/**
 * @affectively/aeon-container
 *
 * Runtime services for browser-based code execution: sandbox, filesystem,
 * linting, agent collaboration, and API routing.
 *
 * For IDE UI components and hooks, see @affectively/aeon-ide.
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
