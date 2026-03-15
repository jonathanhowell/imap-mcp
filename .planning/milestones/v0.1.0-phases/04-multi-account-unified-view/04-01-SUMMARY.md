---
phase: 04-multi-account-unified-view
plan: "01"
subsystem: api
tags: [typescript, imap, multi-account, fan-out, promise-allsettled]

# Dependency graph
requires:
  - phase: 03-core-read-operations
    provides: MessageHeader, SearchResultItem, FolderEntry, ToolResult interfaces
  - phase: 02-connection-management
    provides: ConnectionManager.getAccountIds(), getClient() discriminated union
provides:
  - MultiAccountMessageHeader, MultiAccountSearchResultItem, MultiAccountFolderEntry, MultiAccountResult<T> types
  - fanOutAccounts<T> parallel fan-out helper with partial-failure handling
  - safeTime() safe date comparator for multi-account merge sorting
affects:
  - 04-02
  - 04-03
  - 04-04

# Tech tracking
tech-stack:
  added: []
  patterns: [Promise.allSettled fan-out, discriminated union error propagation, account field enrichment via spread]

key-files:
  created:
    - src/tools/multi-account.ts
    - tests/tools/multi-account.test.ts
    - tests/tools/multi-account-types.test.ts
  modified:
    - src/types.ts

key-decisions:
  - "fanOutAccounts returns { results, errors } always (errors is empty Record not undefined) — callers can always iterate errors keys safely"
  - "safeTime uses || 0 not ?? 0 — new Date('').getTime() is NaN which is falsy, making || correct here"
  - "Account field added via spread on each item — preserves original type T fields without mutation"

patterns-established:
  - "fanOutAccounts pattern: parallel Promise.allSettled over accountIds, getClient check before fn call, spread+account field for results, error string capture for rejections"
  - "Multi-account TDD: write type-shape tests in separate test file before implementing types in src/types.ts"

requirements-completed: [ACCT-01, ACCT-02, ACCT-03]

# Metrics
duration: 3min
completed: 2026-03-14
---

# Phase 4 Plan 01: Multi-Account Types and fanOutAccounts Helper Summary

**MultiAccountResult<T> generic types and Promise.allSettled fan-out helper with per-account partial-failure isolation**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-14T10:28:50Z
- **Completed:** 2026-03-14T10:31:54Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added four multi-account type interfaces to src/types.ts (MultiAccountMessageHeader, MultiAccountSearchResultItem, MultiAccountFolderEntry, MultiAccountResult<T>)
- Created fanOutAccounts helper that fans out to all accounts in parallel via Promise.allSettled, collecting both results and per-account errors
- Created safeTime safe date comparator (returns 0 for NaN/empty, not NaN) for merge sorting across accounts
- 11 new unit tests covering success, partial failure (getClient error), partial failure (fn throw), all-fail, and safeTime edge cases

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: multi-account type tests** - `7b443ef` (test)
2. **Task 1 GREEN: multi-account interfaces** - `a3d11e8` (feat)
3. **Task 2 RED: fanOutAccounts tests** - `05ce2dd` (test)
4. **Task 2 GREEN: fanOutAccounts implementation** - `54821cc` (feat)

_Note: TDD tasks have multiple commits (test → feat)_

## Files Created/Modified
- `src/types.ts` - Added MultiAccountMessageHeader, MultiAccountSearchResultItem, MultiAccountFolderEntry, MultiAccountResult<T> after existing ToolResult
- `src/tools/multi-account.ts` - Created with fanOutAccounts<T> and safeTime exports
- `tests/tools/multi-account-types.test.ts` - Type shape tests for all four interfaces
- `tests/tools/multi-account.test.ts` - Unit tests for fanOutAccounts and safeTime

## Decisions Made
- fanOutAccounts returns errors as `Record<string, string>` (always present, never undefined) so callers can safely iterate without null guard
- safeTime uses `|| 0` not `?? 0` because `new Date('').getTime()` returns NaN which is falsy, making `||` the correct nullish-or-falsy guard
- Account field added via object spread `{ ...item, account: accountId }` to preserve T shape without mutation

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- fanOutAccounts and multi-account types are ready for use by 04-02 (list_messages), 04-03 (list_folders), and 04-04 (search_messages) handlers
- No blockers

---
*Phase: 04-multi-account-unified-view*
*Completed: 2026-03-14*

## Self-Check: PASSED

- FOUND: src/types.ts
- FOUND: src/tools/multi-account.ts
- FOUND: tests/tools/multi-account.test.ts
- FOUND: tests/tools/multi-account-types.test.ts
- FOUND commit: 7b443ef (test RED - type tests)
- FOUND commit: a3d11e8 (feat GREEN - types)
- FOUND commit: 05ce2dd (test RED - fanOutAccounts tests)
- FOUND commit: 54821cc (feat GREEN - fanOutAccounts)
