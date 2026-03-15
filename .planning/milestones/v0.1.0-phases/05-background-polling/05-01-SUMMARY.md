---
phase: 05-background-polling
plan: 01
subsystem: testing
tags: [vitest, tdd, wave-0, polling, scaffold]

# Dependency graph
requires:
  - phase: 04-multi-account-unified-view
    provides: MultiAccountMessageHeader and MultiAccountResult types that the new tests reference in comments/docs
provides:
  - Wave 0 test scaffolds for Poller and get_new_mail handler (POLL-01, POLL-02, POLL-03)
  - 15 it.todo stubs for Poller covering constructor, start/stop, isCacheReady, cache population, and query
  - 10 it.todo stubs for handleGetNewMail covering cold cache, since filtering, account scoping, and response shape
affects:
  - 05-background-polling (Wave 1+ plans use these files as their verify targets)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Wave 0 scaffold pattern: create test files with it.todo stubs before implementation exists so suite is always green

key-files:
  created:
    - tests/polling/poller.test.ts
    - tests/tools/get-new-mail.test.ts
  modified: []

key-decisions:
  - "Wave 0 scaffolds use it.todo stubs (not it.skip) so Vitest reports pending count without any failures"
  - "No top-level import of non-existent source files — avoids compile errors while preserving test intent"

patterns-established:
  - "Wave 0 test scaffold: it.todo stubs with comment header, no source imports, vitest describes match planned interface"

requirements-completed: [POLL-01, POLL-02, POLL-03]

# Metrics
duration: 5min
completed: 2026-03-14
---

# Phase 5 Plan 01: Background Polling Test Scaffolds Summary

**Wave 0 it.todo test scaffolds for Poller class (15 stubs) and get_new_mail handler (10 stubs) — no source imports, full suite green**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-14T13:32:56Z
- **Completed:** 2026-03-14T13:38:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created `tests/polling/poller.test.ts` with 15 it.todo stubs covering all Poller behaviors (POLL-01, POLL-02)
- Created `tests/tools/get-new-mail.test.ts` with 10 it.todo stubs covering all get_new_mail handler behaviors (POLL-03)
- Full test suite remains green: 13 passed, 2 skipped (scaffold files), 0 failures

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Poller test scaffold** - `cfb4c60` (test)
2. **Task 2: Create get_new_mail handler test scaffold** - `1519280` (test)

## Files Created/Modified

- `tests/polling/poller.test.ts` - Wave 0 scaffold for Poller class with 15 it.todo stubs (constructor, start/stop, isCacheReady, cache population, query)
- `tests/tools/get-new-mail.test.ts` - Wave 0 scaffold for handleGetNewMail with 10 it.todo stubs (cold cache, since filtering, account scoping, response shape)

## Decisions Made

- Used `it.todo` over `it.skip` — Vitest reports todo count separately and does not count them as failures or skipped tests requiring skip reasons
- No top-level imports from non-existent source files — avoids TypeScript compile errors while preserving intent in stub descriptions

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Wave 0 scaffolds in place; Wave 1 implementation tasks (Poller constructor + start/stop) can now use `npm test -- tests/polling/poller.test.ts` as their verify command
- Tests will transition from todo to real assertions as `src/polling/poller.ts` and `src/tools/get-new-mail.ts` are implemented

---
*Phase: 05-background-polling*
*Completed: 2026-03-14*

## Self-Check: PASSED

- FOUND: tests/polling/poller.test.ts
- FOUND: tests/tools/get-new-mail.test.ts
- FOUND: .planning/phases/05-background-polling/05-01-SUMMARY.md
- FOUND commit: cfb4c60 (Task 1)
- FOUND commit: 1519280 (Task 2)
- FOUND commit: d34e618 (metadata)
