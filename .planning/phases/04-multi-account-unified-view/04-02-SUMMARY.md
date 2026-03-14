---
phase: 04-multi-account-unified-view
plan: "02"
subsystem: api
tags: [imap, multi-account, fan-out, list-messages, list-folders, typescript]

# Dependency graph
requires:
  - phase: 04-multi-account-unified-view
    provides: fanOutAccounts utility, safeTime helper, MultiAccount types in src/types.ts

provides:
  - handleListMessages fan-out branch: account-optional, merged {results,errors?} wrapper
  - handleListFolders fan-out branch: account-optional, alphabetically merged {results,errors?} wrapper
  - Multi-account test coverage for both list tools

affects:
  - 04-multi-account-unified-view (remaining plans building on list tool contracts)
  - Any downstream agent workflows using list_messages or list_folders without account

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Multi-account branch: if (account === undefined) fan-out else single-account path"
    - "Per-account over-fetch: pass (limit+offset) per account to guarantee global top-N"
    - "Merge then sort then slice: fanOut → sort by comparator → slice(offset, offset+limit)"
    - "Conditional errors spread: ...(Object.keys(errors).length > 0 ? { errors } : {})"

key-files:
  created: []
  modified:
    - src/tools/list-messages.ts
    - src/tools/list-folders.ts
    - tests/tools/list-messages.test.ts
    - tests/tools/list-folders.test.ts

key-decisions:
  - "list_messages multi-account sort: safeTime descending (newest-first), consistent with single-account default"
  - "list_folders multi-account sort: localeCompare alphabetical (stable, deterministic for folder names)"
  - "Per-account limit = (limit ?? 50) + (offset ?? 0) ensures correct global pagination after merge"
  - "errors key omitted from multi-account response when empty — callers check if (response.errors)"

patterns-established:
  - "Optional account param pattern: ListMessagesParams.account?: string with required: ['folder'] in inputSchema"
  - "All-fail detection: results.length === 0 && Object.keys(errors).length === accountIds.length"

requirements-completed: [ACCT-01, ACCT-02, ACCT-03]

# Metrics
duration: 3min
completed: 2026-03-14
---

# Phase 4 Plan 02: Multi-account fan-out for list_messages and list_folders Summary

**list_messages and list_folders both support optional account param, fanning out to all accounts via fanOutAccounts and returning merged {results,errors?} wrappers when account is omitted**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-14T10:33:32Z
- **Completed:** 2026-03-14T10:36:49Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added multi-account fan-out branch to handleListMessages — account param now optional, merged results sorted newest-first with per-account over-fetch for correct pagination
- Added multi-account fan-out branch to handleListFolders — account param now optional, merged results sorted alphabetically by folder name
- 9 new multi-account test cases across both tools, all single-account tests remain green (111 total passing)

## Task Commits

Each task was committed atomically with TDD RED/GREEN pattern:

1. **Task 1: RED — list_messages multi-account tests** - `c50a593` (test)
2. **Task 1: GREEN — handleListMessages fan-out implementation** - `1ccf1c8` (feat)
3. **Task 2: RED — list_folders multi-account tests** - `c97af12` (test)
4. **Task 2: GREEN — handleListFolders fan-out implementation** - `a078250` (feat)

_Note: TDD tasks committed as RED (failing test) then GREEN (passing implementation)_

## Files Created/Modified
- `src/tools/list-messages.ts` - account param made optional; multi-account branch added before single-account path; inputSchema required changed to ["folder"]
- `src/tools/list-folders.ts` - account param made optional; multi-account branch added before single-account path; inputSchema required changed to []
- `tests/tools/list-messages.test.ts` - 5 new multi-account test cases: two-succeed, unified-INBOX-unread, one-fail, all-fail, pagination
- `tests/tools/list-folders.test.ts` - 4 new multi-account test cases: two-succeed, one-fail, all-fail, single-account-unchanged

## Decisions Made
- list_messages multi-account sort uses safeTime descending (newest-first), consistent with single-account default sort behavior
- list_folders multi-account sort uses localeCompare alphabetical — deterministic ordering for cross-account folder lists
- Per-account limit is `(limit ?? 50) + (offset ?? 0)` to ensure the global top-N by date are captured before the final merge+slice
- errors key omitted from response when empty — clean agent response without empty error objects

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None — implementation followed plan specification without incident. TypeScript compiled clean on first attempt.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ACCT-01, ACCT-02, ACCT-03 requirements satisfied by list_messages and list_folders multi-account support
- fanOutAccounts pattern fully proven across three tools (search_messages from plan 03, list_messages and list_folders from this plan)
- Phase 4 plan 03 (search_messages multi-account) may already be complete based on commit history

---
*Phase: 04-multi-account-unified-view*
*Completed: 2026-03-14*
