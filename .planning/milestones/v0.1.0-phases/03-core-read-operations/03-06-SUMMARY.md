---
phase: 03-core-read-operations
plan: "06"
subsystem: api
tags: [mcp, imap, tool-routing, connection-manager]

# Dependency graph
requires:
  - phase: 03-core-read-operations
    provides: list-folders, list-messages, read-message, download-attachment, search-messages handlers from plans 03-02 through 03-05
  - phase: 02-connection-management
    provides: ConnectionManager with getClient() and getStatus()
provides:
  - Fully wired MCP server with 6 real tool handlers replacing stub dispatcher
  - ConnectionManager.getAccountIds() returning all configured account names
  - src/tools/list-accounts.ts with LIST_ACCOUNTS_TOOL and handleListAccounts
  - src/index.ts switch-router dispatching all 6 tools to real handlers
affects: [04-monitoring, 05-write-operations, 06-release]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - MCP CallToolRequestSchema handler uses switch-dispatch pattern with as-unknown-as casts for strict TypeScript compatibility
    - ToolResult returned from all handlers; dispatch layer uses AnyToolResult cast to satisfy SDK ServerResult type
    - handleListAccounts is synchronous (no IMAP call) — getAccountIds() + getStatus() are pure in-memory reads

key-files:
  created:
    - src/tools/list-accounts.ts
  modified:
    - src/connections/connection-manager.ts
    - src/index.ts

key-decisions:
  - "as unknown as Parameters<typeof handler>[0] required for strict TypeScript dispatch — single cast point avoids duplicating param type definitions"
  - "eslint-disable no-explicit-any scoped to AnyToolResult alias in switch block — ToolResult does not satisfy SDK ServerResult union due to missing task field"
  - "stubs.ts retained — startup.test.ts imports STUB_TOOLS/handleStubToolCall directly; removing it would break tests (not the server path)"

patterns-established:
  - "Tool router pattern: switch on name, as unknown as cast to param type, return as AnyToolResult"
  - "Synchronous list_accounts: no IMAP connection needed, pure manager state read"

requirements-completed: [MAIL-01, MAIL-02, MAIL-03, LIST-01, LIST-02, LIST-03, LIST-04, READ-01, READ-02, READ-03, READ-04, READ-05, SRCH-01, SRCH-02, SRCH-03, SRCH-04]

# Metrics
duration: 15min
completed: 2026-03-12
---

# Phase 3 Plan 06: MCP Server Wiring Summary

**All 6 Phase 3 IMAP tools wired into MCP server with real handlers, stub dispatcher removed, and ConnectionManager augmented with getAccountIds() for list_accounts**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-12T21:10:00Z
- **Completed:** 2026-03-12T21:58:00Z
- **Tasks:** 2
- **Files modified:** 3 (connection-manager.ts, list-accounts.ts created, index.ts)

## Accomplishments
- Added `getAccountIds()` to ConnectionManager returning all configured account names regardless of connection state
- Created `src/tools/list-accounts.ts` with synchronous `handleListAccounts` mapping account statuses to JSON
- Replaced stub dispatcher in `src/index.ts` with real switch-router importing and calling all 6 tool handlers
- All 86 tests GREEN across 11 test files; TypeScript and ESLint clean; build passes

## Task Commits

Each task was committed atomically:

1. **Task 1: Add getAccountIds() to ConnectionManager and implement list-accounts handler** - `cc56cfe` (feat)
2. **Task 2: Wire all tools into src/index.ts — replace stub dispatcher** - `6205f23` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/connections/connection-manager.ts` - Added getAccountIds() method after getStatus()
- `src/tools/list-accounts.ts` - New file: LIST_ACCOUNTS_TOOL definition and handleListAccounts function
- `src/index.ts` - Replaced STUB_TOOLS + handleStubToolCall with 6-tool TOOLS array and switch-router dispatch

## Decisions Made
- `as unknown as Parameters<typeof handler>[0]` pattern used for all handler param casts in the switch block — avoids duplicating type definitions while satisfying TypeScript strict mode
- `AnyToolResult` type alias with `eslint-disable no-explicit-any` scoped to switch block — ToolResult does not include the `task` field required by the MCP SDK's ServerResult union type
- `stubs.ts` deliberately retained — `startup.test.ts` imports STUB_TOOLS and handleStubToolCall directly; removing it would break the test suite even though index.ts no longer references it
- `handleListAccounts` is synchronous (no async) — getAccountIds() and getStatus() are pure in-memory reads of the Map, no IMAP calls needed

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript strict mode rejected direct as-cast from Record<string, unknown> to handler param types**
- **Found during:** Task 2 (Wire all tools into src/index.ts)
- **Issue:** `params as Parameters<typeof handleListMessages>[0]` failed because neither type sufficiently overlaps; strict TS requires `as unknown as` double-cast
- **Fix:** Changed all handler param casts to `as unknown as Parameters<typeof handler>[0]` pattern
- **Files modified:** src/index.ts
- **Verification:** `npx tsc --noEmit` passes clean
- **Committed in:** `6205f23` (Task 2 commit)

**2. [Rule 1 - Bug] ToolResult return type incompatible with MCP SDK ServerResult union**
- **Found during:** Task 2 (Wire all tools into src/index.ts)
- **Issue:** MCP SDK CallToolRequestSchema handler expects return type matching ServerResult union which requires a `task` field; ToolResult lacks it
- **Fix:** Added `type AnyToolResult = any` alias with eslint-disable, cast all handler returns as `AnyToolResult`
- **Files modified:** src/index.ts
- **Verification:** `npx tsc --noEmit` and `npx eslint src/index.ts` both pass; all 86 tests GREEN
- **Committed in:** `6205f23` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 - TypeScript strict mode bugs caught during compilation)
**Impact on plan:** Both fixes necessary for correct TypeScript compilation. No scope creep; same functional behavior as plan specified.

## Issues Encountered
None beyond the TypeScript strict-mode type issues documented above.

## Next Phase Readiness
- Phase 3 is complete: all 6 tools registered and routing to real handlers
- All 86 tests GREEN (Phase 1 + Phase 2 + Phase 3 tests)
- Server is ready for Phase 4 (monitoring) or release validation

---
*Phase: 03-core-read-operations*
*Completed: 2026-03-12*
