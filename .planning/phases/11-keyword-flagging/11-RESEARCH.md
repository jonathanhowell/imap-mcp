# Phase 11: Keyword Flagging - Research

**Researched:** 2026-03-18
**Domain:** IMAP custom keywords, imapflow flag API, cache-side filtering
**Confidence:** HIGH

## Summary

Phase 11 adds three capabilities to the IMAP MCP server: (1) a new `flag_message` tool that sets a custom keyword on a message via IMAP STORE +FLAGS, (2) server-side `exclude_keyword` filtering via `NOT KEYWORD` in `search_messages`, and (3) in-memory `exclude_keyword` filtering in `get_new_mail`. A PERMANENTFLAGS capability check logs a warning when the server does not support user-defined keywords.

All design decisions are fully captured in CONTEXT.md. The implementation is a set of strictly additive changes — new tool, new optional parameters, new type fields — with no breaking changes to existing contracts. The codebase patterns from Phase 10 (body search, filename-based attachment download) are direct precedents for every technique needed here.

**Primary recommendation:** Follow the CONTEXT.md decisions exactly. The imapflow API is well-matched: `messageFlagsAdd` handles STORE +FLAGS, `client.mailbox.permanentFlags` (a `Set<string>`) is accessible after `getMailboxLock`, and the existing `criteria` object in `search-service.ts` accepts IMAP keyword search criteria. The only structural question is adding `keywords?: string[]` to `MultiAccountMessageHeader` so the poller cache can support flag-based filtering.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- `flag_message` tool: required params `account` (string), `uid` (number), `keyword` (string); uses IMAP STORE +FLAGS additive only
- Canonical example keyword: `ClaudeProcessed` (no `\` prefix per RFC 3501)
- Returns `{ isError, content }` ToolResult consistent with existing tools
- Registered in `src/index.ts` (import, TOOLS array, switch case)
- `exclude_keyword` in `search_messages`: server-side via IMAP SEARCH `NOT KEYWORD <keyword>` using `criteria.unKeyword` (or imapflow equivalent)
- `exclude_keyword` in `get_new_mail`: in-process filter on cached entries (cache-only tool, no IMAP round-trip)
- `MultiAccountMessageHeader` must store a `keywords` field populated during polling
- PERMANENTFLAGS check: in `flag_message` handler before STORE; warn via `logger.warn()` if `\*` not in `permanentFlags`; no throw, no tool failure
- Warning message format: `[{accountId}] Server does not support custom IMAP keywords (PERMANENTFLAGS lacks \\*) — ClaudeProcessed flag may not persist`
- `flag_message` returns `isError: true` on IMAP STORE failure; error includes account, UID, keyword

### Claude's Discretion
- Exact imapflow API call shape for STORE (`messageFlagsAdd` vs raw `store` command)
- Whether `keywords` on `MultiAccountMessageHeader` is `string[]` or `Set<string>`
- Whether to do the PERMANENTFLAGS check once per connection or once per `flag_message` call

### Deferred Ideas (OUT OF SCOPE)
- Unflagging / clearing keywords
- Listing messages by keyword (`has_keyword` parameter)
- Gmail label workaround
- PERMANENTFLAGS check on every connection/mailbox open (not just flag_message)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| KFLAG-01 | `flag_message` tool sets a custom IMAP keyword on a message (account + uid + keyword) via IMAP STORE +FLAGS | imapflow `messageFlagsAdd(uid, [keyword], { uid: true })` called inside `getMailboxLock`; pattern from `download-attachment.ts` |
| KFLAG-02 | `search_messages` accepts optional `exclude_keyword`; messages with that keyword are excluded | Add `unKeyword` field to `SearchParams` and criteria object; imapflow search criteria object supports this directly |
| KFLAG-03 | `get_new_mail` accepts optional `exclude_keyword`; messages with that keyword excluded from cache query | Filter `entries` in `Poller.query()` where `m.keywords` includes the keyword; requires `keywords` field on cached headers |
| KFLAG-04 | When mailbox is opened, PERMANENTFLAGS is checked; if `\*` absent, warning is logged (no failure) | `client.mailbox.permanentFlags` is a `Set<string>` accessible after `getMailboxLock`; check `has('\\*')` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| imapflow | (project-pinned) | IMAP client — `messageFlagsAdd`, `getMailboxLock`, `client.mailbox.permanentFlags` | Already in use throughout all write-path tools |
| @modelcontextprotocol/sdk | (project-pinned) | Tool definition (`Tool` type), `CallToolRequestSchema` | Standard for all MCP tools in this project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ^4.0.18 | Unit test framework | All new test files follow `describe/it/expect/vi` pattern |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `messageFlagsAdd` | raw `client.store` command | `messageFlagsAdd` is the idiomatic imapflow method, documented API surface, no raw protocol needed |
| `unKeyword` criteria field | post-fetch in-process filter | Server-side filtering via SEARCH is more efficient; for `get_new_mail` (cache-only), in-process is the only option |

**Installation:** No new dependencies required.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── tools/flag-message.ts         # NEW — FLAG_MESSAGE_TOOL + handleFlagMessage
├── tools/search-messages.ts      # MODIFY — add exclude_keyword param
├── tools/get-new-mail.ts         # MODIFY — add exclude_keyword param
├── services/search-service.ts    # MODIFY — add unKeyword to SearchParams + criteria
├── polling/poller.ts             # MODIFY — add exclude_keyword to query(), store keywords in cache
├── types.ts                      # MODIFY — add keywords?: string[] to MessageHeader or MultiAccountMessageHeader
└── index.ts                      # MODIFY — import flag-message, add to TOOLS, add switch case

tests/
└── tools/flag-message.test.ts    # NEW — unit tests for KFLAG-01, KFLAG-04
```

### Pattern 1: Write Tool Handler (reference: download-attachment.ts)
**What:** validate params → `manager.getClient(accountId)` → `client.getMailboxLock(folder)` → operation in try/finally → `lock.release()` → return `ToolResult`
**When to use:** Any tool that opens a mailbox and performs a write

```typescript
// Source: src/tools/download-attachment.ts (established project pattern)
const clientOrError = manager.getClient(account);
if ("error" in clientOrError) {
  return { content: [{ type: "text", text: `Error: ${clientOrError.error}` }], isError: true };
}
const client = clientOrError;

const lock = await client.getMailboxLock(folder);
try {
  // operation
} finally {
  lock.release();
}
```

### Pattern 2: imapflow messageFlagsAdd (KFLAG-01)
**What:** Set custom IMAP keyword using additive STORE +FLAGS
**When to use:** Whenever setting any flag on a message by UID

```typescript
// Source: imapflow official docs — https://imapflow.com/docs/api/imapflow-client/
// Must be called inside an open mailbox lock
await client.messageFlagsAdd([uid], [keyword], { uid: true });
```

Note: range accepts arrays of UIDs when `{ uid: true }` is set. For a single UID, pass `[uid]` as an array.

### Pattern 3: PERMANENTFLAGS check (KFLAG-04)
**What:** After `getMailboxLock`, inspect `client.mailbox.permanentFlags` for `\*`
**When to use:** In `flag_message` handler before STORE, inside the lock

```typescript
// Source: imapflow official docs — https://imapflow.com/docs/api/imapflow-client/
// client.mailbox.permanentFlags is Set<string> after getMailboxLock
if (!client.mailbox.permanentFlags.has('\\*')) {
  logger.warn(`[${account}] Server does not support custom IMAP keywords (PERMANENTFLAGS lacks \\*) — ClaudeProcessed flag may not persist`);
}
// then proceed with messageFlagsAdd — no throw, no isError
```

### Pattern 4: IMAP keyword search criteria (KFLAG-02)
**What:** Add `unKeyword` to `SearchParams` and criteria to exclude messages by keyword
**When to use:** Server-side exclusion in search-service.ts

```typescript
// Source: search-service.ts established criteria pattern (Phase 10 body search precedent)
// The imapflow search object supports keyword/unkeyword natively
if (excludeKeyword !== undefined) criteria.unKeyword = excludeKeyword;
```

Note: The exact field name in imapflow's `SearchObject` may be `unKeyword` or may need to use the `{ not: { keyword: value } }` form. The CONTEXT.md mentions both options — `criteria.unKeyword` is preferred; if imapflow does not expose `unKeyword` directly, wrap as `{ not: { keyword: excludeKeyword } }`.

### Pattern 5: Cache-side keyword filter (KFLAG-03)
**What:** Filter `Poller.query()` results by keyword absence
**When to use:** In `Poller.query()` after the `since` time filter

```typescript
// Source: poller.ts established filter pattern (extension of existing filter chain)
// Requires keywords field on cached MultiAccountMessageHeader entries
const filtered = entries.filter(
  (m) => (new Date(m.date).getTime() || 0) > sinceTime
    && (excludeKeyword === undefined || !(m.keywords ?? []).includes(excludeKeyword))
);
```

### Pattern 6: Tool registration in src/index.ts
**What:** Three-part registration for every new tool
**When to use:** When adding any new MCP tool

```typescript
// Source: src/index.ts (established project pattern)
// 1. Import at top of file
import { FLAG_MESSAGE_TOOL, handleFlagMessage } from "./tools/flag-message.js";

// 2. Add to TOOLS array
const TOOLS = [
  ...,
  FLAG_MESSAGE_TOOL,
];

// 3. Add case in switch
case "flag_message":
  return handleFlagMessage(
    params as unknown as Parameters<typeof handleFlagMessage>[0],
    manager
  ) as AnyToolResult;
```

### Anti-Patterns to Avoid
- **Nested mailbox locks:** The poller.ts comment in Phase 10 established this — always release lock before acquiring another. `flag_message` opens exactly one lock; there is no second lock needed.
- **Throwing on PERMANENTFLAGS absence:** The server may return OK even without `\*` support (RFC 3501 notes). The warning is informational only.
- **Post-fetch filtering for search_messages:** Use server-side `NOT KEYWORD` criteria — it is more efficient than fetching and then filtering. Post-fetch filtering is only acceptable in the cache (get_new_mail).
- **Removing `to`/`cc` from mock setup in new tests:** Existing test mocks include `to: [], cc: []` on envelope — new tests must maintain this shape to avoid `undefined` spreading in formatAddress.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| IMAP STORE +FLAGS | Custom raw protocol command | `client.messageFlagsAdd(range, flags, { uid: true })` | imapflow handles encoding, sequence vs UID mode, error mapping |
| Server capability discovery | Parse raw CAPABILITY response | `client.mailbox.permanentFlags` (populated by imapflow after `getMailboxLock`) | imapflow parses PERMANENTFLAGS response automatically |
| IMAP keyword exclusion search | Fetch all + filter by flags | `criteria.unKeyword` / `{ not: { keyword } }` in `client.search()` | Server-side filtering reduces data transferred |
| Cache deduplication | Custom merge logic | Already in `Poller.mergeIntoCache` — do not duplicate | Existing dedup is UID-based; adding keywords field does not change dedup logic |

## Common Pitfalls

### Pitfall 1: imapflow `unKeyword` field name
**What goes wrong:** The imapflow `SearchObject` may expose keyword exclusion as `unKeyword`, or it may require `{ not: { keyword: value } }` — the exact property name is not consistently documented in search results.
**Why it happens:** imapflow docs are dense and auto-generated; keyword search criteria are less commonly documented than flag-based searches.
**How to avoid:** Check the TypeScript type definition file (`imapflow.d.ts`) or the `SearchObject` type at runtime. The fallback form `{ not: { keyword: excludeKeyword } }` is always correct per IMAP RFC semantics.
**Warning signs:** TypeScript type error on `criteria.unKeyword` assignment.

### Pitfall 2: messageFlagsAdd range parameter type
**What goes wrong:** Passing a bare number (`uid`) instead of an array (`[uid]`) when using `{ uid: true }` mode.
**Why it happens:** The method signature accepts `SequenceString | number[] | SearchObject` — a bare `number` is not valid; use `[uid]`.
**How to avoid:** Always wrap single UIDs in an array: `client.messageFlagsAdd([uid], [keyword], { uid: true })`.

### Pitfall 3: keywords field not populated during polling
**What goes wrong:** `Poller.query()` applies keyword filter but cached `MultiAccountMessageHeader` entries have no `keywords` field — all messages pass through.
**Why it happens:** `pollAccount` maps `SearchResultItem` to headers but `SearchResultItem` only stores `uid, from, subject, date, unread, folder`. The `flags` field from `fetchAll` is not currently stored.
**How to avoid:** The poller's `searchMessages` call already uses `fetchAll` with `{ flags: true }`. The poll path must extract flags and store them on the cached header. The CONTEXT.md decision is to add `keywords?: string[]` to `MessageHeader` or `MultiAccountMessageHeader`.
**Warning signs:** `exclude_keyword` has no effect even when flag is set.

### Pitfall 4: Custom keyword string casing
**What goes wrong:** `flags.has('ClaudeProcessed')` fails because the server returns `claudeprocessed` (lowercase normalization is server-dependent).
**Why it happens:** RFC 3501 specifies keywords are case-insensitive atoms, but server implementations vary.
**How to avoid:** When filtering cached entries for `exclude_keyword`, do a case-insensitive comparison: `(m.keywords ?? []).some(k => k.toLowerCase() === excludeKeyword.toLowerCase())`. For IMAP SEARCH-based exclusion, case normalization is the server's responsibility.
**Warning signs:** `exclude_keyword` filter inconsistently excludes messages.

### Pitfall 5: `client.mailbox` access outside lock
**What goes wrong:** Accessing `client.mailbox.permanentFlags` before calling `getMailboxLock` — `client.mailbox` may be null or stale.
**Why it happens:** imapflow only populates `client.mailbox` while a mailbox is selected (after lock acquisition).
**How to avoid:** Always read `client.mailbox.permanentFlags` inside the `try` block, after lock acquisition, before the STORE command.

## Code Examples

### flag_message tool skeleton
```typescript
// Source: established project patterns from src/tools/download-attachment.ts
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ConnectionManager } from "../connections/index.js";
import type { ToolResult } from "../types.js";
import { logger } from "../logger.js";

export const FLAG_MESSAGE_TOOL: Tool = {
  name: "flag_message",
  description: "Set a custom IMAP keyword on a message to mark it as processed.",
  inputSchema: {
    type: "object",
    properties: {
      account: { type: "string", description: "Account name from config" },
      uid: { type: "number", description: "IMAP UID of the message" },
      keyword: { type: "string", description: "Custom keyword to set (e.g. ClaudeProcessed)" },
      folder: { type: "string", description: "Mailbox folder (default: INBOX)" },
    },
    required: ["account", "uid", "keyword"],
  },
};

interface FlagMessageArgs {
  account: string;
  uid: number;
  keyword: string;
  folder?: string;
}

export async function handleFlagMessage(
  args: FlagMessageArgs,
  manager: ConnectionManager
): Promise<ToolResult> {
  const { account, uid, keyword, folder = "INBOX" } = args;

  const clientOrError = manager.getClient(account);
  if ("error" in clientOrError) {
    return { content: [{ type: "text", text: `Error: ${clientOrError.error}` }], isError: true };
  }
  const client = clientOrError;

  const lock = await client.getMailboxLock(folder);
  try {
    // KFLAG-04: warn if server does not support custom keywords
    if (!client.mailbox.permanentFlags.has('\\*')) {
      logger.warn(`[${account}] Server does not support custom IMAP keywords (PERMANENTFLAGS lacks \\*) — ClaudeProcessed flag may not persist`);
    }
    // KFLAG-01: set the keyword
    await client.messageFlagsAdd([uid], [keyword], { uid: true });
    return { content: [{ type: "text", text: JSON.stringify({ success: true, account, uid, keyword }) }], isError: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error flagging message ${uid} on ${account} with keyword ${keyword}: ${message}` }], isError: true };
  } finally {
    lock.release();
  }
}
```

### SearchParams extension (search-service.ts)
```typescript
// Source: src/services/search-service.ts established pattern
export interface SearchParams {
  from?: string;
  subject?: string;
  since?: string;
  before?: string;
  unread?: boolean;
  body?: string;
  folder?: string;
  maxResults?: number;
  excludeKeyword?: string;   // NEW — maps to criteria.unKeyword
}

// Inside criteria-building block:
if (excludeKeyword !== undefined) {
  // Use imapflow SearchObject field — if unKeyword is not typed, use: (criteria as any).unKeyword = excludeKeyword
  // Alternative: criteria.not = { keyword: excludeKeyword }
  criteria.unKeyword = excludeKeyword;
}
```

### Poller.query extension (poller.ts)
```typescript
// Source: src/polling/poller.ts established filter pattern
query(
  since: string,
  account?: string,
  excludeKeyword?: string    // NEW parameter
): MultiAccountResult<MultiAccountMessageHeader> {
  const sinceTime = new Date(since).getTime() || 0;
  // ...
  const filtered = entries.filter(
    (m) =>
      (new Date(m.date).getTime() || 0) > sinceTime &&
      (excludeKeyword === undefined ||
        !(m.keywords ?? []).some(
          (k) => k.toLowerCase() === excludeKeyword.toLowerCase()
        ))
  );
}
```

### types.ts addition
```typescript
// Add keywords field to MessageHeader (propagates to MultiAccountMessageHeader via extension)
export interface MessageHeader {
  uid: number;
  from: string;
  subject: string;
  date: string;
  unread: boolean;
  to: string[];
  cc: string[];
  keywords?: string[];   // NEW — custom IMAP keywords set on the message
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Raw STORE command | `messageFlagsAdd` helper | imapflow v1.x | Handles UID mode, encoding, error mapping automatically |
| Check CAPABILITY at login | Check `client.mailbox.permanentFlags` after mailboxOpen | imapflow design | Per-mailbox granularity; more accurate than global CAPABILITY |

**Deprecated/outdated:**
- None relevant to this phase.

## Open Questions

1. **imapflow `SearchObject` exact field for NOT KEYWORD**
   - What we know: imapflow `SearchObject` has `keyword` field for KEYWORD search; RFC 3501 defines UNKEYWORD command
   - What's unclear: Whether imapflow exposes `unKeyword` as a top-level field on `SearchObject` or requires `{ not: { keyword: value } }`
   - Recommendation: Check `imapflow.d.ts` type file during Wave 0. If `unKeyword` is not a typed field, cast to `any` or use `criteria.not = { keyword: excludeKeyword }` form. The CONTEXT.md explicitly mentions both forms.

2. **Where to add `keywords` field: `MessageHeader` vs `MultiAccountMessageHeader`**
   - What we know: `MessageHeader` is the shared base; `MultiAccountMessageHeader` extends it; both `SearchResultItem` and cache headers derive from `MessageHeader`
   - What's unclear: Whether keywords should be on the base type (making it available in all responses) or only on `MultiAccountMessageHeader` (cache-only concern)
   - Recommendation: Add to `MessageHeader` as `keywords?: string[]` so it propagates everywhere and remains optional — existing consumers see no change; search responses also carry it for symmetry.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.0.18 |
| Config file | vitest.config.ts (project root) |
| Quick run command | `npm test -- tests/tools/flag-message.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| KFLAG-01 | `handleFlagMessage` calls `messageFlagsAdd([uid], [keyword], { uid: true })` | unit | `npm test -- tests/tools/flag-message.test.ts` | Wave 0 |
| KFLAG-01 | `handleFlagMessage` returns `isError: false` on success | unit | `npm test -- tests/tools/flag-message.test.ts` | Wave 0 |
| KFLAG-01 | `handleFlagMessage` returns `isError: true` when `getClient` errors | unit | `npm test -- tests/tools/flag-message.test.ts` | Wave 0 |
| KFLAG-01 | `handleFlagMessage` returns `isError: true` when `messageFlagsAdd` throws | unit | `npm test -- tests/tools/flag-message.test.ts` | Wave 0 |
| KFLAG-02 | `handleSearchMessages` passes `unKeyword` criteria when `exclude_keyword` is set | unit | `npm test -- tests/tools/search-messages.test.ts` | Exists (extend) |
| KFLAG-02 | `handleSearchMessages` with no `exclude_keyword` does not include `unKeyword` in criteria | unit | `npm test -- tests/tools/search-messages.test.ts` | Exists (extend) |
| KFLAG-03 | `Poller.query()` with `exclude_keyword` omits messages whose `keywords` include that value | unit | `npm test -- tests/polling/poller.test.ts` | Exists (extend) |
| KFLAG-03 | `handleGetNewMail` passes `exclude_keyword` to `poller.query()` | unit | `npm test -- tests/tools/get-new-mail.test.ts` | Exists (extend) |
| KFLAG-04 | `handleFlagMessage` calls `logger.warn` when `permanentFlags` lacks `\*` | unit | `npm test -- tests/tools/flag-message.test.ts` | Wave 0 |
| KFLAG-04 | `handleFlagMessage` does NOT return `isError: true` when `permanentFlags` lacks `\*` | unit | `npm test -- tests/tools/flag-message.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- tests/tools/flag-message.test.ts` (or relevant test file)
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/tools/flag-message.test.ts` — covers KFLAG-01 and KFLAG-04 (new file, does not exist)

*(All other test files exist; they need new test cases added, not new files created)*

## Sources

### Primary (HIGH confidence)
- [imapflow official client API docs](https://imapflow.com/docs/api/imapflow-client/) — `messageFlagsAdd` signature, `client.mailbox.permanentFlags` type and access pattern
- `src/tools/download-attachment.ts` — canonical write-tool pattern (lock → try/finally → release)
- `src/services/search-service.ts` — criteria-building pattern; `body` field addition in Phase 10 is the direct precedent for `unKeyword`
- `src/polling/poller.ts` — `query()` signature and filter pattern; `mergeIntoCache` dedup logic
- `src/types.ts` — `MessageHeader`, `MultiAccountMessageHeader`, `SearchResultItem` type hierarchy
- `src/index.ts` — tool registration pattern (import + TOOLS array + switch case)

### Secondary (MEDIUM confidence)
- [imapflow DeepWiki — Message Operations](https://deepwiki.com/postalsys/imapflow/5-message-operations) — `messageFlagsAdd` usage patterns, confirmed `{ uid: true }` option
- [imapflow DeepWiki — Mailbox Operations](https://deepwiki.com/postalsys/imapflow/4-mailbox-operations) — `client.mailbox.permanentFlags` access after lock

### Tertiary (LOW confidence)
- imapflow SearchObject `unKeyword` field name — not definitively confirmed in official docs; needs verification against `imapflow.d.ts` during implementation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in use; no new dependencies
- Architecture: HIGH — all patterns established in existing code; direct precedents for every technique
- Pitfalls: HIGH — derived from codebase inspection and RFC 3501 knowledge; imapflow `unKeyword` field name is the one LOW item
- imapflow `unKeyword` field: LOW — needs verification against `.d.ts` type file; fallback form is known

**Research date:** 2026-03-18
**Valid until:** 2026-06-18 (stable library, stable RFC)
