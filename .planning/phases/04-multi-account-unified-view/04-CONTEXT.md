# Phase 4: Multi-Account Unified View - Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Enable agents to target any named account explicitly, or issue a single query spanning all configured accounts that returns a merged, sorted result with per-account error isolation. This phase adds ACCT-01, ACCT-02, and ACCT-03. It does not add write operations, sending, or new account discovery mechanisms.

</domain>

<decisions>
## Implementation Decisions

### Multi-Account Trigger

- Make `account` parameter **optional** across all tools (currently required). Omitting it = "all accounts" mode.
- Tools that support multi-account when `account` is omitted: `list_folders`, `list_messages`, `search_messages`
- Tools that still require `account`: `read_message`, `download_attachment` (need a specific UID from a specific account)
- `folder` remains required even when `account` is omitted

### Unified Inbox Definition

- The "unified inbox" is defined as the folder literally named `INBOX` per account (RFC 3501 — guaranteed present on all IMAP servers, case-insensitive by spec)
- Scope: INBOX only per account — not all folders. Unread in Sent/Spam/Trash is noise.

### Multi-Account Response Shape

Flat merged array with an `account` field added to each item:

```json
{
  "results": [
    { "account": "gmail", "uid": 101, "subject": "...", "date": "...", "unread": true },
    { "account": "work",  "uid": 55,  "subject": "...", "date": "...", "unread": true }
  ],
  "errors": {
    "fastmail": "connection failed"
  }
}
```

- `results`: flat array, all accounts merged, each item has `account` field
- `errors`: object keyed by account name, only present accounts that failed
- If `errors` is empty, it may be omitted or included as `{}`
- Single-account calls (account explicitly provided): unchanged — still return `isError: true` on failure, no wrapper object

### Partial Success Rules

- **Some accounts succeed, some fail**: return `{ results: [...], errors: { ... } }` with `isError: false`
- **All accounts fail**: return `isError: true` (no point returning empty results as success)
- **Single-account call fails**: unchanged — `isError: true`, current error format

### Merged Result Ordering and Pagination

- Always sorted by date descending (newest first) in multi-account mode
- `limit` applies to the **final merged result** — not per account. Fetch `limit` from each account, merge, sort, slice to `limit`
- `offset` is supported in multi-account mode (consistent with single-account behavior)

### Claude's Discretion

- How many messages to fetch per account internally before merging (to ensure the top `limit` items by date are captured)
- Whether to fan out account queries in parallel or sequential (parallel preferred for performance)
- Exact error message text for per-account failures

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets

- `ConnectionManager.getAccountIds()` (`src/connections/connection-manager.ts:82`) — returns all configured account names as `string[]`. Ready to use for iterating accounts in multi-account mode.
- `handleListAccounts` (`src/tools/list-accounts.ts`) — already iterates all accounts and formats per-account status. Pattern to follow for multi-account fan-out.
- Existing `folder: "all"` pattern in `search_messages` (`src/services/search-service.ts`) — iterates all folders for one account. Same fan-out pattern, lifted to account level.
- `AccountConnectionStatus` discriminated union — already handles per-account error states. Can be reused to detect failed accounts before attempting IMAP operations.

### Established Patterns

- Error response: `{ isError: true, content: [{ type: "text", text: "..." }] }` — unchanged for single-account calls
- `getClient()` returns `ImapFlow | { error: string }` — check `"error" in result` pattern used in all current handlers; works the same in multi-account fan-out
- `ToolResult` type: `{ content: Array<{ type: "text"; text: string }>; isError: boolean }` — multi-account success response is JSON-stringified into `content[0].text`

### Integration Points

- `src/index.ts` switch statement — account param is currently cast as required; needs schema updates to mark optional
- All tool MCP schema `inputSchema` definitions — `account` property currently listed as required; move to optional in Phase 4
- `src/tools/list-messages.ts`, `src/tools/list-folders.ts`, `src/tools/search-messages.ts` — primary files to modify; each needs a multi-account branch when account is absent

</code_context>

<specifics>
## Specific Ideas

No specific references — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 04-multi-account-unified-view*
*Context gathered: 2026-03-13*
