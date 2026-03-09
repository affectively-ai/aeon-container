/**
 * FileTree Component Tests
 */

import { describe, it, expect } from 'bun:test';

describe('FileTree', () => {
  it('should export the component', async () => {
    const mod = await import('../FileTree');
    expect(mod.FileTree).toBeDefined();
    expect(typeof mod.FileTree).toBe('function');
  });
});
