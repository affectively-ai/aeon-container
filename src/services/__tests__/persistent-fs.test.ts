/**
 * Persistent Filesystem Tests
 *
 * Tests CRUD operations, dirty tracking, and tree building.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { PersistentFS } from '../persistent-fs';

describe('PersistentFS', () => {
  let fs: PersistentFS;

  beforeEach(() => {
    fs = new PersistentFS('test-container', {
      apiUrl: 'https://api.example.com',
      ucanToken: 'test-token',
    });
  });

  describe('seedFiles', () => {
    it('should seed files without marking them dirty', () => {
      fs.seedFiles([
        { path: '/src/index.ts', content: 'console.log("hello")' },
        { path: '/README.md', content: '# Test' },
      ]);

      const files = fs.listFiles();
      expect(files.length).toBeGreaterThanOrEqual(2);
      expect(fs.dirty).toBe(false);
    });
  });

  describe('listFiles', () => {
    it('should return sorted file entries with directories', () => {
      fs.seedFiles([
        { path: '/src/index.ts', content: 'code' },
        { path: '/src/lib/utils.ts', content: 'utils' },
        { path: '/README.md', content: '# README' },
      ]);

      const files = fs.listFiles();
      // Should include /src directory, /src/lib directory, and files
      expect(files.some((f) => f.type === 'directory')).toBe(true);
      expect(files.some((f) => f.type === 'file')).toBe(true);
    });

    it('should sort directories before files', () => {
      fs.seedFiles([
        { path: '/a-file.ts', content: '' },
        { path: '/z-dir/inner.ts', content: '' },
      ]);

      const files = fs.listFiles();
      const dirIdx = files.findIndex((f) => f.type === 'directory');
      const fileIdx = files.findIndex((f) => f.path === '/a-file.ts');
      if (dirIdx >= 0 && fileIdx >= 0) {
        expect(dirIdx).toBeLessThan(fileIdx);
      }
    });
  });

  describe('writeFile', () => {
    it('should write to cache and mark as dirty', async () => {
      await fs.writeFile('/test.ts', 'new content');
      expect(fs.dirty).toBe(true);

      const files = fs.listFiles();
      const testFile = files.find((f) => f.path === '/test.ts');
      expect(testFile).toBeDefined();
      expect(testFile!.dirty).toBe(true);
    });
  });

  describe('readFile — cache', () => {
    it('should read seeded files from cache', async () => {
      fs.seedFiles([{ path: '/data.json', content: '{"key":"value"}' }]);

      const content = await fs.readFile('/data.json');
      expect(content).toBe('{"key":"value"}');
    });

    it('should read written files from cache', async () => {
      await fs.writeFile('/new.ts', 'hello');
      const content = await fs.readFile('/new.ts');
      expect(content).toBe('hello');
    });
  });

  describe('toFSNode', () => {
    it('should build a valid AeonFSNode tree', () => {
      fs.seedFiles([
        { path: '/src/index.ts', content: 'code' },
        { path: '/src/lib/utils.ts', content: 'utils' },
      ]);

      const root = fs.toFSNode();
      expect(root.type).toBe('directory');
      expect(root.name).toBe('/');
      expect(root.path).toBe('/');
      expect(root.children).toBeDefined();
      expect(root.children!.length).toBeGreaterThan(0);
    });

    it('should create nested directory structure', () => {
      fs.seedFiles([{ path: '/a/b/c.ts', content: 'deep' }]);

      const root = fs.toFSNode();
      const a = root.children?.find((c) => c.name === 'a');
      expect(a).toBeDefined();
      expect(a!.type).toBe('directory');

      const b = a!.children?.find((c) => c.name === 'b');
      expect(b).toBeDefined();
      expect(b!.type).toBe('directory');

      const c = b!.children?.find((c) => c.name === 'c.ts');
      expect(c).toBeDefined();
      expect(c!.type).toBe('file');
      expect(c!.content).toBe('deep');
    });
  });

  describe('getChanges', () => {
    it('should return only dirty files as changes', async () => {
      fs.seedFiles([{ path: '/clean.ts', content: 'original' }]);
      await fs.writeFile('/dirty.ts', 'new content');

      const changes = fs.getChanges();
      expect(changes.length).toBe(1);
      expect(changes[0].path).toBe('/dirty.ts');
      expect(changes[0].content).toBe('new content');
      expect(changes[0].type).toBe('modify');
    });

    it('should return empty when no dirty files', () => {
      fs.seedFiles([{ path: '/clean.ts', content: 'original' }]);
      const changes = fs.getChanges();
      expect(changes.length).toBe(0);
    });
  });

  describe('deleteFile', () => {
    it('should remove file from cache', async () => {
      fs.seedFiles([{ path: '/to-delete.ts', content: 'bye' }]);
      expect(fs.listFiles().some((f) => f.path === '/to-delete.ts')).toBe(true);

      // deleteFile handles API errors internally — no try/catch needed
      await fs.deleteFile('/to-delete.ts');

      expect(fs.listFiles().some((f) => f.path === '/to-delete.ts')).toBe(
        false
      );
    });
  });

  describe('syncing state', () => {
    it('should report syncing as false initially', () => {
      expect(fs.syncing).toBe(false);
    });

    it('should report dirty as false with only seeded files', () => {
      fs.seedFiles([{ path: '/a.ts', content: 'x' }]);
      expect(fs.dirty).toBe(false);
    });
  });

  describe('language detection', () => {
    it('should detect TypeScript files', () => {
      fs.seedFiles([{ path: '/app.tsx', content: 'code' }]);
      const files = fs.listFiles();
      const tsFile = files.find((f) => f.path === '/app.tsx');
      expect(tsFile?.language).toBe('typescript');
    });

    it('should detect Python files', () => {
      fs.seedFiles([{ path: '/script.py', content: 'code' }]);
      const files = fs.listFiles();
      const pyFile = files.find((f) => f.path === '/script.py');
      expect(pyFile?.language).toBe('python');
    });

    it('should detect Rust files', () => {
      fs.seedFiles([{ path: '/main.rs', content: 'code' }]);
      const files = fs.listFiles();
      const rsFile = files.find((f) => f.path === '/main.rs');
      expect(rsFile?.language).toBe('rust');
    });

    it('should detect TLA files', () => {
      fs.seedFiles([{ path: '/spec/triangle.tla', content: 'Spec == TRUE' }]);
      const files = fs.listFiles();
      const tlaFile = files.find((f) => f.path === '/spec/triangle.tla');
      expect(tlaFile?.language).toBe('tla');
    });
  });
});
