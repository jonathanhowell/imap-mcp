# Phase 4: Multi-Account Unified View - Research

**Researched:** 2026-03-14
**Domain:** TypeScript fan-out concurrency, MCP tool schema evolution, multi-account merge/sort
**Confidence:** HIGH — all findings grounded in the existing codebase; no speculative library APIs required

## Summary

Phase 4 is a pure refactor and extension of existing handlers. Every building block already exists: `ConnectionManager.getAccountIds()` enumerates all accounts, `getClient()` returns a discriminated union that already signals per-account errors, and the `Promise.allSettled` pattern is already used in `ConnectionManager.connectAll()` and `closeAll()`. No new dependencies are needed.

The core work is: (1) mark `account` optional in three tool schemas and their TypeScript param interfaces, (2) add a multi-account branch in each affected handler that fans out to per-account service calls in parallel via `Promise.allSettled`, (3) merge and sort the results by date descending, slice to the requested `limit`, and (4) return the agreed wrapper shape `{ results, errors }` when all-accounts mode is triggered.

`read_message` and `download_attachment` are explicitly out of scope for multi-account — they still require `account` to be provided and their interfaces do not change.

**Primary recommendation:** Implement multi-account fan-out as a self-contained helper function (e.g., `fanOutAccounts`) that encapsulates the `Promise.allSettled` loop and returns `{ results, errors }`. Each affected handler calls this helper when `account` is absent, keeping the single-account path unchanged.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Multi-Account Trigger**
- Make `account` parameter optional across all tools (currently required). Omitting it = "all accounts" mode.
- Tools that support multi-account when `account` is omitted: `list_folders`, `list_messages`, `search_messages`
- Tools that still require `account`: `read_message`, `download_attachment` (need a specific UID from a specific account)
- `folder` remains required even when `account` is omitted

**Unified Inbox Definition**
- The "unified inbox" is defined as the folder literally named `INBOX` per account (RFC 3501 — guaranteed present on all IMAP servers, case-insensitive by spec)
- Scope: INBOX only per account — not all folders. Unread in Sent/Spam/Trash is noise.

**Multi-Account Response Shape**
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

**Partial Success Rules**
- Some accounts succeed, some fail: return `{ results: [...], errors: { ... } }` with `isError: false`
- All accounts fail: return `isError: true` (no point returning empty results as success)
- Single-account call fails: unchanged — `isError: true`, current error format

**Merged Result Ordering and Pagination**
- Always sorted by date descending (newest first) in multi-account mode
- `limit` applies to the final merged result — not per account. Fetch `limit` from each account, merge, sort, slice to `limit`
- `offset` is supported in multi-account mode (consistent with single-account behavior)

### Claude's Discretion

- How many messages to fetch per account internally before merging (to ensure the top `limit` items by date are captured)
- Whether to fan out account queries in parallel or sequential (parallel preferred for performance)
- Exact error message text for per-account failures

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ACCT-01 | All tool calls accept an optional account name parameter to target a specific account | Schema changes in three tool definitions + TypeScript interface updates; existing single-account path unchanged |
| ACCT-02 | Agent can retrieve a unified unread inbox merged and sorted across all configured accounts | `getAccountIds()` + parallel `listMessages` fan-out with date-sort merge; `unread_only: true`, `folder: "INBOX"` per account |
| ACCT-03 | When an operation spans multiple accounts, per-account errors return partial results with error details rather than failing the entire request | `Promise.allSettled` discriminates fulfilled/rejected; `{ results, errors }` wrapper; all-fail case returns `isError: true` |
</phase_requirements>

---

## Standard Stack

### Core (no new dependencies needed)

| Asset | Location | Purpose | Status |
|-------|----------|---------|--------|
| `ConnectionManager.getAccountIds()` | `src/connections/connection-manager.ts:82` | Returns `string[]` of all configured account names | Ready to use |
| `ConnectionManager.getClient(id)` | `src/connections/connection-manager.ts:45` | Returns `ImapFlow \| { error: string }` | Ready to use |
| `Promise.allSettled` | Built-in | Fan-out with per-task failure isolation | Already used in `connectAll`, `closeAll` |
| `listMessages` service | `src/services/message-service.ts` | Fetches paginated headers for one account+folder | Ready to use as-is |
| `searchMessages` service | `src/services/search-service.ts` | Searches one account; folder='all' pattern established | Ready to use as-is |
| `listFolders` service | `src/services/folder-service.ts` | Lists folders for one account | Ready to use as-is |
| `ToolResult` interface | `src/types.ts:86` | `{ content: [{type:"text", text: string}], isError: boolean }` | Unchanged |

**Installation:** No new packages required.

### New Types Required

Three new interfaces needed in `src/types.ts`:

```typescript
// An item in a multi-account merged result — adds `account` discriminator
export interface MultiAccountMessageHeader extends MessageHeader {
  account: string;
}

export interface MultiAccountSearchResultItem extends SearchResultItem {
  account: string;
}

export interface MultiAccountFolderEntry extends FolderEntry {
  account: string;
}

// Wrapper returned when account param is omitted
export interface MultiAccountResult<T> {
  results: T[];
  errors: Record<string, string>;
}
```

---

## Architecture Patterns

### Recommended Project Structure

No new directories required. All changes are in-place modifications to existing files, plus one new shared helper:

```
src/
├── tools/
│   ├── list-folders.ts        # modify: account optional, add multi-account branch
│   ├── list-messages.ts       # modify: account optional, add multi-account branch
│   ├── search-messages.ts     # modify: account optional, add multi-account branch
│   ├── read-message.ts        # no change
│   └── download-attachment.ts # no change
├── tools/multi-account.ts     # NEW: shared fanOutAccounts helper
└── types.ts                   # modify: add multi-account result types
tests/
└── tools/
    ├── list-messages.test.ts   # extend: add multi-account test cases
    ├── list-folders.test.ts    # extend: add multi-account test cases
    └── search-messages.test.ts # extend: add multi-account test cases
```

### Pattern 1: Fan-out with Promise.allSettled

**What:** Run one service call per account in parallel, collect results and errors independently.
**When to use:** Whenever `account` param is absent — applicable to `list_folders`, `list_messages`, `search_messages`.

```typescript
// Source: established pattern from src/connections/connection-manager.ts connectAll/closeAll
async function fanOutAccounts<T>(
  accountIds: string[],
  manager: ConnectionManager,
  fn: (client: ImapFlow, accountId: string) => Promise<T[]>
): Promise<{ results: Array<T & { account: string }>; errors: Record<string, string> }> {
  const settled = await Promise.allSettled(
    accountIds.map(async (accountId) => {
      const clientResult = manager.getClient(accountId);
      if ("error" in clientResult) throw new Error(clientResult.error);
      const items = await fn(clientResult, accountId);
      return { accountId, items };
    })
  );

  const results: Array<T & { account: string }> = [];
  const errors: Record<string, string> = {};

  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i];
    if (outcome.status === "fulfilled") {
      for (const item of outcome.value.items) {
        results.push({ ...item, account: outcome.value.accountId });
      }
    } else {
      const accountId = accountIds[i];
      errors[accountId] = outcome.reason instanceof Error
        ? outcome.reason.message
        : String(outcome.reason);
    }
  }

  return { results, errors };
}
```

### Pattern 2: Multi-Account Handler Branch

**What:** Each affected handler checks whether `account` was provided. If yes, single-account path (unchanged). If no, multi-account fan-out path.
**When to use:** In `handleListMessages`, `handleListFolders`, `handleSearchMessages`.

```typescript
// Illustrative structure — source: adapted from src/tools/list-messages.ts
export async function handleListMessages(
  params: ListMessagesParams,
  manager: ConnectionManager
): Promise<ToolResult> {
  const { account, folder, limit = 50, offset = 0, sort, unread_only } = params;

  // Single-account path — unchanged
  if (account !== undefined) {
    const clientResult = manager.getClient(account);
    if ("error" in clientResult) {
      return { content: [{ type: "text", text: clientResult.error }], isError: true };
    }
    const headers = await listMessages(clientResult, folder, { limit, offset, sort, unreadOnly: unread_only });
    return { content: [{ type: "text", text: JSON.stringify(headers) }], isError: false };
  }

  // Multi-account path
  const accountIds = manager.getAccountIds();
  const { results, errors } = await fanOutAccounts(accountIds, manager, (client) =>
    listMessages(client, folder, { limit, sort, unreadOnly: unread_only })
  );

  if (results.length === 0 && Object.keys(errors).length === accountIds.length) {
    // All accounts failed
    return {
      content: [{ type: "text", text: `All accounts failed: ${JSON.stringify(errors)}` }],
      isError: true,
    };
  }

  // Sort merged results by date descending, then apply limit+offset
  results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const page = results.slice(offset, offset + limit);

  const response: MultiAccountResult<MultiAccountMessageHeader> = {
    results: page,
    ...(Object.keys(errors).length > 0 ? { errors } : {}),
  };

  return { content: [{ type: "text", text: JSON.stringify(response) }], isError: false };
}
```

### Pattern 3: Per-Account Fetch Size for Merge Correctness

**What:** When fetching per account before merging, fetch more than `limit` per account to ensure the global top-N by date are captured. The safest approach is to fetch `limit + offset` per account before merging (covers the worst case where one account dominates the top results).

**Recommendation (Claude's discretion):** Pass `limit: limit + offset` (or a minimum floor like `Math.max(limit + offset, 50)`) to each per-account service call before merging and slicing. This ensures pagination correctness without fetching unbounded data.

### Anti-Patterns to Avoid

- **Applying `limit` per account before merging:** If account A has 50 items and account B has 0 visible after slicing to 50, the merged result would miss account B's top items. Fetch `limit + offset` per account, merge all, then slice.
- **Returning `isError: false` when all accounts failed:** The contract specifies `isError: true` when every account fails. An empty `results` array with `isError: false` would silently mislead the agent.
- **Mutating `account` to required in `read_message`/`download_attachment`:** These tools already require `account` and must not be touched.
- **Changing the single-account response shape:** When `account` is provided, the handler must continue returning the existing flat array / flat object, not the `{ results, errors }` wrapper.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parallel fan-out with partial failure | Custom Promise loop with manual error tracking | `Promise.allSettled` | Already battle-tested; exact semantics match the requirement; `connectAll` already uses it |
| Account enumeration | Config re-parsing or any ad-hoc list | `manager.getAccountIds()` | Single source of truth; already in `ConnectionManager` |
| Per-account client error detection | Custom connection probing | `"error" in manager.getClient(id)` | Established discriminated-union pattern used in all Phase 3 handlers |
| Date sort | Custom date parsing | `new Date(isoString).getTime()` | All dates in the system are already ISO 8601 strings from `internalDate.toISOString()` |

**Key insight:** This phase has no genuinely novel technical problems. Every primitive needed (fan-out, error isolation, account enumeration, service calls) already exists in the codebase. The risk is in the integration details — schema changes, TypeScript types, and the all-fail edge case — not in algorithmic complexity.

---

## Common Pitfalls

### Pitfall 1: MCP Schema `required` array not updated
**What goes wrong:** Tool definition `inputSchema.required` still lists `"account"` after the param is made optional. MCP clients may reject or warn on calls that omit a "required" field.
**Why it happens:** TypeScript interface is updated but the JSON Schema `required` array in the `Tool` constant is forgotten.
**How to avoid:** In each affected tool file, remove `"account"` from the `required` array in `inputSchema`. Verify the `Tool` constant matches the updated TypeScript interface.
**Warning signs:** TypeScript compiles clean but an MCP client rejects tool calls without `account`.

### Pitfall 2: `account` typed as `string` instead of `string | undefined`
**What goes wrong:** TypeScript handler receives `account` as `string` even after the interface change, causing the multi-account branch to be unreachable because `account !== undefined` is always true.
**Why it happens:** Interface param type not updated, or the `params as unknown as Parameters<...>[0]` cast in `index.ts` coerces undefined away.
**How to avoid:** Update each param interface (e.g., `account?: string`), and confirm `index.ts` passes `args` through without defaulting missing keys.

### Pitfall 3: Pagination semantics differ between single- and multi-account
**What goes wrong:** `offset` in single-account mode skips N messages within the per-account sorted list. In multi-account mode, `offset` must skip N in the final merged+sorted list, not per account.
**Why it happens:** Developer naively passes `offset` down to each per-account service call, producing wrong results for page 2+.
**How to avoid:** In multi-account mode, pass `offset: 0` (or `limit + offset`) to each per-account fetch, then apply `offset` only on the final merged result slice.

### Pitfall 4: Date comparison of non-ISO strings
**What goes wrong:** `new Date(date).getTime()` returns `NaN` if any message has a malformed or empty date string, causing sort instability.
**Why it happens:** `message-service.ts` already guards with `String(msg.internalDate ?? "")` which can produce an empty string for messages with no `internalDate`.
**How to avoid:** Guard the sort comparator: treat `NaN` as `0` (oldest). `const t = (d: string) => new Date(d).getTime() || 0`.
**Warning signs:** Merged results have NaN-dated messages floating to unexpected positions.

### Pitfall 5: `errors` key always present in response
**What goes wrong:** Response always includes `"errors": {}` even when no errors occurred, adding noise the agent must handle.
**Why it happens:** Unconditional `errors` key in the response object.
**How to avoid:** Omit `errors` key entirely when empty, or consistently include it as `{}`. The CONTEXT.md decision says "may be omitted or included as `{}`" — pick one and document it. Recommend omitting when empty for cleaner agent responses.

---

## Code Examples

Verified patterns from the existing codebase:

### Promise.allSettled Fan-out (established in codebase)
```typescript
// Source: src/connections/connection-manager.ts:22-37
const results = await Promise.allSettled(
  entries.map(([, connection]) => connection.connect())
);
for (const result of results) {
  if (result.status === "fulfilled") { /* success */ }
  else { /* result.reason is the error */ }
}
```

### Discriminated Union Client Check (established in all Phase 3 handlers)
```typescript
// Source: src/tools/list-messages.ts:58-65
const clientResult = manager.getClient(account);
if ("error" in clientResult) {
  return { content: [{ type: "text", text: clientResult.error }], isError: true };
}
// clientResult is ImapFlow here
```

### Account Enumeration
```typescript
// Source: src/tools/list-accounts.ts:12 / src/connections/connection-manager.ts:82
const accountIds = manager.getAccountIds(); // string[]
```

### Date Sort for Merge
```typescript
// New pattern, grounded in existing ISO date strings from message-service.ts:61-65
const safeTime = (d: string): number => new Date(d).getTime() || 0;
results.sort((a, b) => safeTime(b.date) - safeTime(a.date));
const page = results.slice(offset, offset + limit);
```

### Existing Folder='all' Fan-out Pattern (to mirror at account level)
```typescript
// Source: src/services/search-service.ts:45-59
for (const folderEntry of folderList) {
  if (results.length >= maxResults) break;
  try {
    const folderResults = await searchFolder(client, folderEntry.path, criteria, remaining);
    results.push(...folderResults);
  } catch {
    // Skip folders that cannot be searched
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Sequential per-account iteration (folder='all' in search-service) | Parallel `Promise.allSettled` fan-out | Phase 4 introduces it | Dramatically faster for 2+ accounts; error isolation included |
| `account` required in all tools | `account` optional in `list_folders`, `list_messages`, `search_messages` | Phase 4 | Schema is a breaking change for any caller that relied on validation rejecting missing account |

**Deprecated/outdated in Phase 4:**
- `required: ["account", "folder"]` in `LIST_MESSAGES_TOOL.inputSchema` — `"account"` moves out of required
- `required: ["account"]` in `LIST_FOLDERS_TOOL.inputSchema` and `SEARCH_MESSAGES_TOOL.inputSchema` — same
- `account: string` (non-optional) in `ListMessagesParams`, `SearchMessagesParams`, and `handleListFolders` param type — becomes `account?: string`

---

## Open Questions

1. **Per-account fetch multiplier**
   - What we know: `limit` applies to the final merged result; we fetch `limit` from each account per CONTEXT.md, but that risks missing cross-account top items on page 2+
   - What's unclear: Whether `limit + offset` per account is sufficient, or whether a larger buffer (e.g. 2× limit) is needed
   - Recommendation (Claude's discretion): Fetch `limit + offset` per account. This guarantees correctness for all pages because the worst-case cross-account overlap is bounded by offset. Document this choice in code comments.

2. **`errors` key: omit-when-empty vs always-include**
   - What we know: CONTEXT.md says "may be omitted or included as `{}`"
   - What's unclear: Agent behaviour if it sometimes sees `errors` key and sometimes doesn't
   - Recommendation: Omit when empty. Simpler for agents to check `if (response.errors)`. Document the decision.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.x |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `npm test -- --reporter=verbose` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ACCT-01 | `list_messages` with `account` omitted → multi-account path invoked | unit | `npm test -- tests/tools/list-messages.test.ts` | ✅ extend existing |
| ACCT-01 | `list_folders` with `account` omitted → multi-account path invoked | unit | `npm test -- tests/tools/list-folders.test.ts` | ✅ extend existing |
| ACCT-01 | `search_messages` with `account` omitted → multi-account path invoked | unit | `npm test -- tests/tools/search-messages.test.ts` | ✅ extend existing |
| ACCT-01 | `read_message` still requires `account` | unit | `npm test -- tests/tools/read-message.test.ts` | ✅ no change needed |
| ACCT-02 | Two accounts succeed → merged flat array with `account` field, sorted by date desc | unit | `npm test -- tests/tools/list-messages.test.ts` | ✅ extend existing |
| ACCT-02 | Unified INBOX unread query returns messages from both accounts sorted newest-first | unit | `npm test -- tests/tools/list-messages.test.ts` | ✅ extend existing |
| ACCT-03 | One account fails, one succeeds → `{ results: [...], errors: { failedAccount: "..." } }`, `isError: false` | unit | `npm test -- tests/tools/list-messages.test.ts` | ✅ extend existing |
| ACCT-03 | All accounts fail → `isError: true` | unit | `npm test -- tests/tools/list-messages.test.ts` | ✅ extend existing |

### Sampling Rate
- **Per task commit:** `npm test -- tests/tools/list-messages.test.ts tests/tools/list-folders.test.ts tests/tools/search-messages.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
None — existing test infrastructure covers all phase requirements. The three affected test files already exist and follow established mocking patterns (see `tests/tools/list-messages.test.ts` etc.). New test cases are additions to existing `describe` blocks, not new files.

---

## Sources

### Primary (HIGH confidence)
- `src/connections/connection-manager.ts` — `getAccountIds()`, `getClient()`, `connectAll()`, `closeAll()` patterns read directly
- `src/tools/list-messages.ts`, `list-folders.ts`, `search-messages.ts`, `list-accounts.ts` — current handler structure and schema read directly
- `src/services/message-service.ts`, `search-service.ts` — service signatures and existing fan-out pattern read directly
- `src/types.ts` — `ToolResult`, `MessageHeader`, `SearchResultItem` interfaces read directly
- `src/index.ts` — switch-router pattern and `as unknown as Parameters<...>[0]` cast read directly
- `.planning/phases/04-multi-account-unified-view/04-CONTEXT.md` — all locked decisions

### Secondary (MEDIUM confidence)
- `package.json` — confirmed no new deps needed; vitest 4.x, imapflow 1.2.x, zod 4.x
- `vitest.config.ts` — confirmed test include glob `tests/**/*.test.ts`

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all assets read directly from codebase; no third-party library changes
- Architecture: HIGH — fan-out pattern directly parallels existing `connectAll`/`closeAll`; no novel patterns
- Pitfalls: HIGH — schema/type pitfalls identified from reading actual code; pagination pitfall is a deterministic consequence of the offset semantics

**Research date:** 2026-03-14
**Valid until:** Until codebase changes to affected files (stable — no fast-moving dependencies)
