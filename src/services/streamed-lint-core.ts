/**
 * Core streamed linting rule engine used by the worker.
 *
 * WASM-backed syntax checks are injected via parseWithSwc. All other rules
 * are deterministic string scans so this module stays worker/test friendly.
 */

import type {
  StreamedLintDiagnostic,
  StreamedLintEngine,
  StreamedLintLanguage,
} from './streamed-lint-types';

type SwcParserOptions =
  | {
      syntax: 'typescript';
      tsx?: boolean;
      decorators?: boolean;
      dynamicImport?: boolean;
    }
  | {
      syntax: 'ecmascript';
      jsx?: boolean;
      dynamicImport?: boolean;
    };

export interface LintCoreInput {
  path: string;
  language: StreamedLintLanguage;
  content: string;
  maxDiagnostics: number;
  parseWithSwc?: (content: string, options: SwcParserOptions) => unknown;
}

export interface LintCoreOutput {
  diagnostics: StreamedLintDiagnostic[];
  engine: StreamedLintEngine;
  supportsWasm: boolean;
}

type MutableDiagnostic = Omit<StreamedLintDiagnostic, 'id'>;

const MAX_DEFAULT_DIAGNOSTICS = 240;

export function lintDocumentCore(input: LintCoreInput): LintCoreOutput {
  const diagnostics: MutableDiagnostic[] = [];
  const language = input.language;
  const lines = input.content.split('\n');
  const maxDiagnostics =
    input.maxDiagnostics > 0 ? input.maxDiagnostics : MAX_DEFAULT_DIAGNOSTICS;

  let engine: StreamedLintEngine = 'rules';
  let supportsWasm = false;

  if (language === 'javascript' || language === 'typescript') {
    if (input.parseWithSwc) {
      supportsWasm = true;
      engine = 'swc-wasm';
      lintTypeScriptSyntaxWithSwc(diagnostics, input);
    }
    lintTypeScriptRules(diagnostics, lines);
  } else if (language === 'go') {
    lintGoRules(diagnostics, lines);
  } else if (language === 'python') {
    lintPythonRules(diagnostics, lines);
  } else if (language === 'gnosis') {
    lintGnosisRules(diagnostics, lines);
  } else {
    lintGenericRules(diagnostics, lines);
  }

  lintCommonRules(diagnostics, lines);
  lintBracketBalance(diagnostics, input.content);

  const deduped = dedupeDiagnostics(diagnostics).slice(0, maxDiagnostics);

  return {
    diagnostics: deduped.map((diagnostic, index) => ({
      ...diagnostic,
      id: `${diagnostic.code}:${diagnostic.line}:${diagnostic.column}:${index}`,
    })),
    engine,
    supportsWasm,
  };
}

function lintTypeScriptSyntaxWithSwc(
  diagnostics: MutableDiagnostic[],
  input: LintCoreInput
): void {
  if (!input.parseWithSwc) return;

  const isTsx = /\.tsx$/i.test(input.path);
  const isJsx = /\.jsx$/i.test(input.path);

  const parserOptions: SwcParserOptions =
    input.language === 'typescript'
      ? {
          syntax: 'typescript',
          tsx: isTsx,
          decorators: true,
        }
      : {
          syntax: 'ecmascript',
          jsx: isJsx,
          dynamicImport: true,
        };

  try {
    input.parseWithSwc(input.content, parserOptions);
  } catch (error) {
    const message = extractSwcMessage(error);
    const { line, column } = extractSwcPosition(message);
    diagnostics.push({
      line,
      column,
      endLine: line,
      endColumn: column + 1,
      severity: 'error',
      source: 'swc-wasm',
      code: 'SWC_SYNTAX',
      message: extractSwcHeadline(message),
    });
  }
}

function lintTypeScriptRules(
  diagnostics: MutableDiagnostic[],
  lines: string[]
): void {
  lines.forEach((lineContent, lineIndex) => {
    const lineNumber = lineIndex + 1;

    const consoleIndex = lineContent.indexOf('console.log(');
    if (consoleIndex >= 0) {
      diagnostics.push({
        line: lineNumber,
        column: consoleIndex + 1,
        endLine: lineNumber,
        endColumn: consoleIndex + 'console.log'.length + 1,
        severity: 'warning',
        source: 'ts-rules',
        code: 'TS_NO_CONSOLE_LOG',
        message: 'Avoid console.log in committed code.',
      });
    }

    const debuggerIndex = lineContent.indexOf('debugger');
    if (debuggerIndex >= 0) {
      diagnostics.push({
        line: lineNumber,
        column: debuggerIndex + 1,
        endLine: lineNumber,
        endColumn: debuggerIndex + 'debugger'.length + 1,
        severity: 'warning',
        source: 'ts-rules',
        code: 'TS_NO_DEBUGGER',
        message: 'Remove debugger statements before shipping.',
      });
    }

    const anyMatch = lineContent.match(/:\s*any\b/);
    if (anyMatch && anyMatch.index !== undefined) {
      diagnostics.push({
        line: lineNumber,
        column: anyMatch.index + 1,
        endLine: lineNumber,
        endColumn: anyMatch.index + anyMatch[0].length + 1,
        severity: 'warning',
        source: 'ts-rules',
        code: 'TS_NO_EXPLICIT_ANY',
        message: 'Avoid explicit any; prefer unknown or concrete types.',
      });
    }

    const ignoreIndex = lineContent.indexOf('@ts-ignore');
    if (ignoreIndex >= 0) {
      diagnostics.push({
        line: lineNumber,
        column: ignoreIndex + 1,
        endLine: lineNumber,
        endColumn: ignoreIndex + '@ts-ignore'.length + 1,
        severity: 'warning',
        source: 'ts-rules',
        code: 'TS_AVOID_IGNORE',
        message: 'Prefer a typed fix over @ts-ignore.',
      });
    }
  });
}

function lintGoRules(diagnostics: MutableDiagnostic[], lines: string[]): void {
  const packageLine = lines.findIndex((line) => /^\s*package\s+\w+/.test(line));
  if (packageLine === -1) {
    diagnostics.push({
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: 8,
      severity: 'error',
      source: 'go-rules',
      code: 'GO_PACKAGE_REQUIRED',
      message: 'Go files should declare a package.',
    });
  }

  const hasMain = lines.some((line) => /^\s*func\s+main\s*\(/.test(line));
  if (
    !hasMain &&
    packageLine === 0 &&
    /\bpackage\s+main\b/.test(lines[0] || '')
  ) {
    diagnostics.push({
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: 1,
      severity: 'info',
      source: 'go-rules',
      code: 'GO_MAIN_RECOMMENDED',
      message: 'package main usually defines func main().',
    });
  }

  const hasFmtPrint = lines.some((line) =>
    /\bfmt\.(Print|Printf|Println)\s*\(/.test(line)
  );
  const hasFmtImport = lines.some((line) =>
    /(^\s*import\s+"fmt")|(^\s*"fmt"\s*$)/.test(line)
  );
  if (hasFmtPrint && !hasFmtImport) {
    diagnostics.push({
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: 1,
      severity: 'warning',
      source: 'go-rules',
      code: 'GO_FMT_IMPORT',
      message: 'fmt print calls detected but fmt import was not found.',
    });
  }

  lines.forEach((lineContent, lineIndex) => {
    const tabMatchIndex = lineContent.indexOf('\t');
    if (tabMatchIndex >= 0) {
      diagnostics.push({
        line: lineIndex + 1,
        column: tabMatchIndex + 1,
        endLine: lineIndex + 1,
        endColumn: tabMatchIndex + 2,
        severity: 'info',
        source: 'go-rules',
        code: 'GO_GOFMT_TABS',
        message: 'Tabs detected; gofmt will normalize indentation.',
      });
    }
  });
}

function lintPythonRules(
  diagnostics: MutableDiagnostic[],
  lines: string[]
): void {
  const blockStarter =
    /^\s*(def|class|if|elif|else|for|while|try|except|finally|with)\b/;

  lines.forEach((lineContent, lineIndex) => {
    const lineNumber = lineIndex + 1;

    const tabIndex = lineContent.indexOf('\t');
    if (tabIndex >= 0) {
      diagnostics.push({
        line: lineNumber,
        column: tabIndex + 1,
        endLine: lineNumber,
        endColumn: tabIndex + 2,
        severity: 'error',
        source: 'python-rules',
        code: 'PY_TABS',
        message: 'Tabs in indentation can break Python block parsing.',
      });
    }

    const indentMatch = lineContent.match(/^ +/);
    if (indentMatch) {
      const width = indentMatch[0].length;
      if (width % 4 !== 0) {
        diagnostics.push({
          line: lineNumber,
          column: 1,
          endLine: lineNumber,
          endColumn: width + 1,
          severity: 'warning',
          source: 'python-rules',
          code: 'PY_INDENT_MULTIPLE_OF_4',
          message: 'Indentation is not a multiple of 4 spaces.',
        });
      }
    }

    if (
      blockStarter.test(lineContent) &&
      !lineContent.trimEnd().endsWith(':') &&
      !lineContent.trimStart().startsWith('#')
    ) {
      diagnostics.push({
        line: lineNumber,
        column: Math.max(1, lineContent.length),
        endLine: lineNumber,
        endColumn: lineContent.length + 1,
        severity: 'error',
        source: 'python-rules',
        code: 'PY_MISSING_COLON',
        message: 'Python block statements should end with a colon.',
      });
    }

    const printIndex = lineContent.indexOf('print(');
    if (printIndex >= 0) {
      diagnostics.push({
        line: lineNumber,
        column: printIndex + 1,
        endLine: lineNumber,
        endColumn: printIndex + 'print'.length + 1,
        severity: 'info',
        source: 'python-rules',
        code: 'PY_PRINT_DEBUG',
        message: 'print() call detected; confirm this is intentional.',
      });
    }
  });
}

function lintGnosisRules(
  diagnostics: MutableDiagnostic[],
  lines: string[]
): void {
  lines.forEach((lineContent, lineIndex) => {
    const lineNumber = lineIndex + 1;

    const imperativeKeywords = ['function', 'return', 'if', 'while', 'var', 'let', 'const'];
    imperativeKeywords.forEach(keyword => {
      const index = lineContent.indexOf(keyword);
      if (index >= 0) {
        diagnostics.push({
          line: lineNumber,
          column: index + 1,
          endLine: lineNumber,
          endColumn: index + keyword.length + 1,
          severity: 'error',
          source: 'gnosis-rules',
          code: 'GNOSIS_IMPERATIVE_REJECTED',
          message: `Imperative keyword '${keyword}' rejected. Use topological graph syntax.`,
        });
      }
    });

    if (lineContent.includes(')-[:') && !lineContent.includes(']->(')) {
      diagnostics.push({
        line: lineNumber,
        column: 1,
        endLine: lineNumber,
        endColumn: lineContent.length + 1,
        severity: 'warning',
        source: 'gnosis-rules',
        code: 'GNOSIS_INCOMPLETE_EDGE',
        message: 'Incomplete edge declaration detected.',
      });
    }
  });
}

function lintGenericRules(
  diagnostics: MutableDiagnostic[],
  lines: string[]
): void {
  lines.forEach((lineContent, lineIndex) => {
    const todoIndex = lineContent.indexOf('TODO');
    if (todoIndex >= 0) {
      diagnostics.push({
        line: lineIndex + 1,
        column: todoIndex + 1,
        endLine: lineIndex + 1,
        endColumn: todoIndex + 'TODO'.length + 1,
        severity: 'info',
        source: 'generic-rules',
        code: 'GENERIC_TODO',
        message: 'TODO marker found.',
      });
    }
  });
}

function lintCommonRules(
  diagnostics: MutableDiagnostic[],
  lines: string[]
): void {
  lines.forEach((lineContent, lineIndex) => {
    const lineNumber = lineIndex + 1;

    if (/\s+$/.test(lineContent)) {
      diagnostics.push({
        line: lineNumber,
        column: Math.max(1, lineContent.trimEnd().length + 1),
        endLine: lineNumber,
        endColumn: lineContent.length + 1,
        severity: 'warning',
        source: 'common-rules',
        code: 'COMMON_TRAILING_WHITESPACE',
        message: 'Trailing whitespace.',
      });
    }

    if (lineContent.length > 120) {
      diagnostics.push({
        line: lineNumber,
        column: 121,
        endLine: lineNumber,
        endColumn: lineContent.length + 1,
        severity: 'warning',
        source: 'common-rules',
        code: 'COMMON_LONG_LINE',
        message: 'Line exceeds 120 characters.',
      });
    }
  });
}

function lintBracketBalance(
  diagnostics: MutableDiagnostic[],
  content: string
): void {
  const opening = new Set(['(', '[', '{']);
  const matching: Record<string, string> = {
    ')': '(',
    ']': '[',
    '}': '{',
  };
  const stack: Array<{ character: string; line: number; column: number }> = [];
  let line = 1;
  let column = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (character === '\n') {
      line += 1;
      column = 0;
      escaped = false;
      continue;
    }
    column += 1;

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (opening.has(character)) {
      stack.push({ character, line, column });
      continue;
    }

    if (character in matching) {
      const expectedOpening = matching[character];
      const previous = stack.pop();
      if (!previous || previous.character !== expectedOpening) {
        diagnostics.push({
          line,
          column,
          endLine: line,
          endColumn: column + 1,
          severity: 'error',
          source: 'common-rules',
          code: 'COMMON_BRACKET_MISMATCH',
          message: `Unexpected '${character}'.`,
        });
      }
    }
  }

  stack.forEach((entry) => {
    diagnostics.push({
      line: entry.line,
      column: entry.column,
      endLine: entry.line,
      endColumn: entry.column + 1,
      severity: 'error',
      source: 'common-rules',
      code: 'COMMON_BRACKET_UNCLOSED',
      message: `Unclosed '${entry.character}'.`,
    });
  });
}

function dedupeDiagnostics(
  diagnostics: MutableDiagnostic[]
): MutableDiagnostic[] {
  const seen = new Set<string>();
  const deduped: MutableDiagnostic[] = [];

  const severityRank: Record<string, number> = {
    error: 0,
    warning: 1,
    info: 2,
  };

  diagnostics
    .slice()
    .sort((a, b) => {
      const severityDelta = severityRank[a.severity] - severityRank[b.severity];
      if (severityDelta !== 0) return severityDelta;
      if (a.line !== b.line) return a.line - b.line;
      if (a.column !== b.column) return a.column - b.column;
      return a.code.localeCompare(b.code);
    })
    .forEach((diagnostic) => {
      const key = [
        diagnostic.severity,
        diagnostic.line,
        diagnostic.column,
        diagnostic.code,
        diagnostic.message,
      ].join('|');
      if (seen.has(key)) return;
      seen.add(key);
      deduped.push(diagnostic);
    });

  return deduped;
}

function extractSwcMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || String(error);
  return String(error);
}

function extractSwcHeadline(message: string): string {
  const line = message
    .split('\n')
    .map((segment) => segment.trim())
    .find((segment) => segment.startsWith('x '));
  if (!line) return 'Syntax error.';
  return line.replace(/^x\s+/, '');
}

function extractSwcPosition(message: string): { line: number; column: number } {
  const lineMatch = message.match(/^\s*(\d+)\s*\|/m);
  const line = lineMatch ? Number.parseInt(lineMatch[1] || '1', 10) : 1;

  const pointerLineMatch = message.match(/^\s*:\s*([ \t]*)\^/m);
  const column = pointerLineMatch
    ? (pointerLineMatch[1] || '').replace(/\t/g, '    ').length + 1
    : 1;

  return { line, column };
}
