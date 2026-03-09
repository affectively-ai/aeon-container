export type AgentRoomPresenceStatus =
  | 'online'
  | 'thinking'
  | 'editing'
  | 'testing'
  | 'blocked'
  | 'idle'
  | 'offline'
  | 'coordinating'
  | 'restarting'
  | 'schema-gating';

export interface AgentRoomTask {
  taskId: string;
  title: string;
  status: 'todo' | 'in_progress' | 'done' | 'blocked';
  blockedReason?: string;
  dependsOn: string[];
}

export interface AgentRoomPresenceRecord {
  roomId: string;
  agentId: string;
  channel: number;
  role: 'system1' | 'coordinator' | 'subagent';
  status: AgentRoomPresenceStatus;
  currentFile?: string;
  lineRange?: string;
  currentTaskId?: string;
  workerId?: string;
  parentAgentId?: string;
  iterationNumber?: number;
  loopStatus?: string;
  lastMcpCall?: string;
  lastHeartbeat: string;
}

export interface AgentRoomSnapshotPayload {
  room: {
    roomId: string;
    request: {
      roomName: string;
      requestSummary: string;
    };
    agents: Record<
      string,
      {
        agentId: string;
        channel: number;
        kind: 'system1' | 'coordinator' | 'subagent';
        displayName: string;
        parentAgentId?: string;
      }
    >;
  };
  presence: AgentRoomPresenceRecord[];
  globalTasks: AgentRoomTask[];
  agentTasks: Record<string, AgentRoomTask[]>;
  latestOutput?: {
    summary: string;
    emittedAt: string;
    decision: {
      emit: boolean;
      selectedActions: Array<{ id: string }>;
    };
  };
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/g, '');
}

function resolveAgentRoomsBase(apiUrl: string): string {
  const trimmed = stripTrailingSlashes(apiUrl || '');
  if (!trimmed) {
    return '';
  }

  if (trimmed.endsWith('/api/agent/rooms')) {
    return trimmed;
  }

  if (trimmed.endsWith('/api/container')) {
    return `${trimmed.slice(0, -'/container'.length)}/agent/rooms`;
  }

  if (trimmed.endsWith('/api')) {
    return `${trimmed}/agent/rooms`;
  }

  try {
    const parsed = new URL(trimmed);
    const normalizedPath = stripTrailingSlashes(parsed.pathname || '');
    if (!normalizedPath || normalizedPath === '/') {
      return `${parsed.origin}/api/agent/rooms`;
    }

    if (normalizedPath.endsWith('/api/agent/rooms')) {
      return `${parsed.origin}${normalizedPath}`;
    }

    if (normalizedPath.endsWith('/api/container')) {
      const basePath = normalizedPath.slice(0, -'/container'.length);
      return `${parsed.origin}${basePath}/agent/rooms`;
    }

    if (normalizedPath.endsWith('/api')) {
      return `${parsed.origin}${normalizedPath}/agent/rooms`;
    }

    return `${parsed.origin}${normalizedPath}/api/agent/rooms`;
  } catch {
    return `${trimmed}/api/agent/rooms`;
  }
}

function joinPath(base: string, path: string): string {
  if (!base) {
    return path;
  }
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

export class AgentRoomClient {
  private readonly baseUrl: string;
  private readonly roomId: string;
  private readonly ucanToken?: string;

  constructor(input: { apiUrl: string; roomId: string; ucanToken?: string }) {
    this.baseUrl = resolveAgentRoomsBase(input.apiUrl);
    this.roomId = input.roomId;
    this.ucanToken = input.ucanToken;
  }

  async getSnapshot(): Promise<AgentRoomSnapshotPayload> {
    const response = await this.fetchRoom('/snapshot', {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`snapshot request failed (${response.status})`);
    }

    const payload = (await response.json()) as {
      snapshot: AgentRoomSnapshotPayload;
    };
    return payload.snapshot;
  }

  async postHeartbeat(input: {
    agentId: string;
    status?: AgentRoomPresenceStatus;
    currentFile?: string;
    lineRange?: string;
    currentTaskId?: string;
  }): Promise<void> {
    const response = await this.fetchRoom('/presence/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(`presence heartbeat failed (${response.status})`);
    }
  }

  async upsertTodo(input: {
    scope: 'global' | 'agent';
    task: AgentRoomTask;
    agentId?: string;
  }): Promise<{
    globalTasks: AgentRoomTask[];
    agentTasks: Record<string, AgentRoomTask[]>;
  }> {
    const response = await this.fetchRoom('/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(`todo update failed (${response.status})`);
    }

    return (await response.json()) as {
      globalTasks: AgentRoomTask[];
      agentTasks: Record<string, AgentRoomTask[]>;
    };
  }

  private async fetchRoom(path: string, init: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      ...((init.headers as Record<string, string>) || {}),
    };
    if (this.ucanToken) {
      headers.Authorization = `Bearer ${this.ucanToken}`;
    }

    const url = joinPath(this.baseUrl, `/${this.roomId}${path}`);
    return fetch(url, {
      ...init,
      headers,
    });
  }
}
