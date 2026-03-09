import { describe, expect, it } from 'bun:test';
import { lintDocumentCore } from '../streamed-lint-core';

describe('streamed lint core', () => {
  it('reports TypeScript rule diagnostics', () => {
    const output = lintDocumentCore({
      path: '/src/index.ts',
      language: 'typescript',
      content: 'const value: any = 1;\nconsole.log(value);\n',
      maxDiagnostics: 50,
    });

    expect(
      output.diagnostics.some((item) => item.code === 'TS_NO_EXPLICIT_ANY')
    ).toBe(true);
    expect(
      output.diagnostics.some((item) => item.code === 'TS_NO_CONSOLE_LOG')
    ).toBe(true);
  });

  it('reports missing Go package declaration', () => {
    const output = lintDocumentCore({
      path: '/src/main.go',
      language: 'go',
      content: 'import "fmt"\n\nfunc main(){ fmt.Println("hi") }\n',
      maxDiagnostics: 50,
    });

    expect(
      output.diagnostics.some((item) => item.code === 'GO_PACKAGE_REQUIRED')
    ).toBe(true);
  });

  it('reports Python block colon issues', () => {
    const output = lintDocumentCore({
      path: '/src/app.py',
      language: 'python',
      content: 'def main()\n    print("hello")\n',
      maxDiagnostics: 50,
    });

    expect(
      output.diagnostics.some((item) => item.code === 'PY_MISSING_COLON')
    ).toBe(true);
  });
});
