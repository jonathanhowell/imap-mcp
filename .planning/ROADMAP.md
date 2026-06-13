# Roadmap: IMAP MCP Server

## Milestones

- ✅ **v0.1.0 IMAP MCP v0.1** — Phases 1–6 (shipped 2026-03-15)
- ✅ **v0.2 Agent UX** — Phases 7–11.1 (shipped 2026-06-08)
- 🚧 **v0.3 Reliability & Cache Rethink** — Phases 12–14 (in progress)

## Phases

<details>
<summary>✅ v0.1.0 IMAP MCP v0.1 (Phases 1–6) — SHIPPED 2026-03-15</summary>

- [x] Phase 1: Foundation (3/3 plans) — completed 2026-03-11
- [x] Phase 2: Connection Management (3/3 plans) — completed 2026-03-12
- [x] Phase 3: Core Read Operations (6/6 plans) — completed 2026-03-12
- [x] Phase 4: Multi-Account Unified View (3/3 plans) — completed 2026-03-14
- [x] Phase 5: Background Polling (4/4 plans) — completed 2026-03-14
- [x] Phase 6: Hardening and Release (4/4 plans) — completed 2026-03-15

Full details: `.planning/milestones/v0.1.0-ROADMAP.md`

</details>

<details>
<summary>✅ v0.2 Agent UX (Phases 7–11.1) — SHIPPED 2026-06-08</summary>

- [x] Phase 7: Header Enrichment (2/2 plans) — completed 2026-03-15
- [x] Phase 8: Account Context and Tool Ergonomics (2/2 plans) — completed 2026-03-16
- [x] Phase 9: Batch Read (3/3 plans) — completed 2026-03-16
- [x] Phase 10: Search and Attachment UX (2/2 plans) — completed 2026-03-16
- [x] Phase 11: Keyword Flagging (2/2 plans) — completed 2026-03-18
- [x] Phase 11.1: unflag_message tool (1/1 plan, INSERTED) — completed 2026-03-19

Full details: `.planning/milestones/v0.2-ROADMAP.md`

</details>

### 🚧 v0.3 Reliability & Cache Rethink (In Progress)

**Milestone Goal:** Make IMAP accounts self-heal from transient failures and improve cache transparency so agents can reason about staleness and manually trigger recovery when needed.

- [x] **Phase 12: Connection Resilience Foundation** - Error classifier, unbounded transient retry, jittered backoff, TCP keepalive, race guard, listener cleanup, suspended state, poller skip (completed 2026-06-11)
- [ ] **Phase 13: Health Surface + Cache Improvements** - Per-account poll tracking, `list_accounts` health fields, `get_new_mail` freshness metadata (30-day eviction deferred to v0.4+)
- [ ] **Phase 14: Manual Recovery Tool** - `reconnect_account` MCP tool wrapping the Phase 12 state machine

## Phase Details

### Phase 12: Connection Resilience Foundation
**Goal**: IMAP accounts recover automatically from transient network failures without server restart, and fatal failures are immediately identified and quarantined
**Depends on**: Phase 11.1 (last v0.2 phase)
**Requirements**: CONN-01, CONN-02, CONN-03, CONN-04, CONN-05, CONN-06, CONN-07
**Success Criteria** (what must be TRUE):
  1. An account that drops during a 10-minute network outage (simulated by disabling Wi-Fi) reconnects automatically once connectivity is restored — no server restart needed
  2. An account with wrong credentials transitions to `suspended` after the first failed attempt and stops retrying — no further reconnect attempts occur
  3. Calling `list_accounts` during a reconnect shows `status: "reconnecting"` with a `last_error` reason; `status: "suspended"` accounts display a human-readable reason explaining what is fatal
  4. Two simultaneous `close` events on the same account do not spawn two concurrent reconnect loops — only one loop runs at a time
  5. A server running three or more accounts with staggered connection drops does not accumulate EventEmitter `MaxListenersExceededWarning` messages across restart cycles
**Plans**: 4 plans
- [x] 12-01-PLAN.md — Wave 0 failing-test scaffolds for CONN-01..CONN-07 (5 test files) — completed 2026-06-09
- [x] 12-02-PLAN.md — Build `src/connections/error-classifier.ts` pure-function module (CONN-01) — completed 2026-06-09
- [x] 12-03-PLAN.md — Refactor `AccountConnection`: 4-state union, unbounded jittered retry, fatal fast-path, TCP keepalive, race guard, listener cleanup, throttled logging (CONN-02..CONN-06) — completed 2026-06-10
- [x] 12-04-PLAN.md — Wire consumers: `connection-manager` + `list-accounts` switch updates, `poller` skip guard (CONN-07), `unhandledRejection` handler in `src/process-handlers.ts` (D-12), `imapflow ^1.3.7` bump (resolved to 1.4.0) — completed 2026-06-11

### Phase 13: Health Surface + Cache Improvements
**Goal**: Agents can observe the freshness of cached mail data per account and understand account health in enough detail to explain failures to users
**Depends on**: Phase 12
**Requirements**: HEALTH-01, HEALTH-02, HEALTH-03, CACHE-01, CACHE-02 (*CACHE-03 deferred to v0.4+ on 2026-06-12 — in-memory cache dies with process; pair with CACHE-DISK*)
**Success Criteria** (what must be TRUE):
  1. `list_accounts` response includes `last_connected_at`, `last_error`, `last_error_at`, and `status` per account — an agent can distinguish "retrying after a 4-hour network drop" from "credentials need fixing"
  2. `get_new_mail` response includes `last_polled_at` and `cache_age_seconds` per account so an agent can tell the user "mail data is 8 minutes old" without additional tool calls
  3. When `get_new_mail` is called for an account that is currently reconnecting, the error message distinguishes "no cache yet" from "account disconnected"
**Plans**: 4 plans
- [x] 13-01-PLAN.md — `AccountConnection.lastErrorAt` field + `ConnectionManager` health accessors (HEALTH-01/02/03) — completed 2026-06-13
- [ ] 13-02-PLAN.md — `list_accounts` switch extension: flat snake_case health fields, drop `detail`, V5 ASVS-safe reconnecting `last_error` (HEALTH-02/03)
- [x] 13-03-PLAN.md — Per-account `Poller.lastPolledAt` Map + `getLastPolledAt` accessor (CACHE-01) — completed 2026-06-13
- [x] 13-04-PLAN.md — `get_new_mail` freshness block + D-14 three-error-string dispatch + remove `isCacheReady` gate (HEALTH-01/CACHE-02 + Success Criteria 2-3) — completed 2026-06-13

### Phase 14: Manual Recovery Tool
**Goal**: Agents can force-reconnect a `suspended` or stuck account after a user has fixed the underlying problem (wrong credentials, expired cert), without requiring a server restart
**Depends on**: Phase 12
**Requirements**: RECONN-01, RECONN-02, RECONN-03
**Success Criteria** (what must be TRUE):
  1. An agent calling `reconnect_account` on a `suspended` account immediately triggers a fresh connection attempt — no server restart needed after a credential fix
  2. `reconnect_account` called on an already-`connected` account returns a clear status indicating the account is healthy, not an error
  3. `reconnect_account` response includes the resulting connection `status` so an agent can confirm whether recovery succeeded or explain the current state to a user

**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1–6 (v0.1.0 phases) | v0.1.0 | 23/23 | Complete | 2026-03-11..2026-03-15 |
| 7–11.1 (v0.2 phases) | v0.2 | 12/12 | Complete | 2026-03-15..2026-03-19 |
| 12. Connection Resilience Foundation | v0.3 | 4/4 | Complete    | 2026-06-11 |
| 13. Health Surface + Cache Improvements | v0.3 | 3/4   | In progress | - |
| 14. Manual Recovery Tool | v0.3 | 0/TBD | Not started | - |
