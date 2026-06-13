---
phase: 13-health-surface-cache-improvements
plan: 01
subsystem: connections
tags: [health-fields, accessors, tdd, lastErrorAt, account-connection, connection-manager, vitest]

# Dependency graph
requires:
  - phase: 12-connection-resilience-foundation
    provides: "private connectedAt + lastError fields on AccountConnection (Phase 12 groundwork — never surfaced); humanReason() stock-string source; sealed 4-state AccountConnectionStatus union; reconnect loop + initial-connect catch sites"
provides:
  - "private lastErrorAt: Date | null field on AccountConnection (D-07)"
  - "Three public accessors on AccountConnection: getConnectedAt(), getLastError(), getLastErrorAt()"
  - "Three delegating accessors on ConnectionManager: getLastConnectedAt(id), getLastError(id), getLastErrorAt(id) — return null (not { error }) for unknown accounts"
  - "JSDoc on both accessor sets documenting the T-12-09 / V5 ASVS sanitization contract Plan 13-02 must enforce"
  - "12 new automated tests (6 on each test file) proving stamp/clear pairing + delegation"
affects: [13-02-list-accounts-tool, 13-04-get-new-mail-handler]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Delegating accessor returns null (not { error }) for unknown accounts on ConnectionManager — distinct from getStatus()'s structured-error pattern; health fields are Date | null / string | null by design"
    - "Phase 13 stamp/clear contract: every lastError write is paired with a lastErrorAt write on the next line (4 sites locked)"
    - "Per-describe beforeEach mock reset for vitest 4 — sticky vi.mocked() implementations from earlier describes do not auto-clear under default config"

key-files:
  created: []
  modified:
    - "src/connections/account-connection.ts — added lastErrorAt field + 3 accessors + paired 4 stamp/clear writes"
    - "src/connections/connection-manager.ts — added 3 delegating accessors"
    - "tests/connections/account-connection.test.ts — appended HEALTH-02 describe with 6 it cases"
    - "tests/connections/connection-manager.test.ts — appended HEALTH-02 describe with 6 it cases + import beforeEach"

key-decisions:
  - "lastErrorAt is internal camelCase; snake_case (last_error_at) lives only at the MCP tool boundary in Plan 13-02 — matches the existing accessor naming on AccountConnection"
  - "Unknown-account ConnectionManager accessors return null, not { error: string } — health fields are Date | null / string | null by design and the tool layer treats null uniformly as 'no value' (CONTEXT.md D-07)"
  - "JSDoc on getLastError() at both AccountConnection and ConnectionManager layers documents that the raw err.message is exposed internally — Plan 13-02 is the gate that sanitizes for the reconnecting branch (T-12-09 / V5 ASVS contract carried from Phase 12)"
  - "AccountConnectionStatus union is NOT modified — Phase 12 seal preserved; Plan 01 is purely additive at the field + accessor layer"

patterns-established:
  - "Per-describe beforeEach mock reset: vitest 4's default config does not clear mocks across describes; a sticky vi.mocked(ImapFlow).mockImplementation in an earlier describe will leak into later ones — explicit reset is required (surfaced as a Rule 3 fix during this plan)"
  - "Paired-write field contract: lastError + lastErrorAt are always written together on the next line — easy to audit via grep ('this.lastErrorAt = ' returns exactly 4)"

requirements-completed: [HEALTH-01, HEALTH-02, HEALTH-03]

# Metrics
duration: 5min
completed: 2026-06-13
---

# Phase 13 Plan 01: Internal health-field foundation Summary

**lastErrorAt: Date | null on AccountConnection + six new internal accessors (3 per class) unblock Plan 13-02's list_accounts health surface; sanitization contract preserved for the tool layer to enforce.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-06-13T08:39:54Z
- **Completed:** 2026-06-13T08:44:57Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Added `private lastErrorAt: Date | null = null` on `AccountConnection` (D-07) with stamp/clear pairing at all 4 sites where `lastError` is written (successful reconnect, reconnect transient failure, successful initial connect, initial connect failure)
- Exposed three public accessors on `AccountConnection`: `getConnectedAt()`, `getLastError()`, `getLastErrorAt()` — JSDoc'd with the T-12-09 / V5 ASVS sanitization contract that Plan 13-02 must honor
- Exposed three delegating accessors on `ConnectionManager`: `getLastConnectedAt(id)`, `getLastError(id)`, `getLastErrorAt(id)` — each returns `null` for unknown accounts (NOT `{ error }`, distinct from `getStatus()`)
- 12 new automated tests (6 + 6) prove stamp/clear semantics and delegation; full suite 258 / 258 green (+12 vs. 246 baseline); `tsc --noEmit` clean

## Task Commits

Each task was committed atomically:

1. **Task 1: RED — Failing tests for AccountConnection lastErrorAt field + accessors** — `53aee82` (test)
2. **Task 2: GREEN — Add lastErrorAt field + 3 accessors on AccountConnection** — `aa28685` (feat)
3. **Task 3: ConnectionManager delegating accessors + RED-then-GREEN tests** — `33147be` (feat — combined RED+GREEN per plan design)

_Note: Plan 01 follows the GREEN-driven TDD cycle — Task 1 commits RED tests, Task 2 commits the implementation that makes them green, Task 3 combines both halves in a single commit because the test and source files are tightly coupled (test mocks the manager, calls accessors, asserts delegation)._

## Files Created/Modified

- `src/connections/account-connection.ts` — new private field `lastErrorAt: Date | null = null` + 3 accessors `getConnectedAt`/`getLastError`/`getLastErrorAt` + paired `lastErrorAt` writes at all 4 lastError write sites
- `src/connections/connection-manager.ts` — 3 new delegating accessors `getLastConnectedAt(id)`/`getLastError(id)`/`getLastErrorAt(id)` returning `null` for unknown accounts
- `tests/connections/account-connection.test.ts` — appended `describe("HEALTH-02: lastErrorAt stamp + clear")` with 6 it cases (A–F)
- `tests/connections/connection-manager.test.ts` — appended `describe("HEALTH-02: ConnectionManager health accessors")` with 6 it cases + imported `beforeEach`

## Decisions Made

- **camelCase internal / snake_case at MCP boundary** — followed plan verbatim; matches the existing `getStatus()` / `connectedAt` / `lastError` naming on AccountConnection. Plan 13-02 transforms to snake_case at the tool layer.
- **Unknown account returns null** (not `{ error }`) on the ConnectionManager health accessors — followed CONTEXT.md D-07 verbatim. Reduces tool-layer branching: Plan 02 reads `null` uniformly as "no value" without disambiguating "unknown" vs "no last error yet".
- **Phase 12 seal preserved** — `AccountConnectionStatus` union unchanged; reconnect-loop logic, gracefulClose, buildClient, wireListeners untouched. Plan 01 is purely additive.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Sticky `vi.mocked(ImapFlow)` mock from prior describes leaked into HEALTH-02 ConnectionManager tests**
- **Found during:** Task 3 (Step 3a → 3b transition, RED → GREEN run)
- **Issue:** After implementing the 3 delegating accessors, 3 of the 6 new HEALTH-02 tests still failed — `expected null to be an instance of Date`, `expected 'auth failed' to be null`, `expected <Date> to be null`. Root cause: the earlier `describe("ConnectionManager suspended state (CONN-03 / D-01)")` block installs `vi.mocked(ImapFlow).mockImplementation(...)` that rejects every connect with an `AUTHENTICATIONFAILED` error. Vitest 4's default config does not auto-clear mocks across describes, so the sticky failure-mode mock leaks into the next describe — meaning my freshly-connected expectations were running against suspended-state accounts.
- **Fix:** Added a `beforeEach` to the new `describe("HEALTH-02: ConnectionManager health accessors")` block that resets `vi.mocked(ImapFlow)` to the clean default (emitter + resolving `connect()`). Imported `beforeEach` from vitest in the file's import line.
- **Files modified:** `tests/connections/connection-manager.test.ts` (lines 1 + new beforeEach inside HEALTH-02 describe)
- **Verification:** After the reset, all 6 HEALTH-02 tests pass; the 10 pre-existing tests stay green.
- **Committed in:** `33147be` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking).
**Impact on plan:** The fix was a pure test-infrastructure correction (no production behavior change). Pattern is now documented in `patterns-established` so Plan 13-02..13-04 inherit the awareness: any new describe block that depends on the default `ImapFlow` mock must either be placed BEFORE the sticky describes or install its own `beforeEach` reset.

## Issues Encountered

- **Worktree branched off pre-Phase-13** — the executor's worktree HEAD was at `31d7d2b` (after Phase 12 wrap-up) but the Phase 13 plan/context/research files only exist at `070d23c` on main. Resolved by `git merge main --no-edit` (fast-forwarded; no conflicts). This is documented for the orchestrator: parallel-wave worktrees created from a base before plan files land on main need a fast-forward merge before execution can read the plan. Per the destructive-git prohibition, the fast-forward is non-destructive (no commit rewriting, no force operations).

## Threat Flags

No new threat surface introduced. Plan 01 expands the internal accessor surface (`AccountConnection.getLastError()` and `ConnectionManager.getLastError(id)`) but does NOT change the tool boundary or add network endpoints. The plan's STRIDE register T-13-01 already classified this as `mitigate-downstream` — the JSDoc on both accessor layers explicitly documents the `getLastError()` raw-message exposure and points Plan 13-02 at the sanitization contract.

## Self-Check: PASSED

**Verified files exist (or modified) by `[ -f path ]`:**

- FOUND: `src/connections/account-connection.ts`
- FOUND: `src/connections/connection-manager.ts`
- FOUND: `tests/connections/account-connection.test.ts`
- FOUND: `tests/connections/connection-manager.test.ts`

**Verified commits exist by `git log --oneline | grep <hash>`:**

- FOUND: `53aee82` (Task 1 RED)
- FOUND: `aa28685` (Task 2 GREEN — AccountConnection)
- FOUND: `33147be` (Task 3 RED+GREEN — ConnectionManager)

**Verified plan-level invariants:**

- `grep -c 'this\.lastErrorAt = ' src/connections/account-connection.ts` → 4 ✓
- `grep -c 'private lastErrorAt: Date | null = null;' src/connections/account-connection.ts` → 1 ✓
- `grep -cE '^\s+get(ConnectedAt|LastError|LastErrorAt)\(\)' src/connections/account-connection.ts` → 3 ✓
- `grep -cE 'getLast(ConnectedAt|Error|ErrorAt)\(accountId' src/connections/connection-manager.ts` → 3 ✓
- `grep -c 'HEALTH-02: lastErrorAt stamp + clear' tests/connections/account-connection.test.ts` → 1 ✓
- `grep -c 'HEALTH-02: ConnectionManager health accessors' tests/connections/connection-manager.test.ts` → 1 ✓
- `npm test` → 258 / 258 passing (≥252 plan threshold; +12 vs. 246 Phase 12 baseline) ✓
- `npx tsc --noEmit` → clean ✓
- `AccountConnectionStatus` union — still 4 variants, unmodified ✓

## User Setup Required

None — internal code change with no external service configuration.

## Next Phase Readiness

- **Plan 13-02 (`handleListAccounts` rewrite — HEALTH-02 / HEALTH-03):** unblocked. `manager.getLastConnectedAt(id)`, `manager.getLastError(id)`, `manager.getLastErrorAt(id)` are the read paths Plan 02 will consume. JSDoc on both layers points Plan 02 at the V5 ASVS sanitization contract for the reconnecting branch — `last_error` must be a stock template or `null`, never the raw `err.message` returned by `getLastError(id)`.
- **Plans 13-03 / 13-04 (poller per-account freshness):** orthogonal — they read from the Poller, not the ConnectionManager. No new coupling introduced by Plan 01.
- **Risk for Plan 02:** the sanitization gate is the most important downstream invariant. The JSDoc warning is necessary but not sufficient — Plan 02's test file must include an assertion that `last_error` for a `reconnecting` account does NOT contain the raw error text (e.g. `"ECONNRESET"`). This is already specified in Plan 02 task 1's verification block (read it before starting).

---

*Phase: 13-health-surface-cache-improvements*
*Plan: 01*
*Completed: 2026-06-13*
