/**
 * AeonContainerIDE Component Tests
 */

import { describe, it, expect } from 'bun:test';

describe('AeonContainerIDE', () => {
  it('should export the component', async () => {
    const mod = await import('../AeonContainerIDE');
    expect(mod.AeonContainerIDE).toBeDefined();
    expect(typeof mod.AeonContainerIDE).toBe('function');
  });
});
