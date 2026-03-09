'use aeon';

/**
 * ExecutionToolbar — Run/Stop/Clear + language selector + mode toggle
 *
 * Top toolbar for the AeonContainerIDE with execution controls.
 */

import React from 'react';
import type { ContainerLanguage } from '../services/types';

// ── Types ────────────────────────────────────────────────────────

interface ExecutionToolbarProps {
  /** Currently selected language */
  language: ContainerLanguage;
  /** Execution mode: browser WASM or edge API */
  executionMode: 'browser' | 'edge';
  /** Whether code is currently executing */
  isExecuting: boolean;
  /** Whether there are unsaved changes */
  dirty: boolean;
  /** Whether DashRelay is connected */
  connected: boolean;
  /** Optional lock owner (for collaborative edit mutex) */
  lockOwnerId?: string | null;
  /** Whether lock toggle should be disabled */
  lockToggleDisabled?: boolean;
  /** Lock lease expiration timestamp */
  lockExpiresAt?: number;
  /** Last lock heartbeat timestamp */
  lockHeartbeatAt?: number;
  /** Current timestamp for live countdowns */
  lockNowMs?: number;
  /** Whether override button should be disabled */
  lockOverrideDisabled?: boolean;
  /** Callbacks */
  onRun: () => void;
  onStop?: () => void;
  onClear?: () => void;
  onLanguageChange: (lang: ContainerLanguage) => void;
  onModeChange: (mode: 'browser' | 'edge') => void;
  onSave?: () => void;
  onToggleLock?: () => void;
  onOverrideLock?: () => void;
}

const LANGUAGES: { value: ContainerLanguage; label: string }[] = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'go', label: 'Go' },
  { value: 'python', label: 'Python' },
  { value: 'rust', label: 'Rust' },
  { value: 'lua', label: 'Lua' },
];

// ── Component ────────────────────────────────────────────────────

export function ExecutionToolbar({
  language,
  executionMode,
  isExecuting,
  dirty,
  connected,
  lockOwnerId = null,
  lockToggleDisabled = false,
  lockExpiresAt,
  lockHeartbeatAt,
  lockNowMs = Date.now(),
  lockOverrideDisabled = false,
  onRun,
  onStop,
  onClear,
  onLanguageChange,
  onModeChange,
  onSave,
  onToggleLock,
  onOverrideLock,
}: ExecutionToolbarProps) {
  const lockHeldByOther = lockOwnerId !== null && lockOwnerId !== 'you';
  const lockIsHeld = lockOwnerId !== null;
  const lockSecondsRemaining =
    typeof lockExpiresAt === 'number'
      ? Math.max(0, Math.ceil((lockExpiresAt - lockNowMs) / 1000))
      : null;
  const heartbeatAgeMs =
    typeof lockHeartbeatAt === 'number'
      ? Math.max(0, lockNowMs - lockHeartbeatAt)
      : null;
  const heartbeatState =
    heartbeatAgeMs === null
      ? 'unknown'
      : heartbeatAgeMs <= 25_000
      ? 'live'
      : heartbeatAgeMs <= 60_000
      ? 'late'
      : 'stale';
  const lockButtonLabel =
    lockOwnerId === null
      ? 'Lock editor'
      : lockOwnerId === 'you'
      ? 'Unlock editor'
      : `Locked by ${lockOwnerId}`;

  return (
    <div
      className="aeon-execution-toolbar flex items-center gap-2 border-b border-[var(--aeon-border)] bg-[var(--aeon-bg-root)] px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"
      role="toolbar"
      aria-label="Execution controls"
    >
      {/* Language Selector */}
      <label className="flex items-center gap-1.5">
        <span className="sr-only">Language</span>
        <select
          value={language}
          onChange={(e) =>
            onLanguageChange(e.target.value as ContainerLanguage)
          }
          className="aeon-toolbar-language-select rounded border border-[var(--aeon-border)] bg-white px-2 py-1 text-xs text-[var(--aeon-text-primary)] focus:border-[#191919] focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-400"
          aria-label="Select language"
        >
          {LANGUAGES.map((lang) => (
            <option key={lang.value} value={lang.value}>
              {lang.label}
            </option>
          ))}
        </select>
      </label>

      {/* Mode Toggle */}
      <button
        onClick={() =>
          onModeChange(executionMode === 'browser' ? 'edge' : 'browser')
        }
        className="aeon-toolbar-mode-button flex items-center gap-1 rounded-lg border border-[var(--aeon-border)] px-2 py-1 text-xs text-[var(--aeon-text-secondary)] transition-colors hover:bg-[#e6dec8]/50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
        aria-label={`Execution mode: ${executionMode}. Click to toggle.`}
        title={
          executionMode === 'browser'
            ? 'Browser WASM: Private, fast, no network'
            : 'Edge API: All languages, persistence, logging'
        }
      >
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            executionMode === 'browser' ? 'bg-emerald-500' : 'bg-blue-500'
          }`}
        />
        {executionMode === 'browser' ? 'Browser' : 'Edge'}
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Status Indicators */}
      <div className="flex items-center gap-2">
        {/* Lock toggle */}
        {onToggleLock && (
          <button
            onClick={onToggleLock}
            disabled={lockToggleDisabled}
            className="aeon-toolbar-lock-button rounded-lg px-2 py-1.5 text-xs text-[var(--aeon-text-tertiary)] transition-colors hover:bg-[#e6dec8]/50 hover:text-[var(--aeon-text-primary)] disabled:opacity-50 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label={lockButtonLabel}
            title={
              lockOwnerId === null
                ? 'Claim exclusive write control'
                : lockOwnerId === 'you'
                ? 'Release exclusive write control'
                : `Editing is locked by ${lockOwnerId}`
            }
          >
            {lockOwnerId === null
              ? 'Lock'
              : lockOwnerId === 'you'
              ? 'Unlock'
              : 'Locked'}
          </button>
        )}

        {lockHeldByOther && (
          <span
            className="aeon-toolbar-lock-owner max-w-[180px] truncate text-[10px]"
            title={
              lockExpiresAt
                ? `Locked by ${lockOwnerId} until ${new Date(
                    lockExpiresAt
                  ).toLocaleTimeString()}`
                : `Locked by ${lockOwnerId}`
            }
          >
            {lockOwnerId}
          </span>
        )}

        {onOverrideLock && lockHeldByOther && (
          <button
            onClick={onOverrideLock}
            disabled={lockOverrideDisabled}
            className="aeon-toolbar-lock-override-button rounded-lg px-2 py-1.5 text-xs transition-colors disabled:opacity-50"
            aria-label="Override lock"
            title="Force takeover of lock (requires capability)"
          >
            Override
          </button>
        )}

        {lockIsHeld && (
          <span className="aeon-toolbar-lock-meta text-[10px]">
            {lockSecondsRemaining === null
              ? 'TTL --'
              : `TTL ${lockSecondsRemaining}s`}
          </span>
        )}
        {lockIsHeld && (
          <span
            className={`aeon-toolbar-lock-heartbeat aeon-toolbar-lock-heartbeat--${heartbeatState} text-[10px]`}
            title={
              heartbeatAgeMs === null
                ? 'Heartbeat unavailable'
                : `Last heartbeat ${Math.floor(heartbeatAgeMs / 1000)}s ago`
            }
          >
            HB {heartbeatState}
          </span>
        )}

        {/* Connection status */}
        <span
          className={`aeon-toolbar-connection-status inline-flex items-center gap-1 text-[10px] ${
            connected
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-[var(--aeon-text-tertiary)] dark:text-zinc-500'
          }`}
          title={connected ? 'DashRelay connected' : 'Offline'}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              connected ? 'bg-emerald-500' : 'bg-[#8a8476] dark:bg-zinc-600'
            }`}
          />
          {connected ? 'Synced' : 'Local'}
        </span>

        {/* Clear button */}
        {onClear && (
          <button
            onClick={onClear}
            className="aeon-toolbar-clear-button rounded-lg px-2 py-1.5 text-xs text-[var(--aeon-text-tertiary)] transition-colors hover:bg-[#e6dec8]/50 hover:text-[var(--aeon-text-primary)] dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="Clear console"
          >
            Clear
          </button>
        )}

        {/* Save button */}
        {onSave && dirty && (
          <button
            onClick={onSave}
            className="aeon-toolbar-save-button rounded-lg bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
            aria-label="Save changes"
          >
            Save
          </button>
        )}

        {/* Run / Stop */}
        {isExecuting ? (
          <button
            onClick={onStop}
            disabled={!onStop}
            className="aeon-toolbar-stop-button rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
            aria-label="Stop execution"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={onRun}
            className="aeon-toolbar-run-button rounded-lg bg-[var(--aeon-accent)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#333] dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            aria-label="Run code"
          >
            Run
          </button>
        )}
      </div>
    </div>
  );
}
