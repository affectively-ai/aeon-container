# Aeon Container Services

Parent: [Services](../README.md)

Browser and edge adapter services for Aeon IDE execution, persistence, lint streaming, and agent-room collaboration state.

## Files

- `agent-room-client.ts` - room snapshot/presence/todo client for embedded IDE collaboration
- `api-routes.ts` - container API base URL/path resolution helpers
- `browser-sandbox.ts` - browser QuickJS execution runtime with edge fallback
- `dev-writeback.ts` - developer writeback integration utilities
- `persistent-fs.ts` - local-first filesystem cache with Dash relay and D1 sync
- `streamed-lint-client.ts` - streamed lint worker client
- `streamed-lint-core.ts` - lint diagnostics core pipeline
- `streamed-lint-types.ts` - shared lint types
- `streamed-lint.worker.ts` - web worker entry for streamed lint
- `types.ts` - shared Aeon container runtime types

## Sub-Directories

- [__tests__](./__tests__)
