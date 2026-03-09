'use aeon';

import type { ContainerLanguage } from '../services/types';

export const LOCAL_LOCK_OWNER_ID = 'you';

const LANGUAGE_BY_EXTENSION: Record<string, ContainerLanguage> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  go: 'go',
  py: 'python',
  rs: 'rust',
  lua: 'lua',
};

export function inferLanguageFromPath(path: string): ContainerLanguage | null {
  const extension = path.split('.').pop()?.toLowerCase();
  if (!extension) {
    return null;
  }
  return LANGUAGE_BY_EXTENSION[extension] || null;
}

export function getDefaultContent(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
      return '// TypeScript\n\nexport function main() {\n  console.log("hello from aeon container");\n}\n\nmain();\n';
    case 'js':
    case 'jsx':
      return '// JavaScript\n\nfunction main() {\n  console.log("hello from aeon container");\n}\n\nmain();\n';
    case 'go':
      return 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hello from aeon container")\n}\n';
    case 'py':
      return '# Python\n\ndef main():\n    print("hello from aeon container")\n\nmain()\n';
    case 'rs':
      return '// Rust\n\nfn main() {\n    println!("hello from aeon container");\n}\n';
    case 'lua':
      return '-- Lua\n\nfunction main()\n  print("hello from aeon container")\nend\n\nmain()\n';
    case 'json':
      return '{\n  "name": "aeon-container",\n  "version": "1.0.0"\n}\n';
    case 'md':
      return '# README\n\nAeon Container IDE project.\n';
    default:
      return '';
  }
}

export function formatDocumentContent(
  content: string,
  language: ContainerLanguage
): string {
  const normalizedLines = content
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n');

  if (language === 'python') {
    return normalizedLines
      .replace(/\t/g, '    ')
      .replace(/\n{4,}/g, '\n\n\n')
      .trimEnd()
      .concat('\n');
  }

  if (language === 'go') {
    return normalizedLines
      .replace(/ {2}/g, '\t')
      .replace(/\n{4,}/g, '\n\n\n')
      .trimEnd()
      .concat('\n');
  }

  return normalizedLines
    .replace(/\t/g, '  ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trimEnd()
    .concat('\n');
}

export function parseLanguageAlias(
  rawAlias: string | undefined
): ContainerLanguage | null {
  if (!rawAlias) return null;
  const normalized = rawAlias.trim().toLowerCase();
  const lookup: Record<string, ContainerLanguage> = {
    js: 'javascript',
    javascript: 'javascript',
    ts: 'typescript',
    typescript: 'typescript',
    go: 'go',
    golang: 'go',
    py: 'python',
    python: 'python',
    rs: 'rust',
    rust: 'rust',
    lua: 'lua',
  };
  return lookup[normalized] ?? null;
}

export function buildStaticAnalysisPlan(language: ContainerLanguage): string[] {
  if (language === 'typescript' || language === 'javascript') {
    return [
      'Stream parse using SWC WASM and emit syntax diagnostics first.',
      'Run semantic rule sweep for unsafe patterns and anti-patterns.',
      'Rank diagnostics by severity and line density hot zones.',
      'Expose quick actions: format, remove dead code, strengthen types.',
    ];
  }

  if (language === 'go') {
    return [
      'Validate package/import topology and main-entry assumptions.',
      'Scan for formatting drift and control-flow bracket mismatch.',
      'Detect suspicious fmt usage/import inconsistencies.',
      'Surface refactor actions for package structure and naming.',
    ];
  }

  if (language === 'python') {
    return [
      'Validate indentation/tabs and block colon completeness.',
      'Detect long-line and trailing whitespace readability issues.',
      'Detect debug prints and brittle branch layout patterns.',
      'Surface refactor actions for type hints and import hygiene.',
    ];
  }

  return [
    'Run syntax-level diagnostics with common structural checks.',
    'Prioritize highest-severity diagnostics and map to actions.',
    'Expose auto-fix actions where deterministic rewrites are safe.',
    'Track baseline metrics for iterative performance tuning.',
  ];
}
