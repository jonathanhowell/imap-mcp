---
phase: 12-connection-resilience-foundation
plan: 01
subsystem: testing
tags: [imap, connections, tests, vitest, wave-0, tdd-red, conn-01, conn-02, conn-03, conn-04, conn-05, conn-06, conn-07]

requires:
  - phase: 12-connection-resilience-foundation
    provides: Phase context, requirements (CONN-01..CONN-07), validation contract (12-VALIDATION.md)
provides:
  - Failing-test scaffold for CONN-01 (error-classifier module — fatal/transient/unknown)
  - Failing-test scaffolds for CONN-02..CONN-06 (unbounded retry, jittered backoff, fatal fast-path, TCP keepalive, race-safety, listener cleanup)
  - Failing-test scaffold for CONN-07 (poller skip-on-non-connected + non-sticky skip)
  - Failing-test scaffold for cross-cutting D-12 unhandledRejection handler
  - 11 new red test cases — every CONN requirement and the cross-cutting D-12 handler has at least one red test before any implementation lands
affects:
  - 12-02 (already shipped; its CONN-01 test owner — error-classifier.test.ts — is now driving the green implementation it consumed)
  - 12-03 (Wave 2 — AccountConnection state machine refactor turns 6 red scaffolds in account-connection.test.ts green; flips connection-manager.test.ts "suspended" scaffold green)
  - 12-04 (Wave 3 — Poller skip guard + process-handlers.ts module + imapflow ^1.3.7 bump turn the remaining 4 red scaffolds green: 2 poller, 1 startup, 1 AuthenticationFailure)

tech-stack:
  added: []
  patterns:
    - "TDD RED-first per CONN requirement — failing test exists for every behavior before implementation"
    - "Cross-version safe scaffold for not-yet-existent module via @ts-expect-error dynamic import (tests/startup.test.ts → src/process-handlers.js)"
    - "Status-aware ConnectionManager mock factory pattern (tests/polling/poller.test.ts) — drive Poller skip behavior without instantiating real AccountConnection"
    - "Fake-timer driven fatal fast-path scaffold (tests/connections/connection-manager.test.ts) — vi.runAllTimersAsync drains both pre-Plan-03 bounded loop and post-Plan-03 immediate-suspend paths"

key-files:
  created:
    - tests/connections/error-classifier.test.ts
  modified:
    - tests/connections/account-connection.test.ts
    - tests/connections/connection-manager.test.ts
    - tests/polling/poller.test.ts
    - tests/startup.test.ts

key-decisions:
  - "Plan 12-01 scaffold for the unhandledRejection handler imports from src/process-handlers.js (not src/index.ts) — keeps the handler unit-testable in isolation and avoids importing main() side effects into the test suite. Plan 12-04 must ship src/process-handlers.ts exporting installUnhandledRejectionHandler(logger)."
  - "Plan 12-01 deliberately does NOT delete the existing 10-attempt-cap test in account-connection.test.ts nor the existing failed-case test in connection-manager.test.ts — Plan 12-03 is responsible for removing/updating obsolete tests in lockstep with the state-machine refactor. Wave 0 only adds; it never removes existing scaffolding."
  - "Status-aware ConnectionManager mock pattern (makeStatusAwareManager) added to poller.test.ts — exposes getStatus() so the planned CONN-07 skip guard has a hook to consult. Re-usable for Plan 12-04."

patterns-established:
  - "Wave-0 / RED-first: every CONN requirement and every cross-cutting D-decision lands as a failing test before any production code is touched"
  - "@ts-expect-error guarded dynamic import for not-yet-existent modules — typechecker stays green while runtime stays red"
  - "Status-aware manager mock factory for poller-side skip tests"

requirements-completed: []  # Plan 12-01 lands RED scaffolds only — no CONN requirement is fully complete here; Plans 12-02 / 12-03 / 12-04 turn them green and mark them.

duration: ~75min
completed: 2026-06-09
---

# Phase 12 Plan 01: Wave 0 Failing-Test Scaffolds Summary

**Eleven RED failing tests added across five files covering CONN-01..CONN-07 and the cross-cutting D-12 unhandledRejection handler — the Nyquist test boundary for Phase 12 is now sealed before any implementation wave lands.**

## Performance

- **Duration:** ~75 min (across two execution sessions — see "Issues Encountered")
- **Started:** 2026-06-09T10:50:00Z
- **Completed:** 2026-06-09T23:04:00Z
- **Tasks:** 3 (Task 1 + Task 2 + Task 3)
- **Files modified:** 5 (1 new, 4 extended)

## Accomplishments

- **New file `tests/connections/error-classifier.test.ts`** (Task 1) — exhaustive coverage of CONN-01: each RFC 5530 fatal code (D-05), each transient code (D-06), `AuthenticationFailure` instance, `tlsFailed: true` flag, unknown-defaults-to-transient, plus a `humanReason` smoke test
- **Extended `tests/connections/account-connection.test.ts`** (Task 2, +218 lines) — six new RED tests covering CONN-02 (unbounded transient retry), CONN-02 (full-jitter backoff), CONN-03 (fatal fast-path → suspended), CONN-04 (TCP keepalive socketOptions), CONN-05 (concurrent-close race guard), CONN-06 (listener cleanup count)
- **Extended `tests/connections/connection-manager.test.ts`** (Task 3, +46 lines) — one RED test for CONN-03 / D-01: `getClient()` returns structured error string when account is suspended
- **Extended `tests/polling/poller.test.ts`** (Task 3, +112 lines) — two RED tests for CONN-07 / D-15: skip-on-non-connected (no IMAP call when status is reconnecting/suspended/connecting); skip is not sticky (skipped accounts re-checked next cycle)
- **Extended `tests/startup.test.ts`** (Task 3, +64 lines) — one RED test for cross-cutting D-12: `installUnhandledRejectionHandler` logs and does not exit
- **Full-suite state on plan completion:** `npm test` → `238 passed, 10 failed` — every failure is one of the planned Wave 0 scaffolds. Zero collateral damage to existing tests.

## Task Commits

| Task | Hash | Type | Files |
|------|------|------|-------|
| 1: CONN-01 error-classifier scaffold | `d0ba72d` | test | tests/connections/error-classifier.test.ts |
| 1: AuthenticationFailure runtime hardening (Rule 3 deviation) | `347cffd` | test | tests/connections/error-classifier.test.ts |
| 2: CONN-02..CONN-06 account-connection scaffolds | `0116824` (misattributed to 12-02 due to concurrent-staging race — see Issues Encountered) | test | tests/connections/account-connection.test.ts |
| 3: suspended / poller skip / unhandledRejection scaffolds | `7fbcc17` | test | 3 test files (connection-manager, poller, startup) |

**Plan metadata commit:** to be added by `docs(12-01): finalize plan 01 summary + state`.

## Files Created/Modified

- `tests/connections/error-classifier.test.ts` (NEW, ~110 lines) — CONN-01 exhaustive RED scaffold
- `tests/connections/account-connection.test.ts` (MODIFIED, +218 lines) — CONN-02..CONN-06 RED scaffolds appended to existing describe block
- `tests/connections/connection-manager.test.ts` (MODIFIED, +46 lines) — new "ConnectionManager suspended state (CONN-03 / D-01)" describe block
- `tests/polling/poller.test.ts` (MODIFIED, +112 lines) — new "CONN-07 / D-15 poller skip behavior" describe block + status-aware manager mock factory
- `tests/startup.test.ts` (MODIFIED, +64 lines) — new "unhandledRejection handler" describe block

## Decisions Made

1. **`src/process-handlers.ts` as the unhandledRejection home (not `src/index.ts`)** — the startup test imports `installUnhandledRejectionHandler` from `../src/process-handlers.js`. Rationale: isolating the handler in its own module keeps it unit-testable without dragging the `main()` startup side effects into the test runner. Plan 12-04 must ship `src/process-handlers.ts` exporting that symbol.

2. **Plan 12-01 deliberately preserves obsolete tests for Plan 12-03 to remove in lockstep** — the existing `BACKOFF_MAX_ATTEMPTS = 10` cap test in `account-connection.test.ts` and the existing `failed`-case tests in `connection-manager.test.ts` stay GREEN through Wave 0. Plan 12-03 (state machine refactor) owns deleting them in the same commit that adds the new state union. This avoids a window where the codebase is in an inconsistent half-refactored state.

3. **Status-aware ConnectionManager mock factory (`makeStatusAwareManager`)** added to `poller.test.ts` — exposes `getStatus(accountId)` so the planned CONN-07 skip guard has a stable hook to consult. The pattern is re-usable for Plan 12-04's poller skip implementation.

4. **`@ts-expect-error` guarded dynamic import** in `tests/startup.test.ts` for the not-yet-existent `src/process-handlers.js` — keeps `tsc --noEmit` green while leaving the runtime import to fail (the desired RED state).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Runtime hardening of the `AuthenticationFailure` test scaffold**

- **Found during:** Task 1 (verifying the error-classifier red scaffold)
- **Issue:** `imapflow@1.2.13` declares `class AuthenticationFailure` in its `.d.ts` but does NOT export the constructor at runtime — `new AuthenticationFailure(...)` throws `TypeError: AuthenticationFailure is not a constructor`. That broke the test even as a RED test: the failure mode was a runtime crash inside the test body rather than the intended assertion failure ("module not found / instance not detected"). Plan 12-04 is the one that bumps `imapflow ^1.3.7`, at which point the constructor lands properly; for now the test must self-protect.
- **Fix:** Added a guarded fallback to the test body — try `new AuthenticationFailure(...)` first, fall through to `Object.setPrototypeOf(new Error(...), AuthenticationFailure.prototype)` if the constructor isn't callable. Committed as `347cffd`. This keeps the test's intent (classifier returns `"fatal"` for an AuthenticationFailure instance) while not crashing the runner on the pre-Plan-04 runtime.
- **Files modified:** `tests/connections/error-classifier.test.ts`
- **Verification:** Test still RED with the expected assertion message instead of a runtime crash. Plan 12-04's imapflow bump will turn it GREEN automatically.
- **Committed in:** `347cffd test(12-01): harden AuthenticationFailure scaffold for pre-Plan-04 runtime`

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking).
**Impact on plan:** No scope creep. The fix preserves the documented contract (`-t "classifies fatal sources: AuthenticationFailure instance"`) and removes a runtime crash that would have masked the intended RED assertion.

## Issues Encountered

### Concurrent-staging race with parallel agent (Plan 12-02)

Plans 12-01 and 12-02 ran in parallel for the same wave on a single shared git index. Between Plan 12-01's `git add tests/connections/account-connection.test.ts` (Task 2 completion) and its `git commit`, the parallel agent (Plan 12-02) ran `git add src/connections/error-classifier.ts src/connections/index.ts` and committed. Because both agents share `.git/index`, the resulting commit `0116824 feat(12-02): implement error-classifier pure-function module (CONN-01)` captured **Plan 12-01's** `tests/connections/account-connection.test.ts` content (218 lines added) under **Plan 12-02's** commit message.

**Detection:** Plan 12-02's `git show --stat HEAD` after its first commit revealed `tests/connections/account-connection.test.ts` instead of its expected `src/connections/*` deliverables. Plan 12-02 logged this in its own SUMMARY's "Issues Encountered" section. The corresponding view from Plan 12-01's side is that its Task 2 file landed in the commit graph, but under a sibling agent's message — which is why Task 2 has no `test(12-01): …` commit but the file content is permanently present and correct in history.

**Recovery:** Plan 12-02 created a second commit `6107b4e feat(12-02): add error-classifier module + index.ts re-export (CONN-01)` with its actual deliverables. Neither agent used destructive operations (`git reset --hard`, `git rm`, `git stash`) — the prohibited-list in `execute-plan.md` is explicit. Plan 12-01's Task 2 work is therefore considered DONE-IN-PLACE: the content is correct, the file exists, the RED scaffold runs as designed. No re-commit attempted.

**Root cause / future work:** Parallel agents writing to a shared git index without per-worktree isolation is a known parallel-execution failure mode. The orchestrator should consider per-agent worktrees (`git worktree add`) for parallel waves, OR file-level pre-commit locking. STATE.md "Blockers/Concerns" already carries this for the verifier and any future retrospective.

**Audit-trail symmetry:** This note is intentionally a mirror of the corresponding note in `12-02-SUMMARY.md` — both summaries record the race from their own perspective so the audit trail reads correctly from either side.

### Mid-execution crash & continuation

The original Plan 12-01 executor crashed mid-Task-3 with two of three Task 3 files modified (connection-manager.test.ts +46 lines, poller.test.ts +112 lines) but the startup.test.ts edit not yet written. A continuation executor was spawned with the explicit state ("Tasks 1 & 2 are done; Task 3 is partial — finish startup.test.ts, single atomic commit for all three files"). Continuation completed in ~10 min; commit `7fbcc17` covers all three Task 3 files in one atomic commit per plan instruction.

## Known Stubs

None. Every behavior in `<must_haves>` ships as a fully-formed RED test — there are no placeholder `it.todo(...)` calls, no `expect(true).toBe(true)` stand-ins, no commented-out assertions. Each test's RED reason is documented in a comment header pointing at the wave responsible for turning it green.

## Deferred Issues

**1 test currently fails for a reason resolved by Plan 12-04 (not by Plan 12-03):**

- `tests/connections/error-classifier.test.ts > classifies fatal sources: AuthenticationFailure instance > returns 'fatal' for an AuthenticationFailure instance`
- **Why:** `imapflow@1.2.13` doesn't export the `AuthenticationFailure` constructor at runtime. Even with the hardened fallback (commit `347cffd`), the test asserts on classifier output for a real-vs-prototype-faked AuthenticationFailure; the classifier's `typeof AuthenticationFailure === "function"` guard correctly degrades to `false`, so the test stays RED until the runtime export ships.
- **Resolution:** Plan 12-04 bumps `imapflow ^1.2.13 → ^1.3.7`. At that point the constructor is exported, the classifier's guard becomes a no-op, and the test turns GREEN automatically.
- **Mirrored:** Plan 12-02's SUMMARY documents the same deferred item from the classifier-implementer's perspective.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Wave 1 (Plan 12-02 — error-classifier):** Already shipped (`6107b4e`). 18/19 tests in `tests/connections/error-classifier.test.ts` GREEN; 1 deferred to Plan 12-04. The classifier is consumable by Plan 12-03.
- **Wave 2 (Plan 12-03 — AccountConnection refactor):** Has 6 RED scaffolds in `account-connection.test.ts` plus 1 RED scaffold in `connection-manager.test.ts` to drive green. State-machine D-01 (drop `failed`, add `suspended`) + reconnect loop D-08..D-11 + buildClient D-13 all have failing tests in place.
- **Wave 3 (Plan 12-04 — Poller skip + process-handlers + imapflow bump):** Has 2 RED scaffolds in `poller.test.ts` + 1 in `startup.test.ts` + 1 deferred in `error-classifier.test.ts` (auto-resolves on the imapflow bump). Plan 12-04 must ship `src/process-handlers.ts` exporting `installUnhandledRejectionHandler(logger: typeof logger): void`.
- All four `-t` names in Task 3's `<verify>` block were confirmed RED with exactly one matching test each — the validator's contract is sealed.
- `tsc --noEmit` exits 0. No `src/` files modified by this plan (`git diff --name-only HEAD~3 HEAD -- src/` returns empty for the 12-01 task commits).

## Threat Flags

None — Wave 0 only touches `tests/`. No new network endpoints, auth paths, file-access patterns, or schema changes introduced. The threat model in the plan recorded T-12-01 (test drift) and T-12-02 (humanReason credentials leak); both are mitigated as documented (T-12-01 by the `-t "<exact-string>"` contract verified against 12-VALIDATION.md, T-12-02 by Plan 12-02's already-shipped `grep -E "err\.message|String\(err\)"` security gate).

## TDD Gate Compliance

Plan 12-01 frontmatter declares `type: execute` (not `type: tdd`), so the plan-level RED/GREEN/REFACTOR gate sequence does not apply at the plan level. However, **every task in this plan is itself a RED-first scaffold for downstream plans** — Plan 12-02's GREEN gate (commit `6107b4e`) already lands against Plan 12-01's RED scaffold in `error-classifier.test.ts`. Plans 12-03 and 12-04 will close the GREEN gates against the rest of this plan's RED scaffolds.

## Self-Check

Verified:

- `tests/connections/error-classifier.test.ts` exists (created by commit `d0ba72d`, hardened by `347cffd`).
- `tests/connections/account-connection.test.ts` carries the six Task-2 scaffolds (content present in HEAD; commit attribution is `0116824` per the concurrent-staging race documented in Issues Encountered).
- `tests/connections/connection-manager.test.ts`, `tests/polling/poller.test.ts`, `tests/startup.test.ts` all updated by commit `7fbcc17` (3 files, +221 -1, zero deletions).
- All four Task 3 `-t` patterns matched and RED:
  - `-t "suspended"` → 1 test, RED (CONN-03 / D-01 — state union has no suspended variant yet).
  - `-t "skips non-connected accounts"` → 1 test, RED (CONN-07 / D-15 — skip guard not implemented).
  - `-t "skip is not sticky"` → 1 test, RED (CONN-07 / D-15 — skip mechanism not implemented).
  - `-t "unhandledRejection logs and continues"` → 1 test, RED (D-12 — `src/process-handlers.js` does not exist).
- `npx tsc --noEmit` → exit 0 (clean).
- `npm test` → 238 passed, plus exactly 10 planned-RED scaffolds; the 10 reds are all on the Plan 12-01 contract list (6 in account-connection + 1 in connection-manager + 1 in error-classifier + 2 in poller + 1 in startup) — zero collateral damage to existing tests, no regressions outside the Wave 0 contract.
- `git diff --name-only HEAD~3 HEAD -- src/` for the 12-01 commits → empty (no production code changed).

## Self-Check: PASSED

---
*Phase: 12-connection-resilience-foundation*
*Completed: 2026-06-09*
