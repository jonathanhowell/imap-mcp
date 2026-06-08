---
phase: 12
slug: connection-resilience-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-08
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `.planning/phases/12-connection-resilience-foundation/12-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest `^4.0.18` |
| **Config file** | none — Vitest uses defaults; project runs `vitest run` via `npm test` |
| **Quick run command** | `npx vitest run tests/connections/error-classifier.test.ts tests/connections/account-connection.test.ts tests/polling/poller.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | quick ~5s · full ~15s (fake timers, no I/O) |

---

## Sampling Rate

- **After every task commit:** Run quick command (above) — three phase-relevant files
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green AND manual TCP-half-open repro documented as PASSED
- **Max feedback latency:** ~5 seconds (quick) / ~15 seconds (full)

---

## Per-Task Verification Map

> Plan IDs (`{N}-XX-YY`) will be assigned by the planner. The rows below are the requirement→test bindings the planner MUST honor.

| Requirement | Behavior | Test Type | Automated Command | File Exists |
|-------------|----------|-----------|-------------------|-------------|
| CONN-01 | Fatal classification: `AuthenticationFailure` instance, `tlsFailed: true`, each RFC 5530 response code (D-05) → `"fatal"` | unit (`describe.each`) | `npx vitest run tests/connections/error-classifier.test.ts -t "classifies fatal sources"` | ❌ W0 — new file |
| CONN-01 | Transient classification: `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `ECONNREFUSED`, `ENETUNREACH`, `EConnectionClosed`, `NoConnection` → `"transient"` | unit | `npx vitest run tests/connections/error-classifier.test.ts -t "classifies transient sources"` | ❌ W0 |
| CONN-01 | Unknown / malformed errors default to `"transient"` (safe default) | unit | `npx vitest run tests/connections/error-classifier.test.ts -t "defaults unknown to transient"` | ❌ W0 |
| CONN-02 | Reconnect loop survives 15+ consecutive transient failures and eventually connects (replaces v0.2 "10 attempts then `failed`" test) | unit (fake timers) | `npx vitest run tests/connections/account-connection.test.ts -t "unbounded transient retry"` | ❌ W0 — extend existing |
| CONN-02 | `backoffDelayMs` produces different values across calls when jitter is active; mocked `Math.random` confirms range `[0, capped)` | unit | `npx vitest run tests/connections/account-connection.test.ts -t "full-jitter backoff"` | ❌ W0 |
| CONN-03 | Reconnect loop transitions to `suspended` on attempt 1 when classifier returns `"fatal"`; no further retries | unit (fake timers) | `npx vitest run tests/connections/account-connection.test.ts -t "fatal goes straight to suspended"` | ❌ W0 |
| CONN-04 | `buildClient()` constructs `ImapFlow` with `socketOptions: { keepAlive: true, keepAliveInitialDelay: 60_000 }` and `socketTimeout: 90_000` | unit | `npx vitest run tests/connections/account-connection.test.ts -t "buildClient applies TCP keepalive"` | ❌ W0 |
| CONN-04 | Sleep laptop ≥5min, wake, reconnect observed within `socketTimeout + 5s` | **manual** | Manual repro — see "Manual-Only Verifications" | manual |
| CONN-05 | Two `close` events emitted in same microtask batch result in exactly ONE new `ImapFlow` instance during reconnect window | unit (fake timers + microtask flush) | `npx vitest run tests/connections/account-connection.test.ts -t "concurrent close events"` | ❌ W0 |
| CONN-06 | After N ≥ 5 reconnect failures, `oldClient.removeAllListeners` invoked on every discarded client; no `MaxListenersExceededWarning` | unit | `npx vitest run tests/connections/account-connection.test.ts -t "listener cleanup"` | ❌ W0 |
| CONN-07 | `Poller.pollAccount` short-circuits without calling IMAP when status is `connecting` / `reconnecting` / `suspended`; single `debug` log per skipped account per cycle | unit | `npx vitest run tests/polling/poller.test.ts -t "skips non-connected accounts"` | ❌ W0 — extend existing |
| CONN-07 | Skipped accounts still appear in the poller's next cycle (skip is not sticky) | unit | `npx vitest run tests/polling/poller.test.ts -t "skip is not sticky"` | ❌ W0 |
| Cross-cutting | `unhandledRejection` handler logs and does not exit process | unit | `npx vitest run tests/startup.test.ts -t "unhandledRejection logs and continues"` | ❌ W0 — extend existing |
| Cross-cutting | Whole-suite regression: existing v0.2 tests (`connection-manager`, `poller`, all tool handlers) green with new 4-state union (no `failed` references remain) | regression | `npm test` | ✅ existing tests must be updated |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/connections/error-classifier.test.ts` — **NEW**; covers CONN-01 exhaustively (one `describe.each` table per fatal source + one per transient source + unknown fallback)
- [ ] `tests/connections/account-connection.test.ts` — **EXTEND** with: unbounded retry test (replaces 10-attempt cap test); jitter assertion (mock `Math.random`); fatal-classification fast-path; concurrent-close race (CONN-05); listener-cleanup count (CONN-06); buildClient socketOptions assertion (CONN-04)
- [ ] `tests/connections/connection-manager.test.ts` — **UPDATE**: remove `failed`-case tests; add `suspended`-case tests for `getClient()` error string and `getStatus()` shape
- [ ] `tests/polling/poller.test.ts` — **EXTEND**: skip-on-non-connected (CONN-07); skip log emitted at debug only once per cycle
- [ ] `tests/startup.test.ts` — **EXTEND**: `unhandledRejection` handler registered; emitting a rejection logs but does not exit (spy on `logger.error` + `process.exit`)
- [ ] No new framework install needed — Vitest + fake timers already configured

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| TCP half-open recovery via laptop sleep/wake | CONN-04 (Success Criterion #1) | Vitest cannot simulate a half-open TCP connection (kernel-level socket state); a real socket plus a real network disruption are required. | 1. Start server with ≥1 real account connected. 2. Sleep laptop for ≥5 minutes. 3. Wake laptop. 4. Observe within `socketTimeout (90s) + 5s tolerance`: account transitions to `reconnecting`, then back to `connected`. 5. Call `list_accounts` to confirm. |
| Fatal auth fast-suspend | CONN-03 (Success Criterion #2) | Requires a real IMAP server rejecting credentials with `AUTHENTICATIONFAILED`. | 1. Configure account with deliberately wrong password. 2. Start server. 3. Within seconds, `list_accounts` shows `status: "suspended"` with human-readable `last_error`. 4. Wait 60s; confirm no further retry attempts in logs. |
| Multi-account staggered drop — no listener leak warning | CONN-06 (Success Criterion #5) | Requires ≥3 real connections and inducing repeated transient drops. | 1. Configure 3+ accounts. 2. Toggle Wi-Fi off/on 5 times with 30s intervals. 3. After all accounts recover, grep server stderr for `MaxListenersExceededWarning` — must find zero. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] Manual repros (above) documented as PASSED before `/gsd:verify-work`
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
