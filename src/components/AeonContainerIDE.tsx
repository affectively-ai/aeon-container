'use aeon';

/**
 * AeonContainerIDE — Browser-First Execution + Persistent Filesystem
 *
 * Top-level React component that composes the Capacitor editor,
 * file tree, execution console, and UCAN capability display.
 *
 * QuickJS WASM runs code in the browser — private, fast, and free.
 * Falls back to edge API for persistence, logging, and multi-agent.
 */

import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import type {
  ContainerLanguage,
  ContainerExecuteResult,
  AeonFSChange,
} from '../services/types';
import {
  StreamedLintClient,
  type StreamedLintHandle,
} from '../services/streamed-lint-client';
import type {
  StreamedLintDiagnostic,
  StreamedLintLanguage,
  StreamedLintStats,
} from '../services/streamed-lint-types';
import { lintDocumentCore } from '../services/streamed-lint-core';
import { useAeonContainer } from '../../hooks/useAeonContainer';
import { useAgentRoomCollaboration } from '../../hooks/useAgentRoomCollaboration';
import { FileTree } from './FileTree';
import { ExecutionConsole } from './ExecutionConsole';
import { ExecutionToolbar } from './ExecutionToolbar';
import { CapabilityBadge } from './CapabilityBadge';
import {
  AeonIdeCodeEditor,
  AeonIdeRevisionScrubber,
} from './AeonIdeEditorPane';
import {
  AeonIdeActionLauncher,
  AeonIdeCollaborationPanel,
  AeonIdeCommandCli,
} from './AeonIdePanels';
import {
  buildIdeActions,
  executeIdeCliCommand,
  handleIdeKeyboardShortcut,
  type IdeAction,
  type IdeCliLevel,
} from './aeon-ide-commands';
import {
  LOCAL_LOCK_OWNER_ID,
  buildStaticAnalysisPlan,
  formatDocumentContent,
  getDefaultContent,
  inferLanguageFromPath,
} from './aeon-ide-helpers';
import {
  appendRevisionSnapshot,
  ensureRevisionTimeline,
  getVisibleRevisionIndex,
  getVisibleRevisionSnapshot,
  moveRevisionCursor,
  restoreRevisionPreview,
  setRevisionPreviewIndex,
  type RevisionTimeline,
} from './revision-history';

// ── Types ────────────────────────────────────────────────────────

export interface AeonContainerIDEProps {
  /** Container identifier */
  containerId: string;
  /** Edge API URL (default: infer from env) */
  apiUrl?: string;
  /** UCAN Bearer token */
  ucanToken?: string;
  /** DashRelay WebSocket URL */
  dashRelayUrl?: string;
  /** Seed files for new containers */
  initialFiles?: Array<{ path: string; content: string }>;
  /** Execution mode (default: auto = browser-first) */
  mode?: 'browser' | 'edge' | 'auto';
  /** Enable writeback to real files */
  devMode?: boolean;
  /** Callback when files change */
  onFilesChanged?: (changes: AeonFSChange[]) => void;
  /** UCAN tier for display */
  tier?: 'free' | 'pro' | 'enterprise' | 'admin' | null;
  /** Agent DID for display */
  agentDid?: string;
  /** Optional room ID for IDE embedded collaboration panel. */
  agentRoomId?: string;
  /** Snapshot/presence poll interval for the room panel. */
  agentRoomPollMs?: number;
  /** Current collaborative lock owner (null = unlocked). If omitted, lock is local-only. */
  lockOwnerId?: string | null;
  /** Callback for lock owner changes */
  onLockChange?: (ownerId: string | null) => void;
}

const EDITOR_LINE_HEIGHT_PX = 24;
const SCRUBBER_REPLAY_SPEEDS = [0.5, 1, 2, 4] as const;

type InlineDiagnostic = StreamedLintDiagnostic;

interface CliEntry {
  id: string;
  text: string;
  level: IdeCliLevel;
}

interface RepoSymbolEntry {
  id: string;
  symbolName: string;
  symbolKind: string;
  filePath: string;
  line: number;
  column: number;
}

// ── Component ────────────────────────────────────────────────────

export function AeonContainerIDE({
  containerId,
  apiUrl,
  ucanToken,
  dashRelayUrl,
  initialFiles,
  mode = 'auto',
  devMode = false,
  onFilesChanged,
  tier = null,
  agentDid,
  agentRoomId,
  agentRoomPollMs,
  lockOwnerId,
  onLockChange,
}: AeonContainerIDEProps) {
  const {
    execute,
    isExecuting,
    files,
    activeFile,
    readFile,
    writeFile,
    deleteFile,
    setActiveFile,
    connected,
    syncing,
    dirty,
    logs,
    clearLogs,
    executionMode,
    setExecutionMode,
    save,
    lockState,
    acquireLock,
    heartbeatLock,
    releaseLock,
    overrideLock,
    getReceipts,
    createSnapshot,
    ingestRepo,
    getRepoFile,
    getRepoStatus,
    getRepoSymbols,
    refreshRepo,
  } = useAeonContainer({
    containerId,
    apiUrl,
    ucanToken,
    dashRelayUrl,
    mode,
    initialFiles,
  });

  const [language, setLanguage] = useState<ContainerLanguage>('javascript');
  const [editorContent, setEditorContent] = useState('');
  const [revisionTimelines, setRevisionTimelines] = useState<
    Record<string, RevisionTimeline>
  >({});
  const revisionTimelinesRef = useRef<Record<string, RevisionTimeline>>({});
  const [localLockOwnerId, setLocalLockOwnerId] = useState<string | null>(null);
  const [localLeaseId, setLocalLeaseId] = useState<string | null>(null);
  const [editorScrollTop, setEditorScrollTop] = useState(0);
  const [editorViewportHeight, setEditorViewportHeight] = useState(0);
  const [inlineDiagnostics, setInlineDiagnostics] = useState<
    InlineDiagnostic[]
  >([]);
  const [lintStatus, setLintStatus] = useState<'idle' | 'running' | 'done'>(
    'idle'
  );
  const [lintProgress, setLintProgress] = useState(0);
  const [lintStats, setLintStats] = useState<StreamedLintStats | null>(null);
  const [lintTriggerToken, setLintTriggerToken] = useState(0);
  const [actionLauncherOpen, setActionLauncherOpen] = useState(false);
  const [actionLauncherMode, setActionLauncherMode] = useState<
    'actions' | 'symbols'
  >('actions');
  const [actionQuery, setActionQuery] = useState('');
  const [actionCursor, setActionCursor] = useState(0);
  const [symbolEntries, setSymbolEntries] = useState<RepoSymbolEntry[]>([]);
  const [symbolsLoading, setSymbolsLoading] = useState(false);
  const [symbolsError, setSymbolsError] = useState<string | null>(null);
  const [scrubberPlaybackActive, setScrubberPlaybackActive] = useState(false);
  const [scrubberPlaybackSpeed, setScrubberPlaybackSpeed] = useState(1);
  const [cliOpen, setCliOpen] = useState(true);
  const [cliInput, setCliInput] = useState('');
  const [cliEntries, setCliEntries] = useState<CliEntry[]>([]);
  const [cliHistory, setCliHistory] = useState<string[]>([]);
  const [cliHistoryIndex, setCliHistoryIndex] = useState(-1);
  const [diagnosticsStripEnabled, setDiagnosticsStripEnabled] = useState(true);
  const [activeRepoId, setActiveRepoId] = useState<string | null>(null);
  const [lockNowMs, setLockNowMs] = useState(() => Date.now());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumberGutterRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef(0);
  const lintClientRef = useRef<StreamedLintClient | null>(null);
  const lintRequestRef = useRef<StreamedLintHandle | null>(null);
  const lintVersionRef = useRef(0);
  const lintBufferedDiagnosticsRef = useRef<InlineDiagnostic[]>([]);
  const cliOutputRef = useRef<HTMLDivElement>(null);
  const actionInputRef = useRef<HTMLInputElement>(null);
  const cliInputRef = useRef<HTMLInputElement>(null);
  const cliDraftRef = useRef('');
  const collaborationAgentId =
    agentDid && agentDid.length > 0
      ? agentDid
      : `ide:${containerId.slice(0, 16) || 'local'}`;
  const roomHeartbeatStatus = isExecuting
    ? 'testing'
    : activeFile
    ? 'editing'
    : 'online';
  const roomCollaboration = useAgentRoomCollaboration({
    apiUrl,
    roomId: agentRoomId,
    ucanToken,
    agentId: collaborationAgentId,
    heartbeatStatus: roomHeartbeatStatus,
    currentFile: activeFile || undefined,
    pollMs: agentRoomPollMs,
  });
  const showRoomPanel = Boolean(agentRoomId);
  const symbolFetchVersionRef = useRef(0);

  const isLockExternallyControlled = lockOwnerId !== undefined;
  const remoteLockOwnerId = lockState.owner_did
    ? lockState.owner_did === LOCAL_LOCK_OWNER_ID ||
      (agentDid && lockState.owner_did === agentDid)
      ? LOCAL_LOCK_OWNER_ID
      : lockState.owner_did
    : null;
  const effectiveLockOwnerId = isLockExternallyControlled
    ? lockOwnerId || null
    : remoteLockOwnerId || localLockOwnerId;
  const editorLockedByOther =
    effectiveLockOwnerId !== null &&
    effectiveLockOwnerId !== LOCAL_LOCK_OWNER_ID;

  const activeTimeline = activeFile ? revisionTimelines[activeFile] : undefined;
  const activeSnapshotCount = activeTimeline
    ? activeTimeline.snapshots.length
    : 0;
  const activeVisibleIndex = activeTimeline
    ? getVisibleRevisionIndex(activeTimeline)
    : 0;
  const activeVisibleSnapshot = activeTimeline
    ? getVisibleRevisionSnapshot(activeTimeline)
    : null;
  const activePreviewing = Boolean(
    activeTimeline && activeTimeline.previewIndex !== null
  );
  const activePreviewDiffers = Boolean(
    activeTimeline &&
      activeTimeline.previewIndex !== null &&
      activeTimeline.previewIndex !== activeTimeline.cursor
  );
  const canUndo = Boolean(activeTimeline && activeTimeline.cursor > 0);
  const canRedo = Boolean(
    activeTimeline &&
      activeTimeline.cursor < activeTimeline.snapshots.length - 1
  );
  const canRestorePreview = Boolean(
    activePreviewDiffers && !editorLockedByOther
  );
  const editorReadOnly = editorLockedByOther || activePreviewDiffers;
  const editorLineCount = useMemo(
    () => Math.max(1, editorContent.split('\n').length),
    [editorContent]
  );
  const inlineErrorCount = useMemo(
    () =>
      inlineDiagnostics.filter((diagnostic) => diagnostic.severity === 'error')
        .length,
    [inlineDiagnostics]
  );
  const visibleLineStart = useMemo(
    () => Math.max(1, Math.floor(editorScrollTop / EDITOR_LINE_HEIGHT_PX) - 30),
    [editorScrollTop]
  );
  const visibleLineCount = useMemo(
    () =>
      Math.max(
        80,
        Math.ceil(editorViewportHeight / EDITOR_LINE_HEIGHT_PX) + 60
      ),
    [editorViewportHeight]
  );
  const visibleLineEnd = useMemo(
    () => Math.min(editorLineCount, visibleLineStart + visibleLineCount - 1),
    [editorLineCount, visibleLineCount, visibleLineStart]
  );
  const visibleEditorLineNumbers = useMemo(() => {
    const count = Math.max(0, visibleLineEnd - visibleLineStart + 1);
    return Array.from(
      { length: count },
      (_, index) => visibleLineStart + index
    );
  }, [visibleLineEnd, visibleLineStart]);
  const lineNumberTopSpacerHeight = useMemo(
    () => Math.max(0, (visibleLineStart - 1) * EDITOR_LINE_HEIGHT_PX),
    [visibleLineStart]
  );
  const lineNumberBottomSpacerHeight = useMemo(
    () =>
      Math.max(0, (editorLineCount - visibleLineEnd) * EDITOR_LINE_HEIGHT_PX),
    [editorLineCount, visibleLineEnd]
  );
  const workspaceCodeFilePaths = useMemo(
    () =>
      files
        .filter((entry) => entry.type === 'file')
        .map((entry) => entry.path)
        .filter((path) => inferLanguageFromPath(path) !== null),
    [files]
  );

  useEffect(() => {
    revisionTimelinesRef.current = revisionTimelines;
  }, [revisionTimelines]);

  useEffect(() => {
    lintClientRef.current = new StreamedLintClient();
    return () => {
      lintRequestRef.current?.cancel();
      lintRequestRef.current = null;
      lintClientRef.current?.dispose();
      lintClientRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!activeFile) {
      lintRequestRef.current?.cancel();
      lintRequestRef.current = null;
      lintBufferedDiagnosticsRef.current = [];
      setInlineDiagnostics([]);
      setLintStatus('idle');
      setLintProgress(0);
      setLintStats(null);
      return;
    }

    const lintClient = lintClientRef.current;
    if (!lintClient) return;

    const timeoutId = setTimeout(() => {
      lintRequestRef.current?.cancel();
      lintRequestRef.current = null;

      const nextVersion = lintVersionRef.current + 1;
      lintVersionRef.current = nextVersion;
      lintBufferedDiagnosticsRef.current = [];
      setInlineDiagnostics([]);
      setLintStatus('running');
      setLintProgress(0);
      setLintStats(null);

      lintRequestRef.current = lintClient.lint({
        version: nextVersion,
        path: activeFile,
        language,
        content: editorContent,
        maxDiagnostics: 260,
        onChunk: (diagnostics, progress) => {
          if (nextVersion !== lintVersionRef.current) return;
          lintBufferedDiagnosticsRef.current = [
            ...lintBufferedDiagnosticsRef.current,
            ...diagnostics,
          ];
          setInlineDiagnostics(lintBufferedDiagnosticsRef.current);
          setLintProgress(progress);
        },
        onDone: (stats) => {
          if (nextVersion !== lintVersionRef.current) return;
          setLintStatus('done');
          setLintProgress(1);
          setLintStats(stats);
        },
        onError: () => {
          if (nextVersion !== lintVersionRef.current) return;
          setLintStatus('done');
          setLintProgress(1);
        },
      });
    }, 120);

    return () => {
      lintRequestRef.current?.cancel();
      lintRequestRef.current = null;
      clearTimeout(timeoutId);
    };
  }, [activeFile, editorContent, language, lintTriggerToken]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const updateViewport = () => {
      setEditorViewportHeight(textarea.clientHeight);
      setEditorScrollTop(textarea.scrollTop);
    };

    updateViewport();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        setEditorViewportHeight(textarea.clientHeight);
      });
      observer.observe(textarea);
      return () => observer.disconnect();
    }

    const handleResize = () => setEditorViewportHeight(textarea.clientHeight);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [activeFile]);

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!actionLauncherOpen) return;
    const frame = requestAnimationFrame(() => {
      actionInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [actionLauncherOpen]);

  useEffect(() => {
    if (!cliOpen) return;
    if (cliOutputRef.current) {
      cliOutputRef.current.scrollTop = cliOutputRef.current.scrollHeight;
    }
  }, [cliEntries, cliOpen]);

  useEffect(() => {
    if (!localLeaseId) return;
    const interval = setInterval(() => {
      void heartbeatLock().catch(() => {
        // If heartbeat fails, lock state refresh will eventually clear owner.
      });
    }, 20_000);
    return () => clearInterval(interval);
  }, [heartbeatLock, localLeaseId]);

  useEffect(() => {
    if (!lockState.expires_at && !lockState.heartbeat_at) {
      setLockNowMs(Date.now());
      return;
    }
    setLockNowMs(Date.now());
    const interval = setInterval(() => {
      setLockNowMs(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [lockState.expires_at, lockState.heartbeat_at]);

  const appendCliEntry = useCallback(
    (text: string, level: CliEntry['level'] = 'info') => {
      setCliEntries((prev) =>
        [
          ...prev,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            text,
            level,
          },
        ].slice(-240)
      );
    },
    []
  );

  const setTimelineForFile = useCallback(
    (path: string, timeline: RevisionTimeline) => {
      setRevisionTimelines((prev) => ({
        ...prev,
        [path]: timeline,
      }));
    },
    []
  );

  const applyTimelineToEditor = useCallback(
    (path: string, timeline: RevisionTimeline, persistToFS: boolean) => {
      const visibleSnapshot = getVisibleRevisionSnapshot(timeline);
      const nextContent = visibleSnapshot ? visibleSnapshot.content : '';
      setEditorContent(nextContent);
      if (persistToFS) {
        void writeFile(path, nextContent);
      }
    },
    [writeFile]
  );

  const pauseScrubberPlayback = useCallback(() => {
    setScrubberPlaybackActive(false);
  }, []);

  const applyScrubberPlaybackSpeed = useCallback(
    (nextSpeed: number) => {
      if (!SCRUBBER_REPLAY_SPEEDS.includes(nextSpeed as 0.5 | 1 | 2 | 4)) {
        return;
      }
      setScrubberPlaybackSpeed(nextSpeed);
      appendCliEntry(`Scrub replay speed: ${nextSpeed}x`, 'info');
    },
    [appendCliEntry]
  );

  const startScrubberPlayback = useCallback(() => {
    if (!activeFile) {
      appendCliEntry('Open a file before replaying timeline history.', 'warn');
      return;
    }

    const timeline = revisionTimelinesRef.current[activeFile];
    if (!timeline || timeline.snapshots.length <= 1) {
      appendCliEntry('Not enough revisions to replay yet.', 'warn');
      return;
    }

    const visibleIndex = getVisibleRevisionIndex(timeline);
    if (visibleIndex >= timeline.snapshots.length - 1) {
      const resetTimeline = setRevisionPreviewIndex(timeline, 0);
      setTimelineForFile(activeFile, resetTimeline);
      applyTimelineToEditor(activeFile, resetTimeline, false);
    }

    setScrubberPlaybackActive(true);
  }, [activeFile, appendCliEntry, applyTimelineToEditor, setTimelineForFile]);

  useEffect(() => {
    if (!activeFile) {
      setScrubberPlaybackActive(false);
    }
  }, [activeFile]);

  useEffect(() => {
    if (!scrubberPlaybackActive || !activeFile) return;

    const baseStepMs = 560;
    const stepMs = Math.max(80, Math.round(baseStepMs / scrubberPlaybackSpeed));
    const intervalId = window.setInterval(() => {
      const timeline = revisionTimelinesRef.current[activeFile];
      if (!timeline) {
        setScrubberPlaybackActive(false);
        return;
      }

      const visibleIndex = getVisibleRevisionIndex(timeline);
      if (visibleIndex >= timeline.snapshots.length - 1) {
        setScrubberPlaybackActive(false);
        return;
      }

      const nextTimeline = setRevisionPreviewIndex(timeline, visibleIndex + 1);
      setTimelineForFile(activeFile, nextTimeline);
      applyTimelineToEditor(activeFile, nextTimeline, false);
    }, stepMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    activeFile,
    applyTimelineToEditor,
    scrubberPlaybackActive,
    scrubberPlaybackSpeed,
    setTimelineForFile,
  ]);

  // Load active file content when selection changes
  useEffect(() => {
    let cancelled = false;

    if (!activeFile) {
      setEditorContent('');
      return () => {
        cancelled = true;
      };
    }

    readFile(activeFile)
      .then((content) => {
        if (cancelled) return;

        const existingTimeline = revisionTimelinesRef.current[activeFile];
        const ensuredTimeline = ensureRevisionTimeline(
          existingTimeline,
          content
        );
        const normalizedTimeline =
          ensuredTimeline.previewIndex === null
            ? ensuredTimeline
            : setRevisionPreviewIndex(ensuredTimeline, null);
        setTimelineForFile(activeFile, normalizedTimeline);

        const visibleSnapshot = getVisibleRevisionSnapshot(normalizedTimeline);
        setEditorContent(visibleSnapshot ? visibleSnapshot.content : content);

        const inferredLanguage = inferLanguageFromPath(activeFile);
        if (inferredLanguage) {
          setLanguage(inferredLanguage);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEditorContent('');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeFile, readFile, setTimelineForFile]);

  // Handle run
  const handleRun = useCallback(async (): Promise<ContainerExecuteResult> => {
    const result = (await execute(
      editorContent,
      language
    )) as ContainerExecuteResult;

    // Notify parent of file changes
    if (result.filesystem_changes && onFilesChanged) {
      onFilesChanged(result.filesystem_changes);
    }

    return result;
  }, [editorContent, language, execute, onFilesChanged]);

  // Handle editor changes
  const handleEditorChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newContent = e.target.value;
      setEditorContent(newContent);

      // Write back to persistent FS
      if (activeFile && !editorLockedByOther) {
        setRevisionTimelines((prev) => {
          const current = ensureRevisionTimeline(prev[activeFile], newContent);
          const next = appendRevisionSnapshot(current, newContent, {
            reason: 'edit',
          });
          return {
            ...prev,
            [activeFile]: next,
          };
        });
        void writeFile(activeFile, newContent);
      }
    },
    [activeFile, editorLockedByOther, writeFile]
  );

  const handleEditorScroll = useCallback(
    (e: React.UIEvent<HTMLTextAreaElement>) => {
      const nextScrollTop = e.currentTarget.scrollTop;
      if (lineNumberGutterRef.current) {
        lineNumberGutterRef.current.scrollTop = nextScrollTop;
      }
      pendingScrollTopRef.current = nextScrollTop;
      if (scrollFrameRef.current !== null) return;
      scrollFrameRef.current = requestAnimationFrame(() => {
        setEditorScrollTop(pendingScrollTopRef.current);
        scrollFrameRef.current = null;
      });
    },
    []
  );

  const jumpToLine = useCallback((targetLine: number) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const clampedLine = Math.max(1, targetLine);
    const content = textarea.value;
    let line = 1;
    let index = 0;

    while (line < clampedLine && index < content.length) {
      if (content.charCodeAt(index) === 10) {
        line += 1;
      }
      index += 1;
    }

    textarea.focus();
    textarea.setSelectionRange(index, index);

    const top = Math.max(
      0,
      (clampedLine - 1) * EDITOR_LINE_HEIGHT_PX - EDITOR_LINE_HEIGHT_PX * 2
    );
    textarea.scrollTop = top;
    if (lineNumberGutterRef.current) {
      lineNumberGutterRef.current.scrollTop = top;
    }
    setEditorScrollTop(top);
  }, []);

  const normalizeRepoPath = useCallback((path: string) => {
    return path.startsWith('/') ? path : `/${path}`;
  }, []);

  const clearCliEntries = useCallback(() => {
    setCliEntries([]);
  }, []);

  const openCli = useCallback(() => {
    setCliOpen(true);
    requestAnimationFrame(() => {
      cliInputRef.current?.focus();
    });
  }, []);

  const openActionLauncher = useCallback(() => {
    setActionLauncherMode('actions');
    setSymbolsError(null);
    setActionQuery('');
    setActionCursor(0);
    setActionLauncherOpen(true);
  }, []);

  const openSymbolLauncher = useCallback(
    (initialQuery?: string) => {
      if (!activeRepoId) {
        appendCliEntry('No repo id active. Run repo ingest first.', 'warn');
        return;
      }
      setActionLauncherMode('symbols');
      setActionQuery(initialQuery || '');
      setActionCursor(0);
      setSymbolsError(null);
      setActionLauncherOpen(true);
    },
    [activeRepoId, appendCliEntry]
  );

  const handleFormatDocument = useCallback(() => {
    if (!activeFile) {
      appendCliEntry('No active file to format.', 'warn');
      return;
    }
    if (editorLockedByOther || activePreviewDiffers) {
      appendCliEntry(
        'Formatting is blocked while editor is locked/previewed.',
        'warn'
      );
      return;
    }

    const formatted = formatDocumentContent(editorContent, language);
    if (formatted === editorContent) {
      appendCliEntry('Document already formatted.', 'info');
      return;
    }

    setEditorContent(formatted);
    setRevisionTimelines((prev) => {
      const current = ensureRevisionTimeline(prev[activeFile], formatted);
      const next = appendRevisionSnapshot(current, formatted, {
        reason: 'format',
      });
      return {
        ...prev,
        [activeFile]: next,
      };
    });
    void writeFile(activeFile, formatted);
    appendCliEntry(`Formatted ${activeFile}.`, 'ok');
  }, [
    activeFile,
    activePreviewDiffers,
    appendCliEntry,
    editorContent,
    editorLockedByOther,
    language,
    writeFile,
  ]);

  const handleFormatWorkspace = useCallback(() => {
    if (workspaceCodeFilePaths.length === 0) {
      appendCliEntry('No code files available to format.', 'warn');
      return;
    }
    if (editorLockedByOther || activePreviewDiffers) {
      appendCliEntry(
        'Workspace formatting is blocked while editor is locked/previewed.',
        'warn'
      );
      return;
    }

    void (async () => {
      let changedCount = 0;
      const timelineUpdates: Record<string, RevisionTimeline> = {};

      for (const path of workspaceCodeFilePaths) {
        const fileLanguage = inferLanguageFromPath(path) || language;
        const sourceContent =
          path === activeFile ? editorContent : await readFile(path);
        const formatted = formatDocumentContent(sourceContent, fileLanguage);
        if (formatted === sourceContent) {
          continue;
        }

        changedCount += 1;
        await writeFile(path, formatted);

        const currentTimeline = ensureRevisionTimeline(
          revisionTimelinesRef.current[path],
          formatted
        );
        timelineUpdates[path] = appendRevisionSnapshot(
          currentTimeline,
          formatted,
          {
            reason: 'format',
          }
        );

        if (path === activeFile) {
          setEditorContent(formatted);
        }
      }

      if (Object.keys(timelineUpdates).length > 0) {
        setRevisionTimelines((prev) => ({
          ...prev,
          ...timelineUpdates,
        }));
      }

      if (changedCount === 0) {
        appendCliEntry('Workspace already formatted.', 'info');
      } else {
        appendCliEntry(`Formatted ${changedCount} file(s) in workspace.`, 'ok');
      }
    })().catch((error) => {
      appendCliEntry(
        `Workspace format failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'error'
      );
    });
  }, [
    activeFile,
    activePreviewDiffers,
    appendCliEntry,
    editorContent,
    editorLockedByOther,
    language,
    readFile,
    workspaceCodeFilePaths,
    writeFile,
  ]);

  const runBuildReadinessForContent = useCallback(
    (
      path: string,
      fileLanguage: ContainerLanguage,
      content: string
    ): {
      errors: number;
      warnings: number;
      infos: number;
      diagnostics: InlineDiagnostic[];
    } => {
      const lintOutput = lintDocumentCore({
        path,
        language: fileLanguage as StreamedLintLanguage,
        content,
        maxDiagnostics: 320,
      });
      const diagnostics = lintOutput.diagnostics;
      return {
        errors: diagnostics.filter((entry) => entry.severity === 'error')
          .length,
        warnings: diagnostics.filter((entry) => entry.severity === 'warning')
          .length,
        infos: diagnostics.filter((entry) => entry.severity === 'info').length,
        diagnostics,
      };
    },
    []
  );

  const handleLintWorkspace = useCallback(() => {
    if (workspaceCodeFilePaths.length === 0) {
      appendCliEntry('No code files available to lint.', 'warn');
      return;
    }

    void (async () => {
      let totalDiagnostics = 0;
      let errorCount = 0;
      let warningCount = 0;
      let infoCount = 0;
      const noisyFiles: string[] = [];
      const startedAt = Date.now();

      for (const path of workspaceCodeFilePaths) {
        const fileLanguage = inferLanguageFromPath(path) || language;
        const content =
          path === activeFile ? editorContent : await readFile(path);
        const result = runBuildReadinessForContent(path, fileLanguage, content);
        totalDiagnostics += result.diagnostics.length;
        errorCount += result.errors;
        warningCount += result.warnings;
        infoCount += result.infos;
        if (result.errors > 0 || result.warnings > 0) {
          noisyFiles.push(
            `${path} (E${result.errors}/W${result.warnings}/I${result.infos})`
          );
        }
      }

      const elapsedMs = Date.now() - startedAt;
      appendCliEntry(
        `Workspace lint: ${workspaceCodeFilePaths.length} file(s), ${totalDiagnostics} issue(s), ${errorCount} error(s), ${warningCount} warning(s) in ${elapsedMs}ms.`,
        errorCount > 0 ? 'warn' : 'ok'
      );
      noisyFiles.slice(0, 6).forEach((entry) => {
        appendCliEntry(`  ${entry}`, 'info');
      });
    })().catch((error) => {
      appendCliEntry(
        `Workspace lint failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'error'
      );
    });
  }, [
    activeFile,
    appendCliEntry,
    editorContent,
    language,
    readFile,
    runBuildReadinessForContent,
    workspaceCodeFilePaths,
  ]);

  const handleBuildFile = useCallback(() => {
    if (!activeFile) {
      appendCliEntry('No active file to build.', 'warn');
      return;
    }

    const fileLanguage = inferLanguageFromPath(activeFile) || language;
    const result = runBuildReadinessForContent(
      activeFile,
      fileLanguage,
      editorContent
    );
    appendCliEntry(
      `Build check ${activeFile}: E${result.errors}/W${result.warnings}/I${result.infos}.`,
      result.errors > 0 ? 'warn' : 'ok'
    );
    result.diagnostics
      .filter((entry) => entry.severity === 'error')
      .slice(0, 4)
      .forEach((entry) => {
        appendCliEntry(
          `  line ${entry.line} (${entry.code}): ${entry.message}`,
          'error'
        );
      });
  }, [
    activeFile,
    appendCliEntry,
    editorContent,
    language,
    runBuildReadinessForContent,
  ]);

  const handleBuildWorkspace = useCallback(() => {
    if (workspaceCodeFilePaths.length === 0) {
      appendCliEntry('No code files available to build.', 'warn');
      return;
    }

    void (async () => {
      let errorCount = 0;
      let warningCount = 0;
      const failingFiles: string[] = [];
      const startedAt = Date.now();

      for (const path of workspaceCodeFilePaths) {
        const fileLanguage = inferLanguageFromPath(path) || language;
        const content =
          path === activeFile ? editorContent : await readFile(path);
        const result = runBuildReadinessForContent(path, fileLanguage, content);
        errorCount += result.errors;
        warningCount += result.warnings;
        if (result.errors > 0 || result.warnings > 0) {
          failingFiles.push(`${path} (E${result.errors}/W${result.warnings})`);
        }
      }

      const elapsedMs = Date.now() - startedAt;
      appendCliEntry(
        `Workspace build check: ${workspaceCodeFilePaths.length} file(s), E${errorCount}/W${warningCount} in ${elapsedMs}ms.`,
        errorCount > 0 ? 'warn' : 'ok'
      );
      failingFiles.slice(0, 6).forEach((entry) => {
        appendCliEntry(`  ${entry}`, 'info');
      });
    })().catch((error) => {
      appendCliEntry(
        `Workspace build failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'error'
      );
    });
  }, [
    activeFile,
    appendCliEntry,
    editorContent,
    language,
    readFile,
    runBuildReadinessForContent,
    workspaceCodeFilePaths,
  ]);

  const handleScaffoldFluxApp = useCallback(() => {
    void (async () => {
      appendCliEntry('Scaffolding Aeon Flux app...', 'info');
      try {
        await writeFile(
          '/package.json',
          JSON.stringify(
            {
              name: 'my-aeon-app',
              version: '0.1.0',
              private: true,
              dependencies: {
                react: '^18.2.0',
                'react-dom': '^18.2.0',
                '@affectively/edgework-sdk': 'workspace:*',
                '@affectively/aeon-flux': 'workspace:*',
              },
              scripts: {
                build: 'aeon build',
                deploy: 'aeon deploy',
              },
            },
            null,
            2
          )
        );

        await writeFile(
          '/aeon.config.ts',
          `export default {
  name: 'my-aeon-app',
  entry: './src/plugin.tsx',
};`
        );

        await writeFile(
          '/src/plugin.tsx',
          `import * as React from 'react';
import { App } from './App';

export const aeonShellPlugin = {
  id: 'remote.fun.my-app',
  activate: (ctx) => {
    ctx.registerCanvasContribution({
      id: 'my-app.canvas',
      label: 'My Aeon App',
      render: () => <App />,
    });
  }
};
export default aeonShellPlugin;`
        );

        await writeFile(
          '/src/App.tsx',
          `import React from 'react';

export function App() {
  return (
    <div style={{ padding: 20 }}>
      <h1>Welcome to Aeon Flux</h1>
      <p>This is your newly scaffolded application.</p>
    </div>
  );
}`
        );

        appendCliEntry(
          'Scaffold complete. Run `aeon deploy` to publish.',
          'ok'
        );
      } catch (err) {
        appendCliEntry(
          `Scaffold failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
          'error'
        );
      }
    })();
  }, [appendCliEntry, writeFile]);

  const handleScaffoldMcpServer = useCallback(() => {
    void (async () => {
      appendCliEntry('Scaffolding MCP Server...', 'info');
      try {
        await writeFile(
          '/package.json',
          JSON.stringify(
            {
              name: 'my-mcp-server',
              version: '0.1.0',
              private: true,
              type: 'module',
              dependencies: {
                '@affectively/edgework-sdk': 'workspace:*',
                '@affectively/mcp-framework': 'workspace:*',
                '@modelcontextprotocol/sdk': '^1.4.1',
              },
              scripts: {
                build: 'bun build src/index.ts --outdir dist --target node',
                start: 'bun run src/index.ts',
                deploy: 'aeon deploy',
              },
            },
            null,
            2
          )
        );

        await writeFile(
          '/tsconfig.json',
          JSON.stringify(
            {
              compilerOptions: {
                target: 'ESNext',
                module: 'NodeNext',
                moduleResolution: 'NodeNext',
                strict: true,
                outDir: './dist',
              },
              include: ['src/**/*'],
            },
            null,
            2
          )
        );

        await writeFile(
          '/aeon.config.ts',
          `export default {
        name: 'my-mcp-server',
        entry: './src/index.ts',
        preset: 'mcp-server',
        };`
        );

        await writeFile(
          '/src/index.ts',
          `import { Server } from '@modelcontextprotocol/sdk/server/index.js';
        import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
        import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

        const server = new Server(
        { name: 'my-mcp-server', version: '0.1.0' },
        { capabilities: { tools: {} } }
        );

        server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
        {
        name: 'hello_world',
        description: 'A simple hello world tool',
        inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name']
        }
        }
        ]
        }));

        server.setRequestHandler(CallToolRequestSchema, async (request) => {
        if (request.params.name === 'hello_world') {
        const name = (request.params.arguments as any)?.name || 'World';
        return { content: [{ type: 'text', text: \`Hello, \${name}!\` }] };
        }
        throw new Error("Tool not found");
        });

        async function main() {
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error('MCP Server running on stdio');
        }
        main().catch(console.error);`
        );

        appendCliEntry(
          'MCP Server scaffold complete. Run `aeon deploy` to publish.',
          'ok'
        );
      } catch (err) {
        appendCliEntry(
          `Scaffold failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
          'error'
        );
      }
    })();
  }, [appendCliEntry, writeFile]);

  const triggerLintPass = useCallback(() => {
    setLintTriggerToken((prev) => prev + 1);
    appendCliEntry('Lint pass requested.', 'info');
  }, [appendCliEntry]);

  const applyLanguageSelection = useCallback(
    (nextLanguage: ContainerLanguage) => {
      setLanguage(nextLanguage);
      appendCliEntry(`Language switched to ${nextLanguage}.`, 'ok');
    },
    [appendCliEntry]
  );

  const emitStaticAnalysisPlan = useCallback(() => {
    const planLines = buildStaticAnalysisPlan(language);
    appendCliEntry('Static analysis plan:', 'ok');
    planLines.forEach((line) => appendCliEntry(`- ${line}`));
  }, [appendCliEntry, language]);

  const handleToggleDiagnosticsStrip = useCallback(() => {
    setDiagnosticsStripEnabled((prev) => {
      const next = !prev;
      appendCliEntry(
        `Diagnostics strip ${next ? 'enabled' : 'disabled'}.`,
        'info'
      );
      return next;
    });
  }, [appendCliEntry]);

  const handleCreateSnapshot = useCallback(() => {
    void createSnapshot()
      .then((snapshot) => {
        appendCliEntry(
          `Snapshot saved (${snapshot.files_count} files, ${snapshot.snapshot_id}).`,
          'ok'
        );
      })
      .catch((error) => {
        appendCliEntry(
          `Snapshot failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          'error'
        );
      });
  }, [appendCliEntry, createSnapshot]);

  const handleShowReceipts = useCallback(() => {
    void getReceipts(12)
      .then((receipts) => {
        if (receipts.length === 0) {
          appendCliEntry('No receipts recorded yet.', 'info');
          return;
        }
        appendCliEntry(`Latest receipts (${receipts.length}):`, 'ok');
        receipts.slice(0, 5).forEach((receipt) => {
          appendCliEntry(
            `${receipt.event_type} by ${receipt.actor_did} @ ${new Date(
              receipt.created_at
            ).toLocaleTimeString()}`,
            'info'
          );
        });
      })
      .catch((error) => {
        appendCliEntry(
          `Failed to fetch receipts: ${
            error instanceof Error ? error.message : String(error)
          }`,
          'error'
        );
      });
  }, [appendCliEntry, getReceipts]);

  const handleRepoIngest = useCallback(() => {
    if (!activeFile) {
      appendCliEntry(
        'Open a file before creating a repo snapshot ingest.',
        'warn'
      );
      return;
    }

    const currentContent = editorContent;
    const currentPath = activeFile;
    void ingestRepo({
      source_type: 'local-import',
      repo_ref: 'workspace-head',
      files: [{ path: currentPath, content: currentContent, language }],
    })
      .then((repo) => {
        setActiveRepoId(repo.repo_id);
        appendCliEntry(
          `Repo index ingested (${repo.indexed_files} files, ${repo.symbols} symbols) -> ${repo.repo_id}`,
          'ok'
        );
      })
      .catch((error) => {
        appendCliEntry(
          `Repo ingest failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          'error'
        );
      });
  }, [activeFile, appendCliEntry, editorContent, ingestRepo, language]);

  const handleRepoRefresh = useCallback(() => {
    if (!activeRepoId) {
      appendCliEntry('No repo id active. Run repo ingest first.', 'warn');
      return;
    }
    void refreshRepo(activeRepoId)
      .then((job) => {
        appendCliEntry(`Repo refresh job ${job.job_id} (${job.status}).`, 'ok');
        return getRepoStatus(activeRepoId);
      })
      .then((status) => {
        appendCliEntry(
          `Repo status: ${String(status.status || 'unknown')} (${String(
            status.indexed_files || 0
          )}/${String(status.total_files || 0)} indexed).`,
          'info'
        );
      })
      .catch((error) => {
        appendCliEntry(
          `Repo refresh failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          'error'
        );
      });
  }, [activeRepoId, appendCliEntry, getRepoStatus, refreshRepo]);

  const handleRepoStatus = useCallback(() => {
    if (!activeRepoId) {
      appendCliEntry('No repo id active. Run repo ingest first.', 'warn');
      return;
    }
    void getRepoStatus(activeRepoId)
      .then((status) => {
        appendCliEntry(
          `Repo ${activeRepoId}: ${String(
            status.status || 'unknown'
          )} (${String(status.indexed_files || 0)}/${String(
            status.total_files || 0
          )} indexed)`,
          'info'
        );
      })
      .catch((error) => {
        appendCliEntry(
          `Repo status failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          'error'
        );
      });
  }, [activeRepoId, appendCliEntry, getRepoStatus]);

  const handleRepoSymbols = useCallback(
    (query?: string) => {
      openSymbolLauncher(query);
    },
    [openSymbolLauncher]
  );

  const handleNavigateToSymbol = useCallback(
    async (symbol: RepoSymbolEntry): Promise<void> => {
      const normalizedPath = normalizeRepoPath(symbol.filePath);
      try {
        await readFile(normalizedPath);
      } catch {
        if (!activeRepoId) {
          throw new Error('No active repository selected');
        }
        const repoFile = await getRepoFile(activeRepoId, normalizedPath);
        await writeFile(normalizedPath, repoFile.content);
      }

      setActiveFile(normalizedPath);
      setActionLauncherOpen(false);
      setActionLauncherMode('actions');
      setActionQuery('');
      setActionCursor(0);
      appendCliEntry(
        `Jumped to ${symbol.symbolName} at ${normalizedPath}:${symbol.line}.`,
        'ok'
      );
      window.setTimeout(() => {
        jumpToLine(symbol.line);
      }, 70);
    },
    [
      activeRepoId,
      appendCliEntry,
      getRepoFile,
      jumpToLine,
      normalizeRepoPath,
      readFile,
      setActiveFile,
      writeFile,
    ]
  );

  // Handle file creation
  const handleCreateFile = useCallback(
    async (path: string) => {
      const defaultContent = getDefaultContent(path);
      await writeFile(path, defaultContent);
      setActiveFile(path);
    },
    [writeFile, setActiveFile]
  );

  // Handle file deletion
  const handleDeleteFile = useCallback(
    async (path: string) => {
      await deleteFile(path);
      setRevisionTimelines((prev) => {
        const next = { ...prev };
        delete next[path];
        return next;
      });
      if (activeFile === path) {
        setActiveFile(null);
        setEditorContent('');
      }
    },
    [deleteFile, activeFile, setActiveFile]
  );

  const handleUndo = useCallback(() => {
    if (!activeFile || editorLockedByOther) return;
    setScrubberPlaybackActive(false);
    const timeline = revisionTimelinesRef.current[activeFile];
    if (!timeline) return;

    const nextTimeline = moveRevisionCursor(timeline, -1);
    if (nextTimeline === timeline) return;

    setTimelineForFile(activeFile, nextTimeline);
    applyTimelineToEditor(activeFile, nextTimeline, true);
  }, [
    activeFile,
    applyTimelineToEditor,
    editorLockedByOther,
    setTimelineForFile,
  ]);

  const handleRedo = useCallback(() => {
    if (!activeFile || editorLockedByOther) return;
    setScrubberPlaybackActive(false);
    const timeline = revisionTimelinesRef.current[activeFile];
    if (!timeline) return;

    const nextTimeline = moveRevisionCursor(timeline, 1);
    if (nextTimeline === timeline) return;

    setTimelineForFile(activeFile, nextTimeline);
    applyTimelineToEditor(activeFile, nextTimeline, true);
  }, [
    activeFile,
    applyTimelineToEditor,
    editorLockedByOther,
    setTimelineForFile,
  ]);

  const handleRevisionScrub = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!activeFile) return;
      setScrubberPlaybackActive(false);
      const nextIndex = Number(e.target.value);
      if (Number.isNaN(nextIndex)) return;

      const timeline = revisionTimelinesRef.current[activeFile];
      if (!timeline) return;

      const nextTimeline = setRevisionPreviewIndex(timeline, nextIndex);
      setTimelineForFile(activeFile, nextTimeline);
      applyTimelineToEditor(activeFile, nextTimeline, false);
    },
    [activeFile, applyTimelineToEditor, setTimelineForFile]
  );

  const handleJumpToLatestRevision = useCallback(() => {
    if (!activeFile) return;
    setScrubberPlaybackActive(false);
    const timeline = revisionTimelinesRef.current[activeFile];
    if (!timeline) return;

    const nextTimeline = setRevisionPreviewIndex(timeline, null);
    setTimelineForFile(activeFile, nextTimeline);
    applyTimelineToEditor(activeFile, nextTimeline, false);
  }, [activeFile, applyTimelineToEditor, setTimelineForFile]);

  const handleRestoreRevision = useCallback(() => {
    if (!activeFile || editorLockedByOther) return;
    setScrubberPlaybackActive(false);
    const timeline = revisionTimelinesRef.current[activeFile];
    if (!timeline) return;

    const restoreResult = restoreRevisionPreview(timeline);
    setTimelineForFile(activeFile, restoreResult.timeline);
    applyTimelineToEditor(activeFile, restoreResult.timeline, true);
  }, [
    activeFile,
    applyTimelineToEditor,
    editorLockedByOther,
    setTimelineForFile,
  ]);

  const handleToggleLock = useCallback(async () => {
    if (isLockExternallyControlled) {
      const nextOwnerId =
        effectiveLockOwnerId === LOCAL_LOCK_OWNER_ID
          ? null
          : LOCAL_LOCK_OWNER_ID;
      if (onLockChange) {
        onLockChange(nextOwnerId);
      }
      return;
    }

    try {
      if (effectiveLockOwnerId === LOCAL_LOCK_OWNER_ID) {
        await releaseLock();
        setLocalLeaseId(null);
        setLocalLockOwnerId(null);
        appendCliEntry('Lock released.', 'ok');
        return;
      }

      if (effectiveLockOwnerId !== null) {
        appendCliEntry(
          `Lock held by ${effectiveLockOwnerId}. Use "lock override" command if you have capability.`,
          'warn'
        );
        return;
      }

      const lease = await acquireLock();
      setLocalLeaseId(lease.lease_id);
      setLocalLockOwnerId(LOCAL_LOCK_OWNER_ID);
      appendCliEntry('Lock acquired.', 'ok');
    } catch (error) {
      appendCliEntry(
        `Lock operation failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'error'
      );
    }
  }, [
    acquireLock,
    appendCliEntry,
    effectiveLockOwnerId,
    isLockExternallyControlled,
    onLockChange,
    releaseLock,
  ]);

  const handleOverrideLock = useCallback(async () => {
    try {
      const lease = await overrideLock();
      setLocalLeaseId(lease.lease_id);
      setLocalLockOwnerId(LOCAL_LOCK_OWNER_ID);
      appendCliEntry('Lock override granted.', 'ok');
    } catch (error) {
      appendCliEntry(
        `Lock override failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'error'
      );
    }
  }, [appendCliEntry, overrideLock]);

  const ideActions = useMemo<IdeAction[]>(
    () =>
      buildIdeActions({
        effectiveLockOwnerId,
        runCode: handleRun,
        appendCliEntry,
        formatDocument: handleFormatDocument,
        formatWorkspace: handleFormatWorkspace,
        triggerLintPass,
        lintWorkspace: handleLintWorkspace,
        buildFile: handleBuildFile,
        buildWorkspace: handleBuildWorkspace,
        emitStaticAnalysisPlan,
        undoRevision: handleUndo,
        redoRevision: handleRedo,
        restorePreviewRevision: handleRestoreRevision,
        jumpToLatestRevision: handleJumpToLatestRevision,
        scrubberPlaybackActive,
        scrubberPlaybackSpeed,
        startScrubberPlayback,
        pauseScrubberPlayback,
        setScrubberPlaybackSpeed: applyScrubberPlaybackSpeed,
        toggleLock: handleToggleLock,
        overrideLock: handleOverrideLock,
        openCli,
        applyLanguageSelection,
        createSnapshot: handleCreateSnapshot,
        showReceipts: handleShowReceipts,
        repoIngest: handleRepoIngest,
        repoRefresh: handleRepoRefresh,
        repoStatus: handleRepoStatus,
        repoSymbols: handleRepoSymbols,
        toggleDiagnosticsStrip: handleToggleDiagnosticsStrip,
        scaffoldFluxApp: handleScaffoldFluxApp,
        scaffoldMcpServer: handleScaffoldMcpServer,
      }),
    [
      appendCliEntry,
      applyScrubberPlaybackSpeed,
      applyLanguageSelection,
      handleBuildFile,
      handleBuildWorkspace,
      handleCreateSnapshot,
      effectiveLockOwnerId,
      emitStaticAnalysisPlan,
      handleFormatDocument,
      handleFormatWorkspace,
      handleJumpToLatestRevision,
      handleLintWorkspace,
      handleOverrideLock,
      pauseScrubberPlayback,
      handleRepoIngest,
      handleRepoRefresh,
      handleRepoStatus,
      handleRepoSymbols,
      handleRedo,
      handleRestoreRevision,
      handleScaffoldFluxApp,
      handleScaffoldMcpServer,
      handleShowReceipts,
      handleShowReceipts,
      handleToggleLock,
      handleToggleDiagnosticsStrip,
      handleUndo,
      openCli,
      scrubberPlaybackActive,
      scrubberPlaybackSpeed,
      startScrubberPlayback,
      triggerLintPass,
    ]
  );

  const filteredActions = useMemo(() => {
    const query = actionQuery.trim().toLowerCase();
    if (!query) return ideActions;
    return ideActions.filter((action) => {
      if (action.label.toLowerCase().includes(query)) return true;
      if (action.hint.toLowerCase().includes(query)) return true;
      return action.keywords.some((keyword) =>
        keyword.toLowerCase().includes(query)
      );
    });
  }, [actionQuery, ideActions]);

  useEffect(() => {
    if (!actionLauncherOpen) return;
    if (actionLauncherMode !== 'symbols') return;
    if (!activeRepoId) {
      setSymbolEntries([]);
      setSymbolsLoading(false);
      setSymbolsError('No active repository.');
      return;
    }

    const fetchVersion = symbolFetchVersionRef.current + 1;
    symbolFetchVersionRef.current = fetchVersion;
    const timeoutId = window.setTimeout(() => {
      setSymbolsLoading(true);
      setSymbolsError(null);
      void getRepoSymbols(activeRepoId, actionQuery.trim() || undefined)
        .then((rawSymbols) => {
          if (fetchVersion !== symbolFetchVersionRef.current) return;
          const mapped: RepoSymbolEntry[] = rawSymbols.map((entry, index) => {
            const symbolName = String(entry.symbol_name || 'unknown');
            const symbolKind = String(entry.symbol_kind || 'symbol');
            const filePath = normalizeRepoPath(String(entry.file_path || ''));
            const parsedLine = Number(entry.line || 1);
            const parsedColumn = Number(entry.column || 1);
            const line =
              Number.isFinite(parsedLine) && parsedLine > 0 ? parsedLine : 1;
            const column =
              Number.isFinite(parsedColumn) && parsedColumn > 0
                ? parsedColumn
                : 1;
            return {
              id: `${filePath}:${line}:${column}:${symbolName}:${index}`,
              symbolName,
              symbolKind,
              filePath,
              line,
              column,
            };
          });
          setSymbolEntries(mapped);
        })
        .catch((error) => {
          if (fetchVersion !== symbolFetchVersionRef.current) return;
          setSymbolsError(
            error instanceof Error ? error.message : String(error)
          );
          setSymbolEntries([]);
        })
        .finally(() => {
          if (fetchVersion === symbolFetchVersionRef.current) {
            setSymbolsLoading(false);
          }
        });
    }, 120);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    actionLauncherOpen,
    actionLauncherMode,
    activeRepoId,
    actionQuery,
    getRepoSymbols,
    normalizeRepoPath,
  ]);

  useEffect(() => {
    const count =
      actionLauncherMode === 'actions'
        ? filteredActions.length
        : symbolEntries.length;
    setActionCursor((prev) => {
      if (count === 0) return 0;
      return Math.min(prev, count - 1);
    });
  }, [actionLauncherMode, filteredActions.length, symbolEntries.length]);

  const actionLauncherItems = useMemo(
    () =>
      filteredActions.map((action) => ({
        id: action.id,
        label: action.label,
        hint: action.hint,
      })),
    [filteredActions]
  );

  const symbolLauncherItems = useMemo(
    () =>
      symbolEntries.map((symbol) => ({
        id: symbol.id,
        label: symbol.symbolName,
        hint: `${symbol.symbolKind} | ${symbol.filePath}:${symbol.line}`,
      })),
    [symbolEntries]
  );

  const launcherItems = useMemo(
    () =>
      actionLauncherMode === 'actions'
        ? actionLauncherItems
        : symbolLauncherItems,
    [actionLauncherItems, actionLauncherMode, symbolLauncherItems]
  );

  const executeAction = useCallback((action: IdeAction) => {
    action.run();
    setActionLauncherOpen(false);
    setActionLauncherMode('actions');
    setActionQuery('');
  }, []);

  const executeLauncherItemByIndex = useCallback(
    (index: number) => {
      if (actionLauncherMode === 'actions') {
        const selectedAction = filteredActions[index];
        if (!selectedAction) return;
        executeAction(selectedAction);
        return;
      }

      const selectedSymbol = symbolEntries[index];
      if (!selectedSymbol) return;
      void handleNavigateToSymbol(selectedSymbol).catch((error) => {
        appendCliEntry(
          `Failed to open symbol: ${
            error instanceof Error ? error.message : String(error)
          }`,
          'error'
        );
      });
    },
    [
      actionLauncherMode,
      appendCliEntry,
      executeAction,
      filteredActions,
      handleNavigateToSymbol,
      symbolEntries,
    ]
  );

  const handleActionInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActionCursor((prev) =>
          launcherItems.length === 0
            ? 0
            : Math.min(prev + 1, launcherItems.length - 1)
        );
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActionCursor((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        executeLauncherItemByIndex(actionCursor);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setActionLauncherOpen(false);
        setActionLauncherMode('actions');
      }
    },
    [actionCursor, executeLauncherItemByIndex, launcherItems.length]
  );

  const executeCliCommand = useCallback(
    (rawCommand: string) => {
      executeIdeCliCommand({
        rawCommand,
        effectiveLockOwnerId,
        appendCliEntry,
        runCode: handleRun,
        triggerLintPass,
        formatDocument: handleFormatDocument,
        formatWorkspace: handleFormatWorkspace,
        lintWorkspace: handleLintWorkspace,
        buildFile: handleBuildFile,
        buildWorkspace: handleBuildWorkspace,
        scrubberPlaybackActive,
        startScrubberPlayback,
        pauseScrubberPlayback,
        setScrubberPlaybackSpeed: applyScrubberPlaybackSpeed,
        toggleLock: handleToggleLock,
        overrideLock: handleOverrideLock,
        undoRevision: handleUndo,
        redoRevision: handleRedo,
        restorePreviewRevision: handleRestoreRevision,
        jumpToLatestRevision: handleJumpToLatestRevision,
        applyLanguageSelection,
        jumpToLine,
        emitStaticAnalysisPlan,
        openActionLauncher,
        clearCliEntries,
        clearLogs,
        createSnapshot: handleCreateSnapshot,
        showReceipts: handleShowReceipts,
        repoIngest: handleRepoIngest,
        repoRefresh: handleRepoRefresh,
        repoStatus: handleRepoStatus,
        repoSymbols: handleRepoSymbols,
        toggleDiagnosticsStrip: handleToggleDiagnosticsStrip,
        scaffoldFluxApp: handleScaffoldFluxApp,
        scaffoldMcpServer: handleScaffoldMcpServer,
      });
    },
    [
      appendCliEntry,
      applyScrubberPlaybackSpeed,
      applyLanguageSelection,
      clearCliEntries,
      clearLogs,
      handleBuildFile,
      handleBuildWorkspace,
      effectiveLockOwnerId,
      emitStaticAnalysisPlan,
      handleCreateSnapshot,
      handleFormatDocument,
      handleFormatWorkspace,
      handleJumpToLatestRevision,
      handleLintWorkspace,
      handleOverrideLock,
      pauseScrubberPlayback,
      handleRepoIngest,
      handleRepoRefresh,
      handleRepoStatus,
      handleRepoSymbols,
      handleRedo,
      handleRestoreRevision,
      handleScaffoldFluxApp,
      handleScaffoldMcpServer,
      handleShowReceipts,
      handleShowReceipts,
      handleToggleLock,
      handleToggleDiagnosticsStrip,
      handleUndo,
      jumpToLine,
      openActionLauncher,
      scrubberPlaybackActive,
      startScrubberPlayback,
      triggerLintPass,
    ]
  );

  const handleCliSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const command = cliInput.trim();
      if (!command) return;

      appendCliEntry(`$ ${command}`, 'info');
      setCliHistory((prev) =>
        [command, ...prev.filter((item) => item !== command)].slice(0, 120)
      );
      setCliHistoryIndex(-1);
      setCliInput('');
      cliDraftRef.current = '';
      executeCliCommand(command);
    },
    [appendCliEntry, cliInput, executeCliCommand]
  );

  const handleCliInputChange = useCallback(
    (nextValue: string) => {
      cliDraftRef.current = nextValue;
      if (cliHistoryIndex !== -1) {
        setCliHistoryIndex(-1);
      }
      setCliInput(nextValue);
    },
    [cliHistoryIndex]
  );

  const handleCliInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      const withModifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const input = event.currentTarget;

      const stepHistoryUp = () => {
        if (cliHistory.length === 0) return;
        event.preventDefault();
        setCliHistoryIndex((prev) => {
          if (prev === -1) {
            cliDraftRef.current = input.value;
          }
          const next = Math.min(prev + 1, cliHistory.length - 1);
          setCliInput(cliHistory[next] || '');
          return next;
        });
      };

      const stepHistoryDown = () => {
        if (cliHistory.length === 0) return;
        event.preventDefault();
        setCliHistoryIndex((prev) => {
          if (prev <= 0) {
            setCliInput(cliDraftRef.current);
            return -1;
          }
          const next = prev - 1;
          setCliInput(cliHistory[next] || '');
          return next;
        });
      };

      if (event.key === 'ArrowUp' || (event.ctrlKey && key === 'p')) {
        stepHistoryUp();
        return;
      }

      if (event.key === 'ArrowDown' || (event.ctrlKey && key === 'n')) {
        stepHistoryDown();
        return;
      }

      if (event.ctrlKey && !event.metaKey && key === 'a') {
        event.preventDefault();
        input.setSelectionRange(0, 0);
        return;
      }

      if (event.metaKey && key === 'a') {
        event.preventDefault();
        input.setSelectionRange(0, input.value.length);
        return;
      }

      if (event.ctrlKey && !event.metaKey && key === 'e') {
        event.preventDefault();
        const end = input.value.length;
        input.setSelectionRange(end, end);
        return;
      }

      if (withModifier && key === 'w') {
        event.preventDefault();
        const selectionStart = input.selectionStart ?? input.value.length;
        const selectionEnd = input.selectionEnd ?? input.value.length;
        const anchor = Math.min(selectionStart, selectionEnd);
        const focus = Math.max(selectionStart, selectionEnd);
        const beforeFocus = input.value.slice(0, anchor);
        const afterFocus = input.value.slice(focus);
        const trimmedBefore = beforeFocus.replace(/\s+$/, '');
        const tokenStart = trimmedBefore.search(/\S+\s*$/);
        const deleteStart = tokenStart === -1 ? 0 : tokenStart;
        const nextValue = `${beforeFocus.slice(0, deleteStart)}${afterFocus}`;
        setCliInput(nextValue);
        cliDraftRef.current = nextValue;
        requestAnimationFrame(() => {
          input.setSelectionRange(deleteStart, deleteStart);
        });
        return;
      }

      if (withModifier && key === 'u') {
        event.preventDefault();
        const selectionEnd = input.selectionEnd ?? input.value.length;
        const nextValue = input.value.slice(selectionEnd);
        setCliInput(nextValue);
        cliDraftRef.current = nextValue;
        requestAnimationFrame(() => {
          input.setSelectionRange(0, 0);
        });
        return;
      }

      if (withModifier && key === 'l') {
        event.preventDefault();
        clearCliEntries();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        setCliHistoryIndex(-1);
        setCliInput('');
        cliDraftRef.current = '';
      }
    },
    [cliHistory, clearCliEntries]
  );

  const toggleCliPanel = useCallback(() => {
    if (cliOpen) {
      setCliOpen(false);
      return;
    }
    openCli();
  }, [cliOpen, openCli]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (event: KeyboardEvent) =>
      handleIdeKeyboardShortcut(event, {
        actionLauncherOpen,
        toggleCliPanel,
        openActionLauncher,
        openSymbolPicker: () => openSymbolLauncher(''),
        closeActionLauncher: () => setActionLauncherOpen(false),
        openCli,
        runCode: handleRun,
        save,
        undoRevision: handleUndo,
        redoRevision: handleRedo,
        toggleLock: handleToggleLock,
      });
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    actionLauncherOpen,
    handleRedo,
    handleRun,
    handleToggleLock,
    handleUndo,
    openActionLauncher,
    openSymbolLauncher,
    openCli,
    save,
    toggleCliPanel,
  ]);

  return (
    <div className="aeon-container-ide relative flex h-full w-full flex-col rounded-lg border border-[var(--aeon-border)] bg-white dark:border-zinc-800 dark:bg-zinc-900">
      {/* Toolbar */}
      <ExecutionToolbar
        language={language}
        executionMode={executionMode}
        isExecuting={isExecuting}
        dirty={dirty}
        connected={connected}
        lockOwnerId={effectiveLockOwnerId}
        lockToggleDisabled={editorLockedByOther}
        lockExpiresAt={lockState.expires_at}
        lockHeartbeatAt={lockState.heartbeat_at}
        lockNowMs={lockNowMs}
        lockOverrideDisabled={isLockExternallyControlled}
        onRun={handleRun}
        onClear={clearLogs}
        onLanguageChange={setLanguage}
        onModeChange={setExecutionMode}
        onSave={save}
        onToggleLock={handleToggleLock}
        onOverrideLock={handleOverrideLock}
      />

      {/* Main Content Area */}
      <div className="flex min-h-0 flex-1">
        {/* File Tree (sidebar) */}
        <div className="w-48 shrink-0">
          <FileTree
            files={files}
            activeFile={activeFile}
            onSelectFile={setActiveFile}
            onCreateFile={handleCreateFile}
            onDeleteFile={handleDeleteFile}
          />
        </div>

        {/* Editor + Console */}
        <div className="flex min-w-0 flex-1 flex-col">
          {activeFile && activeTimeline && (
            <AeonIdeRevisionScrubber
              snapshotCount={activeSnapshotCount}
              visibleIndex={activeVisibleIndex}
              visibleSnapshot={activeVisibleSnapshot}
              canUndo={canUndo}
              canRedo={canRedo}
              canRestorePreview={canRestorePreview}
              playbackActive={scrubberPlaybackActive}
              playbackSpeed={scrubberPlaybackSpeed}
              canPlay={activeSnapshotCount > 1}
              previewing={activePreviewing}
              previewDiffers={activePreviewDiffers}
              editorLockedByOther={editorLockedByOther}
              lockOwnerId={effectiveLockOwnerId}
              lintStatus={lintStatus}
              lintProgress={lintProgress}
              inlineDiagnostics={inlineDiagnostics}
              inlineErrorCount={inlineErrorCount}
              lintEngine={lintStats ? lintStats.engine : null}
              onUndo={handleUndo}
              onRedo={handleRedo}
              onRestore={handleRestoreRevision}
              onLatest={handleJumpToLatestRevision}
              onTogglePlayback={
                scrubberPlaybackActive
                  ? pauseScrubberPlayback
                  : startScrubberPlayback
              }
              onPlaybackSpeedChange={applyScrubberPlaybackSpeed}
              onScrub={handleRevisionScrub}
            />
          )}

          <AeonIdeCodeEditor
            activeFile={activeFile}
            editorContent={editorContent}
            previewDiffers={activePreviewDiffers}
            editorLockedByOther={editorLockedByOther}
            lockOwnerId={effectiveLockOwnerId}
            editorReadOnly={editorReadOnly}
            diagnostics={inlineDiagnostics}
            showDiagnosticsStrip={diagnosticsStripEnabled}
            editorLineCount={editorLineCount}
            visibleEditorLineNumbers={visibleEditorLineNumbers}
            lineNumberTopSpacerHeight={lineNumberTopSpacerHeight}
            lineNumberBottomSpacerHeight={lineNumberBottomSpacerHeight}
            textareaRef={textareaRef}
            lineNumberGutterRef={lineNumberGutterRef}
            onEditorChange={handleEditorChange}
            onEditorScroll={handleEditorScroll}
            onJumpToLine={jumpToLine}
          />

          {/* Console (resizable) */}
          <div className="h-48 shrink-0">
            <ExecutionConsole
              logs={logs}
              isExecuting={isExecuting}
              onClear={clearLogs}
            />
          </div>

          <AeonIdeCommandCli
            isOpen={cliOpen}
            entries={cliEntries}
            inputValue={cliInput}
            outputRef={cliOutputRef}
            inputRef={cliInputRef}
            onToggleOpen={() => setCliOpen((prev) => !prev)}
            onSubmit={handleCliSubmit}
            onInputChange={handleCliInputChange}
            onInputKeyDown={handleCliInputKeyDown}
          />
        </div>

        {showRoomPanel && (
          <div className="w-80 shrink-0 border-l border-[var(--aeon-border)] dark:border-zinc-800">
            <AeonIdeCollaborationPanel
              enabled={roomCollaboration.enabled}
              loading={roomCollaboration.loading}
              error={roomCollaboration.error}
              snapshot={roomCollaboration.snapshot}
              onRefresh={() => {
                void roomCollaboration.refresh();
              }}
              onTaskStatusChange={roomCollaboration.setTaskStatus}
            />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="aeon-container-ide-footer flex items-center justify-between border-t border-[var(--aeon-border)] px-3 py-1.5 dark:border-zinc-800">
        <CapabilityBadge tier={tier} agentDid={agentDid} />
        <div className="aeon-container-ide-footer-meta flex items-center gap-2 text-[10px] text-[var(--aeon-text-tertiary)] dark:text-zinc-500">
          {devMode && (
            <span className="aeon-container-ide-dev-pill rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-400">
              DEV
            </span>
          )}
          <span>
            {containerId.length > 16
              ? `${containerId.slice(0, 8)}...${containerId.slice(-6)}`
              : containerId}
          </span>
          {effectiveLockOwnerId && (
            <span>
              {effectiveLockOwnerId === LOCAL_LOCK_OWNER_ID
                ? 'Locked by you'
                : `Locked by ${effectiveLockOwnerId}`}
            </span>
          )}
          {syncing && <span>Syncing...</span>}
        </div>
      </div>

      <AeonIdeActionLauncher
        open={actionLauncherOpen}
        query={actionQuery}
        cursor={actionCursor}
        items={launcherItems}
        headerLabel={
          actionLauncherMode === 'actions'
            ? 'Action Launcher'
            : 'Symbol Navigator'
        }
        headerHint={
          actionLauncherMode === 'actions' ? 'Cmd/Ctrl+K' : 'Jump To Definition'
        }
        placeholder={
          actionLauncherMode === 'actions'
            ? 'Run, lint, format, lock, language...'
            : 'Search symbols...'
        }
        emptyLabel={
          actionLauncherMode === 'actions'
            ? 'No matching actions.'
            : symbolsLoading
            ? 'Loading symbols...'
            : symbolsError || 'No symbols found.'
        }
        inputRef={actionInputRef}
        onClose={() => {
          setActionLauncherOpen(false);
          setActionLauncherMode('actions');
        }}
        onQueryChange={(nextQuery) => {
          setActionQuery(nextQuery);
          setActionCursor(0);
        }}
        onInputKeyDown={handleActionInputKeyDown}
        onHoverItem={setActionCursor}
        onSelectItem={executeLauncherItemByIndex}
      />
    </div>
  );
}
