'use aeon';

/**
 * Revision History Utilities
 *
 * Pure timeline helpers for per-file history:
 * - append snapshots (with edit coalescing)
 * - undo/redo cursor movement
 * - preview scrubbing
 * - restore from preview
 */

export type RevisionReason = 'load' | 'edit' | 'restore' | 'format';

export interface RevisionSnapshot {
  id: string;
  content: string;
  timestamp: number;
  reason: RevisionReason;
}

export interface RevisionTimeline {
  snapshots: RevisionSnapshot[];
  cursor: number;
  previewIndex: number | null;
  lastEditAt: number;
}

interface AppendRevisionSnapshotOptions {
  timestamp?: number;
  reason?: RevisionReason;
  coalesceWindowMs?: number;
}

export interface RestoreRevisionPreviewResult {
  timeline: RevisionTimeline;
  restored: boolean;
  restoredContent: string | null;
}

const DEFAULT_COALESCE_WINDOW_MS = 350;

function clampIndex(index: number, maxIndex: number): number {
  if (maxIndex <= 0) return 0;
  if (index <= 0) return 0;
  if (index >= maxIndex) return maxIndex;
  return index;
}

function createRevisionId(timestamp: number, sequence: number): string {
  return `rev-${timestamp}-${sequence}`;
}

export function createRevisionTimeline(
  initialContent: string,
  timestamp = Date.now()
): RevisionTimeline {
  return {
    snapshots: [
      {
        id: createRevisionId(timestamp, 1),
        content: initialContent,
        timestamp,
        reason: 'load',
      },
    ],
    cursor: 0,
    previewIndex: null,
    lastEditAt: 0,
  };
}

export function ensureRevisionTimeline(
  timeline: RevisionTimeline | undefined,
  initialContent: string,
  timestamp = Date.now()
): RevisionTimeline {
  if (!timeline || timeline.snapshots.length === 0) {
    return createRevisionTimeline(initialContent, timestamp);
  }
  return timeline;
}

export function getVisibleRevisionIndex(timeline: RevisionTimeline): number {
  const maxIndex = timeline.snapshots.length - 1;
  if (maxIndex < 0) return 0;

  if (timeline.previewIndex === null) {
    return clampIndex(timeline.cursor, maxIndex);
  }

  return clampIndex(timeline.previewIndex, maxIndex);
}

export function getVisibleRevisionSnapshot(
  timeline: RevisionTimeline
): RevisionSnapshot | null {
  if (timeline.snapshots.length === 0) return null;
  const index = getVisibleRevisionIndex(timeline);
  return timeline.snapshots[index] ?? null;
}

export function appendRevisionSnapshot(
  timeline: RevisionTimeline,
  content: string,
  options: AppendRevisionSnapshotOptions = {}
): RevisionTimeline {
  const timestamp = options.timestamp ?? Date.now();
  const reason = options.reason ?? 'edit';
  const coalesceWindowMs =
    options.coalesceWindowMs ?? DEFAULT_COALESCE_WINDOW_MS;

  if (timeline.snapshots.length === 0) {
    return createRevisionTimeline(content, timestamp);
  }

  const maxIndex = timeline.snapshots.length - 1;
  const normalizedCursor = clampIndex(timeline.cursor, maxIndex);

  let snapshots = [...timeline.snapshots];
  if (normalizedCursor < snapshots.length - 1) {
    snapshots = snapshots.slice(0, normalizedCursor + 1);
  }

  const lastIndex = snapshots.length - 1;
  const lastSnapshot = snapshots[lastIndex];
  if (!lastSnapshot) {
    return createRevisionTimeline(content, timestamp);
  }

  if (lastSnapshot.content === content) {
    return {
      ...timeline,
      snapshots,
      cursor: lastIndex,
      previewIndex: null,
      lastEditAt: reason === 'edit' ? timestamp : timeline.lastEditAt,
    };
  }

  const canCoalesce =
    reason === 'edit' &&
    lastSnapshot.reason === 'edit' &&
    timestamp - timeline.lastEditAt <= coalesceWindowMs;

  if (canCoalesce) {
    snapshots[lastIndex] = {
      ...lastSnapshot,
      content,
      timestamp,
    };

    return {
      ...timeline,
      snapshots,
      cursor: lastIndex,
      previewIndex: null,
      lastEditAt: timestamp,
    };
  }

  snapshots.push({
    id: createRevisionId(timestamp, snapshots.length + 1),
    content,
    timestamp,
    reason,
  });

  return {
    ...timeline,
    snapshots,
    cursor: snapshots.length - 1,
    previewIndex: null,
    lastEditAt: reason === 'edit' ? timestamp : timeline.lastEditAt,
  };
}

export function moveRevisionCursor(
  timeline: RevisionTimeline,
  direction: -1 | 1
): RevisionTimeline {
  if (timeline.snapshots.length === 0) return timeline;

  const maxIndex = timeline.snapshots.length - 1;
  const normalizedCursor = clampIndex(timeline.cursor, maxIndex);
  const nextCursor = clampIndex(normalizedCursor + direction, maxIndex);

  if (nextCursor === normalizedCursor && timeline.previewIndex === null) {
    return timeline;
  }

  return {
    ...timeline,
    cursor: nextCursor,
    previewIndex: null,
  };
}

export function setRevisionPreviewIndex(
  timeline: RevisionTimeline,
  previewIndex: number | null
): RevisionTimeline {
  if (timeline.snapshots.length === 0) return timeline;

  if (previewIndex === null) {
    if (timeline.previewIndex === null) return timeline;
    return { ...timeline, previewIndex: null };
  }

  const maxIndex = timeline.snapshots.length - 1;
  const clamped = clampIndex(previewIndex, maxIndex);
  const nextPreviewIndex = clamped === timeline.cursor ? null : clamped;

  if (timeline.previewIndex === nextPreviewIndex) {
    return timeline;
  }

  return {
    ...timeline,
    previewIndex: nextPreviewIndex,
  };
}

export function restoreRevisionPreview(
  timeline: RevisionTimeline,
  timestamp = Date.now()
): RestoreRevisionPreviewResult {
  if (timeline.snapshots.length === 0) {
    return { timeline, restored: false, restoredContent: null };
  }

  if (timeline.previewIndex === null) {
    const current = getVisibleRevisionSnapshot(timeline);
    return {
      timeline,
      restored: false,
      restoredContent: current ? current.content : null,
    };
  }

  const previewSnapshot =
    timeline.snapshots[getVisibleRevisionIndex(timeline)] ?? null;

  if (!previewSnapshot) {
    return {
      timeline: { ...timeline, previewIndex: null },
      restored: false,
      restoredContent: null,
    };
  }

  const cursorIndex = clampIndex(
    timeline.cursor,
    timeline.snapshots.length - 1
  );
  const cursorSnapshot = timeline.snapshots[cursorIndex] ?? null;

  if (cursorSnapshot && cursorSnapshot.content === previewSnapshot.content) {
    return {
      timeline: { ...timeline, previewIndex: null, cursor: cursorIndex },
      restored: false,
      restoredContent: previewSnapshot.content,
    };
  }

  const nextTimeline = appendRevisionSnapshot(
    {
      ...timeline,
      cursor: cursorIndex,
      previewIndex: null,
    },
    previewSnapshot.content,
    {
      reason: 'restore',
      timestamp,
      coalesceWindowMs: 0,
    }
  );

  return {
    timeline: nextTimeline,
    restored: true,
    restoredContent: previewSnapshot.content,
  };
}
