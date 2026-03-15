---
phase: 05-background-polling
plan: "02"
subsystem: polling
tags: [imap, background-polling, in-memory-cache, vitest, zod, typescript]

# Dependency graph
requires:
  - phase: 05-01
    provides: Wave 0 test scaffolds and Poller interface stub
  - phase: 04-multi-account-unified-view
    provides: MultiAccountMessageHeader and MultiAccountResult types
  - phase: 02-connection-management
    provides: ConnectionManager with getAccountIds/getClient API
  - phase: 03-core-read-operations
    provides: searchMessages service

provides:
  - AppConfigSchema extended with optional polling.interval_seconds (positive int)
  - Poller class: start/stop, background polling loop, in-memory header cache
  - isCacheReady() lifecycle signal for the handler layer
  - query(since, account?) returning filtered+sorted MultiAccountMessageHeader[]
  - 17 passing unit tests replacing Wave 0 stubs

affects:
  - 05-03 (get_new_mail handler uses Poller.isCacheReady and Poller.query)
  - 05-04 (wiring Poller into src/index.ts startup)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Recursive globalThis.setTimeout loop (not setInterval, not node:timers/promises) for fake-timer testability
    - Poll-then-schedule pattern: await poll(), then if (!stopped) schedule next — stop() is side-effect-free flag
    - UID-based deduplication: Set<uid> per account, append-only cache
    - Incremental poll uses lastPollTime - 24h for IMAP SEARCH SINCE day-granularity
    - TDD fake timer pattern: vi.advanceTimersByTimeAsync(0) flushes microtasks without advancing time, avoiding infinite timer loops

key-files:
  created:
    - src/polling/poller.ts
    - tests/polling/poller.test.ts
  modified:
    - src/config/schema.ts

key-decisions:
  - "Poller.stop() sets a flag only — poll in progress always completes; setTimeout not scheduled after current poll"
  - "runOnePoll test helper uses advanceTimersByTimeAsync(0) + poller.stop() to flush one cycle without infinite loop"
  - "vi.runAllTimersAsync() avoided for start-then-check tests; use advanceTimersByTimeAsync(0) to drain microtasks only"
  - "mockSearchMessages.mockReset() required in beforeEach — mockResolvedValue() alone does not reset call counts"
  - "Seed poll: 30 days lookback, maxResults 1000; incremental: lastPollTime-24h, maxResults 100"

patterns-established:
  - "Poller pattern: constructor injection of ConnectionManager, no direct IMAP in Poller tests"
  - "Fake timer TDD: useFakeTimers + advanceTimersByTimeAsync(0) for async polling loop tests"

requirements-completed: [POLL-01, POLL-02]

# Metrics
duration: 7min
completed: 2026-03-14
---

# Phase 5 Plan 02: Background Polling — Poller Class Summary

**Poller class with recursive setTimeout loop, per-account UID-deduplicated cache, and incremental IMAP polling; AppConfigSchema extended with polling.interval_seconds validation**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-03-14T13:33:12Z
- **Completed:** 2026-03-14T13:40:30Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Extended AppConfigSchema with `polling: { interval_seconds?: positiveInt }` — rejects 0 and negative, accepts omitted field or empty object
- Implemented Poller class: `start()`, `stop()`, `isCacheReady()`, `query()`, private `runLoop()`, `poll()`, `pollAccount()`, `mergeIntoCache()`
- Replaced all Wave 0 `it.todo` stubs with 17 passing tests covering every Poller behavior

## Task Commits

Each task was committed atomically:

1. **RED (test stubs):** `d6183ff` — test(05-02): add failing tests (--no-verify, RED state)
2. **Task 1: Extend AppConfigSchema** — `c7a07a8` feat(05-02): extend AppConfigSchema with optional polling field
3. **Task 2: Implement Poller class** — `cb9ea93` feat(05-02): implement Poller class with background polling loop and cache

_Note: TDD tasks have RED commit (--no-verify) + GREEN commit pattern per project convention_

## Files Created/Modified

- `src/config/schema.ts` — Added `polling: z.object({ interval_seconds: z.number().int().positive().optional() }).optional()`
- `src/polling/poller.ts` — Full Poller implementation (was stub: `throw new Error("Not implemented")`)
- `tests/polling/poller.test.ts` — 17 real tests replacing Wave 0 `it.todo` stubs

## Decisions Made

- **Recursive setTimeout vs setInterval:** Uses `globalThis.setTimeout(() => void this.runLoop(), interval)` after poll completes — required by project convention for vitest fake timer compatibility
- **stop() is a non-blocking flag:** Current poll always completes; setTimeout is simply not scheduled after the poll finishes checking the flag
- **Test fake timer strategy:** `vi.advanceTimersByTimeAsync(0)` flushes promise microtasks without advancing time — prevents the infinite timer loop that `vi.runAllTimersAsync()` would cause with a recursive polling loop
- **mockReset() in beforeEach:** Required to reset call counts between tests; `mockResolvedValue` alone does not clear prior call records
- **Seed vs incremental:** Seed poll goes back 30 days (startup cold start); incremental uses `lastPollTime - 24h` to handle IMAP SEARCH SINCE day-granularity per RFC 3501

## Deviations from Plan

None — plan executed exactly as written, aside from test helper design discovered during TDD green phase (fake timer strategy for recursive loop).

## Issues Encountered

- `vi.runAllTimersAsync()` creates infinite loop with recursive setTimeout pattern — resolved by switching to `vi.advanceTimersByTimeAsync(0)` which flushes only pending promise microtasks without advancing fake time. This is a vitest-specific constraint for polling loop tests.

## Next Phase Readiness

- Poller class is complete and fully tested — Plan 05-03 (get_new_mail handler) can use `Poller.isCacheReady()` and `Poller.query()` as designed
- Plan 05-04 (wiring into src/index.ts) can construct and start the Poller using `config.polling?.interval_seconds`
- No blockers

---
*Phase: 05-background-polling*
*Completed: 2026-03-14*

## Self-Check: PASSED

- FOUND: src/config/schema.ts
- FOUND: src/polling/poller.ts
- FOUND: tests/polling/poller.test.ts
- FOUND: .planning/phases/05-background-polling/05-02-SUMMARY.md
- FOUND: commit c7a07a8 (feat(05-02): extend AppConfigSchema)
- FOUND: commit cb9ea93 (feat(05-02): implement Poller class)
- All 135 tests pass (npm test)
