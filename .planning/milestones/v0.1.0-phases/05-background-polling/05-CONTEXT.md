# Phase 5: Background Polling - Context

**Gathered:** 2026-03-14
**Status:** Ready for planning

<domain>
## Phase Boundary

The server proactively polls all accounts at a configurable interval, pre-populates a header cache, and exposes a `get_new_mail` tool so agents can detect arrivals without issuing IMAP round-trips. This phase adds POLL-01, POLL-02, and POLL-03. It does not add write operations, push notifications (IMAP IDLE), or per-account polling intervals.

</domain>

<decisions>
## Implementation Decisions

### Cache scope
- Poll INBOX only per account (consistent with Phase 4 unified inbox definition)
- Cache all messages (read + unread) received within the last 1 month per account
- Updates are incremental: each poll fetches only messages newer than the last poll timestamp and merges into the cache
- Full cache on startup (first poll is not incremental — seeds the 1-month window)

### get_new_mail tool interface
- Tool name: `get_new_mail`
- Parameters: `since` (required, ISO 8601 timestamp) + `account` (optional — omit for all accounts, consistent with Phase 4 multi-account pattern)
- Response shape: `MultiAccountResult<MultiAccountMessageHeader>` — same `{ results, errors? }` wrapper as `list_messages` / `search_messages` multi-account
- Cache-only: results are served exclusively from the in-memory cache, no live IMAP fallback
- When cache is not yet populated (first poll hasn't completed): return `isError: true` with a descriptive, agent-actionable message, e.g. `"Polling has not completed yet — no cached results available. Retry in ~5 minutes."`

### Polling configuration
- Location: config file only — add a top-level `polling` section to the Zod `AppConfigSchema`
- Key: `polling.interval_seconds` (optional, defaults to `300` / 5 minutes)
- Scope: global interval applied to all accounts (per-account intervals are FEAT-03, deferred to v2)
- Startup behavior: first poll runs immediately when the server starts (cache is populated within seconds); subsequent polls run at the configured interval

### Claude's Discretion
- Internal data structure for the cache (Map keyed by account, array or Map of message headers)
- How to handle incremental merge when a message appears in cache and arrives again (deduplication by UID)
- Polling loop implementation (setInterval vs. recursive setTimeout — recursive preferred to avoid overlap on slow polls)
- Error logging format for per-account poll failures

</decisions>

<specifics>
## Specific Ideas

- 5-minute default chosen by user (not the 3-minute roadmap default) — use 300 seconds in schema
- The "cache cold" error message should be agent-readable, not developer jargon — include retry timing in the message

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ConnectionManager.getAccountIds()` (`src/connections/connection-manager.ts:82`) — returns all configured account names; polling loop iterates this to fan out across accounts
- `ConnectionManager.getClient(accountId)` — same `ImapFlow | { error: string }` pattern; poller checks `'error' in result` before attempting IMAP fetch per account
- `MultiAccountResult<T>` and `MultiAccountMessageHeader` (`src/types.ts`) — `get_new_mail` returns this shape; no new types needed
- `fanOutAccounts` helper (`src/tools/multi-account.ts`) — may be reusable for the get_new_mail handler's multi-account fan-out from cache
- `AppConfigSchema` (`src/config/schema.ts`) — extend with optional `polling` object to add `interval_seconds`
- `src/services/message-service.ts` — existing `listMessages` service accepts an ImapFlow client and folder; poller can reuse this to fetch recent headers

### Established Patterns
- Per-account error isolation: poller catches per-account failures, logs them, continues polling other accounts — same as Phase 4 fan-out
- Incremental fetch using `since` date maps to IMAP SEARCH SINCE criteria — same pattern as `search-service.ts` date range search
- All logging via `logger.ts` (stderr only — stdout is the MCP JSON-RPC channel)
- `globalThis.setTimeout` for async sleep loops (not `node:timers/promises` — vitest fake timers don't intercept that module)

### Integration Points
- `src/index.ts` — poller starts after `connectAll()` resolves; shuts down gracefully on SIGTERM/SIGINT alongside `closeAll()`
- `src/config/schema.ts` — add `polling` field to `AppConfigSchema`; `AppConfig` type auto-derives from schema via Zod inference
- New file: `src/polling/poller.ts` — polling loop class/function, owns the in-memory cache, exposes a query method
- New tool file: `src/tools/get-new-mail.ts` — handler for the `get_new_mail` MCP tool
- MCP tool registration in `src/index.ts` — `get_new_mail` registered alongside existing tools

</code_context>

<deferred>
## Deferred Ideas

- Per-account polling intervals (FEAT-03) — already in v2 requirements backlog
- IMAP IDLE push notifications replacing polling (FEAT-04) — v2 backlog; reduces latency but adds reconnect complexity
- Caching read message bodies (not just headers) — not in scope; cache is header-only per POLL-02

</deferred>

---

*Phase: 05-background-polling*
*Context gathered: 2026-03-14*
