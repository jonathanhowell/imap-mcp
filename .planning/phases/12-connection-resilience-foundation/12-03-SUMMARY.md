---
phase: 12-connection-resilience-foundation
plan: 03
subsystem: connections
tags: [imap, connections, state-machine, reconnect, jittered-backoff, keepalive, race-guard, listener-cleanup]

requires:
  - phase: 12-connection-resilience-foundation
    provides: error-classifier pure-function module (Plan 12-02 — classifyConnectionError, humanReason)
  - phase: 12-connection-resilience-foundation
    provides: Wave 0 RED scaffolds for CONN-02..CONN-06 (Plan 12-01)
provides:
  - 4-state AccountConnectionStatus union — connecting / connected / reconnecting / suspended (D-01)
  - Unbounded transient-retry loop with full-jitter exponential backoff (D-08 / D-09 — CONN-02)
  - Fatal-verdict fast-path → suspended on attempt 1, no further retries (D-08 / CONN-03)
  - Initial-connect fatal fast-path → suspended without first sleep (RESEARCH Open Question 2)
  - TCP keepalive + 90s socketTimeout on every ImapFlow built (D-13 / CONN-04)
  - Synchronous reconnectInFlight race guard against concurrent close events (D-10 / CONN-05)
  - removeAllListeners() on every discarded ImapFlow before new construction (D-11 / CONN-06)
  - Outer try/catch around runReconnectLoop preventing silent loop death (D-12)
  - Throttled per-attempt logging — attempts 1..3 always-warn, then 5/10/20/40/80/160/… sequence; reset on err.message change (D-14)
  - Internal connectedAt / lastError private fields — Phase 13 groundwork, not surfaced to tools
affects:
  - 12-04 (Plan 04 / Wave 3 must fix the TS errors in connection-manager.ts and list-accounts.ts that surface from the dropped `failed` variant — the intended migration signal)
  - 13 (Phase 13 health surface consumes the internal connectedAt / lastError fields without union-shape revision)
  - 14 (reconnect_account tool reads the suspended state populated by this plan)

tech-stack:
  added: []
  patterns:
    - "4-state discriminated union over a connection state machine — no booleans for status"
    - "Full-jitter exponential backoff `Math.floor(Math.random() * capped)` to prevent retry-storm thundering herds (T-12-10)"
    - "Synchronous boolean race guard written BEFORE any await — bridges EventEmitter / microtask boundary"
    - "Outer try/catch around an indefinitely-running async loop — log-and-leave-state pattern instead of crash-and-recover"
    - "Throttled per-attempt logging with power-of-two cadence + err.message-change reset"

key-files:
  created: []
  modified:
    - src/connections/account-connection.ts
    - tests/connections/account-connection.test.ts

key-decisions:
  - "shouldLogAttempt sequence pinned to 1, 2, 3, 5, 10, 20, 40, 80, 160, 320, ... — the loop doubles from 5 (NOT from 1). Matches CONTEXT.md D-14 text at face value, the resolution from RESEARCH Open Question 1 A3."
  - "buildClient uses a typed intersection `ConstructorParameters<typeof ImapFlow>[0] & { socketOptions?: ... }` rather than `as any` because imapflow 1.2.13's TypeScript declarations omit socketOptions. The runtime constructor accepts it; Plan 12-04's bump to ^1.3.7 drops the intersection."
  - "Initial-connect transient path enters runReconnectLoop directly from connect() (not via a synthetic close event) — keeps the no-first-sleep semantic explicit and avoids racing with the close-handler race guard."
  - "Deliberately did NOT add a `// @ts-expect-error` to silence the connection-manager / list-accounts surface area — Plan 12-04 owns those consumers; leaving the errors red is the documented migration signal."
  - "Removed two obsolete tests from tests/connections/account-connection.test.ts: the deterministic exponential-delay test (incompatible with D-09 full jitter) and the BACKOFF_MAX_ATTEMPTS = 10 → 'failed' test (D-01 removes the variant, D-08 makes retry unbounded). Replaced by Wave-0 scaffolds 'full-jitter backoff …' and 'unbounded transient retry survives 15 consecutive transient failures'."

patterns-established:
  - "4-state-union connection status (drop `failed`, add `suspended` with reason+since)"
  - "Synchronous race guard before async work (D-10 pattern — reusable for any EventEmitter → async-loop bridge)"
  - "Listener cleanup on every reconnect iteration (D-11 — reusable for any EventEmitter that gets discarded across an async cycle)"
  - "Outer try/catch around indefinite async loops (D-12 — surfaces bugs without taking the server down)"

requirements-completed: [CONN-02, CONN-03, CONN-04, CONN-05, CONN-06]

duration: ~50min (across two execution sessions — first executor crashed mid-refactor; this is the recovery summary)
completed: 2026-06-10
---

# Phase 12 Plan 03: AccountConnection Refactor Summary

**Single-file rebuild of `src/connections/account-connection.ts` and its test — 4-state union (drop `failed`, add `suspended`), unbounded jittered retry, fatal fast-path via the Plan 02 classifier, TCP keepalive, race-safe concurrent close, EventEmitter listener cleanup. Five CONN requirements turn green at once; consumers in `connection-manager.ts` and `list-accounts.ts` now fail to typecheck — that is the intended Plan 04 migration signal.**

## Performance

- **Duration:** ~50 min total (first executor crashed mid-execution; continuation finished the commits + docs in ~15 min)
- **Started:** 2026-06-09 (first executor)
- **Completed:** 2026-06-10
- **Tasks:** 1 (single combined refactor — plan task_count=1)
- **Files modified:** 2 (1 source rewrite +267/-104 lines net change; 1 test file rebalanced)

## Accomplishments

- **CONN-02 (unbounded transient retry, jittered backoff)** — `BACKOFF_MAX_ATTEMPTS` constant deleted; loop runs `while (!isShuttingDown)`; backoff formula `Math.floor(Math.random() * min(initial * mult^(attempt-1), cap))` with cap raised 60s → 120s. Wave 0 scaffold `unbounded transient retry survives 15 consecutive transient failures and eventually connects` is GREEN; Wave 0 scaffold `full-jitter backoff produces values in [0, capped) range with mocked Math.random` is GREEN.
- **CONN-03 (fatal → suspended)** — Both `connect()`'s catch (initial connect) and `runReconnectLoop()`'s per-iteration catch consult `classifyConnectionError(err)`. Fatal verdict → status `{ kind: "suspended", reason: humanReason(err), since: new Date() }` and return. Wave 0 scaffold `fatal goes straight to suspended on attempt 1 with no further retries` is GREEN; the suspended.reason is "Authentication failed — fix credentials" (the locked Plan 02 stock string for AUTHENTICATIONFAILED).
- **CONN-04 (TCP keepalive + socketTimeout 90s)** — `buildClient()` now constructs `ImapFlow` with `socketOptions: { keepAlive: true, keepAliveInitialDelay: 60_000 }` and `socketTimeout: 90_000`. Wave 0 scaffold `buildClient applies TCP keepalive` is GREEN.
- **CONN-05 (race-safe concurrent close)** — Synchronous `reconnectInFlight = true` is written BEFORE any await in the `close` handler. Two close events emitted in the same microtask batch construct exactly ONE new ImapFlow. Wave 0 scaffold `concurrent close events trigger exactly one reconnect loop` is GREEN.
- **CONN-06 (EventEmitter listener cleanup)** — `this.currentClient?.removeAllListeners()` is invoked on every loop iteration BEFORE the new `buildClient()`. Wave 0 scaffold `listener cleanup: removeAllListeners is invoked on every discarded client across 5 reconnect failures` is GREEN.
- **D-12 (outer try/catch safety net)** — `runReconnectLoop` body is wrapped in `try { while(...) { ... } } catch (err) { logger.error(...); }`. Logger crashes / classifier exceptions log at `error` and leave status untouched (no false `suspended` transition that would mask a code bug).
- **D-14 (throttled logging)** — Implemented `shouldLogAttempt(attempt)`: always-warn for attempts ≤ 3, plus the geometric sequence `5, 10, 20, 40, 80, 160, …`. Other attempts log at `debug`. Throttle resets if `err.message` differs from the previously-logged value.
- **Phase 13 groundwork** — `private connectedAt: Date | null` and `private lastError: string | null` populated on every connect/reconnect/failure. NOT surfaced to MCP tools in Phase 12; Phase 13's `list_accounts.last_connected_at` / `last_error` reads them directly.
- **All 14 tests in `tests/connections/account-connection.test.ts` GREEN** — the 6 Wave 0 scaffolds + 8 pre-existing tests that survived the refactor.
- **Full suite: 241 passed, 5 failed** — every failure is a Plan 12-04 planned RED scaffold (1 in connection-manager.test.ts — suspended case; 2 in poller.test.ts — skip guard + non-sticky; 1 in startup.test.ts — unhandledRejection; 1 in error-classifier.test.ts — AuthenticationFailure instance, awaiting imapflow ^1.3.7 bump). Zero regressions.

## Task Commits

| Task | Hash | Type | Files |
|------|------|------|-------|
| 1: full account-connection refactor (CONN-02..CONN-06) | `3d78b7f` | refactor | src/connections/account-connection.ts, tests/connections/account-connection.test.ts |
| 1 follow-up: lint fix inherited from Plan 12-01 scaffold | `35d2532` | fix | tests/connections/account-connection.test.ts |

**Plan metadata commit:** to be added by `docs(12-03): complete account-connection refactor plan`.

## Files Created/Modified

- `src/connections/account-connection.ts` (MODIFIED, +267/-104 lines net change) — full rebuild of the state machine, reconnect loop, listener wiring, buildClient socket options, and connect() initial-fast-path. `gracefulClose` and the `sleep` helper preserved verbatim per the plan's instruction.
- `tests/connections/account-connection.test.ts` (MODIFIED, +49/-89 lines net change) — added AuthenticationFailure stub to `vi.mock("imapflow")` (required by the new error-classifier import path; vitest's strict module mock throws on undeclared exports), deleted two obsolete tests (replaced by Wave-0 scaffolds), prefixed one unused parameter to satisfy lint.

## Decisions Made

1. **shouldLogAttempt sequence interpretation** — Pinned to `1, 2, 3, 5, 10, 20, 40, 80, 160, 320, …`. The doubling starts at 5 (not at 1), per CONTEXT.md D-14 read at face value (RESEARCH Open Question 1, A3 resolution). Implementation:
   ```typescript
   function shouldLogAttempt(attempt: number): boolean {
     if (attempt <= 3) return true;
     let n = 5;
     while (n < attempt) n *= 2;
     return n === attempt;
   }
   ```
   This is the exact code recorded by the plan for Plan 04 cross-reference.

2. **buildClient typed intersection over `as any`** — `imapflow@1.2.13`'s `ImapFlowOptions` type omits `socketOptions`, but the runtime constructor accepts it (documented behavior). Used:
   ```typescript
   const options: ConstructorParameters<typeof ImapFlow>[0] & {
     socketOptions?: { keepAlive: boolean; keepAliveInitialDelay: number };
   } = { ... socketOptions: { keepAlive: true, keepAliveInitialDelay: 60_000 } };
   ```
   The intersection is local (not exported), narrow (one optional field), and disappears when Plan 12-04 bumps to `^1.3.7`. Critically avoids `as any`, which would silently swallow any future upstream shape change.

3. **Initial-connect transient enters runReconnectLoop directly (no synthetic close event)** — A simpler alternative would be to call `client.close()` from the initial-connect catch and let the close handler spawn the loop. Rejected: that would race with the synchronous race guard (would need to flip the guard before triggering the close), is slower (extra microtask hop), and makes the "no first sleep" semantic implicit. Direct call is the spec.

4. **No `@ts-expect-error` on consumer files** — `tsc --noEmit` reports 5 errors after this commit:
   - `src/connections/connection-manager.ts(48,33)` — function lacks return on suspended branch
   - `src/connections/connection-manager.ts(62,12)` — comparison with `"failed"` no longer valid
   - `src/connections/connection-manager.ts(63,78)` — `reason` does not exist on `never`
   - `src/tools/list-accounts.ts(35,12)` — comparison with `"failed"` no longer valid
   - `src/tools/list-accounts.ts(36,65)` — `reason` does not exist on `never`

   All five are the intended migration signal for Plan 12-04 (Plan 04 owns both files; the plan's `<files>` explicitly excludes them). Leaving them red is the documented contract.

5. **Removed two obsolete tests** — the deterministic exponential-delay test (1000/2000/4000ms cap progression — incompatible with D-09 full jitter) and the BACKOFF_MAX_ATTEMPTS = 10 → 'failed' test (D-01 removes the `failed` variant, D-08 makes retry unbounded). Both have a comment block in the test file pointing readers at the Wave 0 scaffolds that subsume them. Explicitly preserved deletion over `it.skip` so future readers don't try to revive obsolete assertions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Add `AuthenticationFailure` to vi.mock("imapflow") payload**

- **Found during:** Task 1 (test run after initial refactor)
- **Issue:** The new `account-connection.ts` imports `classifyConnectionError, humanReason` from `./error-classifier.js`. `error-classifier.ts` (Plan 12-02) imports `AuthenticationFailure` from `imapflow` at module load time. Vitest's strict module-mock factory throws `Cannot read properties of undefined (reading 'AuthenticationFailure')` if the property is not listed in the mock's return object. Every test in the file failed with that error before the fix.
- **Fix:** Added a `class MockAuthenticationFailure extends Error {}` stub to the `vi.mock("imapflow")` factory. The classifier's runtime guard `typeof AuthenticationFailure === "function"` evaluates correctly against the stub class; no test in this file constructs an instance, so a stub is sufficient. The error-classifier.test.ts file owns the AuthenticationFailure-instance test.
- **Files modified:** `tests/connections/account-connection.test.ts`
- **Verification:** All 14 tests pass after the fix.
- **Committed in:** `3d78b7f` (Task 1 commit — part of the atomic refactor).

**2. [Rule 1 — Bug] Prefix unused `event` parameter in CONN-06 spy to satisfy lint**

- **Found during:** Task 1 (pre-commit hook ran `eslint --fix` and surfaced one error)
- **Issue:** The Wave-0 CONN-06 listener-cleanup scaffold (inherited from Plan 12-01 commit `0116824`) declared the `removeAllListenersSpy` as `vi.fn((event?: string | symbol) => ...)`. The arg is never used in the spy body, so `@typescript-eslint/no-unused-vars` (allowed pattern `/^_/u`) flagged it. The lint check did not run when 12-01 staged the scaffold (concurrent-staging race meant the file landed under a sibling agent's commit and bypassed the hook), so the error surfaced for the first time when Plan 12-03 re-touched the file.
- **Fix:** Renamed `event` → `_event` (single-character change). No behavior change.
- **Files modified:** `tests/connections/account-connection.test.ts`
- **Verification:** `npx eslint tests/connections/account-connection.test.ts` clean; all 14 tests still pass.
- **Committed in:** `35d2532` (separate follow-up commit so the audit trail attributes the lint nit to the scaffold's original author through the commit message).

---

**Total deviations:** 2 auto-fixed (1 blocking — vitest strict-mock; 1 bug — inherited lint nit). **No architectural changes (Rule 4) were needed.**

## Issues Encountered

### Mid-execution executor crash & continuation

The original Plan 12-03 executor crashed mid-execution AFTER the source rewrite and test cleanup were already on disk but BEFORE any commits were created (no SUMMARY, no STATE update). A continuation executor was spawned with explicit state: "the working tree contains the finished work; review it, commit it, run tests post-commit, write SUMMARY, update tracking files." The continuation completed in ~15 min: review-commit-test-summary-state-roadmap in sequence. The single-task atomic refactor commit (`3d78b7f`) covers the entire production rewrite + test rebalance per the plan's `task_count=1` instruction.

**Detection:** Continuation prompt explicitly stated the crash position and verification commands. `git status --short` showed `M src/connections/account-connection.ts` and `M tests/connections/account-connection.test.ts` with no staged changes — matching the prompt's description.

**Recovery:** Read the plan, verified the in-progress diff against the plan's `<action>` block decision-by-decision (D-01..D-14 + the must_haves block), confirmed 14/14 tests pass against the unstaged file, then committed with the message describing the full multi-decision scope per the plan's commit-message guidance. No destructive operations (`git reset --hard`, `git rm`, `git stash`) — the prohibited-list in `execute-plan.md` is explicit.

**Lint nit not caught at first commit:** The pre-commit hook ran `eslint --fix` and reported the unused-`event` error, but the commit still landed in HEAD with the lint error in the source. Followed up immediately with `35d2532` to fix it.

**Root cause / future work:** Mid-execution crash is a known parallel-agent failure mode; the continuation pattern (read prompt → verify state → resume from documented point) works correctly. No action item.

## Known Stubs

None. The refactor is functionally complete for CONN-02..CONN-06. The internal `connectedAt` / `lastError` fields are NOT stubs — they are real fields populated on every connect/reconnect/failure; they're just not exposed to MCP tools in Phase 12 (Phase 13 reads them through `list_accounts`).

## Deferred Issues

**5 RED scaffolds remain across the full suite** — all owned by Plan 12-04:

1. `tests/connections/connection-manager.test.ts > ConnectionManager suspended state` — Plan 04 updates the manager's switch to handle the new `suspended` variant.
2. `tests/polling/poller.test.ts > skips non-connected accounts` — Plan 04 ships the CONN-07 skip guard.
3. `tests/polling/poller.test.ts > skip is not sticky` — Plan 04 ships the per-cycle re-check.
4. `tests/startup.test.ts > unhandledRejection logs and continues` — Plan 04 ships `src/process-handlers.ts` exporting `installUnhandledRejectionHandler(logger)`.
5. `tests/connections/error-classifier.test.ts > AuthenticationFailure instance` — Plan 04 bumps imapflow `^1.2.13 → ^1.3.7` so the constructor exports at runtime; the existing classifier guard becomes a no-op.

**5 TypeScript errors in `tsc --noEmit`** — listed under Decisions Made #4. All in `connection-manager.ts` and `list-accounts.ts`; all owned by Plan 04. Documented in the SUMMARY for Plan 04 to consume directly as the migration TODO list.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Wave 3 (Plan 12-04 — Consumer wiring + imapflow bump):** Has every input it needs. The 5 RED scaffolds + 5 tsc errors above form Plan 04's complete TODO list. The internal AccountConnection contract (4 status variants, `connectedAt`/`lastError` fields, `gracefulClose` unchanged) is stable.
- **Plan 04 should consume:**
  - `import type { AccountConnectionStatus } from "./account-connection.js"` — switch on `kind` exhaustively across the 4 reachable variants.
  - When poller sees `kind: "reconnecting" | "suspended" | "connecting"` — skip the poll cycle (CONN-07).
  - When `list_accounts` sees `kind: "suspended"` — surface `status.reason`. When `kind: "reconnecting"` — surface `status.lastError` and `status.nextRetryAt`.
- **Phase 13:** can read `private connectedAt` / `private lastError` via a getter on AccountConnection (the fields are wired; just need surface).
- **Phase 14:** `reconnect_account` tool calls `accountConnection.connect()` directly on a suspended account; the existing reconnect machinery handles the rest. No further state-machine work needed.

## Threat Flags

None — the threat model in the plan covered every new surface:

- T-12-06 (auth-failure infinite retry) → mitigated by classifier integration in both initial connect and the loop body. Verified by `fatal goes straight to suspended` test.
- T-12-07 (concurrent close → double loop) → mitigated by `reconnectInFlight` synchronous boolean. Verified by `concurrent close events trigger exactly one reconnect loop` test.
- T-12-08 (MaxListenersExceededWarning leak) → mitigated by `removeAllListeners()`. Verified by `listener cleanup` test.
- T-12-09 (suspended.reason leaks credentials) → mitigated by `humanReason()` from Plan 02 (never echoes `err.message`). Verified by reading Plan 02's stock-string contract; this plan never builds `suspended.reason` from `err.message`.
- T-12-10 (synchronized retry storm) → mitigated by full-jitter `Math.floor(Math.random() * capped)`. Verified by `full-jitter backoff` test.
- T-12-11 (loop dies silently on logger/classifier crash) → mitigated by outer try/catch in `runReconnectLoop`.

No new threat surface introduced beyond what the plan enumerated.

## TDD Gate Compliance

Plan 12-03 frontmatter declares `type: execute` (not `type: tdd`), so the plan-level RED/GREEN/REFACTOR gate sequence does not apply at the plan level. However, **the task IS `tdd="true"`** — the Wave 0 RED scaffolds in `account-connection.test.ts` (shipped by Plan 12-01 commit attributed to `0116824`) are the RED commit; Plan 12-03's `3d78b7f` refactor is the GREEN commit. The sequence is satisfied across plans: RED (Plan 12-01, `test(12-01): ...`) → GREEN (Plan 12-03, `refactor(12-03): ...`). No separate REFACTOR pass was needed — the production code lands clean.

## Self-Check

Verified:

- `src/connections/account-connection.ts` exists and is 351 lines (well above the 200-line `min_lines` floor in the plan's `must_haves`).
- `grep -c 'kind: "suspended"' src/connections/account-connection.ts` → 3 (satisfies `>= 2`).
- `grep -c 'reconnectInFlight' src/connections/account-connection.ts` → 7 (satisfies `>= 3`).
- `grep -c 'removeAllListeners' src/connections/account-connection.ts` → 2 (satisfies `>= 1`).
- `grep -E 'socketOptions.*keepAlive.*true|keepAlive: true' src/connections/account-connection.ts` → matches.
- `grep 'socketTimeout: 90_000' src/connections/account-connection.ts` → matches.
- `grep -cE 'classifyConnectionError|humanReason' src/connections/account-connection.ts` → 7 (satisfies `>= 2`).
- `grep -nE 'BACKOFF_MAX_ATTEMPTS|kind: "failed"' src/connections/account-connection.ts` → 1 hit, in an explanatory comment (`// D-08: BACKOFF_MAX_ATTEMPTS is DELETED. ...`). The code symbol `BACKOFF_MAX_ATTEMPTS` is gone; the union variant `"failed"` is gone. Comment is acceptable per the rule's intent (the rule blocks the SYMBOL in code, not a textual reference in a comment that documents the deletion).
- Commits `3d78b7f` and `35d2532` exist in git log and include the expected files.
- `npx vitest run tests/connections/account-connection.test.ts` → **14 of 14 tests passed**.
- `npm test` (full suite) → **241 passed, 5 failed**; all 5 failures are Plan 12-04's planned RED scaffolds (zero regressions).
- `npx tsc --noEmit` → reports exactly 5 errors, all in `src/connections/connection-manager.ts` and `src/tools/list-accounts.ts` (the intended migration signal — Plan 04 owns both files).
- `npx eslint tests/connections/account-connection.test.ts` → clean.

## Self-Check: PASSED

---
*Phase: 12-connection-resilience-foundation*
*Completed: 2026-06-10*
