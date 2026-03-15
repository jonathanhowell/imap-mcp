---
phase: 03-core-read-operations
plan: 02
subsystem: api
tags: [imap, imapflow, vitest, folder-service, list-folders, mcp-tool, typescript]

# Dependency graph
requires:
  - phase: 03-core-read-operations
    plan: 01
    provides: "FolderEntry and ToolResult types in src/types.ts, list-folders.test.ts Wave 0 scaffold"
  - phase: 02-connection-management
    provides: "ConnectionManager.getClient() returning ImapFlow | { error: string }"
provides:
  - "src/services/folder-service.ts: listFolders(client) with LIST-STATUS statusQuery and SPECIAL_USE_MAP"
  - "src/tools/list-folders.ts: handleListFolders() MCP handler and LIST_FOLDERS_TOOL definition"
  - "5 list-folders tests GREEN covering MAIL-01, MAIL-02, special_use mapping, and error path"
affects: [03-03, 03-04, 03-05, 03-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "service + handler split: folder-service owns raw IMAP call; list-folders handler owns validation and error formatting"
    - "SPECIAL_USE_MAP: Record<string, FolderEntry['special_use']> for O(1) backslash-flag translation"
    - "handleListFolders error guard: 'error' in result check before IMAP call"

key-files:
  created:
    - src/services/folder-service.ts
    - src/tools/list-folders.ts
  modified:
    - tests/tools/list-folders.test.ts (Wave 0 stubs replaced with real assertions)

key-decisions:
  - "folder-service is pure (no try/catch) — errors propagate to handler layer which catches and formats them"
  - "handleListFolders wraps listFolders() in try/catch and returns isError ToolResult on IMAP exceptions"
  - "LIST_FOLDERS_TOOL mirrors stubs.ts list_folders schema — same name, same required account param"

patterns-established:
  - "Service layer: pure async functions that accept ImapFlow client, return typed results, no error catching"
  - "Handler layer: calls manager.getClient(), guards on error, calls service, wraps in try/catch, returns ToolResult"
  - "Test pattern: makeClient() returns { list: vi.fn() } mock; makeManager() returns { getClient: vi.fn() } mock"

requirements-completed: [MAIL-01, MAIL-02]

# Metrics
duration: 8min
completed: 2026-03-12
---

# Phase 3 Plan 02: folder-service and list-folders handler Summary

**list_folders MCP tool implemented — listFolders() service with LIST-STATUS statusQuery and SPECIAL_USE_MAP, handleListFolders() handler with getClient error guard, 5 tests GREEN for MAIL-01/MAIL-02**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-12T13:53:09Z
- **Completed:** 2026-03-12T14:01:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Created `src/services/folder-service.ts` with `listFolders()` using imapflow LIST-STATUS for a single-round-trip folder fetch with message/unseen counts
- Created `src/tools/list-folders.ts` with `handleListFolders()` handler and `LIST_FOLDERS_TOOL` definition following the service+handler split pattern
- Replaced all 5 Wave 0 `it.todo()` stubs in `list-folders.test.ts` with real assertions — all GREEN

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement folder-service** - folder-service.ts committed as part of 03-05 run (8c2f025) prior to this plan execution
2. **Task 2: Implement list-folders handler and make tests GREEN** - `0202f45` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified
- `src/services/folder-service.ts` - listFolders(client): calls client.list({ statusQuery }), maps ListResponse to FolderEntry via SPECIAL_USE_MAP
- `src/tools/list-folders.ts` - handleListFolders(params, manager): getClient guard, listFolders() call, JSON stringify response, error catch
- `tests/tools/list-folders.test.ts` - 5 real tests replacing Wave 0 todo stubs; makeClient/makeManager helper pattern

## Decisions Made
- Service layer is pure (no error catching) — the handler owns structured error formatting
- SPECIAL_USE_MAP uses the exact backslash-prefixed strings imapflow returns (`\\Inbox`, `\\Sent`, etc.)
- Test helpers `makeClient()` and `makeManager()` avoid vi.mock() hoisting complexity for handler-level tests

## Deviations from Plan

None — plan executed exactly as written. The folder-service.ts file was already present from a prior out-of-order execution of 03-05, so Task 1 was effectively a no-op creation (file content matched plan specification).

## Issues Encountered
- folder-service.ts was already committed in commit 8c2f025 (feat 03-05) because that plan ran before 03-02. The file content was correct and matched the 03-02 plan specification exactly, so no changes were needed for Task 1. Task 2 (list-folders.ts handler and tests) was still missing and was implemented in this plan.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `listFolders()` service and `handleListFolders()` handler are ready for wiring into the MCP server's tool dispatch in later plans
- Service+handler split pattern is established — plans 03-03 through 03-06 follow the same structure
- No blockers for plan 03-03 (list-messages implementation)

---
*Phase: 03-core-read-operations*
*Completed: 2026-03-12*

## Self-Check: PASSED

- src/services/folder-service.ts: FOUND
- src/tools/list-folders.ts: FOUND
- tests/tools/list-folders.test.ts: FOUND
- 03-02-SUMMARY.md: FOUND
- Commit 0202f45: FOUND
