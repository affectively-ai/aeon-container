'use aeon';

import React from 'react';
import type { StreamedLintDiagnostic } from '../services/streamed-lint-types';
import type { RevisionSnapshot } from './revision-history';

interface AeonIdeRevisionScrubberProps {
  snapshotCount: number;
  visibleIndex: number;
  visibleSnapshot: RevisionSnapshot | null;
  canUndo: boolean;
  canRedo: boolean;
  canRestorePreview: boolean;
  playbackActive: boolean;
  playbackSpeed: number;
  canPlay: boolean;
  previewing: boolean;
  previewDiffers: boolean;
  editorLockedByOther: boolean;
  lockOwnerId: string | null;
  lintStatus: 'idle' | 'running' | 'done';
  lintProgress: number;
  inlineDiagnostics: StreamedLintDiagnostic[];
  inlineErrorCount: number;
  lintEngine: string | null;
  onUndo: () => void;
  onRedo: () => void;
  onRestore: () => void;
  onLatest: () => void;
  onTogglePlayback: () => void;
  onPlaybackSpeedChange: (speed: number) => void;
  onScrub: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

interface AeonIdeCodeEditorProps {
  activeFile: string | null;
  editorContent: string;
  previewDiffers: boolean;
  editorLockedByOther: boolean;
  lockOwnerId: string | null;
  editorReadOnly: boolean;
  diagnostics: StreamedLintDiagnostic[];
  showDiagnosticsStrip: boolean;
  editorLineCount: number;
  visibleEditorLineNumbers: number[];
  lineNumberTopSpacerHeight: number;
  lineNumberBottomSpacerHeight: number;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  lineNumberGutterRef: React.RefObject<HTMLDivElement | null>;
  onEditorChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onEditorScroll: (event: React.UIEvent<HTMLTextAreaElement>) => void;
  onJumpToLine: (line: number) => void;
}

function formatRevisionTimestamp(snapshot: RevisionSnapshot): string {
  const time = new Date(snapshot.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return `${snapshot.reason} @ ${time}`;
}

export function AeonIdeRevisionScrubber({
  snapshotCount,
  visibleIndex,
  visibleSnapshot,
  canUndo,
  canRedo,
  canRestorePreview,
  playbackActive,
  playbackSpeed,
  canPlay,
  previewing,
  previewDiffers,
  editorLockedByOther,
  lockOwnerId,
  lintStatus,
  lintProgress,
  inlineDiagnostics,
  inlineErrorCount,
  lintEngine,
  onUndo,
  onRedo,
  onRestore,
  onLatest,
  onTogglePlayback,
  onPlaybackSpeedChange,
  onScrub,
}: AeonIdeRevisionScrubberProps) {
  return (
    <div
      className="aeon-revision-scrubber border-b border-[var(--aeon-border)] px-3 py-2"
      aria-label="Revision scrubber"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-[var(--aeon-text-tertiary)]">
          Revision {visibleIndex + 1}/{snapshotCount}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onUndo}
            disabled={!canUndo || editorLockedByOther}
            className="aeon-revision-button rounded px-2 py-1 text-xs disabled:opacity-50"
            aria-label="Undo revision"
          >
            Undo
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo || editorLockedByOther}
            className="aeon-revision-button rounded px-2 py-1 text-xs disabled:opacity-50"
            aria-label="Redo revision"
          >
            Redo
          </button>
          <button
            onClick={onRestore}
            disabled={!canRestorePreview}
            className="aeon-revision-button aeon-revision-button--primary rounded px-2 py-1 text-xs disabled:opacity-50"
            aria-label="Restore selected revision"
          >
            Restore
          </button>
          <button
            onClick={onLatest}
            disabled={!previewing}
            className="aeon-revision-button rounded px-2 py-1 text-xs disabled:opacity-50"
            aria-label="Jump to latest revision"
          >
            Latest
          </button>
          <button
            onClick={onTogglePlayback}
            disabled={!canPlay}
            className="aeon-revision-button rounded px-2 py-1 text-xs disabled:opacity-50"
            aria-label={
              playbackActive ? 'Pause revision replay' : 'Play revision replay'
            }
          >
            {playbackActive ? 'Pause' : 'Play'}
          </button>
          <label className="aeon-replay-speed flex items-center gap-1 text-[10px] text-[var(--aeon-text-tertiary)]">
            <span>Speed</span>
            <select
              className="aeon-revision-speed-select"
              value={playbackSpeed}
              onChange={(event) => {
                onPlaybackSpeedChange(Number(event.target.value));
              }}
              aria-label="Replay speed"
            >
              <option value={0.5}>0.5x</option>
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={4}>4x</option>
            </select>
          </label>
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(snapshotCount - 1, 0)}
        step={1}
        value={visibleIndex}
        onChange={onScrub}
        className="aeon-revision-slider w-full"
        aria-label="Revision timeline slider"
      />
      <div className="flex items-center justify-between gap-2 text-[10px] text-[var(--aeon-text-tertiary)]">
        <span>
          {visibleSnapshot
            ? formatRevisionTimestamp(visibleSnapshot)
            : 'No revisions'}
        </span>
        <span>
          {previewDiffers
            ? 'Preview mode'
            : editorLockedByOther
            ? `Locked by ${lockOwnerId}`
            : 'Live'}
          {playbackActive && ' | Replay'}
          {lintStatus === 'running' &&
            ` | Linting ${Math.round(lintProgress * 100)}%`}
          {lintStatus === 'done' &&
            inlineDiagnostics.length > 0 &&
            ` | ${inlineErrorCount} error${
              inlineErrorCount === 1 ? '' : 's'
            }, ${inlineDiagnostics.length} issue${
              inlineDiagnostics.length === 1 ? '' : 's'
            }${lintEngine ? ` (${lintEngine})` : ''}`}
        </span>
      </div>
    </div>
  );
}

export function AeonIdeCodeEditor({
  activeFile,
  editorContent,
  previewDiffers,
  editorLockedByOther,
  lockOwnerId,
  editorReadOnly,
  diagnostics,
  showDiagnosticsStrip,
  editorLineCount,
  visibleEditorLineNumbers,
  lineNumberTopSpacerHeight,
  lineNumberBottomSpacerHeight,
  textareaRef,
  lineNumberGutterRef,
  onEditorChange,
  onEditorScroll,
  onJumpToLine,
}: AeonIdeCodeEditorProps) {
  return (
    <div className="min-h-0 flex-1">
      <div className="aeon-editor-shell h-full">
        <div
          ref={lineNumberGutterRef}
          className="aeon-editor-gutter"
          aria-hidden="true"
        >
          {lineNumberTopSpacerHeight > 0 && (
            <div style={{ height: `${lineNumberTopSpacerHeight}px` }} />
          )}
          {visibleEditorLineNumbers.map((lineNumber) => (
            <div key={lineNumber} className="aeon-editor-line-number">
              {lineNumber}
            </div>
          ))}
          {lineNumberBottomSpacerHeight > 0 && (
            <div style={{ height: `${lineNumberBottomSpacerHeight}px` }} />
          )}
        </div>

        <textarea
          ref={textareaRef}
          value={editorContent}
          onChange={onEditorChange}
          onScroll={onEditorScroll}
          placeholder={
            !activeFile
              ? 'Select or create a file to start editing.'
              : previewDiffers
              ? 'Previewing an older revision. Click Restore to time-travel.'
              : editorLockedByOther
              ? `Locked by ${lockOwnerId}. Waiting for unlock.`
              : 'Write your code here...'
          }
          className="aeon-editor-textarea h-full flex-1 resize-none bg-white p-4 font-mono text-[16px] text-sm leading-relaxed text-[var(--aeon-text-primary)] placeholder-[#8a8476] focus:outline-none dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500"
          spellCheck={false}
          readOnly={editorReadOnly}
          aria-readonly={editorReadOnly}
          aria-label={activeFile ? `Editing ${activeFile}` : 'Code editor'}
        />

        {showDiagnosticsStrip && (
          <div
            className="aeon-editor-lint-strip"
            aria-label="Lint diagnostics strip"
          >
            {diagnostics.map((diagnostic, index) => (
              <button
                key={diagnostic.id || `${diagnostic.line}-${index}`}
                type="button"
                onClick={() => onJumpToLine(diagnostic.line)}
                className={[
                  'aeon-editor-lint-marker',
                  diagnostic.severity === 'error'
                    ? 'aeon-editor-lint-marker--error'
                    : diagnostic.severity === 'warning'
                    ? 'aeon-editor-lint-marker--warning'
                    : 'aeon-editor-lint-marker--info',
                ].join(' ')}
                style={{
                  top: `${
                    ((diagnostic.line - 1) / Math.max(editorLineCount - 1, 1)) *
                    100
                  }%`,
                }}
                aria-label={`Issue on line ${diagnostic.line}: ${diagnostic.message}`}
                title={`Line ${diagnostic.line}: ${diagnostic.message}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
