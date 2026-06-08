# Project Research Summary

**Project:** IMAP MCP Server — v0.3 Reliability & Cache Rethink
**Domain:** Long-running connection-pooled IMAP gateway serving AI agents via MCP
**Researched:** 2026-06-08
**Confidence:** HIGH

---

## Executive Summary

v0.3 addresses two distinct problems that share a single root cause: the codebase treats all IMAP failures identically. The bounded reconnect loop (`BACKOFF_MAX_ATTEMPTS = 10`) gives up on transient network drops after roughly three minutes, requiring server restarts after every sleep/wake cycle. The same loop retries fatal auth failures all ten times, wasting time and risking account lockouts. The fix is targeted: remove the attempt cap for transient errors, classify auth and TLS failures as immediately fatal using imapflow's own `AuthenticationFailure` class, add TCP keepalive and reduce `socketTimeout` from 300s to 90s to surface dead connections promptly, and extend the status union with `last_error`/`last_error_at` so agents can reason about failure cause. These are surgical changes to `AccountConnection` and one new `error-classifier.ts` module — no architectural restructuring.

On the cache side, all four research streams reached the same verdict: keep the polling cache and improve it (Option A). The three-minute staleness is a documented behavior, not a bug. IDLE push notification fixes freshness but requires a dedicated second `ImapFlow` connection per account — IDLE holds a mailbox lock that blocks tool operations on the same client, making dual connections mandatory. That redesign is its own future milestone. What v0.3 does need: per-account `lastPollTime` tracking (the current single global timestamp hides per-account staleness), 30-day cache eviction (current `mergeIntoCache` never evicts, causing unbounded growth), and `cache_age_seconds` per account in `list_accounts` health fields.

The main implementation risk is sequencing: error classification and the unbounded retry fix must come before everything that depends on them. TCP keepalive, the `reconnectInFlight` guard, and the outer try/catch in the reconnect loop belong in the same phase as the retry logic. Cache and health field improvements are genuinely independent. The `reconnect_account` manual-trigger tool is a small differentiator that rounds out the reliability story once error classification is in place — all research streams agree it should ship in v0.3.

---

## Key Findings

### Recommended Stack

The existing stack is unchanged and correct. The only version change needed is upgrading imapflow to ^1.3.7 (released 2026-06-08). No state machine library is needed (4→5 state union is 40 lines of TypeScript). No network-detection library is needed (fail-and-retry-forever is the correct pattern). EventEmitter is sufficient for IDLE fan-out (no RxJS). `cockatiel ^4.0.0` is vetted for per-operation retry if a phase adds retried IMAP operations, but may not be needed in v0.3 scope at all. `better-sqlite3 ^12.10.0` is the right choice if cache persistence is ever needed — defer to v0.4.

**Core technologies:**
- `imapflow ^1.3.7` — IMAP client; upgrade from ^1.2.13; `AuthenticationFailure` export is the classification key
- TypeScript discriminated union — connection state machine extension; zero new dependencies
- `cockatiel ^4.0.0` — per-operation retry with typed error predicate (ESM-only in v4); add only if a phase adds retried IMAP ops
- `better-sqlite3 ^12.10.0` — cache persistence; defer to v0.4

### Expected Features

**Must have (table stakes) — v0.3 ships these:**
- Transient vs fatal error classification — `AuthenticationFailure` → immediately fatal; everything else → transient, retry forever
- Unbounded reconnect for transient failures — remove `BACKOFF_MAX_ATTEMPTS = 10` cap
- `last_error` and `last_error_at` on `reconnecting` status — agents need to distinguish "retrying for 3 seconds" from "retrying for 4 hours"
- TCP keepalive + `socketTimeout` reduced to 90s — surfaces half-open TCP connections after sleep (current 300s means accounts hang silently up to 5 minutes after laptop wake)
- Full jitter in `backoffDelayMs` — prevents thundering-herd reconnect storms across multiple accounts; raise `BACKOFF_CAP_MS` to 120s
- `reconnectInFlight` boolean flag — race-safe double-reconnect prevention (status-check guard is racy because async loop hasn't written status yet when `close` fires twice)
- Outer try/catch in `runReconnectLoop` + `process.on('unhandledRejection')` handler in `index.ts`
- `removeAllListeners()` on discarded `ImapFlow` instances — prevents EventEmitter listener leak across reconnect attempts
- Poller skips `reconnecting`/`failed` accounts gracefully (structured `errors` entry, not thrown exception)
- `get_new_mail` error message distinguishes cold-cache from account-disconnected
- Per-account `lastPollTimes: Map<string, Date | null>` in Poller — replaces single global timestamp
- Cache eviction: 30-day sliding window in `mergeIntoCache`
- `list_accounts` health fields: `last_connected`, `last_error`, `next_retry_at`, `last_poll`, `cache_age_seconds`

**Should have (differentiators) — v0.3 ships these:**
- `reconnect_account` MCP tool — resets a transient-failed account to `connecting` without server restart
- `next_retry_at` exposed in `list_accounts` reconnecting branch — already computed, one-line addition

**Defer to v0.4+:**
- IDLE-driven cache freshness — dual-connection redesign required; its own milestone
- Structured `meta` health block on `get_new_mail` responses
- Cache persistence (SQLite)
- Multi-folder IDLE
- `\Seen` toggle, SMTP send, message moves

**Anti-features — do not build:**
- `watch_account` / real-time MCP push notifications
- Runtime-configurable backoff parameters via MCP tool
- Per-folder IDLE in v0.3
- SUSPENDED as a separate named state (use `failed` with `fatal: boolean` discriminant instead)

### Architecture Approach

The architecture changes are surgical, not structural. `AccountConnection` gains a 5th state (either a named `suspended` variant or `failed` with `fatal: true` — see Decision Point 1), two new fields (`connectedAt`, `lastError`), and a call to a new pure-function module `error-classifier.ts`. `Poller` gains per-account timestamps and cache eviction. `list_accounts` tool gains health fields and requires `poller` to be passed alongside `manager`. Everything else is unchanged: tool API surface, `get_new_mail` serving model, `flag_message`/`unflag_message` write path, `ConnectionManager` registry.

**Major components:**
1. `src/connections/error-classifier.ts` (NEW) — pure function `(err: unknown) => "transient" | "fatal"`; no state; built first as it has no upstream dependencies
2. `AccountConnection` (MODIFIED) — add fatal/suspended state variant; add `connectedAt`/`lastError`; call classifier in reconnect loop; add `reconnectInFlight` guard; TCP keepalive in `buildClient()`
3. `Poller` (MODIFIED) — per-account `lastPollTimes` map; cache eviction; `getLastPollTime()` accessor
4. `list-accounts` tool (MODIFIED) — accept `poller` param; add health fields to output
5. `reconnect_account` tool (NEW) — resets a `failed(fatal=false)` account to `connecting`

### Critical Pitfalls

1. **TCP half-open after sleep** — socket looks alive but hangs indefinitely; `keepAlive: true` + `socketTimeout: 90_000` in `buildClient()`; this is the root cause of the original PROJECT.md bug (confirmed imapflow issue #27)
2. **Auth failures retried 10 times, potentially locking accounts** — `AuthenticationFailure` instanceof check must be the first branch in the reconnect loop; transition to `failed(fatal=true)` after attempt 1, not attempt 10
3. **Concurrent double-reconnect** — `error` fires then `close` fires synchronously; status-check guard is race-prone; replace with synchronous `reconnectInFlight: boolean` flag
4. **Unbounded cache growth** — `mergeIntoCache` never evicts; add 30-day cutoff trim after each merge
5. **EventEmitter listener leak** — each reconnect creates a new `ImapFlow` but never calls `removeAllListeners()` on the old one; at 10+ reconnects per account, GC retention grows and `MaxListenersExceededWarning` appears

---

## Implications for Roadmap

### Phase Naming Reconciliation

The four research files used different phase numbering conventions:

| Research file | Proposed phases | Canonical names used here |
|---|---|---|
| FEATURES.md | Phase 12: Error Taxonomy + self-healing; Phase 13: reconnect_account tool; Phase 14: IDLE cache | Phase 12: Connection Resilience; Phase 13: Health + Cache; Phase 14: reconnect_account |
| ARCHITECTURE.md | Phase 12: Resilience Foundation (classifier + state machine); Phase 13: Health Surfacing (poller + list_accounts) | Phase 12 = Architecture's Phase 12; Phase 13 = Architecture's Phase 13; Phase 14 = Features's Phase 13 |
| STACK.md | Fix 1–3 (no numbered phases) | All map into Phase 12 |
| PITFALLS.md | Phase 12: Connection Lifecycle; Phase 13: Transient vs Fatal; Phase 14: Cache | Phase 12 collapses Pitfalls' Phase 12+13 (they belong together); Phase 13 = cache; Phase 14 = reconnect_account |

**Recommended: 3 phases (12, 13, 14).** Architecture's 2-phase split (12 = classifier+state machine, 13 = health+cache) is the closest match to the recommended structure. Features's Phase 13 (`reconnect_account`) becomes Phase 14 as a short focused phase.

---

### Phase 12: Connection Resilience Foundation

**Rationale:** This is the named bug fix from PROJECT.md. Everything else (health surfacing, reconnect tool) depends on a correct error classification and unbounded retry loop. Must ship first.

**Delivers:**
- `src/connections/error-classifier.ts` — pure `classifyConnectionError()` function
- `AccountConnection` 5-state machine with `connectedAt`, `lastError`, `fatal` discriminant
- `reconnectInFlight` boolean guard — race-safe double-reconnect prevention
- Unbounded retry for transient failures; immediate `failed(fatal=true)` for `AuthenticationFailure` / TLS cert errors
- TCP keepalive + `socketTimeout: 90_000` in `buildClient()`
- Full jitter in `backoffDelayMs`; `BACKOFF_CAP_MS` raised to 120s
- `removeAllListeners()` on discarded `ImapFlow` instances
- Outer try/catch in `runReconnectLoop`; `process.on('unhandledRejection')` in `index.ts`
- imapflow upgraded to ^1.3.7

**Addresses features:** Transient vs fatal classification, unbounded retry, reconnect correctness (all table stakes)

**Avoids pitfalls:** TCP half-open (#1), auth-failure infinite retry (#4), concurrent double-reconnect (#2), unhandled rejections (#10), listener leak (#11), bounded-retry exhaustion (#8)

**Research flag:** Standard patterns — no research phase needed

---

### Phase 13: Health Surfacing + Cache Improvements

**Rationale:** Depends on Phase 12 completing (`connectedAt`, `lastError`, `failed(fatal)` state must exist before health fields can be populated). Cache changes are structurally independent but should follow Phase 12 so health fields can surface both connection and poll data coherently in a single `list_accounts` response.

**Delivers:**
- Per-account `lastPollTimes: Map<string, Date | null>` in `Poller` (replaces single global `lastPollTime`)
- Cache eviction: 30-day sliding window in `mergeIntoCache`
- `getLastPollTime(accountId)` accessor on `Poller`
- `list_accounts` health fields: `last_connected`, `last_error`, `next_retry_at`, `last_poll`, `cache_age_seconds`
- `index.ts` passes `poller` to `handleListAccounts`
- `get_new_mail` error distinguishes cold-cache from account-disconnected
- Poller skips `reconnecting`/`failed` accounts with structured `errors` entry

**Addresses features:** Per-account health visibility (table stakes), cache age transparency (differentiator), `next_retry_at` exposure (differentiator — one-liner)

**Avoids pitfalls:** Global poll timestamp masking per-account staleness, unbounded cache memory growth (#6), cache divergence opacity (#7)

**Research flag:** Standard patterns — no research phase needed

---

### Phase 14: `reconnect_account` Tool

**Rationale:** Thin tool wrapping Phase 12 state machine. Small surface area but genuine agent value: agents observing `failed(fatal=false)` status have no way to force a retry without server restart. Gets its own phase for a clean validation checklist.

**Delivers:**
- `reconnect_account` MCP tool with `account` parameter
- No-ops (with descriptive error) if account is `connected` or `failed(fatal=true)`
- Resets `AccountConnection` to `connecting`, creates new `AbortController`, calls `connect()`

**Addresses features:** Manual recovery for agents (differentiator — evidence from Claude Code issues #57207, #10129)

**Research flag:** Standard patterns — thin wrapper on Phase 12 machinery

---

### Phase Ordering Rationale

- Phase 12 must precede Phase 13 (health fields consume `connectedAt`/`lastError` from Phase 12)
- Phase 12 must precede Phase 14 (reconnect tool requires error classification to know when to act)
- Phase 13 and Phase 14 are mutually independent; either order works
- Cache eviction (Phase 13) does not touch the tool API surface
- IDLE (deferred) requires dual `ImapFlow` instances per account — a structural change to `ConnectionManager`, `Poller`, and every tool calling `getClient()`; separate future milestone

---

## Decision Points

Three explicit decisions required before requirements are written:

### Decision Point 1: Cache Architecture Choice

**Question:** Which cache option ships in v0.3?

All four research streams recommend **Option A (Keep + Improve)**. Architecture, Pitfalls, and Stack all conclude that IDLE is the right future direction but belongs in a separate milestone because it mandates dual `ImapFlow` connections per account (IDLE holds a mailbox lock; tool operations on the same client block until IDLE releases). Features.md's "hybrid IDLE pattern viable" refers to the EmailEngine hybrid of IDLE-push + polling backstop — that hybrid is what the future IDLE milestone implements, not an alternative to Option A in v0.3.

Option C (live fallback on cache miss) is explicitly recommended against by Architecture: "conflates two tools" and "if freshness is inadequate, fix the freshness mechanism (IDLE), not the serving model."

**What to decide:** Confirm Option A, or explicitly add an IDLE phase to v0.3 scope (accepting a larger, more complex milestone).

---

### Decision Point 2: 5th State — `suspended` or `failed(fatal: true)`?

Architecture proposed a named `SUSPENDED` state as a 5th variant of the union, distinct from `FAILED` (which would be reserved for "exhausted transient retries"). Stack, Features, and Pitfalls implicitly used `failed` with a `fatal: boolean` discriminant.

Both approaches carry the same information. Trade-off:
- Named `suspended` state: more self-documenting, requires `list_accounts` consumers to handle a new `status` string value
- `failed` with `fatal: boolean`: no new `status` string; `fatal` field discriminates; slightly simpler for consumers that only check `status === "connected"`

**What to decide:** Pick one naming convention before requirements are written. Both are valid; just needs consistency.

---

### Decision Point 3: Does `reconnect_account` Ship in v0.3?

Features.md says yes (Phase 13); Architecture implies it is small enough to fold into Phase 12 or 13. Pitfalls does not address it. Stack does not address it.

**Recommendation: Yes, ship in v0.3 as Phase 14.** The tool is genuinely small. The agent value is real (Claude Code issues #57207 and #10129 document the manual reconnect gap in MCP ecosystems). Deferring to v0.4 is not justified.

**What to decide:** Confirm v0.3 scope, and whether Phase 14 is a standalone phase or folded into Phase 12 or 13.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All claims verified via Context7 + official imapflow docs; npm versions spot-checked 2026-06-08 |
| Features | HIGH (error taxonomy); MEDIUM (agent-consumer UX) | Error classification is RFC + imapflow source verified; agent UX rationale is reasoned from MCP design patterns |
| Architecture | HIGH | Based on direct codebase read + verified imapflow behavior; Option A is conservative and low-risk |
| Pitfalls | HIGH | TCP half-open confirmed in imapflow issue #27; concurrent reconnect race confirmed via EventEmitter synchronous dispatch behavior; cache growth confirmed via codebase inspection |

**Overall confidence:** HIGH

### Gaps to Address

- **`suspended` vs `failed(fatal: true)` naming** — Decision Point 2 above; must be resolved before requirements are written
- **`reconnect_account` behavior on `failed(fatal=true)` accounts** — All research agrees the tool should no-op or return a descriptive error; exact error message and `isError` vs descriptive `message` needs to be decided in requirements
- **Poller startup stagger** — Pitfalls flagged that all accounts poll simultaneously at startup (30-day seed × N accounts at once). Not addressed in any proposed phase. Could fold into Phase 13 cache work as a low-risk addition; or defer. Low priority unless 3+ accounts with large mailboxes.
- **`from` field formatting tech debt** — PROJECT.md notes `read_message`/`read_messages` use bare address instead of `formatAddress(name, addr)`. Not in v0.3 scope per any research file but flagged as tech debt; could be a micro-fix in any phase touching those files.

---

## Sources

### Primary (HIGH confidence)
- `/postalsys/imapflow` (Context7) — events, IDLE, `AuthenticationFailure`, reconnect pattern, mailbox lock, `socketTimeout`, `usable` property
- `https://imapflow.com/docs/api/imapflow-client/` — event list, IDLE options, `socketOptions`, `connectionTimeout`
- `https://github.com/postalsys/imapflow/issues/27` — hanging promises after connection troubles (TCP half-open confirmation)
- `https://github.com/postalsys/imapflow/issues/15` — new instance required on reconnect (`ERR_STREAM_WRITE_AFTER_END`)
- `https://github.com/postalsys/imapflow/issues/41` — stale client reuse crash pattern
- `https://github.com/postalsys/imapflow/releases` — v1.3.7 confirmed 2026-06-08
- `https://www.rfc-editor.org/rfc/rfc5530.html` — IMAP response codes: `AUTHENTICATIONFAILED`, `UNAVAILABLE`, `LOGINDISABLED`, `OVERQUOTA`
- `https://datatracker.ietf.org/doc/html/rfc2177` — IMAP IDLE; 29-minute client-side restart requirement
- `https://bugzilla.mozilla.org/show_bug.cgi?id=1535969` — Thunderbird TCP keepalive for IMAP suspend/resume detection
- `src/connections/account-connection.ts` — direct codebase read; existing state machine, reconnect loop, `BACKOFF_MAX_ATTEMPTS`
- `src/polling/poller.ts` — direct codebase read; cache structure, `mergeIntoCache`, no eviction, single global `lastPollTime`
- `src/tools/list-accounts.ts` — direct codebase read; current health surfacing shape
- `/connor4312/cockatiel` (Context7) — `handleWhen`, `ExponentialBackoff` API; v4.0.0 ESM-only confirmed

### Secondary (MEDIUM confidence)
- `https://learn.emailengine.app/docs/advanced/performance-tuning` — EmailEngine IDLE sub-connection architecture (hybrid pattern in production)
- `https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/` — full jitter recommendation
- `https://github.com/postalsys/imapflow/issues/224` — `authenticationFailed: true` and `serverResponseCode` on error objects
- `https://deepwiki.com/postalsys/imapflow/5.3-real-time-updates-with-idle` — auto-IDLE mechanics, preCheck queue
- `https://github.com/anthropics/claude-code/issues/57207` and `#10129` — manual reconnect need in MCP ecosystem (agent UX evidence)

### Tertiary (context/confirmation)
- `https://github.com/thunderbird/thunderbird-android/issues/8824` — real-world reconnect failure on network change
- `https://bugzilla.mozilla.org/show_bug.cgi?id=1727971` — Yahoo `[LIMIT] Rate limit hit` as transient error
- `https://fast.io/resources/implementing-mcp-server-health-checks/` — MCP health check design patterns

---
*Research completed: 2026-06-08*
*Ready for roadmap: yes*
