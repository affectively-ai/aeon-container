/**
 * ExecutionConsole Component Tests
 */

import { describe, it, expect } from 'bun:test';

describe('ExecutionConsole', () => {
  it('should export the component', async () => {
    const mod = await import('../ExecutionConsole');
    expect(mod.ExecutionConsole).toBeDefined();
    expect(typeof mod.ExecutionConsole).toBe('function');
  });
});
