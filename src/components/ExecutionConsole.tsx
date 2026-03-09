'use aeon';

/**
 * ExecutionConsole — Streaming output console for AeonContainerIDE
 *
 * Displays execution output with log levels, timing, and ZK proofs.
 * Auto-scrolls to bottom on new output.
 */

import React, { useRef, useEffect } from 'react';
import type { ContainerExecuteResult } from '../services/types';

// ── Types ────────────────────────────────────────────────────────

export interface ExecutionLogEntry {
  id: string;
  timestamp: number;
  result: ContainerExecuteResult;
  code?: string;
}

interface ExecutionConsoleProps {
  logs: ExecutionLogEntry[];
  isExecuting: boolean;
  onClear?: () => void;
}

// ── Log Level Colors ─────────────────────────────────────────────

function getLogLineStyle(line: string): string {
  if (line.startsWith('[ERROR]') || line.startsWith('[error]')) {
    return 'text-red-500 dark:text-red-400';
  }
  if (line.startsWith('[WARN]') || line.startsWith('[warn]')) {
    return 'text-amber-600 dark:text-amber-400';
  }
  if (line.startsWith('[INFO]') || line.startsWith('[info]')) {
    return 'text-blue-500 dark:text-blue-400';
  }
  if (line.startsWith('[DEBUG]') || line.startsWith('[debug]')) {
    return 'text-[var(--aeon-text-tertiary)] dark:text-zinc-500';
  }
  return 'text-[var(--aeon-text-primary)] dark:text-zinc-200';
}

function getOutcomeStyle(outcome: string): { text: string; className: string } {
  switch (outcome) {
    case 'OUTCOME_OK':
      return {
        text: 'OK',
        className: 'text-emerald-600 dark:text-emerald-400',
      };
    case 'OUTCOME_TIMEOUT':
      return {
        text: 'TIMEOUT',
        className: 'text-amber-600 dark:text-amber-400',
      };
    case 'OUTCOME_ERROR':
      return { text: 'ERROR', className: 'text-red-500 dark:text-red-400' };
    case 'OUTCOME_MEMORY_EXCEEDED':
      return { text: 'OOM', className: 'text-red-500 dark:text-red-400' };
    case 'OUTCOME_UNSUPPORTED_LANGUAGE':
      return {
        text: 'UNSUPPORTED',
        className: 'text-[var(--aeon-text-tertiary)] dark:text-zinc-500',
      };
    default:
      return {
        text: outcome,
        className: 'text-[var(--aeon-text-tertiary)] dark:text-zinc-500',
      };
  }
}

// ── Console Component ────────────────────────────────────────────

export function ExecutionConsole({
  logs,
  isExecuting,
  onClear,
}: ExecutionConsoleProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new output
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, isExecuting]);

  return (
    <div
      className="aeon-execution-console flex h-full flex-col border-t border-[var(--aeon-border)] bg-white dark:border-zinc-800 dark:bg-zinc-950"
      role="log"
      aria-label="Execution console"
      aria-live="polite"
    >
      {/* Console Header */}
      <div className="aeon-execution-console-header flex items-center justify-between border-b border-[var(--aeon-border)] px-3 py-1.5 dark:border-zinc-800">
        <span className="text-xs font-medium uppercase tracking-wider text-[var(--aeon-text-tertiary)] dark:text-zinc-500">
          Console
        </span>
        <div className="flex items-center gap-2">
          {isExecuting && (
            <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
              Running...
            </span>
          )}
          {onClear && logs.length > 0 && (
            <button
              onClick={onClear}
              className="aeon-execution-console-clear-button rounded px-1.5 py-0.5 text-[10px] text-[var(--aeon-text-tertiary)] hover:bg-[#e6dec8]/50 hover:text-[var(--aeon-text-primary)] dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              aria-label="Clear console"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Console Output */}
      <div
        ref={scrollRef}
        className="aeon-execution-console-output min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 font-mono text-xs"
      >
        {logs.length === 0 && !isExecuting && (
          <p className="aeon-execution-console-empty text-[var(--aeon-text-tertiary)] dark:text-zinc-500">
            Press Run to execute code.
          </p>
        )}

        {logs.map((entry) => {
          const outcomeInfo = getOutcomeStyle(entry.result.outcome);
          return (
            <div key={entry.id} className="mb-3 last:mb-0">
              {/* Execution header */}
              <div className="mb-1 flex items-center gap-2 text-[10px]">
                <span className={outcomeInfo.className}>
                  [{outcomeInfo.text}]
                </span>
                <span className="text-[var(--aeon-text-tertiary)] dark:text-zinc-500">
                  {entry.result.execution_time_ms.toFixed(1)}ms
                </span>
                <span className="text-[var(--aeon-text-tertiary)] dark:text-zinc-600">
                  {entry.result.language}
                </span>
                {entry.result.execution_proof && (
                  <span
                    className="text-emerald-600/60 dark:text-emerald-400/60"
                    title={`ZK proof: ${entry.result.execution_proof}`}
                  >
                    ZK
                  </span>
                )}
              </div>

              {/* Log lines */}
              {entry.result.logs.map((line, i) => (
                <div
                  key={i}
                  className={`whitespace-pre-wrap leading-relaxed ${getLogLineStyle(
                    line
                  )}`}
                >
                  {line}
                </div>
              ))}

              {/* Output (if different from logs) */}
              {entry.result.output &&
                !entry.result.logs.includes(entry.result.output) && (
                  <div className="whitespace-pre-wrap leading-relaxed text-[var(--aeon-text-primary)] dark:text-zinc-200">
                    {entry.result.output}
                  </div>
                )}

              {/* Error */}
              {entry.result.error && (
                <div className="mt-1 whitespace-pre-wrap text-red-500 dark:text-red-400">
                  {entry.result.error}
                </div>
              )}
            </div>
          );
        })}

        {/* Executing indicator */}
        {isExecuting && (
          <div className="flex items-center gap-1.5 text-[var(--aeon-text-tertiary)] dark:text-zinc-500">
            <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-[#8a8476] dark:bg-zinc-500" />
            <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-[#8a8476] delay-75 dark:bg-zinc-500" />
            <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-[#8a8476] delay-150 dark:bg-zinc-500" />
          </div>
        )}
      </div>
    </div>
  );
}
