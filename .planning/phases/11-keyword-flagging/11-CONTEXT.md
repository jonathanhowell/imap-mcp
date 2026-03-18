# Phase 11: Keyword Flagging — Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Add a `flag_message` tool that sets a custom IMAP keyword on a message so agents can mark it as processed. Update `search_messages` and `get_new_mail` to accept an optional `exclude_keyword` parameter that filters out messages carrying that keyword. Check PERMANENTFLAGS on mailbox open and warn if the server does not support custom keywords.

Unflagging/clearing keywords, listing messages by keyword, and Gmail label workarounds are explicitly out of scope.

</domain>

<decisions>
## Implementation Decisions

### flag_message tool
- New MCP tool `flag_message` with required parameters: `account` (string), `uid` (number), `keyword` (string)
- Uses IMAP `STORE +FLAGS` — additive only, does not remove existing flags
- Canonical example keyword: `ClaudeProcessed` (no `\` prefix — custom keywords have no backslash per RFC 3501)
- Returns success/error result consistent with existing tool pattern (`isError: true/false`, content array)
- Tool registered in `src/index.ts` alongside existing tools

### exclude_keyword filter — search_messages
- `exclude_keyword` added as an optional string parameter to `search_messages`
- When set: exclude any message whose flags contain the specified keyword
- Implementation: use IMAP SEARCH `NOT KEYWORD <keyword>` criteria in `SearchParams` and `search-service.ts`
  - This is server-side filtering via `criteria.unKeyword` (or `{ not: { keyword: value } }` per imapflow) — efficient, no post-fetch filtering needed
- When omitted: behavior unchanged

### exclude_keyword filter — get_new_mail
- `exclude_keyword` added as an optional string parameter to `get_new_mail` (and `GetNewMailParams`)
- Since `get_new_mail` is cache-only (Poller), filtering must be done in-process on cached entries
- Requires: `MultiAccountMessageHeader` must store a `keywords` field (or full `flags` array) populated during polling
- `Poller.query()` accepts `exclude_keyword` and filters cached entries where `flags` includes the keyword
- Accepted limitation: cached flags may be slightly stale between poll cycles — this is acceptable for the use case

### PERMANENTFLAGS capability check
- Check is performed when a mailbox folder is opened (via `client.mailboxOpen()` in imapflow)
- imapflow exposes `client.mailbox.permanentFlags` after `mailboxOpen` — a `Set<string>`
- If `\*` is NOT in `permanentFlags`, log a warning via `logger.warn()` — do NOT throw, do NOT fail the tool call
- Warning message format: `[{accountId}] Server does not support custom IMAP keywords (PERMANENTFLAGS lacks \\*) — ClaudeProcessed flag may not persist`
- Check is triggered wherever a mailbox is opened for write (i.e., in `flag_message` handler before STORE)
- Does NOT add a new check on every list/read — only on flag operations

### Error handling
- `flag_message` returns `isError: true` if the IMAP STORE command fails (network error, invalid UID, etc.)
- Error message includes account, UID, and keyword for diagnosability
- If server rejects custom keyword (rare — most return OK even without \*), surface the error verbatim

### Known limitations (noted, not worked around)
- Gmail does not support IMAP keywords — uses labels instead. `flag_message` on a Gmail account will silently succeed at the IMAP level but the flag will not persist. The PERMANENTFLAGS warning covers this.
- No unflagging/clearing keywords in this phase
- No listing which messages have a given keyword in this phase

### Claude's Discretion
- Exact imapflow API call shape for STORE (`messageFlagsAdd` vs raw `store` command) — pick whichever imapflow documents
- Whether `keywords` on `MultiAccountMessageHeader` is `string[]` or `Set<string>`
- Whether to do the PERMANENTFLAGS check once per connection or once per `flag_message` call

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

No external specs — requirements are fully captured in decisions above.

### RFC 3501 (context only)
- Custom IMAP keywords have no `\` prefix (e.g. `ClaudeProcessed`, not `\ClaudeProcessed`)
- `PERMANENTFLAGS \*` means the server accepts new keywords permanently
- `STORE +FLAGS.SILENT` sets flags without triggering a FLAGS response (acceptable alternative to `+FLAGS`)

### Existing files that must be modified
- `src/services/search-service.ts` — add `unKeyword?: string` to `SearchParams`; apply `NOT KEYWORD` criteria
- `src/tools/search-messages.ts` — add `exclude_keyword?: string` to params and inputSchema
- `src/tools/get-new-mail.ts` — add `exclude_keyword?: string` to `GetNewMailParams` and inputSchema
- `src/polling/poller.ts` — add `exclude_keyword` param to `query()`; ensure cached headers include flags/keywords
- `src/types.ts` — may need `keywords?: string[]` on `MessageHeader` / `MultiAccountMessageHeader`
- `src/index.ts` — register `flag_message` tool (import, TOOLS array, switch case)

### New files to create
- `src/tools/flag-message.ts` — `FLAG_MESSAGE_TOOL` definition + `handleFlagMessage` handler
- `tests/tools/flag-message.test.ts` — unit tests for KFLAG-01 and KFLAG-04

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/connections/connection-manager.ts` — `getClient(accountId)` pattern used by all write-path tools; same pattern for `flag_message`
- `src/tools/download-attachment.ts` — best reference for "open mailbox for write, do operation, handle lock" pattern
- `src/services/search-service.ts` — `SearchParams` interface and `criteria`-building block pattern; `unKeyword` slot follows existing `unread`, `since`, `body` fields
- `src/tools/read-messages.ts` — reference for tool that takes an account + uid(s) and returns a structured result

### Established Patterns
- All tool handlers follow: validate params → `manager.getClient(accountId)` → `client.getMailboxLock(folder)` → operation → `lock.release()` → return `ToolResult`
- Tool registration in `src/index.ts` requires: import at top, entry in `TOOLS` array, `case` in switch
- `logger.warn()` is the correct severity for capability warnings (not `logger.error()`)
- Existing flag usage: `flags.has("\\Seen")` pattern shows imapflow returns a `Set<string>` for flags

### Integration Points
- `handleFlagMessage` needs `ConnectionManager` (same as all other write tools — passed from `src/index.ts`)
- `Poller.query()` signature change (add `exclude_keyword` param) — `handleGetNewMail` calls `poller.query(params.since, params.account)` so call site needs updating
- `search-service.ts` criteria building is where `NOT KEYWORD` is added — same file, same pattern as `body` was added in Phase 10

</code_context>

<specifics>
## Specific Ideas

- The flag name `ClaudeProcessed` is the canonical example but `keyword` is a free parameter — the agent supplies whatever string it wants
- The PERMANENTFLAGS warning should be visible in server logs but should never cause a tool call to fail
- The `exclude_keyword` parameter name is consistent across both tools (same name, same semantics)

</specifics>

<deferred>
## Deferred Ideas

- **Unflagging / clearing keywords** — explicitly out of scope; future phase
- **Listing messages by keyword** (e.g. `search_messages` with `has_keyword`) — future phase
- **Gmail label workaround** — noted as known limitation; explicitly not planned
- **PERMANENTFLAGS check on every connection/mailbox open** (not just flag_message) — could be surfaced in list_accounts response; deferred

</deferred>

---

*Phase: 11-keyword-flagging*
*Context gathered: 2026-03-18*
