---
phase: 03-core-read-operations
plan: 05
subsystem: api
tags: [imap, search, imapflow, vitest, typescript]

# Dependency graph
requires:
  - phase: 03-01
    provides: "SearchResultItem and ToolResult types; search_messages stub registered in MCP server"
  - phase: 02-connection-management
    provides: "ConnectionManager.getClient() returning ImapFlow | { error: string }"
provides:
  - "searchMessages(client, params) service with IMAP criteria mapping and multi-folder support"
  - "handleSearchMessages MCP tool handler for search_messages"
  - "SRCH-01 through SRCH-04 tests GREEN: from, subject, since/before Date conversion, unread/seen mapping"
affects: [future-search-enhancements, phase-04-write-operations]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "criteria builder pattern: only include defined fields in IMAP SearchObject"
    - "ISO 8601 string to Date conversion before passing to imapflow search()"
    - "multi-folder mode with early exit at max_results boundary"
    - "lock-per-folder with finally release for resource safety"

key-files:
  created:
    - src/services/search-service.ts
    - src/tools/search-messages.ts
    - tests/tools/search-messages.test.ts
  modified: []

key-decisions:
  - "unread param maps inverted to IMAP seen flag: unread=true → seen: false; unread=false → seen: true; unread=undefined → seen omitted"
  - "folder='all' is implemented as sequential per-folder search with early exit — documented as potentially slow in tool description"
  - "searchFolder helper extracted for reuse in single-folder and multi-folder paths, both using finally for lock release"
  - "criteria built as Record<string, unknown> to allow dynamic field inclusion without undefined pollution"

patterns-established:
  - "Service accepts ImapFlow directly; handler owns getClient + error guard pattern (established in 03-core-read-operations)"
  - "Performance warning for expensive operations included in both tool description and service JSDoc"

requirements-completed: [SRCH-01, SRCH-02, SRCH-03, SRCH-04]

# Metrics
duration: ~20min
completed: 2026-03-12
---

# Phase 3 Plan 05: Search Messages Summary

**IMAP search service with criteria mapping (from/subject/since/before/seen) and sequential cross-folder 'all' mode — SRCH-01 through SRCH-04 all GREEN**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-03-12T20:00:00Z
- **Completed:** 2026-03-12T20:53:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- searchMessages service translates from/subject/since/before/unread params into imapflow SearchObject with correct type conversions
- Multi-folder 'all' mode iterates all mailboxes sequentially with per-folder locking and early exit at max_results
- 10 tests covering SRCH-01 through SRCH-04, default folder, max_results cap, folder field on results, and error case all GREEN

## Task Commits

1. **Task 1: Implement search-service** - `8c2f025` (feat)
2. **Task 2: Implement search-messages handler and make tests GREEN** - `fbdd65d` (feat)

## Files Created/Modified

- `src/services/search-service.ts` - IMAP search with criteria mapping, single-folder and multi-folder modes
- `src/tools/search-messages.ts` - search_messages MCP tool handler with performance warning in description
- `tests/tools/search-messages.test.ts` - 10 tests covering all SRCH requirements plus edge cases

## Decisions Made

- unread param maps inverted: unread=true sends `seen: false` to IMAP (IMAP SEEN flag = message has been read, opposite of "unread")
- folder='all' uses client.list() then iterates sequentially — simpler than parallel with less risk of overwhelming IMAP connection; documented as slow
- searchFolder private helper avoids code duplication between single-folder path and multi-folder loop
- criteria object uses Record<string, unknown> to allow dynamic field inclusion; only fields with defined values are added

## Deviations from Plan

None - plan executed exactly as written. Implementation matched all specified behaviors including multi-folder early exit, Date conversion, and lock release in finally blocks.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All four search criteria requirements complete (SRCH-01 through SRCH-04)
- search_messages is a live MCP tool backed by real IMAP SEARCH — ready for integration testing against actual mailboxes
- Phase 3 Wave 2 tools (list-folders, list-messages, read-message, search-messages) are all implemented

---
*Phase: 03-core-read-operations*
*Completed: 2026-03-12*
