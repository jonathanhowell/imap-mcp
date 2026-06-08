---
phase: 09-batch-read
plan: 02
subsystem: api
tags: [imap, mcp-tool, batch, vitest, tdd, wave-1]

# Dependency graph
requires:
  - phase: 09-batch-read-01
    provides: Wave 0 test scaffold (11 it.todo stubs) in tests/tools/read-messages.test.ts
  - phase: 08-account-context-and-tool-ergonomics
    provides: ConnectionManager and established tool handler patterns
provides:
  - src/tools/read-messages.ts — READ_MESSAGES_TOOL definition and handleReadMessages handler
  - 11 real test assertions covering BATCH-01 and BATCH-02 contract
affects:
  - 09-batch-read-03 (Plan 03 registers READ_MESSAGES_TOOL in src/index.ts)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Batch IMAP metadata fetch using client.fetch() with comma-joined UID set — one round-trip for all UIDs
    - Per-UID try/catch around client.download() enabling partial success in batch operations
    - Hard-cap guard evaluated before getClient() or getMailboxLock() to short-circuit without IMAP interaction
    - it.todo Wave 0 stub conversion: write implementation first, then convert stubs to real assertions in same commit

key-files:
  created:
    - src/tools/read-messages.ts
  modified:
    - tests/tools/read-messages.test.ts

key-decisions:
  - "Batch metadata fetch uses client.fetch(uids.join(','), ..., { uid: true }) — one IMAP round-trip via async iterator into a Map<number, any>; body downloads remain sequential per-UID via client.download()"
  - "Hard cap of 50 UIDs returns isError:true before getClient() is called — validated upfront to avoid IMAP interactions for obviously invalid inputs"
  - "Empty uids[] returns isError:false with empty array body without any IMAP call — maps cleanly to zero-iteration result"
  - "Per-UID download errors produce { uid, error } entries with 'download failed:' prefix, allowing partial success without aborting the batch"
  - "ESLint unused-vars rule requires _bodyText (underscore prefix) for unused helper parameters in test factories"

patterns-established:
  - "Batch tool handler: single lock covering all fetches, Map population from async generator, ordered result assembly from requested UIDs"
  - "Wave 1 TDD conversion: create implementation + convert stubs in one atomic commit since pre-commit hook blocks partial states"

requirements-completed: [BATCH-01, BATCH-02]

# Metrics
duration: 8min
completed: 2026-03-16
---

# Phase 9 Plan 02: Batch Read Wave 1 Implementation Summary

**read_messages tool implemented: batch IMAP fetch with one metadata round-trip, per-UID body downloads, partial success error entries, and hard cap of 50 UIDs**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-16T17:34:23Z
- **Completed:** 2026-03-16T17:42:00Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Created src/tools/read-messages.ts with READ_MESSAGES_TOOL definition and handleReadMessages handler
- Converted all 11 it.todo stubs in tests/tools/read-messages.test.ts to real assertions
- All 174 tests pass (163 pre-existing + 11 new); tsc --noEmit exits 0
- Handler delivers: batched metadata fetch, missing-UID error entries, download-failure error entries, order preservation, hard cap, empty-array fast path, format/max_chars options, folder default

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement src/tools/read-messages.ts** - `9f5029c` (feat)

## Files Created/Modified
- `src/tools/read-messages.ts` - READ_MESSAGES_TOOL definition and handleReadMessages handler
- `tests/tools/read-messages.test.ts` - 11 real test assertions (converted from it.todo stubs)

## Decisions Made
- Batch metadata uses `client.fetch(uids.join(","), { uid: true, envelope: true, bodyStructure: true }, { uid: true })` consumed via async iterator into a `Map<number, any>`. This provides one IMAP round-trip for all UIDs rather than N fetchOne calls.
- Hard cap guard placed before `getClient()` — no IMAP interaction occurs for >50 UIDs.
- Per-UID `try/catch` around `client.download()` allows other UIDs to succeed when one download fails; error entry uses `download failed: <message>` prefix matching test expectations.
- Since the pre-commit hook runs the full test suite, implementation and test conversion were done in the same commit (cannot commit a failing test file without the module).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed ESLint unused-vars error in test helper**
- **Found during:** Task 1 (commit attempt)
- **Issue:** Test helper `makeFetchMsg` had a `bodyText` parameter that was never used in the returned object. ESLint `@typescript-eslint/no-unused-vars` flagged this, blocking the pre-commit hook.
- **Fix:** Renamed parameter to `_bodyText` (underscore prefix convention for intentionally unused args).
- **Files modified:** tests/tools/read-messages.test.ts
- **Verification:** Pre-commit hook passed on second attempt; all 174 tests pass.
- **Committed in:** 9f5029c (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Minor ESLint fix, no behavioral change. Plan executed as specified.

## Issues Encountered
- Pre-commit ESLint hook rejected unused `bodyText` parameter in test helper — resolved by prefixing with underscore per the `@typescript-eslint/no-unused-vars` allowed pattern.

## Next Phase Readiness
- src/tools/read-messages.ts is complete and fully tested
- Plan 03 (Wave 2) can now register READ_MESSAGES_TOOL and handleReadMessages in src/index.ts
- No blockers

## Self-Check: PASSED

- `src/tools/read-messages.ts`: FOUND
- `tests/tools/read-messages.test.ts`: FOUND (11 real assertions)
- Commit `9f5029c`: FOUND
- All 174 tests: PASS

---
*Phase: 09-batch-read*
*Completed: 2026-03-16*
