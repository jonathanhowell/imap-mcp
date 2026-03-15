---
phase: 03-core-read-operations
plan: "03"
subsystem: api
tags: [imap, imapflow, pagination, message-headers, mcp-tools]

# Dependency graph
requires:
  - phase: 03-01
    provides: "MessageHeader and ToolResult types in src/types.ts, test scaffolds for MAIL-03 and LIST-01 through LIST-04"
  - phase: 02-connection-management
    provides: "ConnectionManager.getClient() returning ImapFlow | { error: string } discriminated union"
provides:
  - "src/services/message-service.ts: listMessages() with UID-slice pagination and mailbox lock guard"
  - "src/tools/list-messages.ts: handleListMessages() MCP handler and LIST_MESSAGES_TOOL schema"
  - "UID-slice pagination pattern for all subsequent message-reading tools"
  - "Lock guard pattern: getMailboxLock in try/finally always releasing"
  - "search() || [] normalization for imapflow false return"
affects:
  - 03-04-read-message
  - 03-05-search-messages

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "UID-slice pagination: search all UIDs, sort, slice by offset+limit, fetchAll the slice"
    - "Mailbox lock guard: getMailboxLock in try block, lock.release() in finally block"
    - "search() false normalization: (await client.search(...)) || [] handles imapflow returning false"
    - "unread_only filter: passes { seen: false } instead of { all: true } to search"

key-files:
  created:
    - src/services/message-service.ts
    - src/tools/list-messages.ts
    - tests/tools/list-messages.test.ts
  modified: []

key-decisions:
  - "listMessages opts parameter named unreadOnly (camelCase) in service; MCP tool uses unread_only (snake_case) parameter name for MCP schema conventions"
  - "Sort by UID (not internalDate) for newest/oldest — UID ordering matches typical IMAP delivery order and avoids a second sort pass after fetchAll"
  - "Empty UID result returns [] early before acquiring fetchAll — avoids unnecessary network call"

patterns-established:
  - "Service layer accepts ImapFlow directly; handler layer calls getClient() and guards on error — all Phase 3 tools follow this split"
  - "UID-slice pagination pattern: search returns all UIDs, sort+slice in memory, fetchAll only the page UIDs"
  - "Lock guard: try/finally lock.release() — established here, required by all services that call getMailboxLock"

requirements-completed: [MAIL-03, LIST-01, LIST-02, LIST-03, LIST-04]

# Metrics
duration: verified
completed: 2026-03-12
---

# Phase 03 Plan 03: List Messages Summary

**Paginated message header listing via UID-slice + getMailboxLock guard, with sort order, offset/limit pagination, and unread_only filter.**

## Performance

- **Duration:** Pre-committed implementation; verification pass only
- **Started:** 2026-03-12
- **Completed:** 2026-03-12
- **Tasks:** 2 (both pre-committed)
- **Files modified:** 3

## Accomplishments

- Implemented `listMessages()` in `src/services/message-service.ts` with the UID-slice pagination pattern, search() false normalization, and mailbox lock guard in try/finally
- Implemented `handleListMessages()` and `LIST_MESSAGES_TOOL` in `src/tools/list-messages.ts` with account error guarding and unread_only parameter
- All 8 tests GREEN (MAIL-03, LIST-01, LIST-02, LIST-03, LIST-04, error handling) and full 86-test suite passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement message-service with paginated UID fetch** - `3793148` (feat)
2. **Task 2: Implement list-messages handler and make tests GREEN** - `fbdd65d` (feat, recovery commit including Wave 2 work)

## Files Created/Modified

- `src/services/message-service.ts` - listMessages() with lock guard, UID pagination, sort, unread filter
- `src/tools/list-messages.ts` - handleListMessages() MCP handler and LIST_MESSAGES_TOOL schema definition
- `tests/tools/list-messages.test.ts` - 8 tests covering MAIL-03, LIST-01 through LIST-04, and error handling

## Decisions Made

- `unreadOnly` (camelCase) in service opts; `unread_only` (snake_case) in MCP tool params — respects MCP tool schema conventions while keeping TypeScript idiomatic internally
- Sort by UID ordering (descending for newest, ascending for oldest) rather than by internalDate post-fetch — avoids a secondary sort after fetchAll
- Early return `[]` when search returns no UIDs — skips fetchAll network call entirely when mailbox is empty or no matching messages

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - implementation committed prior to this verification pass. All tests GREEN on first run.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- UID-slice pagination pattern established and tested — `read-message` and `search-messages` build on same lock guard and fetchAll approach
- `listMessages()` service interface is stable: `(client: ImapFlow, folder: string, opts: ListMessagesOptions) => Promise<MessageHeader[]>`
- All LIST-01 through LIST-04 requirements satisfied with verified tests

---
*Phase: 03-core-read-operations*
*Completed: 2026-03-12*
