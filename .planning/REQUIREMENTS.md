# Requirements: IMAP MCP Server

**Defined:** 2026-03-15 (v0.1.0) — extended for v0.3 on 2026-06-08
**Core Value:** An agent can reliably read, search, monitor, and tag email across multiple accounts — with the context it needs to act without guessing or re-fetching.

For prior milestones see `.planning/milestones/v0.1.0-REQUIREMENTS.md` and `.planning/milestones/v0.2-REQUIREMENTS.md`.

## v0.3 Requirements — Reliability & Cache Rethink

**Milestone goal:** Make IMAP accounts self-heal from transient failures and reconsider whether the polling/cache architecture is the right pattern for "what's new" queries.

### Connection Resilience

- [ ] **CONN-01**: Server classifies IMAP/network errors as `transient` vs `fatal`. Fatal: authentication failure, expired or invalid TLS cert. Transient: ECONNRESET, ETIMEDOUT, ENOTFOUND, socket close, TLS handshake transients. Unknown errors default to `transient`.
- [ ] **CONN-02**: Transient connection failures retry indefinitely with jittered exponential backoff (no max-attempts cap).
- [ ] **CONN-03**: Fatal connection failures transition the account to `suspended` without retry.
- [ ] **CONN-04**: TCP keepalive is enabled on IMAP sockets so half-open connections (laptop sleep, Wi-Fi switch) surface as errors within a bounded window.
- [ ] **CONN-05**: At most one reconnect loop runs per account at a time — concurrent `close` events cannot spawn duplicate loops.
- [ ] **CONN-06**: `ImapFlow` event listeners are removed before each reconnect — no handler leaks across the connection lifetime.
- [x] **CONN-07**: Background poller skips accounts not in `connected` state — no IMAP calls during reconnect or while suspended.

### Account Health Surface

- [ ] **HEALTH-01**: Account status type adds a `suspended` variant distinct from existing states, indicating fatal/non-retryable failure.
- [x] **HEALTH-02**: `list_accounts` response includes per-account health fields: `status`, `last_error`, `last_error_at`, `last_connected_at`.
- [x] **HEALTH-03**: Health metadata is detailed enough for an agent to explain to a user *why* an account is unavailable (e.g. distinguish "retrying after network drop" from "credentials need to be fixed").

### Cache Improvements

- [x] **CACHE-01**: Poller cache tracks `last_polled_at` per account (replacing the current global timestamp). *(Done — Plan 13-03)*
- [ ] **CACHE-02**: `get_new_mail` response exposes `last_polled_at` and `cache_age_seconds` per account so agents can reason about freshness.

### Manual Recovery

- [ ] **RECONN-01**: An MCP tool `reconnect_account` accepts an `account_id` and forces an immediate reconnect attempt regardless of current state.
- [ ] **RECONN-02**: `reconnect_account` works on `suspended` accounts — lets a user fix credentials/cert and recover without a server restart.
- [ ] **RECONN-03**: `reconnect_account` returns the resulting connection status.

## Future Requirements (deferred from v0.2 / v0.3 scoping)

### Write Operations

- [ ] **WRITE-01**: Agent can mark a message as read or unread (standard `\Seen` flag)
- [ ] **WRITE-02**: Agent can move a message to a different folder
- [ ] **WRITE-03**: Agent can delete or archive a message

### Send / Reply

- [ ] **SEND-01**: Agent can send / reply / forward emails (SMTP integration)

### Threading

- [ ] **THREAD-01**: Agent can group messages into conversation threads via IMAP THREAD extension (REFERENCES algorithm)

### Cache Evolution (likely v0.4+)

- [ ] **CACHE-IDLE**: IMAP IDLE-driven cache invalidation for sub-minute freshness (requires dual `ImapFlow` connections per account)
- [ ] **CACHE-DISK**: Cache persistence to disk so warm state survives MCP server restart
- [ ] **CACHE-03**: Cache evicts messages older than 30 days on each poll merge to bound memory growth on long-running servers (*deferred from v0.3 Phase 13 — 2026-06-12. Rationale: in-memory cache dies with the process; restart frequency in practice handles the unbounded-growth concern. Pair with CACHE-DISK if/when cache becomes persistent.*)

### Tech Debt

- [ ] **DEBT-01**: `read_message[s]` `from` field uses `formatAddress` helper for shape parity with `list_messages`/`search_messages`

## Out of Scope

| Capability | Reason |
|------------|--------|
| OS-level network-change detection | Not portable in Node; "fail and retry forever" is the standard approach |
| Multi-folder IDLE | Connection-count multiplier; tied to IDLE adoption (CACHE-IDLE) |
| Push notifications to agents | MCP doesn't support server-initiated push; polling tools is the model |
| Web UI or dashboard | Agent interface only |
| OAuth / proprietary APIs (Gmail API, MS Graph) | IMAP-only for maximum compatibility |
| Hardcoded credentials | Must remain externally configurable |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CONN-01 | Phase 12 | Pending |
| CONN-02 | Phase 12 | Pending |
| CONN-03 | Phase 12 | Pending |
| CONN-04 | Phase 12 | Pending |
| CONN-05 | Phase 12 | Pending |
| CONN-06 | Phase 12 | Pending |
| CONN-07 | Phase 12 | Done (Plan 12-04, commit 2077988) |
| HEALTH-01 | Phase 13 | Pending |
| HEALTH-02 | Phase 13 | Complete |
| HEALTH-03 | Phase 13 | Complete |
| CACHE-01 | Phase 13 | Done (Plan 13-03, commit 0474625) |
| CACHE-02 | Phase 13 | Pending |
| CACHE-03 | Deferred (v0.4+) | Deferred 2026-06-12 — in-memory cache dies with process |
| RECONN-01 | Phase 14 | Pending |
| RECONN-02 | Phase 14 | Pending |
| RECONN-03 | Phase 14 | Pending |

*Phase column populated by roadmapper — 2026-06-08.*
