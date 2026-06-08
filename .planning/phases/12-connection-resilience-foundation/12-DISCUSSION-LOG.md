# Phase 12: Connection Resilience Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-08
**Phase:** 12-connection-resilience-foundation
**Areas discussed:** Error taxonomy edge cases, Reconnect-loop log volume, `failed` state role
**Areas skipped (research defaults accepted):** Backoff tuning & jitter

---

## Gray-Area Selection

| Area | Description | Selected |
|------|-------------|----------|
| Error taxonomy edge cases | RFC 5530 codes, TLS handshake splits, server-rejection ambiguity | ✓ |
| Backoff tuning & jitter | 60s vs 120s cap, full jitter, socketTimeout 300s → 90s | (skipped — accepted research defaults) |
| Reconnect-loop log volume | Logging cadence with unbounded retry | ✓ |
| `failed` state — keep it reachable? | Role of `failed` in v0.3 state union | ✓ |

---

## Error Taxonomy Edge Cases

### Question 1: RFC 5530 server response codes — fatal or transient?

| Option | Description | Selected |
|--------|-------------|----------|
| All-fatal (strict) | LOGINDISABLED, PRIVACYREQUIRED, AUTHENTICATIONFAILED, OVERQUOTA, UNAVAILABLE, EXPIRED, ALERT, CONTACTADMIN → fatal. Unrecognized codes → transient. | ✓ |
| Split: auth-class fatal, server-state transient | Auth/cert/expired → fatal; OVERQUOTA/UNAVAILABLE → transient (may clear without user action). | |
| Only AUTHENTICATIONFAILED + TLS fatal | Strict spec-minimum — every other code transient. | |

**User's choice:** All-fatal (strict)
**Notes:** All listed RFC 5530 codes signal account-level conditions a user must fix; retrying spams unresolvable conditions and risks server-side lockout. Unrecognized codes still default to transient (CONN-01).

### Question 2: TLS-related failures — fatal vs transient split

| Option | Description | Selected |
|--------|-------------|----------|
| Use imapflow's `tlsFailed` only | `tlsFailed === true` → fatal; everything else (handshake timeout, mid-handshake ECONNRESET) → transient. No message parsing. | ✓ |
| Distinguish expired/untrusted from hostname-mismatch | Inspect `err.code` (`CERT_HAS_EXPIRED`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `ERR_TLS_CERT_ALTNAME_INVALID`) → all fatal. | |
| Treat any TLS-tagged error as fatal | Conservative: any TLS hint → fatal. Protects against undocumented quirks but may suspend on transient hiccups. | |

**User's choice:** Use imapflow's `tlsFailed` only
**Notes:** Trust imapflow's own semantics. Avoids brittle message parsing.

---

## Reconnect-Loop Log Volume

### Question 1: Logging cadence for ongoing reconnect attempts

| Option | Description | Selected |
|--------|-------------|----------|
| Throttled: log every Nth attempt | Always log attempt 1, error-message changes, success, suspension. Throttled set: attempts 1, 2, 3, 5, 10, 20, 40, 80… at `warn`; others at `debug`. | ✓ |
| Time-windowed throttle | First failure logs immediately; subsequent identical-error attempts log at most once per 5 min. | |
| Log every attempt, drop level to debug | Keep per-attempt log at `debug`; `warn` only on first failure and suspension. | |
| You decide | Defer to implementer. | |

**User's choice:** Throttled: log every Nth attempt
**Notes:** Multi-hour outage on a 3-account server would otherwise emit thousands of identical lines.

---

## `failed` State Role

### Question 1 (first ask) — REJECTED, user asked for re-framing

User asked: "what state are we using of transient failure"
Claude clarified: transient failures live in `reconnecting` forever; `suspended` covers fatal; `failed` has no organic trigger in v0.3.
User asked: "re-ask with that framing"

### Question 1 (re-asked with clarified framing)

| Option | Description | Selected |
|--------|-------------|----------|
| Defined but unreachable in v0.3 | Keep `failed` in union for forward compat (STATE.md decision). No writer in v0.3; handlers preserved for type-completeness. | |
| Real trigger: classifier-loop safety net | After K consecutive unknown-code attempts → `failed`. Defense against classifier bug / imapflow regression. | |
| Real trigger: explicit `stop()` method | Internal API to abort retry loop and mark `failed`. Escape hatch before Phase 14 ships. | |
| Drop `failed` from the union entirely | Reduce to 4 reachable states. Cleanest model; contradicts STATE.md. | ✓ |

**User's choice:** Drop `failed` from the union entirely
**Notes:** Type system mirrors actual v0.3 behavior. STATE.md's "5 named states" decision is **explicitly overridden** by this phase — CONTEXT.md D-01 documents the override; STATE.md / PROJECT.md key-decisions must be updated when v0.3 ships.

---

## Closing Check

### Question 1: Ready to write CONTEXT or more to discuss?

| Option | Description | Selected |
|--------|-------------|----------|
| Ready for context | Backoff parameters follow research defaults. | ✓ |
| Confirm backoff parameters | Explicit lock on backoff numbers. | |
| Explore more gray areas | Process-level unhandledRejection handler, initial-connect fatal handling, poller skip logging. | |

**User's choice:** Ready for context
**Notes:** Implied acceptance of research defaults (BACKOFF_CAP_MS=120_000, full jitter, socketTimeout=90_000, keepAliveInitialDelay=60_000). Captured as D-09 / D-13 in CONTEXT.md.

---

## Claude's Discretion

None explicitly deferred — every gray area surfaced was resolved with an explicit choice or by accepting a research-recommended default.

## Deferred Ideas

- `failed` state with real trigger (v0.4+ phase, on demand)
- IDLE-driven cache freshness (CACHE-IDLE)
- Cache persistence to disk (CACHE-DISK)
- `prevent-flag-tools-from-modifying-reserved-imap-keywords` todo (out of Phase 12 scope)
