# @affectively/aeon-container

Parent: [Open Source Catalog](../README.md)

## Overview
`@affectively/aeon-container` is the runtime service layer for browser-based Aeon execution surfaces. It provides:
- browser sandbox execution with QuickJS and edge fallback
- persistent file-system sync against container APIs
- streamed lint orchestration (worker + fallback engine)
- agent-room collaboration client and task/presence transport
- dev writeback adapters for local and edge-backed file updates

## Install
```bash
bun add @affectively/aeon-container
```

## Core Surface
- `BrowserSandbox`
- `PersistentFS`
- `AgentRoomClient`
- `DevWriteback` writeback service
- `StreamedLintClient`
- `createApiRoutes` and API URL helpers
- shared execution/filesystem types from `services/types.ts`

## Quick Start
```ts
import { BrowserSandbox } from '@affectively/aeon-container';

const sandbox = BrowserSandbox.getInstance();
sandbox.setEdgeFallbackUrl('https://example.com/v1/aeon-container/execute');

const result = await sandbox.execute({
  language: 'javascript',
  code: 'const x = 40 + 2; x;',
  timeout_ms: 2000,
});

console.log(result.outcome, result.output);
```

## Persistent Files Example
```ts
import { PersistentFS } from '@affectively/aeon-container';

const fs = new PersistentFS('container-123', { apiUrl: 'https://halo.place' });
await fs.writeFile('/src/index.ts', 'export const ok = true;');
await fs.syncToBackend();
```

## Streamed Lint Example
```ts
import { StreamedLintClient } from '@affectively/aeon-container';

const lint = new StreamedLintClient();
const handle = lint.lint({
  version: 1,
  path: 'src/example.ts',
  language: 'typescript',
  content: 'const x: any = 1;',
  onChunk: (diagnostics) => console.log(diagnostics),
});

// handle.cancel() if needed
```

## Development
```bash
cd open-source/aeon-container
bun test
```

## Subdirectories
- `src/services/` detailed service map: [services/README.md](./src/services/README.md)
