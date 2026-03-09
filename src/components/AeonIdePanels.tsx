'use aeon';

import React from 'react';
import type {
  AgentRoomSnapshotPayload,
  AgentRoomTask,
} from '../services/agent-room-client';

interface ActionLauncherItem {
  id: string;
  label: string;
  hint: string;
}

interface AeonIdeCommandEntry {
  id: string;
  text: string;
  level: 'info' | 'ok' | 'warn' | 'error';
}

interface AeonIdeCommandCliProps {
  isOpen: boolean;
  entries: AeonIdeCommandEntry[];
  inputValue: string;
  outputRef: React.RefObject<HTMLDivElement | null>;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onToggleOpen: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onInputChange: (value: string) => void;
  onInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}

interface AeonIdeActionLauncherProps {
  open: boolean;
  query: string;
  cursor: number;
  items: ActionLauncherItem[];
  headerLabel?: string;
  headerHint?: string;
  placeholder?: string;
  emptyLabel?: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onQueryChange: (value: string) => void;
  onInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onHoverItem: (index: number) => void;
  onSelectItem: (index: number) => void;
}

interface SetTaskStatusInput {
  scope: 'global' | 'agent';
  taskId: string;
  status: AgentRoomTask['status'];
  agentId?: string;
}

interface AeonIdeCollaborationPanelProps {
  enabled: boolean;
  loading: boolean;
  error: string | null;
  snapshot: AgentRoomSnapshotPayload | null;
  onRefresh: () => void;
  onTaskStatusChange: (input: SetTaskStatusInput) => Promise<void>;
}

function statusColorClass(status: string): string {
  switch (status) {
    case 'thinking':
    case 'coordinating':
    case 'editing':
    case 'testing':
      return 'aeon-room-status-dot aeon-room-status-dot--active';
    case 'blocked':
      return 'aeon-room-status-dot aeon-room-status-dot--blocked';
    case 'offline':
      return 'aeon-room-status-dot aeon-room-status-dot--offline';
    default:
      return 'aeon-room-status-dot';
  }
}

function sortPresence(
  left: { channel: number },
  right: { channel: number }
): number {
  return left.channel - right.channel;
}

export function AeonIdeCommandCli({
  isOpen,
  entries,
  inputValue,
  outputRef,
  inputRef,
  onToggleOpen,
  onSubmit,
  onInputChange,
  onInputKeyDown,
}: AeonIdeCommandCliProps) {
  return (
    <section
      className={`aeon-command-cli ${
        isOpen ? 'aeon-command-cli--open' : 'aeon-command-cli--closed'
      }`}
      aria-label="IDE command line"
    >
      <div className="aeon-command-cli-header">
        <span>CLI</span>
        <div className="aeon-command-cli-header-meta">
          <span>Cmd/Ctrl+J</span>
          <button
            type="button"
            onClick={onToggleOpen}
            className="aeon-command-cli-toggle"
            aria-label={
              isOpen ? 'Collapse command line' : 'Expand command line'
            }
          >
            {isOpen ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>
      {isOpen && (
        <>
          <div ref={outputRef} className="aeon-command-cli-output">
            {entries.length === 0 ? (
              <p className="aeon-command-cli-empty">
                Type <code>help</code> for available commands.
              </p>
            ) : (
              entries.map((entry) => (
                <p
                  key={entry.id}
                  className={`aeon-command-cli-entry aeon-command-cli-entry--${entry.level}`}
                >
                  {entry.text}
                </p>
              ))
            )}
          </div>
          <form className="aeon-command-cli-form" onSubmit={onSubmit}>
            <span className="aeon-command-cli-prompt">$</span>
            <input
              ref={inputRef}
              value={inputValue}
              onChange={(event) => onInputChange(event.target.value)}
              onKeyDown={onInputKeyDown}
              className="aeon-command-cli-input"
              placeholder="run | lint | format | language go | goto 128"
              aria-label="IDE command input"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </form>
        </>
      )}
    </section>
  );
}

export function AeonIdeActionLauncher({
  open,
  query,
  cursor,
  items,
  headerLabel = 'Action Launcher',
  headerHint = 'Cmd/Ctrl+K',
  placeholder = 'Run, lint, format, lock, language...',
  emptyLabel = 'No matching actions.',
  inputRef,
  onClose,
  onQueryChange,
  onInputKeyDown,
  onHoverItem,
  onSelectItem,
}: AeonIdeActionLauncherProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="aeon-action-launcher-backdrop" onClick={onClose}>
      <section
        className="aeon-action-launcher"
        role="dialog"
        aria-modal="true"
        aria-label="Action launcher"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="aeon-action-launcher-header">
          <span>{headerLabel}</span>
          <span>{headerHint}</span>
        </header>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={onInputKeyDown}
          className="aeon-action-launcher-input"
          placeholder={placeholder}
          aria-label="Filter actions"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <div className="aeon-action-launcher-list">
          {items.length === 0 ? (
            <p className="aeon-action-launcher-empty">{emptyLabel}</p>
          ) : (
            items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectItem(index)}
                onMouseEnter={() => onHoverItem(index)}
                className={`aeon-action-launcher-item ${
                  index === cursor ? 'aeon-action-launcher-item--active' : ''
                }`}
                aria-label={`${item.label}: ${item.hint}`}
              >
                <span>{item.label}</span>
                <span>{item.hint}</span>
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function TaskStatusSelect(props: {
  task: AgentRoomTask;
  onChange: (status: AgentRoomTask['status']) => void;
}) {
  return (
    <select
      className="aeon-room-task-select"
      value={props.task.status}
      onChange={(event) =>
        props.onChange(event.target.value as AgentRoomTask['status'])
      }
      aria-label={`Set status for ${props.task.title}`}
    >
      <option value="todo">todo</option>
      <option value="in_progress">in progress</option>
      <option value="done">done</option>
      <option value="blocked">blocked</option>
    </select>
  );
}

export function AeonIdeCollaborationPanel({
  enabled,
  loading,
  error,
  snapshot,
  onRefresh,
  onTaskStatusChange,
}: AeonIdeCollaborationPanelProps) {
  if (!enabled) {
    return (
      <aside
        className="aeon-room-panel"
        aria-label="Agent room collaboration panel"
      >
        <header className="aeon-room-panel-header">
          <h3>Room Panel</h3>
        </header>
        <p className="aeon-room-panel-empty">
          Set <code>agentRoomId</code> to enable shared presence and todos.
        </p>
      </aside>
    );
  }

  return (
    <aside
      className="aeon-room-panel"
      aria-label="Agent room collaboration panel"
    >
      <header className="aeon-room-panel-header">
        <h3>Room Panel</h3>
        <button
          type="button"
          className="aeon-room-panel-refresh"
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? 'Syncing' : 'Refresh'}
        </button>
      </header>

      {error && <p className="aeon-room-panel-error">{error}</p>}

      {snapshot ? (
        <>
          <section className="aeon-room-panel-section">
            <h4>Request</h4>
            <p className="aeon-room-panel-summary">
              {snapshot.room.request.requestSummary}
            </p>
          </section>

          <section className="aeon-room-panel-section">
            <h4>Presence</h4>
            <ul className="aeon-room-presence-list">
              {[...snapshot.presence]
                .sort(sortPresence)
                .map((presenceEntry) => {
                  const agent = snapshot.room.agents[presenceEntry.agentId];
                  const label = agent?.displayName || presenceEntry.agentId;
                  return (
                    <li
                      key={presenceEntry.agentId}
                      className="aeon-room-presence-row"
                    >
                      <span
                        className={statusColorClass(presenceEntry.status)}
                      />
                      <span className="aeon-room-presence-channel">
                        C{presenceEntry.channel}
                      </span>
                      <span className="aeon-room-presence-name">{label}</span>
                      <span className="aeon-room-presence-status">
                        {presenceEntry.status}
                      </span>
                    </li>
                  );
                })}
            </ul>
          </section>

          <section className="aeon-room-panel-section">
            <h4>Global Todos</h4>
            {snapshot.globalTasks.length === 0 ? (
              <p className="aeon-room-panel-empty">No global tasks.</p>
            ) : (
              <ul className="aeon-room-task-list">
                {snapshot.globalTasks.map((task) => (
                  <li key={task.taskId} className="aeon-room-task-row">
                    <span className="aeon-room-task-title">{task.title}</span>
                    <TaskStatusSelect
                      task={task}
                      onChange={(status) =>
                        void onTaskStatusChange({
                          scope: 'global',
                          taskId: task.taskId,
                          status,
                        })
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="aeon-room-panel-section">
            <h4>Agent Todos</h4>
            {Object.entries(snapshot.agentTasks).length === 0 ? (
              <p className="aeon-room-panel-empty">No agent tasks.</p>
            ) : (
              <div className="aeon-room-agent-tasks">
                {Object.entries(snapshot.agentTasks).map(([agentId, tasks]) => {
                  if (tasks.length === 0) {
                    return null;
                  }
                  const agent = snapshot.room.agents[agentId];
                  return (
                    <div key={agentId} className="aeon-room-agent-task-group">
                      <h5>{agent?.displayName || agentId}</h5>
                      <ul className="aeon-room-task-list">
                        {tasks.map((task) => (
                          <li key={task.taskId} className="aeon-room-task-row">
                            <span className="aeon-room-task-title">
                              {task.title}
                            </span>
                            <TaskStatusSelect
                              task={task}
                              onChange={(status) =>
                                void onTaskStatusChange({
                                  scope: 'agent',
                                  agentId,
                                  taskId: task.taskId,
                                  status,
                                })
                              }
                            />
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      ) : (
        <p className="aeon-room-panel-empty">
          {loading ? 'Loading room snapshot…' : 'No room data.'}
        </p>
      )}
    </aside>
  );
}
