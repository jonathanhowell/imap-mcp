# Phase 3: Core Read Operations - Context

**Gathered:** 2026-03-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement the MCP tool handlers that replace Phase 1 stubs: folder navigation, paginated message listing, full/cleaned/truncated body fetching, attachment metadata and download, and header-based search. All tools produce stable, normalized JSON responses that agents can depend on — schemas must not change after Phase 3.

</domain>

<decisions>
## Implementation Decisions

### read_message body modes
- One tool (`read_message`) with a `format` parameter: `'full' | 'clean' | 'truncated'`
- Default format when omitted: `clean` (HTML stripped, quoted reply chains removed)
- `truncated` format uses a `max_chars` parameter; defaults to 2000 chars if not specified
- `full` format: prefer `text/plain` part when present; fall back to HTML-stripped body if no plain part exists
- `clean` format: same as `full` but also strips quoted reply chains

### Attachment metadata
- `read_message` always includes an `attachments` array in its response (BODYSTRUCTURE is fetched as part of the same IMAP FETCH — zero additional overhead)
- Each attachment entry: `{ part_id, filename, size, mime_type }`
- No separate `list_attachments` tool — metadata comes free with every `read_message` call

### Attachment download
- Separate `download_attachment(account, uid, part_id)` tool — agents opt-in explicitly since downloads can be large
- `part_id` comes from the `attachments` array in `read_message` response
- Content returned as a base64-encoded string (MCP responses are JSON; binary must be encoded)

### Folder listing shape
- Flat list with full IMAP path strings (e.g. `"Work/Projects/Active"`) — no nested tree
- Each folder entry: `{ name, total, unread, special_use }`
- `special_use` field: `'Inbox' | 'Sent' | 'Trash' | 'Spam' | 'Drafts' | null` — derived from IMAP special-use attributes so agents can find Sent/Trash without knowing provider-specific names (e.g. `[Gmail]/Sent Mail`)

### Search scope and pagination
- `folder` parameter is optional; defaults to `INBOX` if omitted
- Agent can pass `folder: "all"` to search across all folders in the account
- No offset-based pagination on search (IMAP search returns all matches then truncates — offset is unreliable as mail arrives)
- `max_results` parameter caps result count; defaults to 50
- Search results use the same header shape as `list_messages`: `{ uid, from, subject, date, unread, folder }`
- `folder` field is included in each search result (important when `folder: "all"` is used)

### Tool catalog for Phase 3
- `list_accounts` — lists configured accounts with connection status (carries over from Phase 1 stub)
- `list_folders(account)` — flat folder list with counts and special_use
- `list_messages(account, folder, limit?, offset?, sort?)` — paginated header listing
- `read_message(account, uid, format?, max_chars?)` — body + attachment metadata
- `search_messages(account, from?, subject?, since?, before?, unread?, folder?, max_results?)` — header search
- `download_attachment(account, uid, part_id)` — new tool, not in Phase 1 stubs

### Claude's Discretion
- HTML-to-text conversion library choice (mailparser is already installed)
- Quoted reply chain detection algorithm
- Exact IMAP FETCH item sets used for each tool
- Error message wording for unavailable accounts (follows Phase 2 structured error pattern)
- list_messages sort parameter values and defaults

</decisions>

<specifics>
## Specific Ideas

- `special_use` in folder listing lets agents find provider-agnostic special folders — important since Gmail uses `[Gmail]/Sent Mail` while Fastmail uses `Sent`
- `folder: "all"` in search is a power feature but may be slow on large mailboxes — planner should document this in the tool description so agents can reason about it

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/connections/connection-manager.ts` (`ConnectionManager.getClient(accountId)`): returns `ImapFlow | { error: string }` — all tool handlers call this and check `'error' in result` before proceeding
- `src/types.ts` (`MessageRef`, `AccountRef`): established `{account_id, uid}` tuple contract — tool handlers use these types
- `src/logger.ts`: stderr-only logger for all tool-level logging
- `src/tools/stubs.ts`: stub tool definitions with locked names — Phase 3 replaces handlers, not names

### Established Patterns
- `'error' in result` discriminated union check before using any client — all tool handlers follow this pattern from Phase 2
- Structured error returns (not thrown exceptions) — callers receive `{ isError: true, content: [...] }`
- All logging via `logger.ts` (stdout = JSON-RPC channel, must not be touched)
- TypeScript strict mode — all new types must be precise

### Integration Points
- `src/tools/stubs.ts`: stub handlers replaced with real implementations in Phase 3
- `src/index.ts`: `ConnectionManager` already wired in — tool handlers receive it as dependency
- `src/services/`: business logic (IMAP fetching, body parsing, search) lives here per Phase 1 structure plan
- `download_attachment` is a new tool — needs registration in the MCP server tool list alongside existing stubs

</code_context>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-core-read-operations*
*Context gathered: 2026-03-12*
