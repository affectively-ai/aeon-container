/**
 * Browser Sandbox Tests
 *
 * Tests QuickJS WASM execution in the browser sandbox.
 * Covers: JS execution, console capture, timeout handling, FS injection, edge fallback.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { BrowserSandbox } from '../browser-sandbox';

const SAMPLE_TLA_MODULE = `------------------------------ MODULE TriangleOrder ------------------------------
EXTENDS Naturals, Sequences

VARIABLES entered, exited

Init == /\\ entered = <<1, 2, 3, 4, 5>>
        /\\ exited = <<1, 2, 3, 4, 5>>

OrderPreserved == entered = exited
Spec == Init /\\ []OrderPreserved

=============================================================================
`;

const SAMPLE_TLC_CONFIG = `SPECIFICATION Spec
INVARIANTS
  OrderPreserved
`;

describe('BrowserSandbox', () => {
  let sandbox: BrowserSandbox;

  beforeEach(() => {
    // Get a fresh singleton reference
    sandbox = BrowserSandbox.getInstance();
  });

  describe('getInstance', () => {
    it('should return the same instance', () => {
      const a = BrowserSandbox.getInstance();
      const b = BrowserSandbox.getInstance();
      expect(a).toBe(b);
    });
  });

  describe('execute — basic JavaScript', () => {
    it('should execute simple JavaScript and capture output', async () => {
      const result = await sandbox.execute({
        code: 'console.log("hello"); 42',
        language: 'javascript',
      });

      // If QuickJS WASM is available, we get real output
      // If not, we get an error about no sandbox/fallback
      if (result.outcome === 'OUTCOME_OK') {
        expect(result.output).toContain('hello');
        expect(result.logs.length).toBeGreaterThan(0);
        expect(result.execution_time_ms).toBeGreaterThanOrEqual(0);
      } else {
        // In environments without WASM, should get a meaningful error
        expect(result.outcome).toBe('OUTCOME_ERROR');
        expect(result.error).toBeDefined();
      }
    });

    it('should capture console.log output', async () => {
      const result = await sandbox.execute({
        code: 'console.log("line1"); console.log("line2");',
        language: 'javascript',
      });

      if (result.outcome === 'OUTCOME_OK') {
        expect(result.logs).toContain('line1');
        expect(result.logs).toContain('line2');
      }
    });

    it('should capture console.warn and console.error', async () => {
      const result = await sandbox.execute({
        code: 'console.warn("warning"); console.error("error");',
        language: 'javascript',
      });

      if (result.outcome === 'OUTCOME_OK') {
        expect(result.logs.some((l) => l.includes('WARN'))).toBe(true);
        expect(result.logs.some((l) => l.includes('ERROR'))).toBe(true);
      }
    });
  });

  describe('execute — error handling', () => {
    it('should handle syntax errors', async () => {
      const result = await sandbox.execute({
        code: 'function {{{',
        language: 'javascript',
      });

      if (sandbox.isReady()) {
        expect(result.outcome).toBe('OUTCOME_ERROR');
        expect(result.error).toBeDefined();
      }
    });

    it('should handle runtime errors', async () => {
      const result = await sandbox.execute({
        code: 'throw new Error("test error")',
        language: 'javascript',
      });

      if (sandbox.isReady()) {
        expect(result.outcome).toBe('OUTCOME_ERROR');
        expect(result.error).toContain('test error');
      }
    });
  });

  describe('execute — unsupported languages', () => {
    it('should return UNSUPPORTED_LANGUAGE for Python in browser mode', async () => {
      await sandbox.ensureLoaded();
      if (sandbox.isReady()) {
        const result = await sandbox.execute({
          code: 'print("hello")',
          language: 'python',
        });
        expect(result.outcome).toBe('OUTCOME_UNSUPPORTED_LANGUAGE');
      }
    });

    it('should return UNSUPPORTED_LANGUAGE for Rust in browser mode', async () => {
      await sandbox.ensureLoaded();
      if (sandbox.isReady()) {
        const result = await sandbox.execute({
          code: 'fn main() {}',
          language: 'rust',
        });
        expect(result.outcome).toBe('OUTCOME_UNSUPPORTED_LANGUAGE');
      }
    });
  });

  describe('execute — TLA sandbox', () => {
    it('runs aeon-logic parser checks for a TLA module', async () => {
      const result = await sandbox.execute({
        code: SAMPLE_TLA_MODULE,
        language: 'tla',
      });

      expect(result.outcome).toBe('OUTCOME_OK');
      expect(result.language).toBe('tla');
      expect(result.output).toContain('"mode": "tla-sandbox"');
      expect(result.output).toContain('"name": "TriangleOrder"');
      expect(result.logs).toContain('Parsing TLA module...');
    });

    it('parses TLA module and trailing TLC config in one request', async () => {
      const result = await sandbox.execute({
        code: `${SAMPLE_TLA_MODULE}\n${SAMPLE_TLC_CONFIG}`,
        language: 'tla',
      });

      expect(result.outcome).toBe('OUTCOME_OK');
      expect(result.output).toContain('"config"');
      expect(result.logs).toContain('Parsing TLC config...');
    });

    it('returns OUTCOME_ERROR for invalid TLA content', async () => {
      const result = await sandbox.execute({
        code: 'MODULE missing_header_footer',
        language: 'tla',
      });

      expect(result.outcome).toBe('OUTCOME_ERROR');
      expect(result.error).toBeDefined();
    });
  });

  describe('execute — context injection', () => {
    it('should inject context variables as globals', async () => {
      const result = await sandbox.execute({
        code: 'console.log(greeting);',
        language: 'javascript',
        context: { greeting: 'hello world' },
      });

      if (result.outcome === 'OUTCOME_OK') {
        expect(result.output).toContain('hello world');
      }
    });
  });

  describe('execute — filesystem injection', () => {
    it('should inject __fs with file operations', async () => {
      const result = await sandbox.execute({
        code: 'console.log(__fs.readFile("/test.txt"));',
        language: 'javascript',
        filesystem: {
          id: 'root',
          did: 'did:test',
          type: 'directory',
          name: '/',
          path: '/',
          children: [
            {
              id: 'f1',
              did: 'did:test',
              type: 'file',
              name: 'test.txt',
              path: '/test.txt',
              content: 'file content here',
              permissions: [{ did: '*', capabilities: ['read'] }],
              metadata: { lastModified: Date.now(), hash: 'test' },
            },
          ],
          permissions: [{ did: '*', capabilities: ['read'] }],
          metadata: { lastModified: Date.now(), hash: 'root' },
        },
      });

      if (result.outcome === 'OUTCOME_OK') {
        expect(result.output).toContain('file content here');
      }
    });
  });

  describe('setEdgeFallbackUrl', () => {
    it('should accept a fallback URL', () => {
      sandbox.setEdgeFallbackUrl('https://api.example.com');
      // No assertion needed — just verify it doesn't throw
    });
  });

  describe('ensureLoaded', () => {
    it('should return a boolean', async () => {
      const ready = await sandbox.ensureLoaded();
      expect(typeof ready).toBe('boolean');
    });
  });

  describe('result types', () => {
    it('should always include required fields in result', async () => {
      const result = await sandbox.execute({
        code: '1 + 1',
        language: 'javascript',
      });

      expect(result.outcome).toBeDefined();
      expect(typeof result.output).toBe('string');
      expect(Array.isArray(result.logs)).toBe(true);
      expect(typeof result.execution_time_ms).toBe('number');
      expect(result.language).toBe('javascript');
    });
  });
});
