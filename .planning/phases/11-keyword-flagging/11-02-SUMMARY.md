---
phase: 11-keyword-flagging
plan: "02"
subsystem: imap
tags: [imapflow, search, poller, keywords, filtering]

# Dependency graph
requires:
  - phase: 11-01
    provides: "MessageHeader.keywords field, flag_message tool"
provides:
  - "exclude_keywords (array) parameter on search_messages — first keyword server-side IMAP NOT KEYWORD, rest post-filtered in memory"
  - "include_keywords (array) parameter on search_messages — single → criteria.keyword, multiple → criteria.or (OR semantics)"
  - "exclude_keywords (array) parameter on get_new_mail (in-memory cache filter, any-of case-insensitive)"
  - "keywords field populated from IMAP flags in searchFolder (non-system flags)"
  - "Poller.query() third parameter excludeKeywords (array) with any-of case-insensitive comparison"
affects:
  - "agents using search_messages or get_new_mail for deduplication workflows"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "unKeyword in imapflow SearchObject criteria for NOT KEYWORD server-side filtering"
    - "Case-insensitive keyword comparison via .toLowerCase() to handle IMAP server normalization"
    - "Non-system flags extracted by filtering out backslash-prefixed flags from imapflow FetchMessageObject.flags Set"

key-files:
  created: []
  modified:
    - src/services/search-service.ts
    - src/tools/search-messages.ts
    - src/tools/get-new-mail.ts
    - src/polling/poller.ts
    - tests/tools/search-messages.test.ts
    - tests/tools/get-new-mail.test.ts
    - tests/polling/poller.test.ts

key-decisions:
  - "unKeyword field (not criteria.not = { keyword }) used for IMAP NOT KEYWORD — confirmed in imapflow SearchObject type definition"
  - "Case-insensitive keyword comparison in poller.query() via .toLowerCase() per RESEARCH.md pitfall on IMAP server casing normalization"
  - "keywords populated in searchFolder by filtering msg.flags Set for entries not starting with backslash"

patterns-established:
  - "Server-side keyword exclusion: unKeyword field on imapflow SearchObject criteria"
  - "In-memory keyword exclusion: case-insensitive Array.some() comparison on cached message keywords"

requirements-completed:
  - KFLAG-02
  - KFLAG-03

# Metrics
duration: 4min
completed: 2026-03-18
---

# Phase 11 Plan 02: Keyword Filtering Summary

**Server-side IMAP NOT KEYWORD filtering in search_messages and case-insensitive in-memory keyword filtering in get_new_mail, with poller cache now storing custom IMAP keywords from flags**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-18T12:09:55Z
- **Completed:** 2026-03-18T12:13:42Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- search_messages accepts exclude_keywords (array) — first keyword server-side via IMAP SEARCH NOT KEYWORD, remaining post-filtered in memory
- search_messages accepts include_keywords (array) — single keyword uses criteria.keyword, multiple uses criteria.or (OR semantics, server-side)
- get_new_mail accepts exclude_keywords (array) and applies any-of case-insensitive in-memory filter on poller cache
- Poller cache now stores custom keywords (non-backslash-prefixed flags) from searchFolder results
- 13 new test cases across search, get_new_mail, and poller test files; full suite 202/202 green (post-hotfix)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add excludeKeyword to SearchParams and search_messages tool** - `2f44dbe` (feat)
2. **Task 2: Add exclude_keyword to get_new_mail and populate keywords in poller cache** - `37ec6c5` (feat)

## Files Created/Modified

- `src/services/search-service.ts` - Added excludeKeywords (array) and includeKeywords (array) to SearchParams; criteria building with server-side first-keyword and memory post-filter for remainder; include uses criteria.keyword or criteria.or
- `src/tools/search-messages.ts` - Added exclude_keywords (array) and include_keywords (array) to SearchMessagesParams, inputSchema, and both searchMessages call sites
- `src/tools/get-new-mail.ts` - Added exclude_keywords (array) to GetNewMailParams, inputSchema, and poller.query() call
- `src/polling/poller.ts` - Added excludeKeywords (array) third parameter to query() with any-of case-insensitive filter
- `tests/tools/search-messages.test.ts` - Added 4 KFLAG-02 exclude tests (including multi-keyword post-filter) and 3 include_keywords tests
- `tests/tools/get-new-mail.test.ts` - Updated to pass array to poller.query(); updated KFLAG-03 test
- `tests/polling/poller.test.ts` - Updated KFLAG-03 tests to use arrays; added multi-keyword any-of test

## Decisions Made

- Used `criteria.unKeyword` (not `criteria.not = { keyword }`) — confirmed `unKeyword?: string` field exists in imapflow's `SearchObject` interface in `imap-flow.d.ts`
- Applied case-insensitive comparison (`.toLowerCase()`) in poller.query() to handle IMAP server keyword casing normalization
- Keywords extracted by spreading msg.flags Set and filtering out entries starting with `\` (system flags like `\Seen`, `\Flagged`)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 11 keyword flagging workflow is complete: flag_message sets keywords (Plan 01), search_messages and get_new_mail filter by keywords (Plan 02)
- Agents can now use ClaudeProcessed (or any custom keyword) to avoid reprocessing messages across tool calls

## Self-Check: PASSED

- SUMMARY.md: FOUND
- Commit 2f44dbe (Task 1): FOUND
- Commit 37ec6c5 (Task 2): FOUND

---
*Phase: 11-keyword-flagging*
*Completed: 2026-03-18*
