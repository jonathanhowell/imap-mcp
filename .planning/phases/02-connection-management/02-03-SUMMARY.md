---
phase: 02-connection-management
plan: 03
subsystem: connections
tags: [imapflow, imap, connection-manager, graceful-shutdown, tdd]

# Dependency graph
requires:
  - phase: 02-connection-management
    provides: AccountConnection class with state machine and exponential backoff reconnect (02-02)
  - phase: 01-foundation
    provides: AppConfig/AccountConfig types, loadConfig(), logger

provides:
  - ConnectionManager class — concurrent startup, per-account client lookup, graceful shutdown
  - Updated connections barrel exporting AccountConnection, AccountConnectionStatus, ConnectionManager
  - Wired src/index.ts — ConnectionManager created in main(), SIGTERM/SIGINT handlers registered

affects:
  - 03-tool-handlers (getClient() is the primary integration point for all Phase 3 IMAP tool calls)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Promise.allSettled for concurrent connection startup — individual failures isolated"
    - "Discriminated union return: ImapFlow | { error: string } — callers use 'error' in result"
    - "SIGTERM/SIGINT registered before server.connect() to ensure shutdown handlers are always active"
    - "TDD mock pattern: vi.fn(function() { ... }) required for constructor mocks to work with new"

key-files:
  created:
    - src/connections/connection-manager.ts
  modified:
    - src/connections/index.ts
    - src/index.ts
    - src/tools/stubs.ts
    - tests/connections/connection-manager.test.ts

key-decisions:
  - "vi.fn(function() {...}) required for constructor mocks — arrow functions fail silently with 'new' in vitest"
  - "eslint-disable comment used for _manager stub parameter — argsIgnorePattern not configured in project ESLint"
  - "Shutdown handlers registered after connectAll() but before server.connect() — ensures all connections are up before accepting requests"

patterns-established:
  - "ConnectionManager.getClient() discriminated union: callers check 'error' in result to detect unavailability"
  - "connectAll()/closeAll() both use Promise.allSettled — one account never blocks others"

requirements-completed: [CONN-01, CONN-02, CONN-03]

# Metrics
duration: 20min
completed: 2026-03-12
---

# Phase 02 Plan 03: ConnectionManager Summary

**ConnectionManager class implementing concurrent startup, per-account ImapFlow lookup with structured errors, and graceful SIGTERM/SIGINT shutdown wired into src/index.ts**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-03-12T07:49:08Z
- **Completed:** 2026-03-12T08:04:17Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Implemented `ConnectionManager` with `connectAll()` (Promise.allSettled, concurrent), `getClient()` (discriminated union), `getStatus()` (delegation), and `closeAll()` (Promise.allSettled)
- All 7 connection-manager tests moved from RED stub placeholders to GREEN with real assertions
- Wired `ConnectionManager` into `src/index.ts` with SIGTERM/SIGINT handlers and removed `void config` placeholder
- Full test suite (38 tests across 5 files) passes GREEN; TypeScript build and ESLint clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement ConnectionManager** - `f9f4a9d` (feat — TDD GREEN)
2. **Task 2: Wire ConnectionManager into src/index.ts** - `fae9ba6` (feat)

## Files Created/Modified

- `src/connections/connection-manager.ts` - ConnectionManager class with full API
- `src/connections/index.ts` - Added `export { ConnectionManager }` to barrel
- `src/index.ts` - ConnectionManager created in main(), shutdown handlers, removed `void config`
- `src/tools/stubs.ts` - Added optional `_manager?: ConnectionManager` param to `handleStubToolCall`
- `tests/connections/connection-manager.test.ts` - Replaced 7 stub assertions with real test logic

## Decisions Made

- `vi.fn(function() {...})` is required for vitest constructor mocks — arrow functions in mockImplementation fail silently when called with `new`, causing "0 connected, N failed" from Promise.allSettled on AccountConnection.connect(). The `vi.fn(function() {...})` pattern is already established in account-connection.test.ts.
- Used `// eslint-disable-next-line @typescript-eslint/no-unused-vars` for the `_manager` stub parameter — the project ESLint config uses `typescript-eslint` recommended without explicit `argsIgnorePattern`, so `_` prefix alone is not sufficient to suppress the warning.
- Shutdown handlers registered after `connectAll()` — this ensures connections are established before the server is ready to accept MCP tool calls, satisfying CONN-01.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- Vitest mock pattern issue: initial test implementation used `vi.fn().mockImplementation(() => ...)` with arrow functions for the `ImapFlow` constructor mock. This caused "The vi.fn() mock did not use 'function' or 'class'" warnings and all `AccountConnection.connect()` calls to report as rejected (0 connected, N failed). Fixed by using `vi.fn(function() {...})` — same pattern used successfully in account-connection.test.ts.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All three CONN requirements satisfied: CONN-01 (persistent connections at startup), CONN-02 (exponential backoff reconnect), CONN-03 (per-account isolation with structured errors)
- `manager.getClient(accountId)` is the integration point Phase 3 tool handlers will call before every IMAP operation
- `manager.getStatus(accountId)` is ready for Phase 3 `list_accounts` tool implementation
- No blockers for Phase 3

---
*Phase: 02-connection-management*
*Completed: 2026-03-12*

## Self-Check: PASSED

- FOUND: src/connections/connection-manager.ts
- FOUND: src/connections/index.ts
- FOUND: src/index.ts
- FOUND: .planning/phases/02-connection-management/02-03-SUMMARY.md
- FOUND commit: f9f4a9d (Task 1 - ConnectionManager implementation)
- FOUND commit: fae9ba6 (Task 2 - wire into src/index.ts)
