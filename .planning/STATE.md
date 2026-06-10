---
gsd_state_version: 1.0
milestone: v0.3
milestone_name: Reliability & Cache Rethink
status: executing
stopped_at: Plan 12-01 complete (Wave 0 RED scaffolds shipped)
last_updated: "2026-06-09T23:04:00.000Z"
last_activity: 2026-06-09 -- Plan 12-01 (Wave 0 RED scaffolds) committed
progress:
  total_phases: 3
  completed_phases: 0
  total_plans: 4
  completed_plans: 2
  percent: 17
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-08)

**Core value:** An agent can reliably read, search, monitor, and tag email across multiple accounts — with the context it needs to act without guessing or re-fetching.
**Current focus:** Phase 12 — connection-resilience-foundation

## Current Position

Milestone: **v0.3 Reliability & Cache Rethink**
Phase: 12 (connection-resilience-foundation) — EXECUTING
Plan: 12-01 complete (Wave 0 RED scaffolds shipped); 12-02 complete (error-classifier shipped); next up — 12-03 (AccountConnection refactor / Wave 2)
Status: Executing Phase 12 (Wave 2 of 4 — Plan 12-03 next)
Last activity: 2026-06-09 -- Plan 12-01 (Wave 0 RED scaffolds) committed (commit 7fbcc17)

Progress: [██░░░░░░░░] 17%

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
- Carried from v0.2: `formatAddress` is canonical `Name <addr>` formatter; `{account_id, uid}` is globally unique message ref.

### Blockers/Concerns

- **Concurrent-staging race in parallel executor pattern (logged Plan 12-02 and mirrored in Plan 12-01):** parallel agents writing to a shared git index produced a misattributed commit `0116824` which carries Plan 12-01's Task 2 file (`tests/connections/account-connection.test.ts`) under Plan 12-02's commit message. Recovery commit `6107b4e` contains the actual Plan 12-02 deliverables. Plan 12-01's Task 2 content is correct and tracked; the audit trail is documented symmetrically in both summaries. Consider per-agent worktrees (`git worktree add`) for future parallel waves OR file-level pre-commit locking.
- **Plan 12-02 deferred test (red until Plan 12-04):** `tests/connections/error-classifier.test.ts > classifies fatal sources: AuthenticationFailure instance` is red because `imapflow@1.2.13` does not export the `AuthenticationFailure` constructor at runtime (declared in .d.ts only). Plan 12-04 bumps to ^1.3.7 and the test turns green automatically.
- **10 Wave 0 RED scaffolds intentionally fail full suite (Plan 12-01):** `npm test` reports `238 passed, 10 failed`. All 10 failures are the planned RED scaffolds (6 in account-connection, 1 in connection-manager, 1 in error-classifier, 2 in poller, 1 in startup). Plans 12-03 and 12-04 turn them green. The verifier MUST distinguish these from regression failures.

### Tech Debt (carried from v0.2)

- `read_messages` / `read_message` build `from` as bare address instead of `formatAddress` — one-line fix per tool, not in v0.3 scope unless a touching phase picks it up
- All 5 v0.2 VALIDATION.md files remain `draft` — VERIFICATION.md confirms 100% coverage; backfill with `/gsd:validate-phase` if Nyquist tracking needed

### Pending Todos

None.

## Session Continuity

Last session: 2026-06-09T23:04:00.000Z
Stopped at: Plan 12-01 complete — Wave 0 RED scaffolds shipped (commit 7fbcc17). Next up: Plan 12-03 (Wave 2 — AccountConnection state-machine refactor).
Resume file: .planning/phases/12-connection-resilience-foundation/12-03-PLAN.md
