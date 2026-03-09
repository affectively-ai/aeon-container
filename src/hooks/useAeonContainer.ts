/**
 * useAeonContainer — Orchestration hook for Aeon Container IDE
 *
 * Manages the browser sandbox, persistent filesystem, and DashRelay sync.
 * Provides a unified API for executing code, managing files, and tracking state.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { BrowserSandbox } from '../services/browser-sandbox';
import { PersistentFS } from '../services/persistent-fs';
import type {
  ContainerExecuteResult,
  ContainerLanguage,
  FileEntry,
  ContainerLockState,
  ExecutionReceipt,
  RepoIngestInput,
} from '../services/types';
import type { ExecutionLogEntry } from '../components/ExecutionConsole';
import {
  disconnectPeerSync,
  getYjsDoc,
  initializePeerSync,
  subscribeToSyncStatus,
} from '@emotions-app/shared-ui/services/dash/dashPeerSyncService';

// ── Types ────────────────────────────────────────────────────────

interface UseAeonContainerConfig {
  containerId: string;
  apiUrl?: string;
  ucanToken?: string;
  dashRelayUrl?: string;
  mode?: 'browser' | 'edge' | 'auto';
  initialFiles?: Array<{ path: string; content: string }>;
}

interface UseAeonContainerReturn {
  // Execution
  execute: (
    code: string,
    language?: ContainerLanguage
  ) => Promise<ContainerExecuteResult>;
  isExecuting: boolean;
  lastResult: ContainerExecuteResult | null;

  // Filesystem
  files: FileEntry[];
  activeFile: string | null;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  deleteFile: (path: string) => Promise<void>;
  setActiveFile: (path: string | null) => void;

  // Sync state
  connected: boolean;
  syncing: boolean;
  dirty: boolean;

  // Collaboration lock
  lockState: ContainerLockState;
  acquireLock: (
    leaseMs?: number
  ) => Promise<{ lease_id: string; expires_at: number }>;
  heartbeatLock: (leaseMs?: number) => Promise<void>;
  releaseLock: () => Promise<void>;
  overrideLock: (
    leaseMs?: number
  ) => Promise<{ lease_id: string; expires_at: number }>;

  // Receipts + repo index
  getReceipts: (limit?: number) => Promise<ExecutionReceipt[]>;
  createSnapshot: () => Promise<{
    snapshot_id: string;
    snapshot_key: string;
    files_count: number;
    manifest_hash: string;
    timestamp: number;
  }>;
  ingestRepo: (
    input: Omit<RepoIngestInput, 'container_id'>
  ) => Promise<{ repo_id: string; indexed_files: number; symbols: number }>;
  getRepoStatus: (repoId: string) => Promise<Record<string, unknown>>;
  getRepoFile: (
    repoId: string,
    path: string
  ) => Promise<{ content: string; language?: string }>;
  getRepoSymbols: (
    repoId: string,
    query?: string
  ) => Promise<Array<Record<string, unknown>>>;
  refreshRepo: (repoId: string) => Promise<{ job_id: string; status: string }>;

  // Execution history
  logs: ExecutionLogEntry[];
  clearLogs: () => void;

  // Mode
  executionMode: 'browser' | 'edge';
  setExecutionMode: (mode: 'browser' | 'edge') => void;

  // Actions
  save: () => Promise<void>;
}

// ── Hook ─────────────────────────────────────────────────────────

export function useAeonContainer(
  config: UseAeonContainerConfig
): UseAeonContainerReturn {
  const {
    containerId,
    apiUrl = '',
    ucanToken,
    dashRelayUrl,
    mode = 'auto',
    initialFiles,
  } = config;

  // Refs for stable references
  const sandboxRef = useRef<BrowserSandbox | null>(null);
  const fsRef = useRef<PersistentFS | null>(null);

  // State
  const [isExecuting, setIsExecuting] = useState(false);
  const [lastResult, setLastResult] = useState<ContainerExecuteResult | null>(
    null
  );
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [lockState, setLockState] = useState<ContainerLockState>({
    container_id: containerId,
    owner_did: null,
    lease_id: null,
  });
  const [logs, setLogs] = useState<ExecutionLogEntry[]>([]);
  const [executionMode, setExecutionMode] = useState<'browser' | 'edge'>(
    mode === 'edge' ? 'edge' : 'browser'
  );

  // Initialize sandbox and filesystem
  useEffect(() => {
    // Browser sandbox (singleton)
    const sandbox = BrowserSandbox.getInstance();
    if (apiUrl) {
      sandbox.setEdgeFallbackUrl(apiUrl);
    }
    sandboxRef.current = sandbox;

    // Pre-load WASM
    sandbox.ensureLoaded().then((ready) => {
      if (!ready && mode === 'auto') {
        setExecutionMode('edge');
      }
    });

    // Persistent filesystem (Dash -> D1 bridge)
    const fs = new PersistentFS(containerId, {
      apiUrl,
      ucanToken,
      dashRelayRoom: dashRelayUrl ? `aeon-fs:${containerId}` : undefined,
      syncPolicy: 'dash-d1',
    });
    fsRef.current = fs;

    const cleanups: Array<() => void> = [];

    if (dashRelayUrl) {
      initializePeerSync(undefined, {
        roomName: `aeon-fs:${containerId}`,
        relayWsUrl: dashRelayUrl,
      })
        .then(() => {
          const doc = getYjsDoc();
          if (doc) {
            fs.connectDashRelay(doc);
          }
        })
        .catch(() => {
          setConnected(false);
        });

      cleanups.push(
        subscribeToSyncStatus((status) => {
          setConnected(status.connected);
        })
      );
    } else {
      setConnected(false);
    }

    // Seed initial files if provided
    if (initialFiles && initialFiles.length > 0) {
      fs.seedFiles(initialFiles);
      setFiles(fs.listFiles());
      // Auto-select first file
      if (initialFiles.length > 0) {
        const firstFile =
          initialFiles.find(
            (f) => f.path.endsWith('.ts') || f.path.endsWith('.js')
          ) || initialFiles[0];
        setActiveFile(
          firstFile.path.startsWith('/') ? firstFile.path : `/${firstFile.path}`
        );
      }
    } else if (apiUrl) {
      // Load from backend
      fs.loadFromBackend()
        .then(() => {
          setFiles(fs.listFiles());
        })
        .catch(() => {
          // No backend files — start empty
        });
    }

    return () => {
      // Cleanup: flush any dirty files
      if (fsRef.current?.dirty) {
        fsRef.current.syncToBackend().catch(() => {
          /* noop - fire-and-forget */
        });
      }
      fs.dispose();
      cleanups.forEach((cleanup) => cleanup());
      disconnectPeerSync();
    };
  }, [containerId, apiUrl, ucanToken, dashRelayUrl, mode]);

  // Update files list when filesystem changes
  const refreshFiles = useCallback(() => {
    if (fsRef.current) {
      setFiles(fsRef.current.listFiles());
      setDirty(fsRef.current.dirty);
    }
  }, []);

  // ── Execute ────────────────────────────────────────────────────

  const execute = useCallback(
    async (
      code: string,
      language: ContainerLanguage = 'javascript'
    ): Promise<ContainerExecuteResult> => {
      setIsExecuting(true);

      try {
        const sandbox = sandboxRef.current;
        if (!sandbox) {
          throw new Error('Sandbox not initialized');
        }

        // Build filesystem for sandbox context
        const filesystem = fsRef.current?.toFSNode();

        const result = await sandbox.execute({
          code,
          language,
          filesystem,
          ucan: ucanToken,
          session_id: `ide:${containerId}`,
        });

        setLastResult(result);

        // Add to execution log
        const logEntry: ExecutionLogEntry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(),
          result,
          code: code.slice(0, 200),
        };
        setLogs((prev) => [...prev, logEntry]);

        return result;
      } catch (err) {
        const errorResult: ContainerExecuteResult = {
          outcome: 'OUTCOME_ERROR',
          output: '',
          error: err instanceof Error ? err.message : String(err),
          logs: [],
          execution_time_ms: 0,
          language,
        };
        setLastResult(errorResult);

        const logEntry: ExecutionLogEntry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(),
          result: errorResult,
        };
        setLogs((prev) => [...prev, logEntry]);

        return errorResult;
      } finally {
        setIsExecuting(false);
      }
    },
    [containerId, ucanToken]
  );

  // ── File Operations ────────────────────────────────────────────

  const readFile = useCallback(async (path: string): Promise<string> => {
    if (!fsRef.current) return '';
    const content = await fsRef.current.readFile(path);
    return content;
  }, []);

  const writeFile = useCallback(
    async (path: string, content: string): Promise<void> => {
      if (!fsRef.current) return;
      await fsRef.current.writeFile(path, content);
      refreshFiles();
    },
    [refreshFiles]
  );

  const deleteFile = useCallback(
    async (path: string): Promise<void> => {
      if (!fsRef.current) return;
      await fsRef.current.deleteFile(path);
      refreshFiles();
    },
    [refreshFiles]
  );

  // ── Sync ───────────────────────────────────────────────────────

  const save = useCallback(async (): Promise<void> => {
    if (!fsRef.current) return;
    setSyncing(true);
    try {
      await fsRef.current.syncToBackend();
      refreshFiles();
    } finally {
      setSyncing(false);
    }
  }, [refreshFiles]);

  const refreshLockState =
    useCallback(async (): Promise<ContainerLockState> => {
      if (!fsRef.current) {
        const fallback: ContainerLockState = {
          container_id: containerId,
          owner_did: null,
          lease_id: null,
        };
        setLockState(fallback);
        return fallback;
      }
      const nextLockState = await fsRef.current.getLockState();
      setLockState(nextLockState);
      return nextLockState;
    }, [containerId]);

  useEffect(() => {
    let canceled = false;
    const tick = async () => {
      try {
        const state = await refreshLockState();
        if (!canceled) {
          setLockState(state);
        }
      } catch {
        /* noop */
      }
    };
    void tick();
    const interval = setInterval(() => {
      void tick();
    }, 2500);
    return () => {
      canceled = true;
      clearInterval(interval);
    };
  }, [refreshLockState]);

  const acquireLock = useCallback(
    async (leaseMs = 90_000) => {
      if (!fsRef.current) {
        throw new Error('Filesystem not initialized');
      }
      const lock = await fsRef.current.acquireLock(leaseMs);
      setLockState((prev) => ({
        ...prev,
        container_id: containerId,
        owner_did: 'you',
        lease_id: lock.lease_id,
        expires_at: lock.expires_at,
      }));
      return lock;
    },
    [containerId]
  );

  const heartbeatLock = useCallback(
    async (leaseMs = 90_000): Promise<void> => {
      if (!fsRef.current) return;
      if (!lockState.lease_id) return;
      const lease = await fsRef.current.heartbeatLock(
        lockState.lease_id,
        leaseMs
      );
      setLockState((prev) => ({
        ...prev,
        heartbeat_at: lease.heartbeat_at,
        expires_at: lease.expires_at,
      }));
    },
    [lockState.lease_id]
  );

  const releaseLock = useCallback(async (): Promise<void> => {
    if (!fsRef.current) return;
    await fsRef.current.releaseLock(lockState.lease_id || undefined);
    setLockState({
      container_id: containerId,
      owner_did: null,
      lease_id: null,
    });
  }, [containerId, lockState.lease_id]);

  const overrideLock = useCallback(
    async (leaseMs = 90_000) => {
      if (!fsRef.current) {
        throw new Error('Filesystem not initialized');
      }
      const lease = await fsRef.current.overrideLock(leaseMs);
      setLockState((prev) => ({
        ...prev,
        container_id: containerId,
        owner_did: 'you',
        lease_id: lease.lease_id,
        expires_at: lease.expires_at,
      }));
      return lease;
    },
    [containerId]
  );

  const getReceipts = useCallback(async (limit = 120) => {
    if (!fsRef.current) return [];
    return fsRef.current.getReceipts(limit);
  }, []);

  const createSnapshot = useCallback(async () => {
    if (!fsRef.current) {
      throw new Error('Filesystem not initialized');
    }
    return fsRef.current.createSnapshot();
  }, []);

  const ingestRepo = useCallback(
    async (input: Omit<RepoIngestInput, 'container_id'>) => {
      if (!fsRef.current) {
        throw new Error('Filesystem not initialized');
      }
      return fsRef.current.ingestRepo(input);
    },
    []
  );

  const getRepoStatus = useCallback(async (repoId: string) => {
    if (!fsRef.current) {
      throw new Error('Filesystem not initialized');
    }
    return fsRef.current.getRepoStatus(repoId);
  }, []);

  const getRepoFile = useCallback(async (repoId: string, path: string) => {
    if (!fsRef.current) {
      throw new Error('Filesystem not initialized');
    }
    return fsRef.current.getRepoFile(repoId, path);
  }, []);

  const getRepoSymbols = useCallback(async (repoId: string, query?: string) => {
    if (!fsRef.current) {
      throw new Error('Filesystem not initialized');
    }
    return fsRef.current.getRepoSymbols(repoId, query);
  }, []);

  const refreshRepo = useCallback(async (repoId: string) => {
    if (!fsRef.current) {
      throw new Error('Filesystem not initialized');
    }
    return fsRef.current.refreshRepo(repoId);
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  return {
    execute,
    isExecuting,
    lastResult,
    files,
    activeFile,
    readFile,
    writeFile,
    deleteFile,
    setActiveFile,
    connected,
    syncing,
    dirty,
    lockState,
    acquireLock,
    heartbeatLock,
    releaseLock,
    overrideLock,
    getReceipts,
    createSnapshot,
    ingestRepo,
    getRepoStatus,
    getRepoFile,
    getRepoSymbols,
    refreshRepo,
    logs,
    clearLogs,
    executionMode,
    setExecutionMode,
    save,
  };
}
