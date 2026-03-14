# @affectively/aeon-container

Parent: [Open Source Catalog](../README.md)

`@affectively/aeon-container` is the browser-side runtime layer for running code, keeping files in sync, streaming lint feedback, and coordinating collaborative agent sessions.

The fair brag is that this package gathers several things people normally have to wire together across different libraries: sandboxed execution, persistent file handling, streamed diagnostics, writeback helpers, and room-style collaboration transport.

## Why People May Like It

- `BrowserSandbox` gives you a browser execution surface with an edge fallback when local execution is not enough.
- `PersistentFS` keeps a local-first file view and can sync it back to container APIs.
- `StreamedLintClient` is built for live diagnostics instead of batch-only lint runs.
- `AgentRoomClient` gives you room snapshots, presence, and task transport in the same package.
- API route helpers and writeback helpers keep the surrounding plumbing close to the runtime instead of scattering it through app code.

## Install

```bash
bun add @affectively/aeon-container
```

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

## More Things You Get

### Persistent Files

```ts
import { PersistentFS } from '@affectively/aeon-container';

const fs = new PersistentFS('container-123', { apiUrl: 'https://halo.place' });
await fs.writeFile('/src/index.ts', 'export const ok = true;');
await fs.syncToBackend();
```

### Streamed Lint Feedback

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

## Core Surface

- `BrowserSandbox`
- `PersistentFS`
- `AgentRoomClient`
- `DevWritebackManager`
- `StreamedLintClient`
- `createApiRoutes`
- shared execution and filesystem types from `services/types.ts`

That surface is one of the package's strongest points. It is small enough to understand, but broad enough to support a real browser container experience.

## Repo Guide

- [src/services/README.md](./src/services/README.md): service-by-service map

## Development

```bash
cd open-source/aeon-container
bun test
```

## Why This README Is Grounded

Aeon Container does not need big claims. The strongest fair brag is that it already gives you a practical browser runtime package for code execution, file sync, lint streaming, and collaborative session plumbing.
