---
phase: 12-connection-resilience-foundation
plan: 04
subsystem: connections
tags: [imap, connections, poller, process-handlers, dependencies, unhandled-rejection, suspended-state, wave-3, phase-completion]

requires:
  - phase: 12-connection-resilience-foundation
    provides: error-classifier pure-function module (Plan 12-02 — classifyConnectionError, humanReason)
  - phase: 12-connection-resilience-foundation
    provides: 4-state AccountConnection state machine (Plan 12-03 — suspended replaces failed)
  - phase: 12-connection-resilience-foundation
    provides: Wave 0 RED scaffolds for CONN-07 / D-12 (Plan 12-01)
provides:
  - Updated ConnectionManager + list-accounts switches that exhaustively handle the 4-variant union (D-01 migration complete)
  - Poller skip guard on non-connected accounts with per-cycle log throttling (CONN-07 / D-15)
  - Process-level unhandledRejection handler in its own testable module (D-12 / src/process-handlers.ts)
  - imapflow dependency bump from ^1.2.13 to ^1.3.7 (resolved to 1.4.0)
  - Runtime-safe `AuthenticationFailure` detection via marker-property fallback (corrected RESEARCH Assumption A5)
affects:
  - 13 (Phase 13 health surface — `list_accounts` already differentiates `suspended.detail` from `reconnecting.attempt`; the SUMMARY for that phase will swap the existing { status, detail } shape for a richer HEALTH-03 shape without re-touching the switch).
  - 14 (reconnect_account tool — the suspended state with `humanReason()` reason text is now the canonical input the tool will read to decide whether to reset).

tech-stack:
  added: []
  patterns:
    - "Process-level safety handler in a dedicated module — testable in isolation, dependency-injected logger seam"
    - "Per-cycle Set tracker for log throttling on long-running polling loops (`skipLoggedThisCycle.clear()` at start of each cycle)"
    - "Belt-and-suspenders status check + getClient race-fallback in a single method — both quiet `return`s, no throws"
    - "Marker-property fallback for upstream classes that aren't re-exported at the top level (`err.authenticationFailed === true`)"
    - "Vitest 4 strict-mock workaround — stub even unused exports the SUT imports (`AuthenticationFailure` class stub)"

key-files:
  created:
    - src/process-handlers.ts
  modified:
    - src/connections/connection-manager.ts
    - src/connections/error-classifier.ts
    - src/polling/poller.ts
    - src/index.ts
    - src/tools/list-accounts.ts
    - tests/connections/connection-manager.test.ts
    - tests/polling/poller.test.ts
    - package.json
    - package-lock.json

key-decisions:
  - "src/process-handlers.ts is the home for installUnhandledRejectionHandler (NOT src/index.ts). STATE.md decision and Plan 12-01 RED scaffold both seal this — the test imports from ../src/process-handlers.js and we honor the contract. Handler accepts an optional logger argument so the test can pass a spy."
  - "Corrected RESEARCH Assumption A5: imapflow ^1.3.7 (and ^1.4.0) STILL does not export `AuthenticationFailure` from the top-level `imapflow` entry. The class lives in `imapflow/lib/tools.js` and is never re-exported from `lib/imap-flow.js` (the package `main`). Added a marker-property fallback to the classifier (`err.authenticationFailed === true`) — the imapflow `AuthenticationFailure` constructor sets this property on every instance, so the classifier correctly returns `fatal` regardless of whether the class symbol is exported. This is the [Rule 3 - Blocking] auto-fix that turns the deferred Plan 12-02 test green."
  - "list-accounts.ts switch was fixed in the SAME commit as connection-manager.ts (Task 1) — both files share the identical migration signal (5 tsc errors total), and addressing only one would leave the project un-compilable. The plan's Task 1 nominally names only connection-manager.ts; reading list-accounts.ts as part of the same migration is a SCOPE BOUNDARY judgment call documented here for the verifier."
  - "Connection-manager.test.ts vi.mock(\"imapflow\") needed an `AuthenticationFailure` stub class added — same vitest-4 strict-mock issue that Plan 12-03 hit in account-connection.test.ts. Without the stub, `error-classifier.ts`'s `typeof AuthenticationFailure` access throws inside the classifier and the suspended test fails for the WRONG reason (the actual fatal classification path is never reached)."
  - "Poller's `makeMockManager` test factory extended with a default `getStatus: () => ({ kind: \"connected\" })` so the 24 pre-existing test cases (always-connected fast-path) continue to fall through to `getClient()` after the skip guard was added. Without it, every pre-existing test would crash on `\"error\" in undefined`."

patterns-established:
  - "Process-level handler in its own module with injected dependencies — unit-testable without main() side effects"
  - "Per-cycle Set tracker for once-per-cycle logging on long-running loops"
  - "Marker-property fallback for upstream classes that aren't top-level-exported"

requirements-completed: [CONN-07]

duration: ~30min active execution (started 2026-06-10T14:34Z; commits landed 2026-06-11T21:00Z — wall-clock includes idle time between conversational turns)
completed: 2026-06-11
---

# Phase 12 Plan 04: Consumer Wiring + imapflow ^1.3.7 — Phase Completion Summary

**Three atomic commits land the final 5 RED scaffolds GREEN + resolve the 5 tsc errors from Plan 12-03: connection-manager + list-accounts switches migrate to the 4-state union, the Poller gains its CONN-07 skip guard, src/process-handlers.ts exports the D-12 unhandledRejection handler, and imapflow bumps ^1.2.13 → ^1.3.7 (resolves to 1.4.0). One corrected research assumption: imapflow STILL does not export AuthenticationFailure at the top level — the classifier now uses the marker-property fallback (`err.authenticationFailed === true`) that the imapflow constructor sets internally. Full suite: 246/246 GREEN. `tsc --noEmit` clean. Phase 12 exit criteria 1–5 met (manual TCP-half-open / fatal-auth / multi-account-listener verifications remain for /gsd:verify-work).**

## Performance

- **Duration:** ~30 min active execution (wall-clock spans ~30 hours including idle conversation turns)
- **Started:** 2026-06-10T14:34Z
- **Completed:** 2026-06-11T21:00Z
- **Tasks:** 3 (per plan task_count=3)
- **Files modified:** 9 (1 new, 8 edited)

## Accomplishments

- **Task 1 — Switch migrations to suspended (D-01):** Both `src/connections/connection-manager.ts` `getClient()` and `src/tools/list-accounts.ts` `handleListAccounts()` now have a `case "suspended"` branch and the `case "failed"` branch is DELETED. The 5 tsc errors from Plan 12-03 (3 in connection-manager.ts, 2 in list-accounts.ts) are resolved. `npx tsc --noEmit` now exits clean (0 errors) for the first time since Plan 12-03 landed. Commit `d726be0`.
- **Task 2 — Poller skip guard (CONN-07 / D-15):** `Poller.pollAccount()` consults `manager.getStatus(accountId)` BEFORE any IMAP call. Non-connected status → quiet `return` with a `debug` log; throttled to one log per skipped account per cycle via `skipLoggedThisCycle: Set<string>` which is cleared at the start of every `poll()`. Belt-and-suspenders post-`getClient()` check retains the race-window fallback. Both Wave 0 scaffolds (`skips non-connected accounts`, `skip is not sticky`) GREEN. Commit `2077988`.
- **Task 3 — Process-handlers + imapflow bump (D-12):**
  - New `src/process-handlers.ts` exporting `installUnhandledRejectionHandler(log?: Logger)`. The handler logs at `error` and NEVER calls `process.exit` — surfaces bugs without taking the MCP server down. Lives in its own module per the STATE.md decision so it's unit-testable in isolation.
  - `src/index.ts main()` calls `installUnhandledRejectionHandler()` as the very first line, BEFORE `loadConfig()`.
  - `package.json` `imapflow` range bumped `^1.2.13 → ^1.3.7`; `npm install` resolved to 1.4.0.
  - `src/connections/error-classifier.ts` `isAuthenticationFailure(err)` extended with a marker-property fallback after empirically verifying that imapflow 1.4.0 STILL does not export `AuthenticationFailure` at the top level (RESEARCH Assumption A5 correction).
  - The previously-deferred error-classifier test `AuthenticationFailure instance` is now GREEN — the very last open thread from Plan 12-02 closes here.
  - Commit `16cbd1e`.
- **Phase 12 exit gate:** All 7 CONN requirements (CONN-01..CONN-07) plus the cross-cutting D-12 handler now have GREEN automated tests.
- **Regression gate:** The full v0.2 tool-handler suite passes unchanged after the imapflow bump — no breaking changes observed in 1.2.13 → 1.4.0 across the IMAP surface this project uses (search, fetch, mailbox.lock, messageFlagsAdd, etc.). RESEARCH Assumption A6 verified.

## Task Commits

| Task | Hash      | Type     | Files                                                                                                                                |
| ---- | --------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | `d726be0` | refactor | src/connections/connection-manager.ts, src/tools/list-accounts.ts, tests/connections/connection-manager.test.ts                      |
| 2    | `2077988` | feat     | src/polling/poller.ts, tests/polling/poller.test.ts                                                                                  |
| 3    | `16cbd1e` | feat     | src/process-handlers.ts (NEW), src/index.ts, src/connections/error-classifier.ts, package.json, package-lock.json                    |

**Plan metadata commit:** to be added by `docs(12-04): complete consumer wiring + imapflow bump plan`.

## Files Created/Modified

### Created

- `src/process-handlers.ts` (NEW, 38 lines) — exports `installUnhandledRejectionHandler(log?: Logger = logger)`. Registers a `process.on("unhandledRejection", …)` listener that logs at error with stack and continues. Dependency-injected logger seam (default-binds to the module-scope logger; tests pass a spy).

### Modified

- `src/connections/connection-manager.ts` — `getClient()` switch: `case "failed"` → `case "suspended"`. New branch returns `{ error: 'account "${id}" is suspended: ${status.reason}' }`. `status.reason` is the locked stock string from `humanReason()` (T-12-09 / V5 ASVS — never echoes raw err.message).
- `src/tools/list-accounts.ts` — `handleListAccounts()` switch: `case "failed"` → `case "suspended"`. Returns `{ status: "suspended", detail: status.reason }`. Phase 13 (HEALTH-03) will replace this shape; Phase 12 preserves the API to avoid mid-milestone breakage.
- `src/polling/poller.ts` — Added `private skipLoggedThisCycle = new Set<string>()`. `poll()` clears it at the top; `pollAccount()` consults `manager.getStatus()` BEFORE any IMAP call, logs at debug + returns on non-connected, retains the post-`getClient()` race-fallback check.
- `src/index.ts` — Imported `installUnhandledRejectionHandler`; called it as the very first line of `main()`.
- `src/connections/error-classifier.ts` — `isAuthenticationFailure(err)` now checks both `err instanceof AuthenticationFailure` (preferred, when the symbol is exported) AND `err.authenticationFailed === true` (the marker property the imapflow constructor sets internally). Either passes → fatal. Documented the RESEARCH Assumption A5 correction inline.
- `tests/connections/connection-manager.test.ts` — Added `MockAuthenticationFailure` stub class to `vi.mock("imapflow")` factory (vitest 4 strict-mock workaround). Renamed misleading `when account is 'failed'` test title to `when account is unknown` (body always exercised the unknown-account path).
- `tests/polling/poller.test.ts` — Extended `makeMockManager` with default `getStatus: () => ({ kind: "connected" })` so the 24 pre-existing tests continue to exercise the fast-path through `getClient()`.
- `package.json` — `imapflow ^1.2.13 → ^1.3.7`.
- `package-lock.json` — regenerated by `npm install`; locks `imapflow@1.4.0` (latest in the `^1.3.7` range as of 2026-06-11).

## Decisions Made

1. **`src/process-handlers.ts` is the handler home (NOT `src/index.ts`).** The plan body suggested `src/index.ts` ("Add this exported helper near the top of the file"); the test (Plan 12-01 RED scaffold) hard-codes `import("../src/process-handlers.js")`; STATE.md's "Decisions (v0.3)" entry pinned the location to `src/process-handlers.ts` precisely because the test contract sealed it. Test contract + STATE.md decision both take precedence over the plan body's prose. The plan's intent is satisfied: the handler IS installed at the very first line of `main()`; it just lives in its own module.

2. **Handler signature `installUnhandledRejectionHandler(log?: Logger = logger)`.** The Plan 12-01 SUMMARY noted the test calls `installUnhandledRejectionHandler(logger)` with the spy passed explicitly. The implementation takes a default-`logger` arg so `main()` can call it parameter-less while the test passes its spy. Cleanest seam.

3. **list-accounts.ts switch was migrated in the SAME commit as connection-manager.ts (Task 1).** The plan nominally scopes Task 1 to connection-manager.ts only, but the 5 tsc errors from Plan 12-03 span both files and the project does NOT compile until both are fixed. Splitting into two commits would have left the working tree in a tsc-broken state between commits — not a viable atomic-commit pattern. Documented here for the verifier; SCOPE BOUNDARY judgment applied.

4. **Marker-property fallback for `AuthenticationFailure` detection.** RESEARCH Assumption A5 said the ^1.3.7 bump would restore `AuthenticationFailure` as a top-level export. Empirical verification on the installed 1.4.0 showed it does NOT — the class is still in `lib/tools.js` and never re-exported from `lib/imap-flow.js`. The constructor sets `authenticationFailed = true` on every instance (`class AuthenticationFailure extends Error { authenticationFailed = true; }`), so the classifier's marker-property check is the canonical runtime detection path. Either the typed `instanceof` OR the marker property → fatal. Documented inline in `error-classifier.ts` so future maintainers don't try to "simplify" by removing the marker path.

5. **vitest 4 strict-mock requires the `AuthenticationFailure` stub even when the test never uses it.** Vitest 4 (`^4.0.18`) throws on access to undeclared mock properties — even `typeof` reads. Since the SUT (`error-classifier.ts`) does `import { AuthenticationFailure } from "imapflow"` at module load, every file that mocks `"imapflow"` and transitively triggers the classifier MUST stub it. The same `MockAuthenticationFailure` stub Plan 12-03 added to `account-connection.test.ts` is now also in `connection-manager.test.ts`. (This is a parallel-execution-style auto-fix — different test file, same root cause.)

6. **Default `getStatus` in poller test mock.** The poller's pre-existing 24 tests exercise the always-connected fast-path. With the new skip guard, `getStatus()` is called BEFORE `getClient()`. Without a default `getStatus` returning `{ kind: "connected" }` in `makeMockManager`, every pre-existing test would crash on `"error" in undefined`. Documented in the test factory's docstring.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Added `MockAuthenticationFailure` stub to `tests/connections/connection-manager.test.ts` vi.mock("imapflow") factory**

- **Found during:** Task 1 (running the suspended scaffold)
- **Issue:** Vitest 4's strict module-mock factory throws `Error: No "AuthenticationFailure" export is defined on the "imapflow" mock` when `error-classifier.ts`'s `isAuthenticationFailure(err)` evaluates `typeof AuthenticationFailure`. Before the fix the suspended test failed with the symptom `expected 'account "personal" is connecting' to match /suspended/i` — the classifier crashed inside the connect() catch, the catch's outer caller swallowed it via `Promise.allSettled`, and the connection's status stayed at the initial `connecting` value (set at the top of `connect()`).
- **Fix:** Added `class MockAuthenticationFailure extends Error {}` to the vi.mock factory's return object so `typeof === "function"` is true and the classifier proceeds to the `serverResponseCode === "AUTHENTICATIONFAILED"` check.
- **Files modified:** `tests/connections/connection-manager.test.ts`
- **Verification:** All 10 connection-manager tests pass after the fix.
- **Committed in:** `d726be0` (Task 1 commit).

**2. [Rule 3 — Blocking] Added marker-property fallback to `isAuthenticationFailure` in `src/connections/error-classifier.ts`**

- **Found during:** Task 3 (running the full suite after the imapflow bump)
- **Issue:** RESEARCH Assumption A5 stated that bumping imapflow to ^1.3.7 would restore the top-level `AuthenticationFailure` export. Empirical verification on `imapflow@1.4.0` (the version `^1.3.7` resolved to): `node -e "import('imapflow').then(m => console.log(typeof m.AuthenticationFailure))"` → `undefined`. The class is in `node_modules/imapflow/lib/tools.js` line 17 (`class AuthenticationFailure extends Error { authenticationFailed = true; }`) but is never re-exported from the package main entry. The Plan 12-01 Wave 0 scaffold for `AuthenticationFailure instance` continued to fail because the test's else branch (line 28-31) sets `authenticationFailed: true` on a generic Error — which the classifier wasn't checking.
- **Fix:** `isAuthenticationFailure(err)` now returns `true` if EITHER `err instanceof AuthenticationFailure` (when the symbol is exported) OR `err.authenticationFailed === true`. The marker-property path is the canonical runtime detection — the imapflow constructor sets it on every instance, so the classifier is robust regardless of whether downstream environments / mocks expose the class.
- **Files modified:** `src/connections/error-classifier.ts`
- **Verification:** Full classifier test suite (19 tests) passes; full suite (246 tests) passes.
- **Committed in:** `16cbd1e` (Task 3 commit). The plan body anticipated the AuthenticationFailure test turning green automatically on the bump; the marker-property addition is the unanticipated step needed to actually achieve that.

**3. [Rule 3 — Blocking] Migrated `src/tools/list-accounts.ts` in the same commit as `src/connections/connection-manager.ts`**

- **Found during:** Task 1 (running tsc after only updating connection-manager.ts)
- **Issue:** Plan 12-03 left 5 tsc errors — 3 in connection-manager.ts and 2 in list-accounts.ts. Plan 12-04's Task 1 nominally names only connection-manager.ts. But leaving list-accounts.ts broken would have left the project tsc-broken between Task 1 commit and Task 3 (where the imapflow bump triggers a full-suite verification gate). Splitting the migration into two commits is incompatible with the atomic-commit pattern.
- **Fix:** Applied the identical `case "failed"` → `case "suspended"` migration to list-accounts.ts in the Task 1 commit. The plan's `<files_modified>` frontmatter does NOT list list-accounts.ts, so this is a documented scope expansion. Justification: the migration signal in Plan 12-03's SUMMARY explicitly enumerated both files as Plan 04's TODO list.
- **Files modified:** `src/tools/list-accounts.ts`
- **Verification:** `npx tsc --noEmit` clean after Task 1 commit; `tests/tools/list-accounts.test.ts` continues to pass.
- **Committed in:** `d726be0` (Task 1 commit, alongside connection-manager.ts).

**4. [Rule 2 — Missing critical] Extended `makeMockManager` in `tests/polling/poller.test.ts` with a default `getStatus`**

- **Found during:** Task 2 (running the poller suite after the skip-guard was added)
- **Issue:** The skip guard in `Poller.pollAccount()` calls `this.manager.getStatus(accountId)` before any IMAP work. The pre-existing `makeMockManager` factory only stubbed `getAccountIds` and `getClient` — no `getStatus`. After the skip guard, every pre-existing test would crash on `"error" in undefined` (TypeError).
- **Fix:** Added `getStatus: vi.fn().mockReturnValue({ kind: "connected", client: { mailbox: "INBOX" } })` to the factory's return so the 24 pre-existing tests continue to flow through to `getClient()`.
- **Files modified:** `tests/polling/poller.test.ts`
- **Verification:** All 26 poller tests pass (24 pre-existing + 2 Wave 0 scaffolds).
- **Committed in:** `2077988` (Task 2 commit).

---

**Total deviations:** 4 auto-fixed (3 blocking, 1 missing-critical). **No architectural changes (Rule 4) were needed.**

## Issues Encountered

### RESEARCH Assumption A5 was incorrect (corrected here)

The phase RESEARCH (`12-RESEARCH.md`) said the imapflow ^1.3.7 bump would restore `AuthenticationFailure` as a top-level export, at which point the classifier's runtime guard would become a no-op and the Plan 12-02 deferred test would turn green automatically. **Empirically verified false on imapflow 1.4.0:** the class is still in `lib/tools.js` and is never re-exported from the package `main` entry (`lib/imap-flow.js`). The marker-property fallback (deviation #2 above) is the canonical fix — and is more robust than relying on a future imapflow release to fix the export. Documented inline in the classifier's `isAuthenticationFailure` docstring with a pointer to the verification path.

This does NOT block the phase exit — both the typed and marker-property paths handle the case correctly. It's a documentation correction that the planner / verifier / future imapflow-version-bump phases should be aware of.

### imapflow 1.2.13 → 1.4.0 transitive jump

`npm install` resolved `^1.3.7` to `1.4.0` (the latest in the range). The plan asked for `1.3.7` literally; `^1.3.7` semver range was the agreed contract. RESEARCH Assumption A6 (full v0.2 test suite is the regression gate) is satisfied: all 246 tests pass on 1.4.0. No breaking changes observed across the IMAP surface this project uses (`new ImapFlow(...)`, `client.connect()`, `client.logout()`, `client.close()`, `client.mailbox.lock()`, `client.search()`, `client.fetchOne()`, `client.fetch()`, `client.messageFlagsAdd()`, `client.usable`, the `error` / `close` events). The `socketOptions` field that Plan 12-03 had to type-intersect (because 1.2.13's .d.ts omitted it) is now in the official type declarations on 1.4.0 — the intersection is no longer strictly necessary but does not break, so it stays in place (removing it is out of scope for this plan; a future hygiene plan can drop it).

## Known Stubs

None. All implementations are functionally complete for Phase 12 scope. The internal `connectedAt` / `lastError` fields on `AccountConnection` (populated by Plan 12-03) remain internal — Phase 13 (HEALTH-02) is responsible for surfacing them through `list_accounts`.

## Deferred Issues

None. Every RED scaffold from Plan 12-01 is now GREEN. Every TypeScript error from Plan 12-03 is resolved. Every CONN requirement (CONN-01..CONN-07) has a green automated test. The single deferred test from Plan 12-02 (`AuthenticationFailure instance`) is GREEN.

## Manual-Only Verifications (per 12-VALIDATION.md)

These must be performed before `/gsd:verify-work`:

1. **TCP half-open recovery (CONN-04 / Success Criterion #1):** Start server with ≥1 real account, sleep laptop ≥5min, wake. Within ~95s (`socketTimeout: 90_000 + 5s tolerance`) the account must transition to `reconnecting` then back to `connected`. Verify via `list_accounts`.
2. **Fatal auth fast-suspend (CONN-03 / Success Criterion #2):** Configure account with deliberately wrong password, start server. Within seconds `list_accounts` shows `status: "suspended"` with `detail: "Authentication failed — fix credentials"`. After 60s, grep server stderr — must find no retry attempts.
3. **Multi-account staggered drop — no listener leak (CONN-06 / Success Criterion #5):** Configure 3+ accounts, toggle Wi-Fi off/on 5 times with 30s intervals. After all accounts recover, grep stderr for `MaxListenersExceededWarning` — must find zero.

## User Setup Required

None — no external service configuration required for the code changes. The manual verifications above are validation steps, not setup steps.

## Next Phase Readiness

- **Phase 13 (`health-and-cache`):** Has the substrate it needs. `AccountConnection.connectedAt` / `lastError` are internal fields populated on every connect/reconnect/failure (Plan 12-03 groundwork). The 4-state union with `suspended.reason` (stock string from `humanReason()`) is the contract Phase 13's `list_accounts.last_error` field reads. The classifier's `humanReason` table is locked at the strings in Plan 12-02's SUMMARY — Phase 13 surfaces them verbatim.
- **Phase 14 (`reconnect_account` MCP tool):** Has the state-machine API it needs. `accountConnection.connect()` is idempotent; calling it on a suspended account resets the state and enters the reconnect machinery. No further state-machine work required.

## Threat Flags

None new. All threats in the plan's threat model are mitigated:

- **T-12-12 (Poller log-flood):** mitigated by D-15 — `skipLoggedThisCycle: Set<string>` clears on every cycle, ensuring at most one `debug` log per skipped account per cycle. Verified by `skip is not sticky` test.
- **T-12-13 (unhandled rejection DoS):** mitigated by D-12 — `process.on("unhandledRejection", …)` registered at startup, logs at `error`, never calls `process.exit`. Verified by `unhandledRejection logs and continues` test.
- **T-12-SC (supply-chain via dependency upgrade):** mitigated by RESEARCH Package Legitimacy Audit (same `postalsys` maintainer / repo; `^1.3.7` range; resolved to `1.4.0` published by the same author). Disposition: Approved.
- **T-12-14 (imapflow minor bump breaking change):** the regression gate (full v0.2 test suite) is GREEN. No breaking change observed. Accepted.

No new security surface introduced beyond what the plan enumerated.

## TDD Gate Compliance

Plan 12-04 frontmatter declares `type: execute` (not `type: tdd`), so the plan-level RED/GREEN/REFACTOR gate sequence does not apply at the plan level. Each task IS `tdd="true"` — and the RED scaffolds for each task were shipped by Plan 12-01 (commits `7fbcc17`, `347cffd`). This plan's three task commits are the GREEN gates:

- `d726be0` (Task 1, refactor) — GREEN gate against `tests/connections/connection-manager.test.ts > suspended`
- `2077988` (Task 2, feat) — GREEN gate against `tests/polling/poller.test.ts > skips non-connected accounts` and `> skip is not sticky`
- `16cbd1e` (Task 3, feat) — GREEN gate against `tests/startup.test.ts > unhandledRejection logs and continues` and `tests/connections/error-classifier.test.ts > AuthenticationFailure instance`

No separate REFACTOR pass needed; production code lands clean.

## Self-Check

Verified:

- `src/process-handlers.ts` exists (38 lines); exports `installUnhandledRejectionHandler`.
- `grep -c 'case "failed"' src/connections/connection-manager.ts src/tools/list-accounts.ts` → 0 in both files.
- `grep -c 'case "suspended"' src/connections/connection-manager.ts src/tools/list-accounts.ts` → 1 in both files.
- `grep -c 'skipLoggedThisCycle' src/polling/poller.ts` → 4 (field + clear + has + add).
- `grep -c 'throw new Error.*getClient error' src/polling/poller.ts` → 0 (old throw removed).
- `grep -c 'logger.debug.*skipping' src/polling/poller.ts` → 2 (skip log + getClient-race log).
- `grep -c 'installUnhandledRejectionHandler' src/index.ts` → 2 (import + call site).
- `grep -c 'process.on("unhandledRejection"' src/process-handlers.ts` → 2 (text in code + JSDoc).
- `grep -c '"imapflow": "\^1\.3\.7"' package.json` → 1.
- `npm list imapflow` → `imapflow@1.4.0` (in `^1.3.7` range).
- `process.exit` references in `src/process-handlers.ts`: 3, all in JSDoc / comments explicitly stating "do NOT call process.exit". Zero actual calls in handler body.
- Commits `d726be0`, `2077988`, `16cbd1e` all exist in `git log` and include the expected files (verified with `git show --stat`).
- `npx tsc --noEmit` → exit 0 (clean across entire project).
- `npm test` → **246 passed, 0 failed**, 20 test files.
- All 5 previously-RED Wave 0 scaffolds individually verified GREEN via targeted `npx vitest run -t "<pattern>"` invocations.

## Self-Check: PASSED

---

*Phase: 12-connection-resilience-foundation*
*Completed: 2026-06-11*
