---
gsd_state_version: 1.0
milestone: v0.3
milestone_name: Reliability & Cache Rethink
status: verifying
stopped_at: Plan 13-03 complete — per-account lastPolledAt Map + getLastPolledAt accessor shipped (CACHE-01)
last_updated: "2026-06-13T08:44:39Z"
last_activity: 2026-06-13
progress:
  total_phases: 3
  completed_phases: 1
  total_plans: 4
  completed_plans: 4
  percent: 33
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-08)

**Core value:** An agent can reliably read, search, monitor, and tag email across multiple accounts — with the context it needs to act without guessing or re-fetching.
**Current focus:** Phase 12 — connection-resilience-foundation

## Current Position

Milestone: **v0.3 Reliability & Cache Rethink**
Phase: 13
Plan: Not started
Status: Phase 12 implementation done — 4/4 plans shipped. All 7 CONN requirements + D-12 cross-cutting handler have green automated tests. Full suite: 246/246. `tsc --noEmit` clean. Awaiting `/gsd:verify-work` (manual TCP-half-open / fatal-auth / multi-account-listener verifications per 12-VALIDATION.md).
Last activity: 2026-06-11

Progress: [███░░░░░░░] 33%

## Velocity Reference

| Milestone | Phases | Plans | Tasks | Days |
|-----------|--------|-------|-------|------|
| v0.1.0 | 6 | 23 | — | 4 |
| v0.2 | 6 (incl. 1 decimal) | 12 | 19 | 17 |

*Full retrospective: `.planning/RETROSPECTIVE.md`*

## Accumulated Context

### Decisions (v0.3)

Full log in `.planning/PROJECT.md` Key Decisions table. Key v0.3 decisions:

- **State machine**: 5 named states — `connecting | connected | reconnecting | suspended | failed`. `suspended` is the fatal/non-retryable state (not `failed` with a boolean). `failed` reserved for edge cases like explicit operator stop. **OVERRIDDEN by Phase 12 D-01**: union reduces to 4 reachable states (drops `failed`); `humanReason` from Plan 12-02 supplies the `suspended.reason` string.
- **Cache architecture**: Option A — keep and improve the polling cache. No IMAP IDLE adoption in v0.3 (dual-connection redesign is its own future milestone).
- **`reconnect_account` tool**: Ships in v0.3 as Phase 14 — standalone phase, thin wrapper on Phase 12 state machine.
- **Error classifier locked (Plan 12-02)**: `classifyConnectionError` is a pure-function module; fatal verdict triggers `suspended`, transient triggers unbounded retry. Stock-string `humanReason` table is the contract for Phase 13 health surfacing — never echoes underlying error message text (V5 ASVS).
- **Runtime guard for `AuthenticationFailure` (Plan 12-02)**: `instanceof` is wrapped in `typeof === "function"` to handle imapflow 1.2.13 missing the runtime export; Plan 12-04 bumps to ^1.3.7 and the guard becomes a no-op.
- **unhandledRejection home (Plan 12-01 RED scaffold)**: The cross-cutting D-12 handler lives in `src/process-handlers.ts` (NOT `src/index.ts`), exported as `installUnhandledRejectionHandler(logger)`. Keeps the handler unit-testable in isolation. Plan 12-04 must ship the file with that exact export shape — `tests/startup.test.ts` already imports from `../src/process-handlers.js` with `@ts-expect-error`.
- **Wave 0 RED-scaffold contract sealed (Plan 12-01)**: All four `-t` patterns in 12-VALIDATION.md (`suspended`, `skips non-connected accounts`, `skip is not sticky`, `unhandledRejection logs and continues`) plus the CONN-01 / CONN-02 / CONN-04 / CONN-05 / CONN-06 patterns each match exactly one test. Total: 10 RED tests, 238 GREEN regression tests, zero collateral damage to existing v0.2 suites.
- **AccountConnection refactor shipped (Plan 12-03)**: CONN-02, CONN-03, CONN-04, CONN-05, CONN-06 all green. 4-state union (`connecting | connected | reconnecting | suspended`) with `failed` removed entirely. `shouldLogAttempt` cadence pinned to `1, 2, 3, 5, 10, 20, 40, 80, 160, …` (doubling starts at 5; CONTEXT.md D-14 at face value). `buildClient` socketOptions uses a typed intersection (not `as any`) because imapflow 1.2.13's TS declarations omit the field — Plan 04's ^1.3.7 bump drops the intersection. 5 tsc errors now surface in `src/connections/connection-manager.ts` and `src/tools/list-accounts.ts` — these are the intended Plan 04 migration TODO list.
- **Phase 12 complete (Plan 12-04)**: CONN-07 + D-12 + final CONN-01 scaffold all green. `src/process-handlers.ts` (NEW) exports `installUnhandledRejectionHandler(log?: Logger = logger)`; called as the first line of `main()`. Poller `pollAccount()` consults `manager.getStatus()` before any IMAP work; non-connected status → quiet `return` with throttled `debug` log via `skipLoggedThisCycle: Set<string>` cleared every cycle. `imapflow ^1.2.13 → ^1.3.7` (resolves to 1.4.0); the typed-intersection workaround in `buildClient` is no longer strictly required (kept as-is — a future hygiene plan can drop it).
- **RESEARCH Assumption A5 corrected (Plan 12-04)**: imapflow 1.4.0 STILL does NOT export `AuthenticationFailure` at the top level (the class lives in `lib/tools.js` and is never re-exported from `lib/imap-flow.js`). The classifier's `isAuthenticationFailure(err)` now uses a marker-property fallback (`err.authenticationFailed === true`) — the constructor sets this property on every instance internally, so the classifier is robust regardless of the top-level export. Both the typed-instanceof AND marker-property paths classify as fatal.
- **Plan 13-03 shipped (CACHE-01)**: Poller's global `lastPollTime: Date | null` replaced with per-account `lastPolledAt: Map<string, Date | null>` (D-11). New public `getLastPolledAt(accountId)` accessor (D-12). Per-account seed-vs-incremental decision (D-13). The stamp `this.lastPolledAt.set(accountId, new Date())` is the LAST statement of `pollAccount`'s success path (after `mergeIntoCache`) — Pitfall 2 guard verified by a RED test that mocks `searchMessages` to reject and asserts `getLastPolledAt` stays `null`. `isCacheReady()` deliberately kept (rewired to scan the Map) — Plan 13-04 removes it atomically with the `handleGetNewMail` cold-cache gate. Full suite: 251/251 (246 baseline + 5 new CACHE-01). `tsc --noEmit` clean.
- Carried from v0.2: `formatAddress` is canonical `Name <addr>` formatter; `{account_id, uid}` is globally unique message ref.

### Blockers/Concerns

- **Concurrent-staging race in parallel executor pattern (logged Plan 12-02 and mirrored in Plan 12-01):** parallel agents writing to a shared git index produced a misattributed commit `0116824` which carries Plan 12-01's Task 2 file (`tests/connections/account-connection.test.ts`) under Plan 12-02's commit message. Recovery commit `6107b4e` contains the actual Plan 12-02 deliverables. Plan 12-01's Task 2 content is correct and tracked; the audit trail is documented symmetrically in both summaries. Consider per-agent worktrees (`git worktree add`) for future parallel waves OR file-level pre-commit locking. RESOLVED for Phase 12 — no further parallel waves remain in this phase.
- **Plan 12-02 deferred test (RESOLVED in Plan 12-04):** the `AuthenticationFailure instance` scaffold is now GREEN. The fix was NOT the expected ^1.3.7 export reactivation (verified empirically: imapflow 1.4.0 still does not export the class at the top level). Instead, the classifier now uses a marker-property fallback (`err.authenticationFailed === true`) — the constructor sets this on every instance internally.
- **5 Wave 0 RED scaffolds resolved by Plan 12-04:** `npm test` now reports **246 passed, 0 failed**. All previously-RED scaffolds (suspended, skips non-connected accounts, skip is not sticky, unhandledRejection logs and continues, AuthenticationFailure instance) are GREEN.

### Tech Debt (carried from v0.2)

- `read_messages` / `read_message` build `from` as bare address instead of `formatAddress` — one-line fix per tool, not in v0.3 scope unless a touching phase picks it up
- All 5 v0.2 VALIDATION.md files remain `draft` — VERIFICATION.md confirms 100% coverage; backfill with `/gsd:validate-phase` if Nyquist tracking needed

### Pending Todos

None.

## Session Continuity

Last session: 2026-06-13T08:44:39Z
Stopped at: Plan 13-03 complete (parallel wave) — CACHE-01 shipped; awaiting orchestrator merge with sibling plans 13-01/13-02/13-04
Resume file: .planning/phases/13-health-surface-cache-improvements/13-03-SUMMARY.md
