/**
 * Revision History utility tests
 */

import { describe, expect, it } from 'bun:test';
import {
  appendRevisionSnapshot,
  createRevisionTimeline,
  getVisibleRevisionIndex,
  getVisibleRevisionSnapshot,
  moveRevisionCursor,
  restoreRevisionPreview,
  setRevisionPreviewIndex,
} from '../revision-history';

describe('revision-history', () => {
  it('creates a timeline with an initial snapshot', () => {
    const timeline = createRevisionTimeline('hello', 1000);

    expect(timeline.snapshots.length).toBe(1);
    expect(timeline.cursor).toBe(0);
    expect(timeline.previewIndex).toBeNull();
    expect(timeline.snapshots[0]?.content).toBe('hello');
    expect(timeline.snapshots[0]?.reason).toBe('load');
  });

  it('coalesces rapid edit snapshots to keep timeline fast', () => {
    const base = createRevisionTimeline('a', 1000);
    const first = appendRevisionSnapshot(base, 'ab', {
      timestamp: 2000,
      reason: 'edit',
    });
    const second = appendRevisionSnapshot(first, 'abc', {
      timestamp: 2200,
      reason: 'edit',
    });

    expect(second.snapshots.length).toBe(2);
    expect(second.cursor).toBe(1);
    expect(second.snapshots[1]?.content).toBe('abc');
  });

  it('branches correctly when editing after undo', () => {
    const base = createRevisionTimeline('a', 1000);
    const one = appendRevisionSnapshot(base, 'ab', { timestamp: 2000 });
    const two = appendRevisionSnapshot(one, 'abc', { timestamp: 3000 });
    const undone = moveRevisionCursor(two, -1);
    const branched = appendRevisionSnapshot(undone, 'abx', {
      timestamp: 4000,
      reason: 'edit',
    });

    expect(branched.snapshots.length).toBe(3);
    expect(branched.cursor).toBe(2);
    expect(branched.snapshots[2]?.content).toBe('abx');
  });

  it('supports scrub preview and restore as a new revision', () => {
    const base = createRevisionTimeline('v1', 1000);
    const one = appendRevisionSnapshot(base, 'v2', { timestamp: 2000 });
    const two = appendRevisionSnapshot(one, 'v3', { timestamp: 3000 });

    const previewed = setRevisionPreviewIndex(two, 0);
    expect(getVisibleRevisionIndex(previewed)).toBe(0);
    expect(getVisibleRevisionSnapshot(previewed)?.content).toBe('v1');

    const restored = restoreRevisionPreview(previewed, 4000);
    expect(restored.restored).toBe(true);
    expect(restored.timeline.cursor).toBe(3);
    expect(restored.timeline.previewIndex).toBeNull();
    expect(restored.timeline.snapshots[3]?.content).toBe('v1');
  });
});
