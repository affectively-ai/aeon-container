/**
 * Persistent Filesystem Service
 *
 * D1/R2-backed filesystem that persists across sessions.
 * Operates with a local in-memory cache and syncs to the backend.
 * Supports real-time sync via DashRelay (Yjs CRDT).
 */

import type {
  AeonFSNode,
  FileEntry,
  AeonFSChange,
  ContainerLockState,
  ExecutionReceipt,
  RepoIngestInput,
} from './types';
import { joinContainerApiPath, resolveContainerApiBase } from './api-routes';

// ============================================
// TYPES
// ============================================

export interface PersistentFSConfig {
  apiUrl: string;
  ucanToken?: string;
  dashRelayRoom?: string;
  /**
   * Dash is the local-first cache and relay transport; D1 is the durable edge
   * persistence sink. This is intentionally fixed to dash-d1.
   */
  syncPolicy?: 'dash-d1';
}

interface CachedFile {
  path: string;
  content: string;
  language?: string;
  dirty: boolean;
  lastModified: number;
}

// ============================================
// PERSISTENT FS
// ============================================

export class PersistentFS {
  private containerId: string;
  private config: PersistentFSConfig;
  private cache = new Map<string, CachedFile>();
  private dashRelay: any = null;
  private _syncing = false;
  private autoSyncTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(containerId: string, config: PersistentFSConfig) {
    this.containerId = containerId;
    this.config = {
      ...config,
      apiUrl: resolveContainerApiBase(config.apiUrl),
      syncPolicy: 'dash-d1',
    };
  }

  // ── Core Operations ────────────────────────────────────────────

  async readFile(path: string): Promise<string> {
    const normalized = this.normalizePath(path);

    // Check local cache first
    const cached = this.cache.get(normalized);
    if (cached) return cached.content;

    // Fetch from backend
    const response = await this.fetchAPI(
      `/fs/${this.containerId}${normalized}`
    );
    if (!response.ok) {
      throw new Error(`File not found: ${normalized}`);
    }

    const content = await response.text();
    this.cache.set(normalized, {
      path: normalized,
      content,
      language: this.detectLanguage(normalized),
      dirty: false,
      lastModified: Date.now(),
    });

    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    const normalized = this.normalizePath(path);

    this.cache.set(normalized, {
      path: normalized,
      content,
      language: this.detectLanguage(normalized),
      dirty: true,
      lastModified: Date.now(),
    });

    // Notify DashRelay if connected
    if (this.dashRelay) {
      this.notifyDashRelay(normalized, content);
    }

    // Always bridge local writes through Dash relay to edge D1 persistence.
    this.scheduleAutoSync();
  }

  async deleteFile(path: string): Promise<void> {
    const normalized = this.normalizePath(path);
    this.cache.delete(normalized);

    // Delete on backend — fire and forget, don't block on network errors
    try {
      await this.fetchAPI(`/fs/${this.containerId}${normalized}`, {
        method: 'DELETE',
      });
    } catch {
      // Backend sync failure is non-fatal — file is removed from local cache
    }
  }

  listFiles(): FileEntry[] {
    const entries: FileEntry[] = [];
    const dirs = new Set<string>();

    for (const [filePath, cached] of this.cache) {
      // Add file entry
      entries.push({
        path: filePath,
        name: filePath.split('/').pop() || filePath,
        type: 'file',
        language: cached.language,
        size: cached.content.length,
        lastModified: cached.lastModified,
        dirty: cached.dirty,
      });

      // Collect directory entries
      const parts = filePath.split('/').filter(Boolean);
      for (let i = 1; i < parts.length; i++) {
        const dirPath = '/' + parts.slice(0, i).join('/');
        dirs.add(dirPath);
      }
    }

    // Add directory entries
    for (const dirPath of dirs) {
      if (!entries.some((e) => e.path === dirPath)) {
        entries.push({
          path: dirPath,
          name: dirPath.split('/').pop() || dirPath,
          type: 'directory',
        });
      }
    }

    return entries.sort((a, b) => {
      // Directories first, then alphabetical
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
  }

  // ── Sync ───────────────────────────────────────────────────────

  /**
   * Load all files from backend D1/R2 into local cache.
   */
  async loadFromBackend(): Promise<AeonFSNode> {
    const response = await this.fetchAPI(`/fs/${this.containerId}`);
    if (!response.ok) {
      // No files yet — return empty root
      return this.emptyRoot();
    }

    const data = (await response.json()) as {
      files: Array<{ path: string; content: string; language?: string }>;
    };

    for (const file of data.files || []) {
      const normalized = this.normalizePath(file.path);
      this.cache.set(normalized, {
        path: normalized,
        content: file.content || '',
        language: file.language || this.detectLanguage(normalized),
        dirty: false,
        lastModified: Date.now(),
      });
    }

    return this.toFSNode();
  }

  /**
   * Flush all dirty files to the backend R2.
   */
  async syncToBackend(): Promise<void> {
    if (this._syncing) return;
    this._syncing = true;

    try {
      const dirtyFiles = Array.from(this.cache.values()).filter((f) => f.dirty);

      await Promise.all(
        dirtyFiles.map(async (file) => {
          await this.fetchAPI(`/fs/${this.containerId}${file.path}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'text/plain' },
            body: file.content,
          });
          file.dirty = false;
        })
      );
    } finally {
      this._syncing = false;
    }
  }

  /**
   * Connect DashRelay for real-time sync between agents/tabs.
   * Room name: aeon-fs:{containerId}
   */
  connectDashRelay(relay: any): void {
    this.dashRelay = relay;

    // Best-effort wiring for relay implementations that expose pub/sub hooks.
    try {
      if (relay && typeof relay.getMap === 'function') {
        const fileMap = relay.getMap(`aeon-fs:${this.containerId}`);
        if (fileMap && typeof fileMap.observe === 'function') {
          fileMap.observe((event: any) => {
            if (!event?.keysChanged) return;
            for (const key of event.keysChanged as Set<string>) {
              const value = fileMap.get(key);
              if (typeof value !== 'string') continue;
              const normalized = this.normalizePath(key);
              const current = this.cache.get(normalized);
              this.cache.set(normalized, {
                path: normalized,
                content: value,
                language: this.detectLanguage(normalized),
                dirty: current?.dirty || false,
                lastModified: Date.now(),
              });
            }
          });
        }
      }

      if (relay && typeof relay.on === 'function') {
        relay.on(
          'file:update',
          (payload: { path?: string; content?: string }) => {
            if (!payload.path || typeof payload.content !== 'string') return;
            const normalized = this.normalizePath(payload.path);
            const existing = this.cache.get(normalized);
            this.cache.set(normalized, {
              path: normalized,
              content: payload.content,
              language: this.detectLanguage(normalized),
              dirty: existing?.dirty || false,
              lastModified: Date.now(),
            });
          }
        );
      }
    } catch {
      // Relay compatibility should not break editor startup.
    }
  }

  // ── State ──────────────────────────────────────────────────────

  get syncing(): boolean {
    return this._syncing;
  }

  get dirty(): boolean {
    return Array.from(this.cache.values()).some((f) => f.dirty);
  }

  /**
   * Get pending changes for writeback or commit.
   */
  getChanges(): AeonFSChange[] {
    return Array.from(this.cache.values())
      .filter((f) => f.dirty)
      .map((f) => ({
        path: f.path,
        type: 'modify' as const,
        content: f.content,
        newHash: this.simpleHash(f.content),
      }));
  }

  /**
   * Build an in-memory AeonFSNode tree for sandbox execution.
   */
  toFSNode(): AeonFSNode {
    const root: AeonFSNode = this.emptyRoot();

    for (const [filePath, cached] of this.cache) {
      const parts = filePath.split('/').filter(Boolean);
      let current = root;

      // Create intermediate directories
      for (let i = 0; i < parts.length - 1; i++) {
        const dirName = parts[i];
        let child = current.children?.find(
          (c) => c.name === dirName && c.type === 'directory'
        );
        if (!child) {
          child = {
            id: '',
            did: 'did:local',
            type: 'directory',
            name: dirName,
            path: '/' + parts.slice(0, i + 1).join('/'),
            children: [],
            permissions: [
              { did: '*', capabilities: ['read', 'write', 'execute'] },
            ],
            metadata: { lastModified: Date.now(), hash: '' },
          };
          if (!current.children) current.children = [];
          current.children.push(child);
        }
        current = child;
      }

      // Add file node
      const fileName = parts[parts.length - 1];
      const hash = this.simpleHash(cached.content);
      if (!current.children) current.children = [];
      current.children.push({
        id: hash,
        did: 'did:local',
        type: 'file',
        name: fileName,
        path: filePath,
        content: cached.content,
        permissions: [{ did: '*', capabilities: ['read', 'write', 'execute'] }],
        metadata: {
          language: cached.language,
          lastModified: cached.lastModified,
          hash,
        },
      });
    }

    return root;
  }

  /**
   * Seed files into the cache without marking them dirty.
   */
  seedFiles(files: Array<{ path: string; content: string }>): void {
    for (const file of files) {
      const normalized = this.normalizePath(file.path);
      this.cache.set(normalized, {
        path: normalized,
        content: file.content,
        language: this.detectLanguage(normalized),
        dirty: false,
        lastModified: Date.now(),
      });
    }
  }

  dispose(): void {
    if (this.autoSyncTimer) {
      clearTimeout(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
    this.dashRelay = null;
  }

  async createSnapshot(): Promise<{
    snapshot_id: string;
    snapshot_key: string;
    files_count: number;
    manifest_hash: string;
    timestamp: number;
  }> {
    const response = await this.fetchAPI(`/fs/${this.containerId}/snapshot`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error(`Snapshot failed (${response.status})`);
    }
    return (await response.json()) as {
      snapshot_id: string;
      snapshot_key: string;
      files_count: number;
      manifest_hash: string;
      timestamp: number;
    };
  }

  async getReceipts(limit = 120): Promise<ExecutionReceipt[]> {
    const response = await this.fetchAPI(
      `/receipts/${this.containerId}?limit=${Math.max(1, Math.min(limit, 500))}`
    );
    if (!response.ok) {
      throw new Error(`Failed to load receipts (${response.status})`);
    }
    const payload = (await response.json()) as {
      receipts?: ExecutionReceipt[];
    };
    return payload.receipts || [];
  }

  async getLockState(): Promise<ContainerLockState> {
    const response = await this.fetchAPI(`/locks/${this.containerId}`);
    if (!response.ok) {
      return {
        container_id: this.containerId,
        owner_did: null,
        lease_id: null,
      };
    }
    const payload = (await response.json()) as {
      lock?: {
        owner_did?: string;
        lease_id?: string;
        acquired_at?: number;
        expires_at?: number;
        heartbeat_at?: number;
      } | null;
    };
    return {
      container_id: this.containerId,
      owner_did: payload.lock?.owner_did || null,
      lease_id: payload.lock?.lease_id || null,
      acquired_at: payload.lock?.acquired_at,
      expires_at: payload.lock?.expires_at,
      heartbeat_at: payload.lock?.heartbeat_at,
    };
  }

  async acquireLock(
    leaseMs = 90_000
  ): Promise<{ lease_id: string; expires_at: number }> {
    const response = await this.fetchAPI(`/locks/${this.containerId}/acquire`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lease_ms: leaseMs }),
    });
    if (!response.ok) {
      throw new Error(`Failed to acquire lock (${response.status})`);
    }
    const payload = (await response.json()) as {
      lease_id: string;
      expires_at: number;
    };
    return payload;
  }

  async heartbeatLock(
    leaseId: string,
    leaseMs = 90_000
  ): Promise<{ heartbeat_at: number; expires_at: number }> {
    const response = await this.fetchAPI(
      `/locks/${this.containerId}/heartbeat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lease_id: leaseId, lease_ms: leaseMs }),
      }
    );
    if (!response.ok) {
      throw new Error(`Failed to heartbeat lock (${response.status})`);
    }
    return (await response.json()) as {
      heartbeat_at: number;
      expires_at: number;
    };
  }

  async releaseLock(leaseId?: string): Promise<void> {
    const response = await this.fetchAPI(`/locks/${this.containerId}/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lease_id: leaseId || null }),
    });
    if (!response.ok) {
      throw new Error(`Failed to release lock (${response.status})`);
    }
  }

  async overrideLock(
    leaseMs = 90_000
  ): Promise<{ lease_id: string; expires_at: number }> {
    const response = await this.fetchAPI(
      `/locks/${this.containerId}/override`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lease_ms: leaseMs }),
      }
    );
    if (!response.ok) {
      throw new Error(`Failed to override lock (${response.status})`);
    }
    return (await response.json()) as { lease_id: string; expires_at: number };
  }

  async ingestRepo(input: Omit<RepoIngestInput, 'container_id'>): Promise<{
    repo_id: string;
    indexed_files: number;
    symbols: number;
  }> {
    const response = await this.fetchAPI('/repos/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...input,
        container_id: this.containerId,
      }),
    });
    if (!response.ok) {
      throw new Error(`Repository ingest failed (${response.status})`);
    }
    return (await response.json()) as {
      repo_id: string;
      indexed_files: number;
      symbols: number;
    };
  }

  async getRepoStatus(repoId: string): Promise<Record<string, unknown>> {
    const response = await this.fetchAPI(`/repos/${repoId}/status`);
    if (!response.ok) {
      throw new Error(`Repository status failed (${response.status})`);
    }
    return (await response.json()) as Record<string, unknown>;
  }

  async getRepoFile(
    repoId: string,
    path: string
  ): Promise<{ content: string; language?: string }> {
    const encodedPath = encodeURIComponent(this.normalizePath(path));
    const response = await this.fetchAPI(
      `/repos/${repoId}/file?path=${encodedPath}`
    );
    if (!response.ok) {
      throw new Error(`Repository file read failed (${response.status})`);
    }
    const payload = (await response.json()) as {
      content: string;
      language?: string;
    };
    return payload;
  }

  async getRepoSymbols(
    repoId: string,
    query?: string
  ): Promise<Array<Record<string, unknown>>> {
    const params = new URLSearchParams();
    if (query && query.trim().length > 0) {
      params.set('q', query.trim());
    }
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const response = await this.fetchAPI(`/repos/${repoId}/symbols${suffix}`);
    if (!response.ok) {
      throw new Error(`Repository symbols failed (${response.status})`);
    }
    const payload = (await response.json()) as {
      symbols?: Array<Record<string, unknown>>;
    };
    return payload.symbols || [];
  }

  async refreshRepo(
    repoId: string
  ): Promise<{ job_id: string; status: string }> {
    const response = await this.fetchAPI(`/repos/${repoId}/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!response.ok) {
      throw new Error(`Repository refresh failed (${response.status})`);
    }
    return (await response.json()) as { job_id: string; status: string };
  }

  // ── Private ────────────────────────────────────────────────────

  private normalizePath(path: string): string {
    return path.startsWith('/') ? path : `/${path}`;
  }

  private async fetchAPI(path: string, init?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      ...((init?.headers as Record<string, string>) || {}),
    };
    if (this.config.ucanToken) {
      headers['Authorization'] = `Bearer ${this.config.ucanToken}`;
    }

    return fetch(joinContainerApiPath(this.config.apiUrl, path), {
      ...init,
      headers,
    });
  }

  private notifyDashRelay(path: string, content: string): void {
    // DashRelay sync uses Yjs shared types
    // The relay handles CRDT conflict resolution automatically
    try {
      if (
        this.dashRelay &&
        typeof this.dashRelay.updateAutomergeDoc === 'function'
      ) {
        this.dashRelay.updateAutomergeDoc({
          type: 'file:update',
          path,
          content,
          containerId: this.containerId,
        });
      } else if (
        this.dashRelay &&
        typeof this.dashRelay.getMap === 'function'
      ) {
        const fileMap = this.dashRelay.getMap(`aeon-fs:${this.containerId}`);
        if (fileMap && typeof fileMap.set === 'function') {
          fileMap.set(path, content);
        }
      } else if (this.dashRelay && typeof this.dashRelay.emit === 'function') {
        this.dashRelay.emit('file:update', {
          path,
          content,
          containerId: this.containerId,
        });
      }
    } catch {
      // DashRelay errors should not block local operations
    }
  }

  private scheduleAutoSync(): void {
    if (this.autoSyncTimer) {
      clearTimeout(this.autoSyncTimer);
    }
    this.autoSyncTimer = setTimeout(() => {
      this.autoSyncTimer = null;
      void this.syncToBackend().catch(() => {
        /* keep dirty state for retry */
      });
    }, 280);
  }

  private emptyRoot(): AeonFSNode {
    return {
      id: '',
      did: 'did:local',
      type: 'directory',
      name: '/',
      path: '/',
      children: [],
      permissions: [{ did: '*', capabilities: ['read', 'write', 'execute'] }],
      metadata: { lastModified: Date.now(), hash: '' },
    };
  }

  private simpleHash(content: string): string {
    let h1 = 0x811c9dc5 | 0;
    let h2 = 0x811c9dc5 | 0;
    for (let i = 0; i < content.length; i++) {
      const ch = content.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 0x01000193);
      h2 = Math.imul(h2 ^ (ch >>> 8), 0x01000193);
    }
    const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
    const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
    return `fnv1a:${hex1}${hex2}`;
  }

  private detectLanguage(path: string): string | undefined {
    const ext = path.split('.').pop()?.toLowerCase();
    const map: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      tla: 'tla',
      go: 'go',
      py: 'python',
      rs: 'rust',
      lua: 'lua',
      json: 'json',
      md: 'markdown',
      html: 'html',
      css: 'css',
    };
    return ext ? map[ext] : undefined;
  }
}
