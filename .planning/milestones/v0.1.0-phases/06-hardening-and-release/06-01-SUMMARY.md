---
phase: 06-hardening-and-release
plan: "01"
subsystem: api
tags: [imap, mcp, rate-limiting, pagination, security]

# Dependency graph
requires:
  - phase: 03-core-read-operations
    provides: list_messages and search_messages handler layer
  - phase: 04-multi-account-unified-view
    provides: multi-account fan-out pattern (fanOutAccounts)
provides:
  - 200-result hard cap on list_messages (both single and multi-account paths)
  - 200-result hard cap on search_messages (both single and multi-account paths)
  - ESLint argsIgnorePattern for underscore-prefixed unused parameters
affects: [agent consumers, context overflow prevention, SC-1 response size ceiling]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Handler-layer cap: MAX_RESULTS = 200 constant at top of handler before branch fork"
    - "Math.min(param ?? default, MAX_RESULTS) applied before multi/single account dispatch"

key-files:
  created: []
  modified:
    - src/tools/list-messages.ts
    - src/tools/search-messages.ts
    - tests/tools/list-messages.test.ts
    - tests/tools/search-messages.test.ts
    - eslint.config.mjs
    - src/tools/stubs.ts

key-decisions:
  - "200-result cap applied at handler entry point (not service layer) so both account paths inherit the same ceiling"
  - "cappedLimit = Math.min(limit ?? 50, 200) replaces raw limit in all three uses: perAccountLimit, effectiveLimit, and listMessages call"
  - "effectiveMax = Math.min(max_results ?? 50, 200) replaces raw max_results in all three uses across both account paths"
  - "ESLint argsIgnorePattern added for _ prefix to fix pre-existing lint errors in multi-account.test.ts"

patterns-established:
  - "Cap-before-fork: enforce result size limits at handler top before account branch fork so neither path can bypass them"

requirements-completed: []

# Metrics
duration: 2min
completed: 2026-03-14
---

# Phase 6 Plan 01: 200-Result Hard Cap Summary

**Server-side 200-result hard cap enforced at handler entry point in list_messages and search_messages, blocking agent context overflow from large mailboxes**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-14T15:36:12Z
- **Completed:** 2026-03-14T15:38:41Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Added `MAX_RESULTS = 200` constant and `Math.min` guard to `handleListMessages` before the account branch fork
- Added `MAX_RESULTS = 200` constant and `Math.min` guard to `handleSearchMessages` before the account branch fork
- TDD cycle: 4 failing cap tests (RED) then GREEN after implementation; 142 total tests pass
- Fixed pre-existing ESLint errors in multi-account.test.ts by adding `argsIgnorePattern` to ESLint config

## Task Commits

Each task was committed atomically:

1. **Task 1: Add failing cap-enforcement tests** - `0010caa` (test)
2. **Task 2: Implement 200-result cap** - `cd0b09d` (feat)

_TDD: Task 1 committed in RED state with --no-verify; Task 2 turned all cap tests GREEN._

## Files Created/Modified

- `src/tools/list-messages.ts` - Added MAX_RESULTS=200 and cappedLimit before branch fork; used in perAccountLimit, effectiveLimit, and listMessages call
- `src/tools/search-messages.ts` - Added MAX_RESULTS=200 and effectiveMax before branch fork; used in fanOut call and single-account searchMessages call
- `tests/tools/list-messages.test.ts` - Added "200-result hard cap" describe block with 4 test cases (single over-cap, single below-cap, single default, multi over-cap)
- `tests/tools/search-messages.test.ts` - Added "200-result hard cap" describe block with 3 test cases (single over-cap, single below-cap, multi over-cap)
- `eslint.config.mjs` - Added argsIgnorePattern/varsIgnorePattern for _ prefix to @typescript-eslint/no-unused-vars rule
- `src/tools/stubs.ts` - Removed stale per-line eslint-disable comment now handled by config

## Decisions Made

- Cap goes at handler layer (not service) so services stay pure and unmodified — aligns with the established service+handler split pattern.
- `cappedLimit` (not `limit`) passed to `listMessages` service to ensure single-account path respects the cap identically to multi-account.
- Pre-existing lint errors in `multi-account.test.ts` fixed via ESLint config (`argsIgnorePattern`) rather than per-line disables — cleaner convention-based solution.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed pre-existing lint errors blocking `npm run lint` success criterion**
- **Found during:** Task 2 verification (lint check)
- **Issue:** `tests/tools/multi-account.test.ts` had `_client` and `_accountId` unused-vars errors; these were pre-existing but blocked the plan's `npm run lint` success criterion
- **Fix:** Added `argsIgnorePattern: "^_"` and `varsIgnorePattern: "^_"` to `@typescript-eslint/no-unused-vars` rule in `eslint.config.mjs`; removed now-redundant eslint-disable comment in `src/tools/stubs.ts`
- **Files modified:** `eslint.config.mjs`, `src/tools/stubs.ts`
- **Verification:** `npm run lint` exits 0 with no errors or warnings
- **Committed in:** `cd0b09d` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking lint issue)
**Impact on plan:** Required to satisfy the plan's `npm run lint` success criterion. ESLint config change is project-wide improvement standardizing underscore convention.

## Issues Encountered

None — implementation was straightforward. The cap pattern from RESEARCH.md applied cleanly.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 200-result cap is live; agent cannot overflow context by passing large limits
- Both single-account and multi-account paths are guarded
- Ready for 06-02 (next hardening plan)

---
*Phase: 06-hardening-and-release*
*Completed: 2026-03-14*

## Self-Check: PASSED

- FOUND: .planning/phases/06-hardening-and-release/06-01-SUMMARY.md
- FOUND: src/tools/list-messages.ts
- FOUND: src/tools/search-messages.ts
- FOUND commit: 0010caa (test - RED)
- FOUND commit: cd0b09d (feat - GREEN)
- FOUND commit: f9e9422 (docs - metadata)
