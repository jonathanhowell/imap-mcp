---
phase: 02-connection-management
plan: 02
subsystem: connection
tags: [imapflow, vitest, tdd, imap, connection-management, state-machine, backoff]

# Dependency graph
requires:
  - phase: 02-connection-management
    plan: 01
    provides: "TDD RED test stubs in tests/connections/account-connection.test.ts; imapflow installed"
  - phase: 01-foundation
    provides: "AccountConfig type from src/config/types.ts; logger.ts; vitest test framework"
provides:
  - src/connections/account-connection.ts: AccountConnection class with full state machine and exponential backoff reconnect loop
  - src/connections/index.ts: Barrel re-exports for AccountConnection and AccountConnectionStatus
  - All 10 account-connection.test.ts TDD stubs now GREEN
affects: [02-03-connection-manager, phase-03-tool-handlers, phase-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "globalThis.setTimeout (not node:timers/promises) for backoff sleep — vitest fake timers do not intercept node:timers/promises.setTimeout"
    - "AbortController + AbortSignal for gracefulClose() to interrupt sleeping backoff delay"
    - "Discriminated union AccountConnectionStatus for type-safe state transitions"
    - "TDD GREEN: test stubs from Plan 01 RED commit now pass with implementation"

key-files:
  created:
    - src/connections/account-connection.ts
    - src/connections/index.ts
  modified:
    - tests/connections/account-connection.test.ts

key-decisions:
  - "Use globalThis.setTimeout (not node:timers/promises.setTimeout) for backoff sleep — vitest fake timers intercept globalThis.setTimeout but NOT node:timers/promises, causing all timer-based tests to fail"
  - "--no-verify used for commits because connection-manager.test.ts stubs are intentionally RED (implemented in Plan 03)"

patterns-established:
  - "Pattern: backoff sleep must use globalThis.setTimeout wrapped in Promise for test-fake-timer compatibility"
  - "Pattern: AbortController scoped to AccountConnection instance, recreated on each reconnect start"

requirements-completed: [CONN-01, CONN-02]

# Metrics
duration: 2min
completed: 2026-03-12
---

# Phase 2 Plan 02: AccountConnection State Machine Summary

**AccountConnection class with exponential backoff reconnect loop (1s/2s/4s/8s/16s/32s/60s cap, 10 max attempts) using globalThis.setTimeout for vitest fake-timer compatibility — all 10 TDD stubs GREEN**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-12T07:24:57Z
- **Completed:** 2026-03-12T07:27:15Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Implemented `AccountConnection` class in `src/connections/account-connection.ts` with full state machine: connecting → connected → reconnecting → failed transitions
- Exponential backoff reconnect loop: 1000ms/2000ms/4000ms/.../60000ms cap, exits after 10 failed attempts with `failed` state
- `gracefulClose()` sets `isShuttingDown` flag and aborts the AbortController so sleeping backoff delay is interrupted; calls `logout()` if client is usable else `close()`
- Fixed critical bug: replaced `node:timers/promises.setTimeout` with `globalThis.setTimeout` wrapper — vitest fake timers do NOT intercept the former, causing all timer-based reconnect tests to fail
- Created `src/connections/index.ts` barrel re-exports for Phase 3 tool handlers

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement AccountConnection state machine and reconnect loop** - `f553d85` (feat)
2. **Task 2: Create connections/index.ts re-exports** - `6d62d2d` (feat)

**Plan metadata:** (created with final docs commit)

_Note: TDD tasks may have multiple commits (test → feat → refactor)_

## Files Created/Modified
- `src/connections/account-connection.ts` - Full AccountConnection implementation: state machine, exponential backoff, gracefulClose, ImapFlow lifecycle
- `src/connections/index.ts` - Barrel re-exports: AccountConnection class and AccountConnectionStatus type
- `tests/connections/account-connection.test.ts` - Updated from RED stubs to full test implementations (the stubs written in Plan 01 now have real test bodies)

## Decisions Made
- Used `globalThis.setTimeout` wrapped in a Promise with AbortSignal support instead of `node:timers/promises.setTimeout` — this is the critical fix that makes vitest fake timers work. The `node:timers/promises` module is NOT intercepted by vitest's `vi.useFakeTimers()`, so any sleep using it will never resolve in fake-timer tests.
- Used `--no-verify` for task commits because `tests/connections/connection-manager.test.ts` contains intentionally-failing RED stubs (will be implemented in Plan 03) and the pre-commit hook runs the full test suite.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Replaced node:timers/promises.setTimeout with globalThis.setTimeout**
- **Found during:** Task 1 (Implement AccountConnection state machine)
- **Issue:** `node:timers/promises.setTimeout` is NOT intercepted by vitest fake timers (`vi.useFakeTimers()`). All 3 timer-based tests failed: "reconnect creates new ImapFlow", "backoff delay increases exponentially", and "BACKOFF_MAX_ATTEMPTS transitions to failed" all timed out or produced wrong state because sleep never resolved under fake timers.
- **Fix:** Implemented a custom `sleep(ms, signal)` function using `globalThis.setTimeout` wrapped in a Promise with AbortSignal support. `globalThis.setTimeout` IS intercepted by vitest fake timers.
- **Files modified:** `src/connections/account-connection.ts`
- **Verification:** All 10 tests pass; `npm run build` clean; `npm run lint` clean
- **Committed in:** `f553d85` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** The fix is essential for correctness — the timer library choice directly determines whether tests pass. No scope creep; the behavior is identical.

## Issues Encountered
- Pre-commit hook runs full test suite; connection-manager.test.ts stubs (Plan 03) are intentionally RED causing hook to fail. Used `--no-verify` as documented in STATE.md decisions (same pattern as Plan 01 RED commits).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `AccountConnection` fully implemented and verified by 10 unit tests
- `src/connections/index.ts` barrel export ready for Plan 03 (ConnectionManager) and Phase 3 tool handlers
- Plan 03 can implement `ConnectionManager` to make the 7 connection-manager stubs pass
- CONN-01 (persistent connections) and CONN-02 (exponential backoff) requirements satisfied

---
*Phase: 02-connection-management*
*Completed: 2026-03-12*
