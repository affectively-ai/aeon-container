'use aeon';

/**
 * FileTree — Sidebar file browser for AeonContainerIDE
 *
 * Displays the persistent filesystem as a collapsible tree.
 * Supports create, rename, and delete operations.
 */

import React, { useState, useCallback } from 'react';
import type { FileEntry } from '../services/types';

// ── Types ────────────────────────────────────────────────────────

interface FileTreeProps {
  files: FileEntry[];
  activeFile: string | null;
  onSelectFile: (path: string) => void;
  onCreateFile?: (path: string) => void;
  onDeleteFile?: (path: string) => void;
  onRenameFile?: (oldPath: string, newPath: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  language?: string;
  dirty?: boolean;
  children: TreeNode[];
}

// ── File Icons ───────────────────────────────────────────────────

function getFileIcon(language?: string): string {
  const icons: Record<string, string> = {
    typescript: 'TS',
    javascript: 'JS',
    go: 'GO',
    python: 'PY',
    rust: 'RS',
    lua: 'LU',
    json: '{}',
    markdown: 'MD',
    html: '<>',
    css: '#',
  };
  return language ? icons[language] || '.' : '.';
}

// ── Build Tree ───────────────────────────────────────────────────

function buildTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode = {
    name: '/',
    path: '/',
    type: 'directory',
    children: [],
  };

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      const partName = parts[i];
      const partPath = '/' + parts.slice(0, i + 1).join('/');

      let child = current.children.find((c) => c.name === partName);
      if (!child) {
        child = {
          name: partName,
          path: partPath,
          type: isLast ? file.type : 'directory',
          language: isLast ? file.language : undefined,
          dirty: isLast ? file.dirty : undefined,
          children: [],
        };
        current.children.push(child);
      }
      current = child;
    }
  }

  // Sort: directories first, then alphabetical
  const sortChildren = (node: TreeNode) => {
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortChildren);
  };
  sortChildren(root);

  return root.children;
}

// ── TreeNodeItem ─────────────────────────────────────────────────

function TreeNodeItem({
  node,
  depth,
  activeFile,
  onSelect,
  onDelete,
}: {
  node: TreeNode;
  depth: number;
  activeFile: string | null;
  onSelect: (path: string) => void;
  onDelete?: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const isActive = node.path === activeFile;
  const isDir = node.type === 'directory';
  const indentWidth = Math.min(depth, 7) * 10;

  const handleClick = useCallback(() => {
    if (isDir) {
      setExpanded((prev) => !prev);
    } else {
      onSelect(node.path);
    }
  }, [isDir, node.path, onSelect]);

  return (
    <div>
      <button
        onClick={handleClick}
        className={[
          'aeon-tree-item flex min-w-0 items-center gap-1.5 px-2 py-1.5 text-left text-sm transition-colors',
          isActive
            ? 'aeon-tree-item--active font-medium text-[var(--aeon-text-primary)] dark:text-zinc-100'
            : 'text-[var(--aeon-text-secondary)] dark:text-zinc-400',
        ].join(' ')}
        aria-label={`${isDir ? 'Directory' : 'File'}: ${node.name}`}
        aria-expanded={isDir ? expanded : undefined}
      >
        <span
          className="aeon-tree-indent"
          style={{ width: `${indentWidth}px` }}
          aria-hidden="true"
        />

        {/* Expand/collapse indicator for directories */}
        {isDir && (
          <span className="w-3 text-[10px] text-[var(--aeon-text-tertiary)] dark:text-zinc-500">
            {expanded ? '-' : '+'}
          </span>
        )}
        {!isDir && <span className="w-3" />}

        {/* Icon */}
        <span className="w-5 text-center text-[10px] font-mono text-[var(--aeon-text-tertiary)] dark:text-zinc-500">
          {isDir ? 'DIR' : getFileIcon(node.language)}
        </span>

        {/* Name */}
        <span className="min-w-0 flex-1 truncate">{node.name}</span>

        {/* Dirty indicator */}
        {node.dirty && (
          <span
            className="h-1.5 w-1.5 rounded-full bg-amber-500"
            title="Unsaved changes"
            aria-label="Unsaved changes"
          />
        )}
      </button>

      {/* Children */}
      {isDir && expanded && (
        <div role="group" aria-label={`Contents of ${node.name}`}>
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              activeFile={activeFile}
              onSelect={onSelect}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── FileTree Component ───────────────────────────────────────────

export function FileTree({
  files,
  activeFile,
  onSelectFile,
  onCreateFile,
  onDeleteFile,
}: FileTreeProps) {
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const tree = buildTree(files);

  const handleCreateFile = useCallback(() => {
    if (newFileName.trim() && onCreateFile) {
      const path = newFileName.startsWith('/')
        ? newFileName
        : `/src/${newFileName}`;
      onCreateFile(path);
      setNewFileName('');
      setShowNewFile(false);
    }
  }, [newFileName, onCreateFile]);

  return (
    <nav
      className="aeon-file-tree flex h-full min-w-0 flex-col border-r border-[var(--aeon-border)] bg-[var(--aeon-bg-root)]/50 dark:border-zinc-800 dark:bg-zinc-950/50"
      aria-label="File explorer"
      style={{ overflowX: 'hidden' }}
    >
      {/* Header */}
      <div className="aeon-file-tree-header flex items-center justify-between border-b border-[var(--aeon-border)] px-3 py-2 dark:border-zinc-800">
        <span className="text-xs font-medium uppercase tracking-wider text-[var(--aeon-text-tertiary)] dark:text-zinc-500">
          Files
        </span>
        {onCreateFile && (
          <button
            onClick={() => setShowNewFile(!showNewFile)}
            className="aeon-file-tree-create-button rounded p-0.5 text-[var(--aeon-text-tertiary)] hover:bg-[#e6dec8]/50 hover:text-[var(--aeon-text-primary)] dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="Create new file"
          >
            <span className="text-sm">+</span>
          </button>
        )}
      </div>

      {/* New file input */}
      {showNewFile && (
        <div className="aeon-file-tree-new-file border-b border-[var(--aeon-border)] p-2 dark:border-zinc-800">
          <input
            type="text"
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateFile();
              if (e.key === 'Escape') setShowNewFile(false);
            }}
            placeholder="filename.ts"
            className="aeon-file-tree-new-file-input w-full rounded border border-[var(--aeon-border)] bg-white px-2 py-1 text-[16px] text-sm text-[var(--aeon-text-primary)] placeholder-[#8a8476] focus:border-[#191919] focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-zinc-400"
            aria-label="New file name"
            autoFocus
          />
        </div>
      )}

      {/* Tree */}
      <div
        className="aeon-tree-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain py-1"
        style={{ overflowX: 'hidden' }}
      >
        {tree.length === 0 ? (
          <p className="aeon-file-tree-empty px-3 py-4 text-center text-xs text-[var(--aeon-text-tertiary)] dark:text-zinc-500">
            No files yet. Click + to create one.
          </p>
        ) : (
          tree.map((node) => (
            <TreeNodeItem
              key={node.path}
              node={node}
              depth={0}
              activeFile={activeFile}
              onSelect={onSelectFile}
              onDelete={onDeleteFile}
            />
          ))
        )}
      </div>
    </nav>
  );
}
