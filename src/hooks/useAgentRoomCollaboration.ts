import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AgentRoomClient,
  type AgentRoomPresenceStatus,
  type AgentRoomSnapshotPayload,
  type AgentRoomTask,
} from '../services/agent-room-client';

const DEFAULT_POLL_MS = 3500;

interface UseAgentRoomCollaborationInput {
  apiUrl?: string;
  roomId?: string;
  ucanToken?: string;
  agentId?: string;
  heartbeatStatus?: AgentRoomPresenceStatus;
  currentFile?: string;
  pollMs?: number;
}

interface SetTaskStatusInput {
  scope: 'global' | 'agent';
  taskId: string;
  status: AgentRoomTask['status'];
  agentId?: string;
}

interface UseAgentRoomCollaborationResult {
  enabled: boolean;
  snapshot: AgentRoomSnapshotPayload | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setTaskStatus: (input: SetTaskStatusInput) => Promise<void>;
}

function findTask(input: {
  snapshot: AgentRoomSnapshotPayload;
  taskId: string;
  scope: 'global' | 'agent';
  agentId?: string;
}): AgentRoomTask | null {
  if (input.scope === 'global') {
    return (
      input.snapshot.globalTasks.find((task) => task.taskId === input.taskId) ??
      null
    );
  }

  if (!input.agentId) {
    return null;
  }

  const queue = input.snapshot.agentTasks[input.agentId] ?? [];
  return queue.find((task) => task.taskId === input.taskId) ?? null;
}

export function useAgentRoomCollaboration(
  input: UseAgentRoomCollaborationInput
): UseAgentRoomCollaborationResult {
  const {
    apiUrl,
    roomId,
    ucanToken,
    agentId,
    heartbeatStatus = 'online',
    currentFile,
    pollMs = DEFAULT_POLL_MS,
  } = input;

  const client = useMemo(() => {
    if (!roomId) {
      return null;
    }

    return new AgentRoomClient({
      apiUrl: apiUrl || '',
      roomId,
      ucanToken,
    });
  }, [apiUrl, roomId, ucanToken]);

  const [snapshot, setSnapshot] = useState<AgentRoomSnapshotPayload | null>(
    null
  );
  const [loading, setLoading] = useState(Boolean(client));
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!client) {
      setSnapshot(null);
      setLoading(false);
      return;
    }

    const nextSnapshot = await client.getSnapshot();
    setSnapshot(nextSnapshot);
    setError(null);
  }, [client]);

  useEffect(() => {
    if (!client) {
      setSnapshot(null);
      setLoading(false);
      return;
    }

    let disposed = false;
    let pending = false;
    const intervalMs = Math.max(1200, pollMs);

    const tick = async () => {
      if (pending) {
        return;
      }

      pending = true;
      try {
        const nextSnapshot = await client.getSnapshot();
        if (!disposed) {
          setSnapshot(nextSnapshot);
          setError(null);
        }
      } catch (cause: unknown) {
        if (!disposed) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        pending = false;
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    setLoading(true);
    void tick();
    const timer = setInterval(() => {
      void tick();
    }, intervalMs);

    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [client, pollMs]);

  useEffect(() => {
    if (!client || !agentId) {
      return;
    }

    let disposed = false;
    const intervalMs = Math.max(1000, Math.floor(pollMs * 0.66));

    const beat = async () => {
      try {
        await client.postHeartbeat({
          agentId,
          status: heartbeatStatus,
          currentFile,
        });
      } catch (cause: unknown) {
        if (!disposed) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    };

    void beat();
    const timer = setInterval(() => {
      void beat();
    }, intervalMs);

    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [agentId, client, currentFile, heartbeatStatus, pollMs]);

  const setTaskStatus = useCallback(
    async (taskUpdate: SetTaskStatusInput): Promise<void> => {
      if (!client || !snapshot) {
        return;
      }

      const existingTask = findTask({
        snapshot,
        scope: taskUpdate.scope,
        taskId: taskUpdate.taskId,
        agentId: taskUpdate.agentId,
      });

      if (!existingTask) {
        throw new Error('task not found in snapshot');
      }

      const response = await client.upsertTodo({
        scope: taskUpdate.scope,
        agentId: taskUpdate.agentId,
        task: {
          ...existingTask,
          status: taskUpdate.status,
        },
      });

      setSnapshot((previous) => {
        if (!previous) {
          return previous;
        }
        return {
          ...previous,
          globalTasks: response.globalTasks,
          agentTasks: response.agentTasks,
        };
      });
      setError(null);
    },
    [client, snapshot]
  );

  return {
    enabled: client !== null,
    snapshot,
    loading,
    error,
    refresh,
    setTaskStatus,
  };
}
