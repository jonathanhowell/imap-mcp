# Phase 2: Connection Management - Context

**Gathered:** 2026-03-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement stable, persistent IMAP connections per account. Each account gets its own connection object that opens at server startup, survives drops via automatic reconnect, and fails independently so a broken account never affects others. No mailbox operations in this phase — those are Phase 3.

</domain>

<decisions>
## Implementation Decisions

### Connection Timing
- Connect all accounts eagerly at server startup (not lazily on first tool call)
- The server is a long-lived stdio subprocess for the duration of the MCP client session — connections should be ready before any tool call arrives
- If an account fails to connect at startup: log the error to stderr and continue serving other accounts. Do NOT block or abort startup.
- After startup, a background loop proactively retries failed accounts — they come back automatically without server restart
- This supersedes the Phase 1 CONTEXT.md note about lazy-connect; eager is correct given the MCP server lifecycle

### Reconnect Strategy
- Exponential backoff with a cap: start fast (e.g. 1s), double each attempt up to a maximum interval (e.g. 60s)
- Claude's discretion on exact backoff parameters and max retry count — pick sensible defaults based on imapflow behavior and typical IMAP server characteristics
- After the max retry limit, mark the account as permanently failed for this session. No more reconnect attempts.
- During the reconnect window: tool calls against that account return an error immediately — do NOT queue or hold calls

### Account Isolation
- Fully independent per-account state: each account has its own connection object, reconnect loop, and backoff state. No shared connection pool.
- When a tool call targets a downed account: return a structured error with the account name and current status (e.g. `account "work" is unavailable (reconnecting)` or `account "work" failed permanently`)
- For multi-account operations: return partial results from working accounts plus an `errors` array listing which accounts failed. Do NOT fail the whole operation if one account is down.
- If imapflow throws an unexpected error mid-call: treat it as a connection drop — log it, mark the account as reconnecting, trigger the reconnect loop, return error to the caller

### Connection Lifecycle
- `ConnectionManager` is instantiated in `main()` after config loads, then passed into tool handlers as a dependency — no module-level singleton
- Register SIGTERM and SIGINT handlers: on shutdown, close all IMAP connections gracefully before exiting (prevents orphaned server-side sessions)
- Connection status per account is exposed so the Phase 3 `list_accounts` tool can include it (connected / reconnecting / failed)

### Testing
- Unit tests: test ConnectionManager state machine, reconnect logic, and error handling with mocked imapflow — fast, no real IMAP server required
- Integration tests: happy-path connect/disconnect against a real IMAP server — Claude's discretion on test server approach (Docker-based or env-var credentials)

### Claude's Discretion
- Exact exponential backoff parameters (initial delay, multiplier, cap, max retries)
- Integration test IMAP server infrastructure choice
- imapflow event/API specifics for detecting drops and performing reconnect

</decisions>

<specifics>
## Specific Ideas

- Connection status in `list_accounts` lets agents know which accounts are live before attempting operations — good for agent reasoning
- "Permanently failed" state should be clearly distinguishable from "reconnecting" in both logs and tool error responses

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/config/types.ts` (`AccountConfig`, `AppConfig`): ConnectionManager receives `AppConfig` and iterates `config.accounts` to open one connection per account
- `src/logger.ts`: Use for all connection state logging (stderr only — stdout is JSON-RPC)
- `src/types.ts` (`MessageRef`, `AccountRef`): Tool handlers will use `AccountRef` to look up connections by `account_id`
- `src/index.ts`: `main()` is where ConnectionManager gets created and wired in

### Established Patterns
- All logging to stderr via `logger.ts` — imapflow events, reconnect attempts, state changes all go through it
- TypeScript strict mode — ConnectionManager state machine types must be precise
- Error handling: unexpected errors should be caught and logged, not propagate to crash the server process

### Integration Points
- `src/connections/` directory: ConnectionManager and per-account connection classes live here
- `src/index.ts`: ConnectionManager created after `loadConfig()`, before `server.connect(transport)`
- Phase 3 tool handlers will call into ConnectionManager to get an active `ImapFlow` client for a given `account_id`
- Phase 5 background polling will also use ConnectionManager to get active connections

</code_context>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-connection-management*
*Context gathered: 2026-03-11*
