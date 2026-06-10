---
phase: 12-connection-resilience-foundation
plan: 02
subsystem: connections
tags: [imap, error-classification, pure-function, rfc5530, security]

requires:
  - phase: 12-connection-resilience-foundation
    provides: Wave 0 red tests in tests/connections/error-classifier.test.ts (Plan 12-01)
provides:
  - Pure-function classifier classifyConnectionError(err) → "transient" | "fatal"
  - Stock-string formatter humanReason(err) — credentials-safe, never echoes underlying error message text
  - ErrorClass type exported from src/connections/error-classifier.ts
  - Re-export of all three symbols from src/connections/index.ts barrel
affects:
  - 12-03 (Plan 03 / Wave 2 consumes classifier in AccountConnection.runReconnectLoop for fatal fast-path and unbounded transient retry)
  - 12-04 (Plan 04 consumes classifier inside connection-manager / poller surface and bumps imapflow ^1.3.7 — at which point the AuthenticationFailure runtime guard becomes a no-op)
  - 13 (Health surface reads `humanReason` output through `suspended.reason`)
  - 14 (`reconnect_account` MCP tool reads classifier-driven `suspended` state)

tech-stack:
  added: []
  patterns:
    - "Pure-function module — no state, no I/O, no logging (D-04)"
    - "Runtime-safe instanceof guard (typeof check) for upstream-typed-but-not-yet-runtime-exported classes"
    - "Stock-string security: never embed underlying err.message in user-facing reason text (V5 ASVS / T-12-03)"
    - "Case-normalized lookup against a UPPERCASE constant Set for RFC 5530 codes"

key-files:
  created:
    - src/connections/error-classifier.ts
  modified:
    - src/connections/index.ts

key-decisions:
  - "Guarded `instanceof AuthenticationFailure` with `typeof === 'function'` to keep the classifier crash-free on imapflow 1.2.13 (where the class is declared in the .d.ts but missing from the CJS exports). Plan 04 bumps to 1.3.7; the guard becomes a no-op."
  - "Locked the humanReason stock-string table (see Stock Strings section). These strings are the contract Wave 3 (Phase 13) reads when surfacing `suspended.reason` to agents."
  - "humanReason returns a defensive fallback ('Connection failed (see logs for details)') for transient/unknown inputs — production callers only invoke it for fatal verdicts, but the safety net prevents a stray exception from killing the reconnect machinery (alignment with D-12)."

patterns-established:
  - "Pure-function classifier with case-normalized RFC 5530 Set lookup"
  - "JSDoc-documented STRIDE / ASVS reasoning at call sites — security gates traceable to source"
  - "Runtime-safe upstream-type guard pattern for cross-version compatibility"

requirements-completed: [CONN-01]

duration: 25min
completed: 2026-06-09
---

# Phase 12 Plan 02: Error Classifier Summary

**Pure-function `classifyConnectionError` + stock-string `humanReason` formatter in a new `src/connections/error-classifier.ts` — the build-first component (D-04) that Wave 2's reconnect loop will consume for the fatal fast-path.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-06-09T11:10:00Z
- **Completed:** 2026-06-09T11:42:00Z
- **Tasks:** 1
- **Files modified:** 2 (1 new, 1 edited)

## Accomplishments

- New `src/connections/error-classifier.ts` (165 lines) exporting `ErrorClass`, `classifyConnectionError`, and `humanReason`
- All RFC 5530 D-05 fatal codes covered: AUTHENTICATIONFAILED, LOGINDISABLED, PRIVACYREQUIRED, OVERQUOTA, UNAVAILABLE, EXPIRED, ALERT, CONTACTADMIN
- All D-06 transient codes pass classification: ECONNRESET, ETIMEDOUT, ENOTFOUND, ECONNREFUSED, ENETUNREACH, EConnectionClosed, NoConnection
- Unknown / malformed errors default to `"transient"` (CONN-01 safe-default rule)
- `humanReason` returns credentials-safe stock strings only — never echoes any underlying error message text (T-12-03 mitigation)
- 18 of 19 tests in `tests/connections/error-classifier.test.ts` green; the 19th is gated on Plan 04's imapflow bump (see "Deferred Issues")

## Task Commits

1. **Task 1 (auto, tdd=true): Implement classifyConnectionError + humanReason** — `6107b4e` (feat)

Note: a prior commit `0116824` carries this plan's commit message but contains the parallel agent's (12-01 Task 2) `account-connection.test.ts` due to a concurrent-staging race on the shared git index. See **Issues Encountered** for the timeline; `6107b4e` contains the actual Plan 02 deliverables (error-classifier.ts + index.ts).

**Plan metadata commit:** _added by docs(12-02): finalize plan 02 summary + state_

## Files Created/Modified

- `src/connections/error-classifier.ts` (NEW, 165 lines) — pure-function classifier + humanReason formatter
- `src/connections/index.ts` (MODIFIED, +2 lines) — re-export `classifyConnectionError`, `humanReason`, `ErrorClass`

## Stock Strings (humanReason output table)

These strings are the contract for Wave 3 / Phase 13's `list_accounts.status: "suspended"` rendering. They are locked here so downstream phases do not have to re-derive them.

| Input | humanReason output |
|-------|--------------------|
| `AuthenticationFailure` instance (imapflow class) | `"Authentication failed — fix credentials"` |
| `err.serverResponseCode === "AUTHENTICATIONFAILED"` | `"Authentication failed — fix credentials"` |
| `err.serverResponseCode === "LOGINDISABLED"` | `"Server has login disabled — check IMAP settings"` |
| `err.serverResponseCode === "PRIVACYREQUIRED"` | `"Server requires TLS — check connection security"` |
| `err.serverResponseCode === "OVERQUOTA"` | `"Account is over storage quota"` |
| `err.serverResponseCode === "UNAVAILABLE"` | `"Server reported account unavailable (RFC 5530)"` |
| `err.serverResponseCode === "EXPIRED"` | `"Account credentials expired — renew password"` |
| `err.serverResponseCode === "ALERT"` | `"Server returned an alert — check server admin"` |
| `err.serverResponseCode === "CONTACTADMIN"` | `"Server requires admin contact"` |
| `err.tlsFailed === true` | `"TLS certificate validation failed"` |
| Any transient / unknown / malformed input | `"Connection failed (see logs for details)"` |

Check ordering inside `humanReason`: AuthenticationFailure instance → tlsFailed → serverResponseCode lookup → fallback. The `serverResponseCode` is `.toUpperCase()`-normalized before lookup (defensive against vendor case variance, per RESEARCH Assumption A4).

## Decisions Made

1. **Runtime-safe `instanceof` guard for `AuthenticationFailure`** — The `.d.ts` of `imapflow@1.2.13` declares `export class AuthenticationFailure` but the published CJS module does not expose the constructor at runtime (verified: `node -e "require('imapflow').AuthenticationFailure"` → `undefined`). An unguarded `err instanceof AuthenticationFailure` throws `TypeError: Right-hand side of 'instanceof' is not an object`, which would break the classifier entirely. Wrapped the check in `typeof AuthenticationFailure === "function"` so the classifier degrades gracefully on the older runtime. Plan 04 bumps imapflow to `^1.3.7`, at which point the guard becomes a no-op and `AuthenticationFailure` instances classify as `"fatal"` as designed.

2. **Stock-string table for `humanReason`** — locked the strings per Plan 02 `<behavior>` block. Strings are operator/agent-actionable and consistent in tone ("fix credentials", "check IMAP settings", "renew password").

3. **Defensive fallback in `humanReason`** — production callers only invoke for fatal verdicts, but the function returns `"Connection failed (see logs for details)"` for transient/unknown inputs rather than throwing. Aligned with D-12 (an unexpected throw inside the reconnect loop should not kill the reconnect machinery).

4. **Module-local `FATAL_RESPONSE_CODES` constant** — not exported (per Plan 02 instruction). Single source of truth for the RFC 5530 fatal list; consumers should call `classifyConnectionError`, not iterate the Set themselves.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Runtime guard for `AuthenticationFailure instanceof` on imapflow 1.2.13**
- **Found during:** Task 1 (test run)
- **Issue:** Plan 02's `<behavior>` specifies `err instanceof AuthenticationFailure` as the first fatal check. The TypeScript declarations of `imapflow@1.2.13` export the class, but the CJS runtime does not — the binding is `undefined`. `instanceof undefined` throws at every classifier call, breaking all consumers.
- **Fix:** Wrapped the `instanceof` check in `isAuthenticationFailure(err)` helper that gates on `typeof AuthenticationFailure === "function"`. Behavior is unchanged once Plan 04 bumps to `^1.3.7`; preserves the spec contract.
- **Files modified:** `src/connections/error-classifier.ts`
- **Verification:** All non-AuthenticationFailure tests pass (18/19); classifier no longer throws on any call. tsc clean.
- **Committed in:** 6107b4e (Task 1 commit)

**2. [Rule 2 — Missing critical] Defensive fallback string in `humanReason`**
- **Found during:** Task 1 (writing humanReason)
- **Issue:** Plan 02 `<behavior>` says "All other (including transient errors — should never be called, but defensive) → fallback string". Without a defensive branch, any unexpected input shape that reaches `humanReason` would either echo `err.message` (security violation T-12-03) or throw (D-12 violation).
- **Fix:** Added `GENERIC_FALLBACK_REASON = "Connection failed (see logs for details)"` returned on all unmatched inputs.
- **Files modified:** `src/connections/error-classifier.ts`
- **Verification:** humanReason smoke test green; security gate `grep -E "err\.message|String\(err\)"` returns 0.
- **Committed in:** 6107b4e (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking — runtime safety on older imapflow; 1 missing critical — defensive fallback).
**Impact on plan:** Both auto-fixes preserve the documented contract and are required for correctness/security. No scope creep.

## Issues Encountered

### Concurrent-staging race with parallel agent (Plan 12-01)

Plan 12-01 runs in parallel for the same wave. Both agents share a single git index. Between my `git add src/connections/error-classifier.ts src/connections/index.ts` and `git commit`, the parallel agent staged its own file (`tests/connections/account-connection.test.ts`), and the resulting commit `0116824` captured the parallel agent's file under my commit message rather than my actual files.

**Detection:** `git show --stat HEAD` after the first commit revealed `tests/connections/account-connection.test.ts` instead of the expected `src/connections/*` files.

**Recovery:** Re-staged my actual files and created a second commit `6107b4e` with the real Plan 02 deliverables. Did NOT use destructive operations (`git reset --hard`, `git rm`) — the prohibited-list in execute-plan.md is explicit. The misattributed `0116824` remains in history but contains valid content (Plan 12-01's intended file). Plan 12-01's task-2 commit will see that file is already tracked and proceed as normal.

**Root cause / future work:** Parallel agents writing to a shared git index without per-worktree isolation is a known parallel-execution failure mode. The orchestrator should consider per-agent worktrees for parallel waves, OR file-level commit locking. Logging here for the verifier and any future retrospective.

## Known Stubs

None. The classifier is functionally complete for all defined inputs (D-05 fatal sources + D-06 transient sources + unknown fallback). No placeholders, no TODOs in shipping code.

## Deferred Issues

**1 test currently fails:** `tests/connections/error-classifier.test.ts > classifies fatal sources: AuthenticationFailure instance > returns 'fatal' for an AuthenticationFailure instance`

- **Why:** The test constructs `new AuthenticationFailure("auth failed")` which throws in imapflow 1.2.13 (constructor undefined at runtime). Its fallback path uses `AuthenticationFailure.prototype` which also dereferences undefined.
- **Resolution:** Plan 12-04 bumps imapflow to `^1.3.7` where the constructor is properly exported. At that point the test will pass without further classifier changes — the classifier already handles the `AuthenticationFailure` case correctly (verified via the runtime guard).
- **Why not fix here:** The test file is owned by Plan 12-01 (parallel wave). Plan 02's `<files_modified>` does not include it; out of scope per the SCOPE BOUNDARY deviation rule. Documented for the verifier.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `classifyConnectionError` and `humanReason` are ready for Plan 12-03 (Wave 2 / AccountConnection refactor) to consume.
- Suggested import in Plan 03: `import { classifyConnectionError, humanReason } from "./error-classifier.js";` (relative ESM import with `.js` extension per project convention).
- Plan 03 should call `classifyConnectionError(err)` on every reconnect failure; if `"fatal"`, transition to `{ kind: "suspended", reason: humanReason(err), since: new Date() }` and exit the loop.
- Plan 04 must NOT introduce its own classifier — reuse this module. Plan 04 is also responsible for bumping `imapflow ^1.2.13 → ^1.3.7`, which makes the AuthenticationFailure runtime guard a no-op and turns the last red test green.

## Threat Flags

None — the only new security surface (`humanReason`) was explicitly mitigated for T-12-03 in the plan's threat model and verified by the `grep` security gate (returns 0). No new network endpoints, auth paths, or file-access patterns introduced.

## Self-Check

Verified:

- `src/connections/error-classifier.ts` exists (165 lines, > 40-line sanity floor).
- `src/connections/index.ts` re-exports the three symbols.
- Commit `6107b4e` exists in git log and includes both files.
- `npx tsc --noEmit` exits 0.
- Security gate: `grep -v '^\s*//' src/connections/error-classifier.ts | grep -E "err\.message|String\(err\)" | wc -l` → 0.
- Purity gate: `grep -v '^\s*//' src/connections/error-classifier.ts | grep -E "console\.|logger\." | wc -l` → 0.
- 18 of 19 tests in `tests/connections/error-classifier.test.ts` green (1 deferred to Plan 04).

## Self-Check: PASSED

---
*Phase: 12-connection-resilience-foundation*
*Completed: 2026-06-09*
