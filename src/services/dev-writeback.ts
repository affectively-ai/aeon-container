/**
 * Dev Writeback Service
 *
 * When devMode is enabled, filesystem changes are written back to real files
 * via the aeon-flux agent runtime's MCP tool calling pattern.
 *
 * Two modes:
 * 1. Local dev — Uses a local MCP server endpoint to write files to disk
 * 2. Remote dev — Uses the edge-workers MCP file_write tool via UCAN delegation
 */

import type { AeonFSChange } from './types';

// ============================================
// TYPES
// ============================================

export interface DevWritebackConfig {
  /** Local MCP server URL for file writes */
  mpcServerUrl?: string;
  /** Edge API URL for remote writes */
  edgeApiUrl?: string;
  /** Real filesystem base path */
  basePath: string;
  /** UCAN token for authorization */
  ucanToken?: string;
}

export interface WritebackResult {
  success: boolean;
  filesWritten: number;
  errors: Array<{ path: string; error: string }>;
}

// ============================================
// DEV WRITEBACK
// ============================================

export class DevWriteback {
  private config: DevWritebackConfig;

  constructor(config: DevWritebackConfig) {
    this.config = config;
  }

  /**
   * Write filesystem changes back to real files.
   * Tries local MCP server first, falls back to edge API.
   */
  async writeBack(changes: AeonFSChange[]): Promise<WritebackResult> {
    if (changes.length === 0) {
      return { success: true, filesWritten: 0, errors: [] };
    }

    if (this.config.mpcServerUrl) {
      return this.writeViaLocalMcp(changes);
    }

    if (this.config.edgeApiUrl) {
      return this.writeViaEdge(changes);
    }

    return {
      success: false,
      filesWritten: 0,
      errors: [{ path: '*', error: 'No writeback target configured' }],
    };
  }

  /**
   * Read files from disk for syncing into the container.
   */
  async syncFromDisk(
    paths: string[]
  ): Promise<Array<{ path: string; content: string }>> {
    if (this.config.mpcServerUrl) {
      return this.readViaLocalMcp(paths);
    }

    if (this.config.edgeApiUrl) {
      return this.readViaEdge(paths);
    }

    return [];
  }

  // ── Local MCP Server ───────────────────────────────────────────

  private async writeViaLocalMcp(
    changes: AeonFSChange[]
  ): Promise<WritebackResult> {
    const errors: Array<{ path: string; error: string }> = [];
    let written = 0;

    for (const change of changes) {
      if (change.type === 'delete') {
        try {
          await this.callMcpTool('file_delete', {
            path: this.resolveRealPath(change.path),
          });
          written++;
        } catch (err) {
          errors.push({
            path: change.path,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        continue;
      }

      if (change.content !== undefined) {
        try {
          await this.callMcpTool('file_write', {
            path: this.resolveRealPath(change.path),
            content: change.content,
          });
          written++;
        } catch (err) {
          errors.push({
            path: change.path,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    return {
      success: errors.length === 0,
      filesWritten: written,
      errors,
    };
  }

  private async readViaLocalMcp(
    paths: string[]
  ): Promise<Array<{ path: string; content: string }>> {
    const results: Array<{ path: string; content: string }> = [];

    for (const path of paths) {
      try {
        const result = await this.callMcpTool('file_read', {
          path: this.resolveRealPath(path),
        });
        if (result.content) {
          results.push({ path, content: result.content as string });
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return results;
  }

  private async callMcpTool(
    tool: string,
    args: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.config.mpcServerUrl}/tools/${tool}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.ucanToken
          ? { Authorization: `Bearer ${this.config.ucanToken}` }
          : {}),
      },
      body: JSON.stringify({ arguments: args }),
    });

    if (!response.ok) {
      throw new Error(`MCP tool ${tool} failed: ${response.status}`);
    }

    return (await response.json()) as Record<string, unknown>;
  }

  // ── Edge API ───────────────────────────────────────────────────

  private async writeViaEdge(
    changes: AeonFSChange[]
  ): Promise<WritebackResult> {
    const errors: Array<{ path: string; error: string }> = [];
    let written = 0;

    for (const change of changes) {
      if (change.content === undefined && change.type !== 'delete') continue;

      try {
        const method = change.type === 'delete' ? 'DELETE' : 'PUT';
        const response = await fetch(
          `${this.config.edgeApiUrl}/v1/aeon-container/fs/writeback${change.path}`,
          {
            method,
            headers: {
              'Content-Type': 'text/plain',
              ...(this.config.ucanToken
                ? { Authorization: `Bearer ${this.config.ucanToken}` }
                : {}),
            },
            body: change.type !== 'delete' ? change.content : undefined,
          }
        );

        if (!response.ok) {
          errors.push({ path: change.path, error: `HTTP ${response.status}` });
        } else {
          written++;
        }
      } catch (err) {
        errors.push({
          path: change.path,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { success: errors.length === 0, filesWritten: written, errors };
  }

  private async readViaEdge(
    paths: string[]
  ): Promise<Array<{ path: string; content: string }>> {
    const results: Array<{ path: string; content: string }> = [];

    for (const path of paths) {
      try {
        const response = await fetch(
          `${this.config.edgeApiUrl}/v1/aeon-container/fs/writeback${path}`,
          {
            headers: this.config.ucanToken
              ? { Authorization: `Bearer ${this.config.ucanToken}` }
              : {},
          }
        );
        if (response.ok) {
          results.push({ path, content: await response.text() });
        }
      } catch {
        // Skip unreadable files
      }
    }

    return results;
  }

  // ── Helpers ────────────────────────────────────────────────────

  private resolveRealPath(virtualPath: string): string {
    const clean = virtualPath.startsWith('/')
      ? virtualPath.slice(1)
      : virtualPath;
    return `${this.config.basePath}/${clean}`;
  }
}
