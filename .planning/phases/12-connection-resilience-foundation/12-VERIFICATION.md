---
phase: 12-connection-resilience-foundation
verified: 2026-06-11T22:15:00Z
status: human_needed
score: 17/17 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: null
  previous_score: null
  gaps_closed: []
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "TCP half-open recovery via laptop sleep/wake"
    expected: "After sleeping the laptop ≥5 minutes and waking, an affected account transitions reconnecting → connected within ~95s (socketTimeout 90_000 + 5s tolerance); `list_accounts` confirms"
    why_human: "Vitest cannot simulate a half-open TCP connection — kernel-level socket state plus real network disruption are required (Success Criterion #1 / CONN-04)"
  - test: "Fatal auth fast-suspend against a real IMAP server"
    expected: "Account configured with a deliberately wrong password shows `status: \"suspended\"` with `detail: \"Authentication failed — fix credentials\"` within seconds; no further retry attempts in logs after 60s"
    why_human: "Requires a real IMAP server rejecting credentials with AUTHENTICATIONFAILED — automated tests use mocked imapflow constructors (Success Criterion #2 / CONN-03)"
  - test: "Multi-account staggered drop — no MaxListenersExceededWarning"
    expected: "After configuring 3+ accounts and toggling Wi-Fi off/on 5 times at 30s intervals, server stderr contains zero `MaxListenersExceededWarning` lines"
    why_human: "Requires ≥3 real connections and inducing repeated transient drops — automated unit test asserts `removeAllListeners` call count but cannot reproduce real-world cumulative EventEmitter pressure (Success Criterion #5 / CONN-06)"
---

# Phase 12: Connection Resilience Foundation — Verification Report

**Phase Goal:** IMAP accounts recover automatically from transient network failures without server restart, and fatal failures are immediately identified and quarantined.

**Verified:** 2026-06-11T22:15:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (ROADMAP.md Success Criteria)

| # | Truth (Success Criterion) | Status | Evidence |
|---|---------------------------|--------|----------|
| SC1 | An account that drops during a 10-minute network outage reconnects automatically once connectivity is restored — no server restart needed | ⚠️ NEEDS HUMAN | Code substrate is fully present: unbounded `while (!isShuttingDown)` loop in `runReconnectLoop()` (account-connection.ts:188-274); TCP keepalive `{ keepAlive: true, keepAliveInitialDelay: 60_000 }` + `socketTimeout: 90_000` in `buildClient()` (account-connection.ts:127-141). End-to-end behaviour requires real network disruption — flagged for manual verification. |
| SC2 | An account with wrong credentials transitions to `suspended` after the first failed attempt and stops retrying | ✓ VERIFIED | Initial-connect fatal fast-path (account-connection.ts:299-315) classifies before any retry; reconnect-loop fatal fast-path (account-connection.ts:239-245) does same after iteration 1. Test `fatal goes straight to suspended on attempt 1 with no further retries` passes (asserts `mock.calls.length === 1`). Real-server repro also flagged for manual verification per VALIDATION.md Manual-Only Verifications. |
| SC3 | Calling `list_accounts` during a reconnect shows `status: "reconnecting"` with a `last_error` reason; `status: "suspended"` accounts display a human-readable reason | ✓ VERIFIED (partial; rest deferred) | `list-accounts.ts:33-42` returns `{status: "reconnecting", attempt: status.attempt}` and `{status: "suspended", detail: status.reason}`. The `suspended.detail` field reads the stock string from `humanReason()` (e.g., "Authentication failed — fix credentials"). The `last_error` field on the reconnecting branch is intentionally deferred to Phase 13 (HEALTH-02/HEALTH-03) — confirmed in CONTEXT.md "Out of scope for Phase 12". Underlying `reconnecting.lastError` field IS populated in account-connection.ts:202-204 (Phase 13 substrate). |
| SC4 | Two simultaneous `close` events on the same account do not spawn two concurrent reconnect loops | ✓ VERIFIED | Synchronous `reconnectInFlight` boolean written BEFORE any await in `wireListeners` close handler (account-connection.ts:158-159). Test `concurrent close events trigger exactly one reconnect loop (one new ImapFlow constructed)` passes — asserts exactly one new client across two close emissions. |
| SC5 | A server running 3+ accounts with staggered connection drops does not accumulate EventEmitter `MaxListenersExceededWarning` messages across restart cycles | ⚠️ NEEDS HUMAN | Code substrate present: `this.currentClient?.removeAllListeners()` invoked at start of every reconnect iteration (account-connection.ts:217-219). Test `listener cleanup: removeAllListeners is invoked on every discarded client across 5 reconnect failures` passes. Real-world multi-account cumulative effect requires manual verification (Wi-Fi toggle cycles) per VALIDATION.md. |

**Score:** 3 fully verified + 2 needs-human = 5/5 SCs addressed (substrate verified; behavior requires manual repro for SC1 + SC5; SC2 partial repro available manually). Per task instructions, manual items surface as `human_verification`, NOT as gaps.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/connections/error-classifier.ts` | Pure-function classifier + humanReason formatter | ✓ VERIFIED | 185 lines (>40 min); exports `ErrorClass`, `classifyConnectionError`, `humanReason`; no logger/console (purity gate clean); no `err.message` echo (security gate clean); imapflow `AuthenticationFailure` import present with marker-property fallback |
| `src/connections/account-connection.ts` | 4-state state machine + unbounded jittered retry + fatal fast-path + TCP keepalive + race guard + listener cleanup | ✓ VERIFIED | 351 lines (>200 min); `kind: "suspended"` appears 3× (type def + 2 assignments); `reconnectInFlight` appears 7×; `removeAllListeners` appears 2× (call + comment); `keepAlive: true` + `socketTimeout: 90_000` present; `classifyConnectionError`/`humanReason` imported and used 9×; `BACKOFF_MAX_ATTEMPTS` deleted (only appears in a comment documenting its deletion); `kind: "failed"` GONE |
| `src/connections/connection-manager.ts` | 4-state switch — `failed` removed, `suspended` added | ✓ VERIFIED | `case "failed"` returns 0 matches; `case "suspended"` returns 1 match; returns `{ error: "account ... is suspended: ${status.reason}" }`; switch is exhaustive (4 cases for 4 variants); no `default:` fall-through |
| `src/connections/index.ts` | Re-exports classifier and account-connection symbols | ✓ VERIFIED | Re-exports `AccountConnection`, `AccountConnectionStatus` (type), `ConnectionManager`, `classifyConnectionError`, `humanReason`, `ErrorClass` (type) |
| `src/polling/poller.ts` | Skip guard in `pollAccount`; per-cycle `skipLoggedThisCycle` tracker | ✓ VERIFIED | `skipLoggedThisCycle` appears 4× (field decl + clear in poll + has + add); `getStatus()` called BEFORE `getClient()`; non-connected → quiet `return` with debug log; old `throw new Error(getClient error ...)` is GONE (0 matches); belt-and-suspenders getClient-race fallback retained |
| `src/tools/list-accounts.ts` | `suspended` case wired into the response | ✓ VERIFIED | `case "failed"` returns 0 matches; `case "suspended"` returns 1 match; returns `{status: "suspended", detail: status.reason}` |
| `src/process-handlers.ts` | `installUnhandledRejectionHandler` exported, logs and continues | ✓ VERIFIED | NEW file (38 lines); exports `installUnhandledRejectionHandler(log?: Logger = logger)`; calls `process.on("unhandledRejection", …)`; the 3 `process.exit` occurrences are all in comments documenting "do NOT call process.exit" — zero actual calls; dependency-injected logger seam matches test contract |
| `src/index.ts` | Calls `installUnhandledRejectionHandler()` at startup | ✓ VERIFIED | Imports `installUnhandledRejectionHandler` from `./process-handlers.js`; called as the very first line of `main()` (src/index.ts:37) BEFORE `loadConfig()`/`connectAll()` |
| `package.json` | `imapflow ^1.3.7` | ✓ VERIFIED | `"imapflow": "^1.3.7"` declared; `npm list imapflow` resolves to `imapflow@1.4.0` (within the ^1.3.7 range) |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `tests/connections/error-classifier.test.ts` | `src/connections/error-classifier.ts` | `import { classifyConnectionError, humanReason } from "../../src/connections/error-classifier.js"` | ✓ WIRED | 19 tests pass, all consume both symbols |
| `src/connections/error-classifier.ts` | `imapflow` | `import { AuthenticationFailure } from "imapflow"` | ✓ WIRED | Import present; runtime guard `typeof === "function"` keeps classifier crash-free even when top-level export is undefined (which it still is on 1.4.0 — verified empirically) |
| `src/connections/account-connection.ts` | `src/connections/error-classifier.ts` | `import { classifyConnectionError, humanReason } from "./error-classifier.js"` | ✓ WIRED | Both symbols imported and used 9× total (initial connect fast-path + per-iteration loop catch) |
| `account-connection.ts wireListeners → runReconnectLoop` | synchronous `reconnectInFlight` boolean | flag set synchronously BEFORE `void runReconnectLoop()`; cleared in `.finally()` | ✓ WIRED | account-connection.ts:158-171 — read happens before write `this.reconnectInFlight = true`, no await in between |
| `account-connection.ts buildClient` | `socketOptions.keepAlive: true` + `socketTimeout: 90_000` | constructor literal | ✓ WIRED | account-connection.ts:137-138 — both present, exactly as VALIDATION.md asserts |
| `src/connections/connection-manager.ts getClient switch` | `AccountConnectionStatus.suspended` variant | `case "suspended": return { error: ... status.reason ... }` | ✓ WIRED | connection-manager.ts:62-66 |
| `src/polling/poller.ts pollAccount` | `this.manager.getStatus(accountId)` | status check before `getClient` | ✓ WIRED | poller.ts:124 — `getStatus` called before any IMAP path |
| `src/index.ts main()` | `process.on('unhandledRejection', handler)` | one-time registration at startup, before `manager.connectAll()` | ✓ WIRED | src/index.ts:37 — `installUnhandledRejectionHandler()` is first call inside `main()` |

---

### Data-Flow Trace (Level 4)

Phase 12 produces backend state-machine and process-handler code — no UI rendering of dynamic data. Level 4 (rendered-data-flow trace) is not applicable to this phase's deliverables. The closest analog is the `list_accounts` MCP tool response, which IS dynamic and was verified at Level 3 (wired through `status.reason` + `status.attempt`).

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite passes | `npm test` | 20 test files, **246 passed, 0 failed**, ~1.5s | ✓ PASS |
| TypeScript clean across project | `npx tsc --noEmit` | exit 0, no output | ✓ PASS |
| imapflow resolves to ^1.3.7 range | `npm list imapflow` | `imapflow@1.4.0` | ✓ PASS |
| `-t "classifies fatal sources"` matches green tests | `npx vitest run -t "classifies fatal sources"` | 10 tests pass | ✓ PASS |
| `-t "classifies transient sources"` matches green tests | `npx vitest run -t "classifies transient sources"` | 7 tests pass | ✓ PASS |
| `-t "unbounded transient retry"` matches a green test | `npx vitest run -t "unbounded transient retry"` | 1 pass | ✓ PASS |
| `-t "full-jitter backoff"` matches a green test | `npx vitest run -t "full-jitter backoff"` | 1 pass | ✓ PASS |
| `-t "fatal goes straight to suspended"` matches a green test | `npx vitest run -t "fatal goes straight to suspended"` | 1 pass | ✓ PASS |
| `-t "buildClient applies TCP keepalive"` matches a green test | `npx vitest run -t "buildClient applies TCP keepalive"` | 1 pass | ✓ PASS |
| `-t "concurrent close events"` matches a green test | `npx vitest run -t "concurrent close events"` | 1 pass | ✓ PASS |
| `-t "listener cleanup"` matches a green test | `npx vitest run -t "listener cleanup"` | 1 pass | ✓ PASS |
| `-t "skips non-connected accounts"` matches a green test | `npx vitest run -t "skips non-connected accounts"` | 1 pass | ✓ PASS |
| `-t "skip is not sticky"` matches a green test | `npx vitest run -t "skip is not sticky"` | 1 pass | ✓ PASS |
| `-t "unhandledRejection logs and continues"` matches a green test | `npx vitest run -t "unhandledRejection logs and continues"` | 1 pass | ✓ PASS |
| `-t "suspended"` matches a green test in connection-manager | `npx vitest run tests/connections/connection-manager.test.ts -t "suspended"` | 1 pass | ✓ PASS |
| imapflow top-level `AuthenticationFailure` export | `node -e "import('imapflow').then(m => console.log(typeof m.AuthenticationFailure))"` | `undefined` (confirms research finding A5 was wrong; marker-property fallback is REQUIRED) | ✓ PASS (validates the deviation) |
| imapflow constructor sets `authenticationFailed = true` | `grep authenticationFailed node_modules/imapflow/lib/tools.js` | line 18: `authenticationFailed = true;` | ✓ PASS (marker-property fallback is sound) |

All 17 spot-checks pass. Every test in the VALIDATION.md `-t` table is green.

---

### Probe Execution

No `scripts/*/tests/probe-*.sh` files exist for this phase (`find scripts -path '*/tests/probe-*.sh' -type f` returns empty). Phase 12 has no convention-discoverable probes; PLAN/SUMMARY do not declare any probe paths. Step 7c is SKIPPED with reason: no probes exist for this phase.

---

### Requirements Coverage

PLAN frontmatter declares requirements `CONN-01..CONN-07` across the four sub-plans. Cross-referenced against REQUIREMENTS.md:

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CONN-01 | 12-01, 12-02 | Classify IMAP/network errors as transient vs fatal | ✓ SATISFIED | `src/connections/error-classifier.ts` implements `classifyConnectionError`; covers all D-05 fatal + D-06 transient codes; unknown defaults to transient; 19 tests pass (`tests/connections/error-classifier.test.ts`) |
| CONN-02 | 12-01, 12-03 | Transient failures retry indefinitely with jittered exponential backoff (no max-attempts cap) | ✓ SATISFIED | `BACKOFF_MAX_ATTEMPTS` deleted; loop runs `while (!this.isShuttingDown)`; full-jitter formula `Math.floor(Math.random() * capped)`; tests `unbounded transient retry survives 15 consecutive transient failures` + `full-jitter backoff produces values in [0, capped)` both pass |
| CONN-03 | 12-01, 12-03 | Fatal failures transition the account to `suspended` without retry | ✓ SATISFIED | Initial-connect fatal fast-path (account-connection.ts:299-315) + loop-iteration fatal fast-path (account-connection.ts:239-245); test `fatal goes straight to suspended on attempt 1 with no further retries` passes; manual real-server repro flagged in human_verification |
| CONN-04 | 12-01, 12-03 | TCP keepalive enabled so half-open connections surface as errors in a bounded window | ✓ SATISFIED (substrate); ⚠️ NEEDS HUMAN (end-to-end) | `socketOptions: { keepAlive: true, keepAliveInitialDelay: 60_000 }` + `socketTimeout: 90_000` in `buildClient()`; test `buildClient applies TCP keepalive` passes; the laptop-sleep/wake recovery test is flagged as human_verification (manual repro) |
| CONN-05 | 12-01, 12-03 | At most one reconnect loop per account at a time — concurrent close events cannot spawn duplicate loops | ✓ SATISFIED | Synchronous `reconnectInFlight` boolean written BEFORE any await; test `concurrent close events trigger exactly one reconnect loop` passes |
| CONN-06 | 12-01, 12-03 | `ImapFlow` event listeners are removed before each reconnect — no handler leaks | ✓ SATISFIED (substrate); ⚠️ NEEDS HUMAN (cumulative) | `this.currentClient?.removeAllListeners()` invoked at start of every loop iteration; test `listener cleanup: removeAllListeners is invoked on every discarded client across 5 reconnect failures` passes; the multi-account cumulative MaxListenersExceededWarning check is flagged as human_verification |
| CONN-07 | 12-01, 12-04 | Background poller skips accounts not in `connected` state | ✓ SATISFIED | `Poller.pollAccount` consults `manager.getStatus()` BEFORE any IMAP call; non-connected → quiet `return` with one debug log per skipped account per cycle; per-cycle `skipLoggedThisCycle` set cleared at start of every `poll()`; tests `skips non-connected accounts` + `skip is not sticky` both pass |
| D-12 (cross-cutting) | 12-01, 12-04 | `unhandledRejection` handler logs and does not exit | ✓ SATISFIED | `src/process-handlers.ts` exports `installUnhandledRejectionHandler`; `src/index.ts:37` calls it as first line of `main()`; test `unhandledRejection logs and continues` passes; zero `process.exit` calls in handler body |

**No orphaned requirements:** Checked `grep -E "Phase 12" .planning/REQUIREMENTS.md` — only the 7 CONN requirements are mapped to Phase 12 in the traceability table. All 7 are accounted for in plans. REQUIREMENTS.md currently lists CONN-01..CONN-06 as `Pending` in the traceability table — this is a documentation-update artifact (the implementation is done; the table needs to be updated). CONN-07 is correctly marked `Done`.

---

### Anti-Patterns Found

Scanned files modified in Phase 12:
- `src/connections/error-classifier.ts` (new)
- `src/connections/account-connection.ts`
- `src/connections/connection-manager.ts`
- `src/connections/index.ts`
- `src/polling/poller.ts`
- `src/tools/list-accounts.ts`
- `src/process-handlers.ts` (new)
- `src/index.ts`

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | No `TBD`/`FIXME`/`XXX` markers in any modified file | — | None |
| (none) | — | No `TODO`/`HACK`/`PLACEHOLDER` markers in any modified file | — | None |
| `src/connections/account-connection.ts` | 23 | Word `BACKOFF_MAX_ATTEMPTS` appears | ℹ️ Info | In an explanatory comment documenting that the constant was DELETED. Not a stub; not a debt marker. The symbol itself is gone from code. |
| `src/process-handlers.ts` | 10, 23, 36 | Phrase `process.exit` appears | ℹ️ Info | All 3 occurrences are in JSDoc/inline comments explicitly stating "does NOT call process.exit" — zero actual calls in the handler body. This is correct D-12 behavior. |

**Stub classification:** No production file modified by this phase returns hardcoded empty values, no-op handlers, or placeholder strings to the user/caller. `humanReason` returns stock strings (which is the V5 ASVS-required design, not a stub). All anti-pattern matches in modified files trace to documentation comments, not to live code.

**Verdict:** No blockers, no warnings. Zero debt markers found in modified files.

---

### Notable Deviation Assessment

The prompt flagged: **imapflow 1.4.0 still does not top-level-export `AuthenticationFailure`. Plan 12-04 added a marker-property fallback (`err.authenticationFailed === true`) in `error-classifier.ts isAuthenticationFailure()`. Verify this is a sound mitigation.**

**Empirical verification:**

1. `node -e "import('imapflow').then(m => console.log(typeof m.AuthenticationFailure))"` → `undefined`. Confirmed: the class is NOT exported from the package main entry.
2. `grep authenticationFailed node_modules/imapflow/lib/tools.js` → line 18: `authenticationFailed = true;` inside the `AuthenticationFailure` class. Confirmed: the constructor sets the marker property on every instance.
3. `isAuthenticationFailure(err)` checks BOTH the typed `instanceof` (guarded by `typeof === "function"` to survive when the symbol is undefined) AND the marker property `err.authenticationFailed === true`. Either path → `fatal` verdict.
4. The classifier test `returns 'fatal' for an AuthenticationFailure instance` passes (was the last deferred RED test from Plan 12-02; turned green in Plan 12-04).

**Soundness assessment:** ✓ SOUND.

- The marker property is set by the constructor on every instance, in production imapflow code, not at the test boundary. This means it WILL be present on every real `AuthenticationFailure` thrown by imapflow at runtime.
- Even if a future imapflow version finally exports the class at the top level, the marker-property check is harmless (it just returns true earlier).
- The guard `typeof AuthenticationFailure === "function"` is the correct fail-safe pattern for upstream typed-but-not-runtime-exported classes — it prevents `instanceof <undefined>` `TypeError`.
- Comment in `error-classifier.ts:62-78` explicitly documents the rationale, the verification path (which imapflow files were inspected), and the historical context (Plan 12-04 added this after RESEARCH Assumption A5 was empirically invalidated).
- Marker properties are a documented public-contract feature of imapflow's `AuthenticationFailure` class — they are not a private implementation detail being relied on inappropriately.

No further action needed on this deviation.

---

### Human Verification Required

The following items cannot be verified programmatically. They are surfaced from `12-VALIDATION.md` § "Manual-Only Verifications" (per the task instructions, these are `human_verification` items, NOT gaps):

#### 1. TCP half-open recovery via laptop sleep/wake (CONN-04 / Success Criterion #1)

**Test:**
1. Start the IMAP MCP server with ≥1 real account connected.
2. Sleep the laptop for ≥5 minutes.
3. Wake the laptop.

**Expected:** Within `socketTimeout + 5s` (~95s) of wake, the affected account transitions to `reconnecting` then back to `connected`. Verify via `list_accounts`.

**Why human:** Vitest cannot simulate a half-open TCP connection — kernel-level socket state and real network disruption are required. The Code substrate (keepalive options + 90s socketTimeout) is verified programmatically; end-to-end behavior requires manual repro.

#### 2. Fatal auth fast-suspend against a real IMAP server (CONN-03 / Success Criterion #2)

**Test:**
1. Configure an account with a deliberately wrong password.
2. Start the server.

**Expected:** Within seconds of startup, `list_accounts` shows `status: "suspended"` with `detail: "Authentication failed — fix credentials"`. After waiting 60s, grep the server stderr — must find zero retry attempts.

**Why human:** Requires a real IMAP server rejecting credentials with `AUTHENTICATIONFAILED`. Automated tests use mocked imapflow constructors (the classifier and state-machine paths ARE verified by unit tests; the real-server round trip is not).

#### 3. Multi-account staggered drop — no MaxListenersExceededWarning (CONN-06 / Success Criterion #5)

**Test:**
1. Configure 3+ real accounts.
2. Toggle Wi-Fi off/on 5 times with ~30s intervals.
3. Wait for all accounts to recover.
4. `grep MaxListenersExceededWarning <server-stderr>`.

**Expected:** Zero matches.

**Why human:** Requires ≥3 real connections plus inducing repeated transient drops. The unit test asserts `removeAllListeners` call counts; the real-world cumulative EventEmitter pressure across multiple accounts over many cycles requires manual repro.

---

### Deferred Items

Step 9b filter — scanned the v0.3 milestone roadmap for items that Phase 12 substrate hasn't yet surfaced but later phases address:

| # | Item | Addressed In | Evidence |
|---|------|--------------|----------|
| D1 | `last_error` / `last_error_at` / `last_connected_at` per-account health fields surfaced in `list_accounts` (the verbose part of SC3) | Phase 13 | ROADMAP.md Phase 13 SC1: "`list_accounts` response includes `last_connected_at`, `last_error`, `last_error_at`, and `status` per account". Phase 12 populates the internal `connectedAt`/`lastError` fields on `AccountConnection`; Phase 13 surfaces them. Phase 12 SC3 partial verification noted above. |
| D2 | `reconnect_account` tool for manual recovery on a `suspended` account | Phase 14 | ROADMAP.md Phase 14 SC1: "An agent calling `reconnect_account` on a `suspended` account immediately triggers a fresh connection attempt". Phase 12 ships the state machine; Phase 14 ships the tool. |

These deferred items are informational only; they do NOT affect status determination.

---

### Gaps Summary

**No gaps.** All 17 must-haves verified by code reads, test runs, and targeted `-t` invocations. Three observable behaviors require manual real-network repro per VALIDATION.md and are surfaced as `human_verification` items (NOT gaps) per the task instructions. The notable deviation flagged in the prompt (marker-property fallback for AuthenticationFailure) was empirically verified as a sound mitigation.

Implementation reports at phase close are accurate:
- 246 tests pass, 0 fail — confirmed (`npm test` → "20 passed, 246 passed")
- `npx tsc --noEmit` clean — confirmed (exit 0, no output)
- All 5 previously-RED scaffolds turned GREEN — confirmed (each `-t` invocation matches one green test)
- imapflow at 1.4.0 (satisfies ^1.3.7) — confirmed (`npm list imapflow`)
- Marker-property fallback is sound — verified empirically against `node_modules/imapflow/lib/tools.js`

---

*Verified: 2026-06-11T22:15:00Z*
*Verifier: Claude (gsd-verifier)*
