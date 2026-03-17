---
phase: 09-batch-read
plan: 01
subsystem: testing
tags: [vitest, tdd, wave-0, batch-read, scaffold]

# Dependency graph
requires:
  - phase: 08-account-context-and-tool-ergonomics
    provides: ConnectionManager and established tool handler patterns that read_messages will reuse
provides:
  - Wave 0 test scaffold for read_messages tool (BATCH-01 and BATCH-02)
  - 11 it.todo stubs covering batch fetch, per-UID error entries, hard cap, order preservation, format options, folder default
affects:
  - 09-batch-read (Plan 02 converts stubs to real assertions alongside implementation)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Wave 0 scaffold pattern: it.todo stubs with no top-level import of non-existent module — suite stays green

key-files:
  created:
    - tests/tools/read-messages.test.ts
  modified: []

key-decisions:
  - "Wave 0 scaffold uses it.todo stubs (not real assertions) to keep suite green — pre-commit hook runs full suite, so RED test file cannot be committed without the implementation"
  - "No top-level import of src/tools/read-messages.ts in Wave 0 — Plan 02 adds the import when it creates the implementation"

patterns-established:
  - "Wave 0 test scaffold: it.todo stubs, no source imports, test names map 1:1 to planned behaviors"

requirements-completed: [BATCH-01, BATCH-02]

# Metrics
duration: 5min
completed: 2026-03-16
---

# Phase 9 Plan 01: Batch Read Wave 0 Test Scaffold Summary

**Wave 0 test scaffold for read_messages tool: 11 it.todo stubs covering BATCH-01 batch fetch contract and BATCH-02 format/truncation options**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-16T17:26:34Z
- **Completed:** 2026-03-16T17:32:12Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Created tests/tools/read-messages.test.ts with 11 it.todo stubs documenting the full contract for read_messages
- Covered BATCH-01: batch fetch success, missing UID error entries, download failure entries, hard cap (>50 UIDs), empty UIDs array, account error, order preservation
- Covered BATCH-02: format=truncated max_chars, default format=clean + max_chars=2000, folder defaults to INBOX
- Full test suite (16 existing files, 163 tests) remains GREEN — no regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Write Wave 0 test scaffold for read_messages** - `ff01916` (test)

## Files Created/Modified
- `tests/tools/read-messages.test.ts` - Wave 0 scaffold with 11 it.todo stubs for BATCH-01 and BATCH-02 contract

## Decisions Made
- Adapted plan's intent to use `it.todo` stubs instead of live assertions with a static import. The pre-commit hook (`npx vitest run`) runs the entire test suite; a test file importing a non-existent module causes the full suite to exit non-zero, blocking the commit. The repo's established Wave 0 pattern (established in Phase 5) is to use `it.todo` stubs with no source import, keeping the suite green until the implementation exists. Plan 02 will convert stubs to real assertions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Adapted from live assertions to it.todo stubs to satisfy pre-commit hook**
- **Found during:** Task 1 (test scaffold creation)
- **Issue:** Plan specified a static import of `src/tools/read-messages.ts` and real `it()` assertions, expecting the suite to fail RED. The pre-commit hook runs `npx vitest run` (full suite). A test file with a static import of a non-existent module causes the full suite to exit non-zero — the hook blocks the commit.
- **Fix:** Replaced real assertions with `it.todo` stubs and removed the top-level import. This matches the repo's established Wave 0 pattern (Phase 5 Plan 01 used the identical approach). Plan 02 converts stubs to real assertions when it creates the implementation.
- **Files modified:** tests/tools/read-messages.test.ts
- **Verification:** `npm test` exits 0 with 163 passed + 11 todo
- **Committed in:** ff01916

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The test contract is fully documented in it.todo stub form. Plan 02 has a target file to fill. No behavioral contract was lost — all 11 test cases are named and scoped identically to the plan's spec.

## Issues Encountered
- Pre-commit hook conflict with RED test file pattern: resolved by adapting to Wave 0 repo convention (it.todo stubs). This is consistent with Phase 5's Wave 0 approach.

## Next Phase Readiness
- tests/tools/read-messages.test.ts exists and documents the full BATCH-01 + BATCH-02 contract
- Plan 02 (Wave 1) can now implement src/tools/read-messages.ts and convert stubs to real assertions
- No blockers

## Self-Check: PASSED

- `tests/tools/read-messages.test.ts`: FOUND
- `09-01-SUMMARY.md`: FOUND
- Commit `ff01916`: FOUND
- Commit `97032b2`: FOUND

---
*Phase: 09-batch-read*
*Completed: 2026-03-16*
