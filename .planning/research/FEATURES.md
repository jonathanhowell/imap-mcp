# Feature Research: IMAP MCP v0.3 Reliability & Cache Rethink

**Domain:** Long-running connection-pooled IMAP gateway serving AI agents via MCP
**Researched:** 2026-06-08
**Confidence:** HIGH for error taxonomy and recovery patterns (RFC + imapflow source-verified); MEDIUM for cache architecture tradeoffs (EmailEngine + community evidence); MEDIUM for agent-consumer specifics (reasoning from MCP design patterns)

---

## Context: What Already Exists

The following are BUILT and NOT scope for v0.3 research:

- `list_accounts` already exposes `connected / connecting / reconnecting / failed` statuses with `attempt` and `detail` fields
- `AccountConnection` already has exponential backoff (1s base, 2x multiplier, 60s cap, 10 attempts max) — exits to `failed` after max attempts
- `close` event triggers `runReconnectLoop()` for unexpected disconnects
- Poller: 3-min interval, seeds 30-day window on first poll, incremental thereafter
- `get_new_mail` serves entirely from in-memory cache, never touches IMAP live

The v0.3 question is: **what is missing or wrong** with the above surfaces for an AI-agent consumer?

---

## Table Stakes

Features an agent-facing IMAP gateway must have for v0.3 reliability to be credible.
**Missing these = agents cannot reason about failures or trust the data.**

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Transient vs fatal error classification in `AccountConnection`** | Without this, the backoff loop retries auth failures forever (10 attempts wasted) and suspends a recoverable network drop too eagerly. Every serious IMAP client (Thunderbird, K-9, mutt) distinguishes these. | SMALL | imapflow throws errors with `authenticationFailed: true` and `serverResponseCode: 'AUTHENTICATIONFAILED'` — detect on first connect attempt, skip backoff loop, transition immediately to `failed`. Network errors (ECONNRESET, ENOTFOUND, ETIMEDOUT, socket close) remain transient. |
| **`failed` state is permanent only for fatal errors; unbounded retry for transient** | Current code caps at 10 attempts then goes permanently `failed` even for a network drop. An agent on a laptop that sleeps for 6 hours comes back to permanently failed accounts — requires server restart. This is the named bug in PROJECT.md. | SMALL | Remove `BACKOFF_MAX_ATTEMPTS` cap for transient errors. Fatal errors (auth, TLS cert invalid, `LOGINDISABLED`, `OVERQUOTA` permanent) transition to `failed` immediately and stay there permanently — no retry. |
| **`last_error` and `last_error_at` fields on `failed` / `reconnecting` states** | Agents calling `list_accounts` need to know *why* an account is failing to decide whether to alert a human or wait. "Failed permanently: reason" (current) is good; `reconnecting` state exposes zero error info. An agent cannot distinguish "has been retrying for 3 seconds" from "has been retrying for 4 hours". | SMALL | Add `last_error: string` and `last_error_at: ISO8601` to `reconnecting` status shape. Expose them in `list_accounts` tool response. Already have `attempt` and `nextRetryAt` — flesh out the error context. |
| **Poller skips disconnected accounts gracefully, surfaces per-account errors in cache-query results** | Current `pollAccount` throws if `getClient` returns error — caught silently at `poll()` level. An agent calling `get_new_mail` for a failed account gets `"account not found in cache"` (misleading: it IS configured, it's just offline). | SMALL | When poller detects an account is in `reconnecting` or `failed` state, include a structured error entry in the `errors` map of `MultiAccountResult` with the actual health reason rather than the generic cache-miss message. |
| **`get_new_mail` response distinguishes "cache not ready" from "account disconnected"** | Currently returns a generic cold-cache error. An agent cannot tell whether to retry in 5 seconds (server just started) or alert a human (account auth failed 3 days ago). | SMALL | Pass health status through to the error response. "Account `work` is disconnected (auth failed — check credentials)" vs "Cache warming, retry in ~60s". |

---

## Differentiators

Features that genuinely improve agent UX beyond what a standard IMAP client exposes.
**An agent, unlike a human, cannot read a UI notification or click "retry" — it needs machine-readable state it can act on.**

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **`reconnect_account` tool (manual reconnect trigger)** | An agent observing `failed` status on a transient failure (e.g., server was down for maintenance, now back) has no way to force a retry without waiting for the next IDLE event or server restart. Real MCP clients (Claude Code itself, Issue #57207) struggle with the same problem. Exposes admin-grade capability to the agent. | SMALL | Takes `account` name. Resets `AccountConnection` to `connecting`, creates a new `AbortController`, calls `connect()` again. Only meaningful when current state is `failed` after a transient failure — should no-op or return error if state is currently `connected`. Does not affect accounts with fatal (auth) failures — document this clearly. |
| **IDLE-driven cache invalidation for `get_new_mail`** | Current architecture polls every 3 minutes. An agent checking for new mail can be up to 3 minutes stale. imapflow already enters IDLE automatically (default behavior when a mailbox is selected). The `exists` event fires instantly when the server pushes a new-message notification. Hybrid approach: IDLE triggers immediate poll, time-based poll is fallback for servers without IDLE or after IDLE disconnects. | MEDIUM | Requires a dedicated IDLE connection per account (separate from the transactional client used for reads). EmailEngine's architecture uses this pattern explicitly — a "sub-connection" for IDLE on the watched folder. Wire `client.on('exists', () => void this.pollAccount(accountId))` on the IDLE connection. The time-based poller becomes a backstop (keep at 3-min default). |
| **`next_retry_at` field in `reconnecting` status** | `AccountConnection` already computes `nextRetryAt: Date` — it's just not exposed in `list_accounts` tool response. An agent can use this to schedule a retry or tell a human "account back in ~47 seconds" rather than "reconnecting". | TINY | One-line change: include `next_retry_at` in the `reconnecting` branch of `handleListAccounts`. Already computed. |
| **Per-account `last_poll_at` in cache query result** | An agent calling `get_new_mail` cannot tell if the cache is 30 seconds stale or 30 minutes stale. Knowing `last_poll_at` lets it decide whether to trust the result or call `list_messages` live instead. | SMALL | Add `last_poll_at: ISO8601 | null` per account to the poller's internal state. Surface it alongside `results` in the `MultiAccountResult` or as a separate metadata field in `get_new_mail` response. |
| **Structured health payload on `get_new_mail` responses** | Agent currently gets `results: []` with no indication whether "empty" means "no new mail" or "poller is broken and hasn't run in hours". A `meta.accounts` block showing per-account `status`, `last_poll_at`, and `message_count` would let agents distinguish these cases without a separate `list_accounts` call. | MEDIUM | Adds a new `meta` key to `get_new_mail` response shape. Breaking change — consider versioning or making `meta` opt-in with a `include_meta: boolean` param. |

---

## Anti-Features

Features to explicitly NOT build in v0.3. These are scope creep, distractions, or deliver false complexity.

| Feature | Why Requested | Why It's Wrong for v0.3 | Better Approach |
|---------|---------------|------------------------|-----------------|
| **SUSPENDED state (stop retrying on server-side rate limits)** | Gmail and Yahoo issue `[LIMIT] Rate limit hit` — some designs add a SUSPENDED state that pauses retries for N minutes. | The current codebase doesn't distinguish rate-limit errors from other transient errors. Adding SUSPENDED requires detecting rate-limit response codes from multiple servers (inconsistent), computing a backoff duration from server hints that often aren't provided, and adding yet another state. The v0.3 goal is "accounts self-heal" — rate-limit errors are transient and the jittered backoff already prevents hammering. | Classify `[LIMIT]` responses as transient. Existing backoff (max 60s) naturally backs off. Log clearly. SUSPENDED as a distinct state is v0.4+ if evidence emerges it's needed. |
| **`watch_account` / real-time MCP notification (push to agent)** | An agent that watches for new mail wants to be notified rather than poll. Some MCP designs discuss server-sent notifications. | MCP's current notification model is nascent and not universally supported by MCP clients. The agent consumer of this server is a request/response LLM — it polls when it needs data. IDLE improves cache freshness for the *poller* side; the agent still calls `get_new_mail`. Building push infrastructure is a significant protocol-level commitment. | Keep `get_new_mail` as pull. IDLE feeds the cache. Agent calls `get_new_mail` when it wants to know. Revisit when MCP notification spec matures. |
| **Configuring backoff parameters via MCP tool** | Admins might want to tune `BACKOFF_INITIAL_MS` or `BACKOFF_CAP_MS` at runtime. | This is config-file territory. Runtime-tunable backoff via MCP tools is over-engineered. The current values (1s/2x/60s) are already reasonable. | Keep as compile-time constants. If tuning is ever needed, make them config-file keys. |
| **Per-folder IDLE (watch multiple folders simultaneously)** | Agents might want instant notification for Sent, Spam, or custom folders, not just INBOX. | IMAP IDLE only works on one selected mailbox per connection. Supporting N folders requires N connections per account — connection exhaustion risk with multi-account setups. The v0.3 target is "INBOX is fresh". | Pin IDLE to INBOX only. If a user needs to watch other folders, the time-based poller (fallback) picks it up at the next 3-min interval. Multi-folder IDLE is v0.4+. |
| **OAuth2 / app-password rotation via MCP tool** | Credentials expire and agents might want to update them. | SMTP/auth credential management is a security-sensitive write operation far outside the read-mostly scope of this server. Credentials live in config files for a reason. | Credential updates require config reload (send SIGHUP or restart). Not an MCP tool concern. |
| **Cache persistence across restarts (Redis/SQLite)** | An agent might want `get_new_mail` to work immediately after server restart without waiting for the first poll. | The current 30-day seed poll on startup takes seconds to minutes depending on mailbox size. Persisting the cache adds a storage dependency, a serialization layer, and cache invalidation complexity. The v0.3 decision on cache architecture is whether to keep the current pattern — not whether to add persistence on top of it. | If startup latency is a real problem, reduce the seed window (e.g., 7 days) rather than persisting. Persistence is v0.4+. |

---

## Feature Dependencies

```
[Transient vs fatal classification] (TABLE STAKES)
    └──enables──> [Unbounded retry for transient failures] (TABLE STAKES)
    └──enables──> [reconnect_account tool] (DIFFERENTIATOR — only useful if transient failures have a recoverable path)

[last_error / last_error_at on reconnecting state] (TABLE STAKES)
    └──enhances──> [reconnect_account tool] (agent can read why it failed before deciding to reconnect)
    └──enhances──> [get_new_mail error messages] (surfaces health context in cache responses)

[IDLE-driven cache invalidation] (DIFFERENTIATOR)
    └──requires──> [Stable transient reconnect loop] (TABLE STAKES — IDLE connection also needs reconnect logic)
    └──independent-of──> [reconnect_account tool]

[next_retry_at in list_accounts] (DIFFERENTIATOR — tiny)
    └──already-computed-by──> [existing AccountConnection.runReconnectLoop]
    └──no-dependencies]

[Structured health payload on get_new_mail] (DIFFERENTIATOR)
    └──requires──> [last_poll_at per account] (DIFFERENTIATOR)
    └──enhances──> [list_accounts health fields]
```

### Dependency Notes

- **Transient/fatal classification must come first.** All other resilience features assume the error taxonomy is correct. Building `reconnect_account` before classifying errors means the tool might "reconnect" an account that will immediately fail again with the same auth error.
- **IDLE implementation is independent.** It is a cache-freshness improvement that does not interact with the error-classification path. It can be a separate phase.
- **`next_retry_at` is already computed** — it is the lowest-effort differentiator. Ship it with the table-stakes work at zero marginal cost.

---

## v0.3 Feature Scope Recommendation

### Phase 12: Error Taxonomy & Self-Healing Connections (Table Stakes)

These must ship together — partial implementation of error classification without fixing the retry loop is worse than nothing:

- [ ] Classify imapflow connect errors: `authenticationFailed: true` → fatal, all others → transient
- [ ] TLS cert errors: classify as fatal (cert mismatch, `DEPTH_ZERO_SELF_SIGNED_CERT`) vs transient (handshake timeout — network blip)
- [ ] `LOGINDISABLED` server capability → fatal immediately (server has IMAP disabled)
- [ ] Remove `BACKOFF_MAX_ATTEMPTS` cap for transient errors → unbounded retry
- [ ] Add `last_error: string` and `last_error_at: ISO8601` to `reconnecting` status shape
- [ ] Expose `next_retry_at` (already computed) in `list_accounts` response
- [ ] Poller: when account is `reconnecting`/`failed`, include structured error in `errors` map
- [ ] `get_new_mail`: distinguish cold-cache from account-disconnected in error text

### Phase 13: Manual Recovery Tool (Differentiator)

- [ ] `reconnect_account` tool: resets `failed`-state accounts to `connecting`, triggers new connect cycle
- [ ] Document: only effective on accounts that failed for transient reasons; no-ops on auth-failed accounts

### Phase 14: IDLE-Driven Cache Freshness (Differentiator)

- [ ] Dedicated IDLE connection per account (separate from transactional client)
- [ ] `exists` event triggers immediate incremental poll for that account
- [ ] Time-based poller kept as backstop
- [ ] IDLE connection participates in same reconnect loop as primary connection

### Deferred to v0.4+

- [ ] Structured health payload (`meta`) on `get_new_mail` responses
- [ ] Multi-folder IDLE
- [ ] Cache persistence (Redis/SQLite)
- [ ] SUSPENDED state for rate-limited accounts

---

## Error Taxonomy Reference

Canonical classification derived from RFC 5530, imapflow source inspection, and real-client behavior (K-9 Mail, Thunderbird, mutt):

| Error Category | Examples | Classification | Retry? |
|----------------|----------|---------------|--------|
| **Authentication** | `AUTHENTICATIONFAILED`, `authenticationFailed: true`, `LOGINDISABLED`, `EXPIRED` | Fatal | No — reconnecting with same credentials will never succeed |
| **Authorization** | `AUTHORIZATIONFAILED`, `NOPERM` | Fatal | No — auth worked but access denied; config change required |
| **TLS cert mismatch** | `DEPTH_ZERO_SELF_SIGNED_CERT`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, hostname mismatch | Fatal | No — cert is wrong, not transient |
| **TLS handshake timeout** | Socket-level `ETIMEDOUT` during TLS phase | Transient | Yes — network blip during negotiation |
| **Network drop** | `ECONNRESET`, `ENOTFOUND`, `ETIMEDOUT`, `EPIPE`, socket `close` event | Transient | Yes — standard reconnect target |
| **Server-side rate limit** | `[LIMIT] Rate limit hit`, `NO Temporary authentication failure (rate-limit)` | Transient | Yes — but log clearly; backoff handles spacing |
| **Server unavailable** | RFC 5530 `UNAVAILABLE` (LDAP/RADIUS backend down), `SERVERBUG` | Transient | Yes — server-side temporary issue |
| **Connection limit** | Gmail 15-conn limit, Exchange 16-conn default | Transient | Yes — after delay; reduce concurrent connections if persistent |
| **Quota exceeded** | `OVERQUOTA` on LOGIN | Depends — usually transient (quota refills) | Yes — but log; quota is server-side and will eventually clear |
| **Capability mismatch** | Server drops a capability mid-session that the client required | Transient | Yes — reconnect re-negotiates capabilities |

**Implementation note:** imapflow surfaces `error.authenticationFailed === true` and `error.serverResponseCode` on connect errors. Check `authenticationFailed` first; it covers the auth/authorization family. For TLS cert errors, check `error.code` for Node.js TLS error codes (`DEPTH_ZERO_SELF_SIGNED_CERT`, etc.) — these do not carry `authenticationFailed`.

---

## Cache Architecture Decision

**Verdict: Keep the polling cache, add IDLE as a push trigger. Do not replace with on-demand fetch.**

### Rationale

The current model (time-based poller → in-memory cache → `get_new_mail` serves from cache) is the right architecture for an LLM agent consumer. Here is why:

**An LLM calls tools synchronously within an inference pass.** If `get_new_mail` went live to IMAP, every call would block for a network round-trip (typically 200–2,000ms), multiplied by N accounts. The 3-minute cache lag is a reasonable tradeoff for zero-latency response to the agent.

**The problem is not the cache pattern, it is freshness.** IDLE solves this without abandoning the cache: the poller's `pollAccount()` fires immediately when IDLE signals `exists`, so the cache is typically fresh within seconds of arrival for servers supporting IDLE (Gmail, Fastmail, Dovecot, Exchange — all support it).

**EmailEngine (the production system built on imapflow) uses this exact hybrid:** a persistent main connection + a sub-connection on IDLE for watched folders, with polling as the backstop. This is the proven pattern for a server-side IMAP gateway.

**What to NOT do:** Do not make `get_new_mail` fall through to a live IMAP fetch on cache miss. This couples response latency to IMAP server health, breaks the "cache is the truth" invariant that enables keyword filtering, and makes the tool unpredictable for agents. If freshness is inadequate, fix the freshness mechanism (IDLE), not the serving model.

---

## Sources

- RFC 5530 (IMAP Response Codes): https://www.rfc-editor.org/rfc/rfc5530.html — defines UNAVAILABLE, AUTHENTICATIONFAILED, AUTHORIZATIONFAILED, EXPIRED, LOGINDISABLED, OVERQUOTA
- imapflow GitHub Issue #224 (auth error properties): https://github.com/postalsys/imapflow/issues/224 — confirms `authenticationFailed: true` and `serverResponseCode` on error objects
- imapflow GitHub Issue #210 (IDLE examples): https://github.com/postalsys/imapflow/issues/210 — `exists` event for new mail detection
- imapflow Client API docs: https://imapflow.com/docs/api/imapflow-client/ — `usable`, `idling`, `exists`/`expunge`/`flags` events, `maxIdleTime`, `missingIdleCommand`
- EmailEngine performance tuning (IMAP sub-connection architecture): https://learn.emailengine.app/docs/advanced/performance-tuning
- AWS Exponential Backoff and Jitter blog: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/ — decorrelated jitter recommendation
- K-9 Mail / Thunderbird Android Issue #8824 (network transition reconnect regression): https://github.com/thunderbird/thunderbird-android/issues/8824 — real-world evidence of reconnect failures on network change
- Claude Code MCP reconnect issues: https://github.com/anthropics/claude-code/issues/57207 — manual reconnect need in MCP ecosystem; https://github.com/anthropics/claude-code/issues/10129 — auto-reconnect gap
- Yahoo IMAP rate limit bug (Thunderbird): https://bugzilla.mozilla.org/show_bug.cgi?id=1727971 — `[LIMIT] Rate limit hit` as transient
- MCP health check design patterns: https://fast.io/resources/implementing-mcp-server-health-checks/

---
*Feature research for: IMAP MCP v0.3 Reliability & Cache Rethink*
*Researched: 2026-06-08*
