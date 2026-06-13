---
phase: 13-health-surface-cache-improvements
plan: 03
subsystem: polling

tags: [poller, cache, lastPolledAt, per-account, freshness, CACHE-01]

# Dependency graph
requires:
  - phase: 12-connection-resilience-foundation
    provides: 4-state union with `connected` discriminator (poller skip guard at pollAccount lines 124-132)
provides:
  - "Per-account `lastPolledAt: Map<string, Date | null>` on Poller (D-11)"
  - "Public `getLastPolledAt(accountId): Date | null` accessor (D-12)"
  - "Per-account seed-vs-incremental decision in pollAccount (D-13)"
  - "Post-merge stamping — `lastPolledAt.set(id, new Date())` runs AFTER `mergeIntoCache` so a thrown searchMessages call leaves the stamp unchanged (Pitfall 2 guard)"
affects:
  - 13-04 (uses `getLastPolledAt` to build `freshness:{}` in get_new_mail; will also delete `isCacheReady()` together with the global cold-cache gate)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-account state on Poller (Map keyed by accountId) supersedes single-global fields — pattern Plan 13-04 follows for the freshness response shape"
    - "Post-success stamping: write metadata only after the destructive side effect (mergeIntoCache) returns — error paths leave state untouched"

key-files:
  created: []
  modified:
    - "src/polling/poller.ts — `lastPollTime: Date | null` → `lastPolledAt: Map<string, Date | null>`, `getLastPolledAt` accessor added, `isCacheReady` rewired to Map (deprecated; Plan 13-04 removes), seed-vs-incremental decision now per-account, post-merge stamp added"
    - "tests/polling/poller.test.ts — 4 private-field injection sites migrated from `[\"lastPollTime\"]` to `[\"lastPolledAt\"]` Map shape (Pitfall 4); Test 11 title updated to `lastPolledAt - 24h`; new `CACHE-01: per-account lastPolledAt` describe block with 5 tests (null-before-poll, Date-after-poll, post-merge stamp guard, skipped-account retention, per-account seed/incremental window)"

key-decisions:
  - "Kept `isCacheReady()` in place but rewired it to scan the new Map — Plan 13-04 removes it atomically with the `handleGetNewMail` gate change so Phase 12 callers don't break mid-wave"
  - "Stamp `this.lastPolledAt.set(accountId, new Date())` is the LAST statement of pollAccount's success path (after `mergeIntoCache`) — Pitfall 2 guard verified by a RED test that mocks `searchMessages` to reject and asserts `getLastPolledAt` stays null"
  - "Seed test uses `mockSearchMessages.mockResolvedValue([])` (not mockResolvedValueOnce) to cover both accounts in one poll cycle — needed because acctA and acctB share the same mock and `mockResolvedValueOnce` only services the first call"

patterns-established:
  - "Per-account Map state on Poller — pattern Plan 13-04 will extend for the `freshness:{}` block"
  - "Pitfall 2 guard test — mock a destructive call to throw and verify metadata stays untouched"

requirements-completed:
  - CACHE-01

# Metrics
duration: 6min
completed: 2026-06-13
---

# Phase 13 Plan 03: Per-account lastPolledAt + getLastPolledAt accessor Summary

**Per-account `lastPolledAt: Map<string, Date | null>` replaces the global `lastPollTime` on Poller, with a public `getLastPolledAt(accountId)` accessor and a post-merge stamping guarantee (Pitfall 2).**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-13T08:38:35Z
- **Completed:** 2026-06-13T08:44:39Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- **CACHE-01 / D-11:** Poller now tracks one `Date | null` per account in `Map<string, Date | null>`. The legacy global `lastPollTime: Date | null` field is gone (`grep -c 'lastPollTime' src/polling/poller.ts` returns 0).
- **D-12:** Public `getLastPolledAt(accountId): Date | null` accessor returns `null` before the account is successfully polled, a `Date` after.
- **D-13:** Per-account seed-vs-incremental decision — `this.lastPolledAt.get(accountId) ?? null` drives the 30-day seed vs `lastPolledAt - 24h` incremental decision per account, not globally.
- **Pitfall 2 guard:** `this.lastPolledAt.set(accountId, new Date())` runs AFTER `this.mergeIntoCache(accountId, headers)` — a thrown `searchMessages` call (caught by `poll()`'s outer try/catch) leaves the stamp unchanged. A dedicated RED test mocks `searchMessages` to reject and asserts `getLastPolledAt` stays `null`.
- **D-11 skipped-account retention:** Accounts whose status is not `connected` retain their prior `lastPolledAt` value across poll cycles — explicit test using a status-aware manager: cycle 1 connected → stamp recorded; cycle 2 flipped to reconnecting → stamp retained (same Date instance).
- **Pitfall 4:** All 4 private-field test injection sites that previously seeded `["lastPollTime"]` migrated to the new `["lastPolledAt"]` Map shape — pre-existing `excludeKeywords` and `removeKeyword` test groups continue to pass.
- **`isCacheReady()` deliberately kept:** Rewired to scan the new Map so the existing `handleGetNewMail` caller in Phase 12 keeps working. Plan 13-04 removes it together with the global cold-cache gate replacement.

## Task Commits

Each task was committed atomically:

1. **Task 1: RED — Failing CACHE-01 tests for per-account lastPolledAt + migrate seed sites** — `d0ff687` (test)
2. **Task 2: GREEN — Replace lastPollTime with per-account lastPolledAt Map + accessor** — `0474625` (feat)

_TDD cycle: Task 1 commits 5 failing tests + 4 migrated seeds. Task 2 implements the source change that turns all 5 tests green and keeps the migrated seeds working._

## Files Created/Modified

- `src/polling/poller.ts` — `lastPollTime: Date | null` removed; `lastPolledAt: Map<string, Date | null>` added; `getLastPolledAt(accountId)` accessor added; `isCacheReady()` rewired to scan the Map (deprecated comment added); seed-vs-incremental decision in `pollAccount` now reads `this.lastPolledAt.get(accountId) ?? null`; new stamping line `this.lastPolledAt.set(accountId, new Date())` added as the LAST statement of the success path (after `mergeIntoCache`).
- `tests/polling/poller.test.ts` — 4 `["lastPollTime"] = new Date()` sites migrated to `["lastPolledAt"] = new Map().set("acct1", new Date())` pattern; Test 11 title changed from `lastPollTime - 24h` to `lastPolledAt - 24h`; new `describe("CACHE-01: per-account lastPolledAt")` block with 5 `it` cases.

## Decisions Made

- **`isCacheReady()` stays for this plan**: Rewired to size-scan the new Map (returns true once any account has a non-null entry). Plan 13-04 removes the method atomically with the `handleGetNewMail` global cold-cache gate replacement — keeping it here avoids breaking Phase 12 callers mid-wave.
- **Seed-vs-incremental test uses `mockResolvedValue([])` (not `mockResolvedValueOnce`)**: The per-account seed test calls `searchMessages` twice (once per account in a single poll cycle). `mockResolvedValueOnce` would only service the first call, leaving the second unstubbed. `mockResolvedValue` services both. Confirmed via the assertion that `mockSearchMessages.mock.calls.length === 2`.
- **Skipped-account-retention test reuses the CONN-07 status-aware manager pattern**: Avoids duplicating the `makeStatusAwareManager` helper from the `CONN-07 / D-15 poller skip behavior` describe block by inlining a small variant that uses a mutable `statuses` record. Same shape, same `getStatus()` mock semantics.

## Deviations from Plan

None — plan executed exactly as written. Each acceptance criterion verified by grep + npm test as specified in the plan's `<verify>` and `<acceptance_criteria>` blocks.

**Total deviations:** 0
**Impact on plan:** None. The plan's read_first, action, verify, and acceptance_criteria steps were sufficient — no Rule 1-3 fixes triggered, no Rule 4 architectural questions.

## Issues Encountered

- **Initial grep returned 1 `lastPollTime` reference in poller.ts** — I had left the literal token in a comment ("The global lastPollTime is gone"). Reworded the comment to "The old global timestamp field is gone" so `grep -c 'lastPollTime' src/polling/poller.ts` correctly returns 0. Pre-commit fix; not tracked as a deviation.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Ready for Plan 13-04 (CACHE-02 + D-14/D-15 freshness block + cold-cache gate replacement).** Plan 13-04 reads `poller.getLastPolledAt(accountId)` to build the per-account `freshness:{}` map in `handleGetNewMail`, and removes both `isCacheReady()` from this file and the global `isCacheReady()` gate from `handleGetNewMail` in the same atomic plan.

**Test baseline for Plan 13-04:** 251 tests passing (246 Phase 12 baseline + 5 new CACHE-01). `tsc --noEmit` clean.

## TDD Gate Compliance

- **RED gate:** `d0ff687` — `test(13-03): add failing CACHE-01 tests for per-account lastPolledAt` (5 new tests fail with `getLastPolledAt is not a function`)
- **GREEN gate:** `0474625` — `feat(13-03): replace global lastPollTime with per-account lastPolledAt Map (CACHE-01)` (all 5 tests pass, full suite 251/251)
- **REFACTOR gate:** Not needed — implementation was already minimal and clean.

## Self-Check: PASSED

- `src/polling/poller.ts` — FOUND
- `tests/polling/poller.test.ts` — FOUND
- `.planning/phases/13-health-surface-cache-improvements/13-03-SUMMARY.md` — FOUND (this file)
- Commit `d0ff687` — verified present in `git log --oneline`
- Commit `0474625` — verified present in `git log --oneline`
- `grep -c 'lastPollTime' src/polling/poller.ts` returns 0
- `grep -c 'lastPollTime' tests/polling/poller.test.ts` returns 0
- `grep -c 'getLastPolledAt' src/polling/poller.ts` returns ≥1
- `grep -c 'CACHE-01: per-account lastPolledAt' tests/polling/poller.test.ts` returns 1
- `npm test` → 251 passed
- `npx tsc --noEmit` → exit 0

---
*Phase: 13-health-surface-cache-improvements*
*Completed: 2026-06-13*
