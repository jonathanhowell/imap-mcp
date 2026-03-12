# Phase 3: Core Read Operations - Research

**Researched:** 2026-03-12
**Domain:** ImapFlow IMAP client API, email body parsing, MCP tool handler patterns
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- One `read_message` tool with a `format` parameter: `'full' | 'clean' | 'truncated'`. Default format: `clean`.
- `truncated` format uses `max_chars` parameter; defaults to 2000 chars if not specified.
- `full` format: prefer `text/plain` part; fall back to HTML-stripped body if no plain part exists.
- `clean` format: same as `full` but also strips quoted reply chains.
- `read_message` always includes an `attachments` array (BODYSTRUCTURE fetched in same FETCH — zero overhead).
- Each attachment entry: `{ part_id, filename, size, mime_type }`.
- No separate `list_attachments` tool.
- Separate `download_attachment(account, uid, part_id)` tool — opt-in; content returned as base64 string.
- Folder listing is a flat list with full IMAP path strings. Each entry: `{ name, total, unread, special_use }`.
- `special_use` field: `'Inbox' | 'Sent' | 'Trash' | 'Spam' | 'Drafts' | null` — derived from IMAP special-use attributes.
- `search_messages` `folder` parameter defaults to `INBOX`; `folder: "all"` searches all folders.
- No offset-based pagination on search; `max_results` caps result count (default 50).
- Search result shape: `{ uid, from, subject, date, unread, folder }`.
- Tool catalog: `list_accounts`, `list_folders`, `list_messages`, `read_message`, `search_messages`, `download_attachment`.

### Claude's Discretion

- HTML-to-text conversion library choice (mailparser is already installed — but it is NOT installed per scan; see Standard Stack below).
- Quoted reply chain detection algorithm.
- Exact IMAP FETCH item sets used for each tool.
- Error message wording for unavailable accounts (follows Phase 2 structured error pattern).
- `list_messages` sort parameter values and defaults.

### Deferred Ideas (OUT OF SCOPE)

- None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MAIL-01 | Agent can list all folders/mailboxes in a named account | `client.list({ statusQuery: { messages, unseen } })` — single IMAP round-trip via LIST-STATUS extension |
| MAIL-02 | Agent can retrieve total and unread message counts per folder | Covered by `statusQuery: { messages: true, unseen: true }` in `list()` |
| MAIL-03 | Agent can list messages from any folder, not just Inbox | `getMailboxLock(folder)` + `fetchAll` with any path |
| LIST-01 | Agent can list messages with pagination (limit and offset) | Fetch all UIDs via `search({ all: true }, { uid: true })`, slice for pagination, fetch slice with envelope+flags |
| LIST-02 | Agent can list unread messages from a specific account | `search({ seen: false }, { uid: true })` inside target folder |
| LIST-03 | Message listings are sortable by date (newest-first or oldest-first) | Sort by `message.internalDate` after fetch; IMAP doesn't guarantee order |
| LIST-04 | Message list responses include headers only (no bodies) | Fetch with `{ uid: true, envelope: true, flags: true, internalDate: true }` — no bodyParts |
| READ-01 | Agent can fetch a full email by account name and UID | `fetchOne(uid, { bodyStructure: true, bodyParts: [...], envelope: true, flags: true }, { uid: true })` |
| READ-02 | Agent can fetch a truncated email body (first N characters) | Slice the extracted plain text after fetch; no special IMAP operation needed |
| READ-03 | Agent can fetch a cleaned email body (HTML stripped, quoted chains removed) | `html-to-text` for HTML parts + `email-reply-parser` for quoted chain stripping |
| READ-04 | Agent can list attachments for a message without downloading | BODYSTRUCTURE tree traversal to find `disposition === 'attachment'` nodes |
| READ-05 | Agent can download a specific attachment by UID and part_id | `client.download(uid, part_id, { uid: true })` — returns Readable stream; buffer and base64-encode |
| SRCH-01 | Agent can search messages by sender address/domain | `client.search({ from: value }, { uid: true })` |
| SRCH-02 | Agent can search messages by subject keyword | `client.search({ subject: value }, { uid: true })` |
| SRCH-03 | Agent can search messages by date range | `client.search({ since: Date, before: Date }, { uid: true })` |
| SRCH-04 | Agent can filter messages by read/unread status | `client.search({ seen: false }, { uid: true })` |
</phase_requirements>

## Summary

Phase 3 replaces the five stub tool handlers with real implementations and adds a sixth tool (`download_attachment`). All operations use the `ImapFlow` client obtained from `ConnectionManager.getClient()`. The key architectural challenge is that every IMAP operation that reads messages requires a mailbox to be selected first — this is done via `client.getMailboxLock(folder)` and the lock must always be released in a `finally` block. This is the only safe pattern when a shared persistent connection is used.

The two new external dependencies needed are `html-to-text` (HTML-to-plaintext conversion) and `email-reply-parser` (quoted reply chain stripping). Both are ESM-compatible, actively maintained, and have no conflicting peer dependencies with this project's stack. The CONTEXT.md mentioned `mailparser` as "already installed" but it is NOT present in `node_modules` or `package.json` dependencies — this needs to be treated as unavailable; `html-to-text` handles the HTML stripping use case directly.

The `list()` method with `statusQuery` is the correct API for `list_folders` — imapflow source confirms it uses the RFC 5819 `LIST-STATUS` extension when available (single round-trip for all folders with counts), falling back to per-mailbox `STATUS` commands on servers that don't support it. Folder count efficiency is therefore handled automatically.

**Primary recommendation:** Use `getMailboxLock` + `try/finally lock.release()` for every operation that requires a selected mailbox. Fetch only the IMAP items needed per tool (never fetch source/body for listing operations). Business logic (body extraction, attachment traversal, HTML stripping) lives in `src/services/`.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| imapflow | ^1.2.13 (installed) | All IMAP operations | Already the project's IMAP client; ships own `.d.ts` |
| html-to-text | ^9.0.5 | Convert HTML email body to plain text | Most widely adopted (1393+ dependents), dual CJS/ESM, v9 stable API |
| email-reply-parser | ^2.3.5 | Strip quoted reply chains from plain text | Used at Crisp with ~1M emails/day, active maintenance (updated March 2026), RE2 fallback |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zod | ^4.3.6 (installed) | Validate tool input parameters | Input validation for all 6 tool handlers |
| @modelcontextprotocol/sdk | ^1.27.1 (installed) | Tool registration and response shape | Registering `download_attachment` new tool |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| html-to-text | mailparser | mailparser parses entire MIME message; heavier than needed when BODYSTRUCTURE already gives structure |
| email-reply-parser | Custom regex | Custom regex fails on non-English "On [date], [person] wrote:" patterns; library handles ~10 locales |
| email-reply-parser | node-email-reply-parser | node-email-reply-parser last published 4 years ago; email-reply-parser is actively maintained |

**Installation:**
```bash
npm install html-to-text email-reply-parser
npm install --save-dev @types/html-to-text
```

Note: `email-reply-parser` ships its own TypeScript types. `html-to-text` requires `@types/html-to-text`.

## Architecture Patterns

### Recommended Project Structure

```
src/
├── tools/
│   ├── stubs.ts              # Replaced: handlers moved to real implementations
│   ├── list-accounts.ts      # list_accounts handler
│   ├── list-folders.ts       # list_folders handler
│   ├── list-messages.ts      # list_messages handler
│   ├── read-message.ts       # read_message handler
│   ├── search-messages.ts    # search_messages handler
│   └── download-attachment.ts # NEW: download_attachment handler
├── services/
│   ├── folder-service.ts     # IMAP list() wrapper + special_use mapping
│   ├── message-service.ts    # Fetch, pagination, UID search helpers
│   ├── body-service.ts       # BODYSTRUCTURE traversal, HTML strip, reply chain strip
│   └── attachment-service.ts # Attachment metadata extraction + download
├── connections/              # Phase 2: unchanged
├── config/                   # Phase 1: unchanged
├── index.ts                  # Updated: register download_attachment + wire real handlers
├── logger.ts                 # Unchanged
└── types.ts                  # Augmented: add Phase 3 response types
```

### Pattern 1: Mailbox Lock Guard

Every operation that reads messages requires a lock. The `getMailboxLock()` method queues concurrent callers automatically — the lock is NOT a mutex that errors on contention; it serializes access safely.

**What:** Acquire mailbox lock before any FETCH/SEARCH, release in finally.
**When to use:** All five tools except `list_accounts` and `list_folders` (which use `list()` without opening a mailbox).

```typescript
// Source: imapflow README + imap-flow.d.ts
const lock = await client.getMailboxLock(folder);
try {
  // fetch, search, download operations here
} finally {
  lock.release();
}
```

### Pattern 2: list() with statusQuery for list_folders

```typescript
// Source: imapflow/lib/commands/list.js (verified in source)
const folders = await client.list({
  statusQuery: { messages: true, unseen: true }
});
// Each ListResponse has: path, specialUse, status.messages, status.unseen
```

The `specialUse` field from imapflow uses backslash-prefixed IMAP RFC values:
- `\\Inbox` → map to `'Inbox'`
- `\\Sent` → map to `'Sent'`
- `\\Trash` → map to `'Trash'`
- `\\Junk` → map to `'Spam'`
- `\\Drafts` → map to `'Drafts'`
- `undefined` or other → `null`

### Pattern 3: Paginated list_messages

IMAP has no native offset pagination. The reliable approach:
1. `search({ all: true }, { uid: true })` — returns all UIDs as number[]
2. Sort descending (highest UID = newest by default; use `internalDate` for date sort)
3. Slice the UID array: `uids.slice(offset, offset + limit)`
4. `fetchAll(slicedUids, { uid: true, envelope: true, flags: true, internalDate: true }, { uid: true })`

```typescript
// Source: imapflow imap-flow.d.ts SearchObject + FetchQueryObject
const allUids = await client.search({ all: true }, { uid: true });
// allUids: number[] — sort descending for newest-first
const sorted = [...allUids].sort((a, b) => b - a);
const pageUids = sorted.slice(offset, offset + limit);
const messages = await client.fetchAll(
  pageUids,
  { uid: true, envelope: true, flags: true, internalDate: true },
  { uid: true }
);
```

**Warning:** `client.search()` returns `number[] | false`. Always check for `false` (returned when mailbox is empty or search yields no results on some servers).

### Pattern 4: read_message with BODYSTRUCTURE

```typescript
// Source: imapflow imap-flow.d.ts FetchQueryObject + MessageStructureObject
const message = await client.fetchOne(
  uid,
  { uid: true, envelope: true, flags: true, bodyStructure: true },
  { uid: true }
);

// BODYSTRUCTURE traversal to find plain text part and attachments:
function findParts(node: MessageStructureObject, path: string[] = []) {
  // node.type is e.g. 'text', 'multipart', 'application', 'image'
  // node.part is the pre-computed part identifier (e.g. '1', '1.1', '2')
  // Use node.part when available (imapflow sets it on child nodes)
}
```

After identifying parts, fetch them separately:
```typescript
const fetched = await client.fetchOne(
  uid,
  { bodyParts: ['1'] },  // part identifiers from bodyStructure
  { uid: true }
);
// fetched.bodyParts is Map<string, Buffer>
const plainTextBuffer = fetched.bodyParts?.get('1');
```

### Pattern 5: download_attachment

```typescript
// Source: imapflow imap-flow.d.ts DownloadObject
const { meta, content } = await client.download(uid, part_id, { uid: true });
// content is a Readable stream — buffer it:
const chunks: Buffer[] = [];
for await (const chunk of content) {
  chunks.push(chunk as Buffer);
}
const base64Content = Buffer.concat(chunks).toString('base64');
```

### Pattern 6: search_messages across folders

```typescript
// For single folder (default):
const lock = await client.getMailboxLock(folder);
try {
  const uids = await client.search({
    from: params.from,
    subject: params.subject,
    since: params.since ? new Date(params.since) : undefined,
    before: params.before ? new Date(params.before) : undefined,
    seen: params.unread === true ? false : params.unread === false ? true : undefined,
  }, { uid: true });
} finally {
  lock.release();
}

// For folder: "all" — iterate all folders, collect results, cap at max_results:
const allFolders = await client.list();
const results: SearchResultItem[] = [];
for (const folder of allFolders) {
  if (results.length >= max_results) break;
  const lock = await client.getMailboxLock(folder.path);
  try {
    // search and fetch headers, annotate each result with folder.path
  } finally {
    lock.release();
  }
}
```

### Pattern 7: HTML body extraction with html-to-text

```typescript
// Source: html-to-text npm (v9 ESM)
import { convert } from 'html-to-text';

const plainText = convert(htmlString, {
  wordwrap: false,      // Don't wrap — agents process programmatically
  selectors: [
    { selector: 'a', options: { ignoreHref: true } }, // Links as text only
    { selector: 'img', format: 'skip' },              // Drop images
  ]
});
```

### Pattern 8: Quoted reply chain stripping with email-reply-parser

```typescript
// Source: email-reply-parser npm (v2.x ESM)
import EmailReplyParser from 'email-reply-parser';

const parsed = new EmailReplyParser().read(plainText);
const visibleText = parsed.getVisibleText(); // Only the new message content
```

### Anti-Patterns to Avoid

- **Forgetting `finally { lock.release() }`**: The ImapFlow lock queue will permanently block if a lock is never released. Every `getMailboxLock()` call MUST have a corresponding release in `finally`.
- **Using `fetchAll` on large result sets without pagination**: If a folder has 50,000 messages, `fetchAll('1:*', ...)` fetches all of them. Always paginate via UID slicing.
- **Opening mailbox for `list_folders`**: `client.list()` does NOT require a mailbox to be opened — calling `getMailboxLock` before `list()` is unnecessary and would select a mailbox on the connection.
- **Checking `'error' in result` after a successful `getClient()` call but inside the lock**: The `getClient()` check must happen BEFORE attempting `getMailboxLock`. The discriminated union check is the first thing each handler does.
- **Using sequence numbers instead of UIDs**: Sequence numbers change when messages are expunged. Always pass `{ uid: true }` to `fetch`, `fetchAll`, `fetchOne`, `search`, and `download`.
- **Assuming `search()` returns sorted results**: IMAP servers return UIDs in ascending order by default, not by date. Always sort explicitly.
- **Treating `message.bodyStructure.part` as the root part_id**: The root node's `part` may be undefined. Child nodes have `part` set (e.g., `'1'`, `'1.1'`). The flat-node traversal must handle root-level single-part messages (no childNodes, body is part `'1'`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTML to plain text | Strip tags with regex | `html-to-text` | Tables, nested lists, entities, charset encoding all fail with naive regex |
| Quoted reply detection | Pattern-match "On [date] wrote:" | `email-reply-parser` | Handles 10+ locales; Gmail, Outlook, Apple Mail all format differently |
| IMAP BODYSTRUCTURE parsing | Write own MIME tree traverser | imapflow's `bodyStructure` in FetchQueryObject | imapflow parses the IMAP RFC 3501 BODYSTRUCTURE response into a typed tree |
| LIST-STATUS fallback | Manually call STATUS per folder | `client.list({ statusQuery: {...} })` | imapflow handles RFC 5819 capability negotiation and fallback transparently |

**Key insight:** The email content domain has decades of edge cases (charsets, nested MIME structures, non-English reply headers, HTML quirks). Every "simple" hand-rolled solution breaks on real-world email.

## Common Pitfalls

### Pitfall 1: Lock Not Released on Error

**What goes wrong:** An exception thrown inside the `getMailboxLock` block leaves the lock unreleased. All subsequent callers on the same client block indefinitely.
**Why it happens:** Forgetting `finally` and using only `try/catch`.
**How to avoid:** Always structure as `try { ... } finally { lock.release() }`. Never `lock.release()` only in the success path.
**Warning signs:** Subsequent tool calls on the same account hang without returning.

### Pitfall 2: `search()` Returns `false` on Empty Mailbox

**What goes wrong:** `const uids = await client.search(...)` — `uids` is `false`, not `[]`. Calling `.slice()` on `false` throws a TypeError.
**Why it happens:** imapflow returns `false` when there are no matches (see `imap-flow.d.ts`: `Promise<number[] | false>`).
**How to avoid:** Always normalize: `const uids = (await client.search(..., { uid: true })) || [];`
**Warning signs:** TypeScript strict mode will catch this — `false` is not assignable to `number[]`.

### Pitfall 3: BODYSTRUCTURE Root Node Has No `part` Field

**What goes wrong:** Single-part messages (not multipart) have a root bodyStructure node with no `childNodes` and `part` is undefined. Recursive traversal that reads `node.part` gets `undefined`.
**Why it happens:** In IMAP, a single-part message's body is implicitly part `1`. imapflow sets `part` on child nodes but not the root.
**How to avoid:** When traversing the BODYSTRUCTURE tree, treat a root node with no `childNodes` as part `'1'`.
**Warning signs:** Attachment `part_id` values being `undefined` in the response.

### Pitfall 4: `folder: "all"` Search Performance

**What goes wrong:** Searching all folders on a large mailbox (e.g., 200 folders, 100k+ messages) takes minutes and blocks the connection lock.
**Why it happens:** Each folder requires a separate lock, SELECT, SEARCH, and optionally FETCH sequence.
**How to avoid:** This is by design (CONTEXT.md explicitly documents it). The tool description must warn agents. Implement with an early exit once `max_results` is reached.
**Warning signs:** No code fix needed; it's inherently slow. Document in tool description.

### Pitfall 5: `specialUse` IMAP Values Have Backslash Prefix

**What goes wrong:** `folder.specialUse === 'Sent'` never matches; the actual value is `'\\Sent'`.
**Why it happens:** imapflow preserves the raw IMAP RFC special-use flag format (e.g., `\Sent`, `\Trash`).
**How to avoid:** Map with explicit backslash strings: `'\\Sent'` → `'Sent'`, `'\\Trash'` → `'Trash'`, `'\\Junk'` → `'Spam'`, `'\\Drafts'` → `'Drafts'`, `'\\Inbox'` → `'Inbox'`.
**Warning signs:** All folders returning `special_use: null`.

### Pitfall 6: `ConnectionManager.getClient()` Returns Stale Client on Reconnect

**What goes wrong:** A tool handler stores the `ImapFlow` reference before a reconnect, then uses it after the reconnect creates a new client object. The old reference is disconnected.
**Why it happens:** `AccountConnection` creates a new `ImapFlow` instance on each reconnect attempt; `getClient()` always returns the current instance.
**How to avoid:** Always call `manager.getClient(accountId)` fresh at the top of each tool handler invocation. Never cache the returned `ImapFlow` across calls.
**Warning signs:** "Connection not usable" errors on the cached client while the account shows as connected.

### Pitfall 7: download() Returns a Stream, Not a Buffer

**What goes wrong:** Treating `DownloadObject.content` as a Buffer when it's a `Readable` stream. Calling `.toString()` directly gives `[object Object]`.
**Why it happens:** `DownloadObject` is defined as `{ meta: {...}; content: Readable }` in imap-flow.d.ts.
**How to avoid:** Collect chunks with `for await (const chunk of content)` and `Buffer.concat(chunks)`.
**Warning signs:** Base64 attachment content is `W29iamVjdCBPYmplY3Rd` (base64 of `[object Object]`).

## Code Examples

Verified patterns from official sources:

### list_folders — Full Account Folder List with Counts

```typescript
// Source: imapflow imap-flow.d.ts ListResponse + ListOptions, lib/commands/list.js
const folders = await client.list({
  statusQuery: { messages: true, unseen: true }
});

const SPECIAL_USE_MAP: Record<string, string> = {
  '\\Inbox': 'Inbox',
  '\\Sent': 'Sent',
  '\\Trash': 'Trash',
  '\\Junk': 'Spam',
  '\\Drafts': 'Drafts',
};

return folders.map(f => ({
  name: f.path,
  total: f.status?.messages ?? 0,
  unread: f.status?.unseen ?? 0,
  special_use: (f.specialUse && SPECIAL_USE_MAP[f.specialUse]) ?? null,
}));
```

### list_messages — Paginated Header List

```typescript
// Source: imapflow imap-flow.d.ts FetchQueryObject, FetchOptions, SearchObject
const lock = await client.getMailboxLock(folder, { readOnly: true });
try {
  const allUids = (await client.search({ all: true }, { uid: true })) || [];
  // Sort by UID descending for newest-first (default); date sort requires internalDate fetch
  const sorted = sort === 'asc' ? allUids : [...allUids].sort((a, b) => b - a);
  const pageUids = sorted.slice(offset, offset + limit);
  if (pageUids.length === 0) return [];
  const messages = await client.fetchAll(
    pageUids,
    { uid: true, envelope: true, flags: true, internalDate: true },
    { uid: true }
  );
  return messages.map(msg => ({
    uid: msg.uid,
    from: msg.envelope?.from?.[0]?.address ?? '',
    subject: msg.envelope?.subject ?? '',
    date: msg.internalDate instanceof Date ? msg.internalDate.toISOString() : String(msg.internalDate),
    unread: !msg.flags?.has('\\Seen'),
  }));
} finally {
  lock.release();
}
```

### read_message — Full Body Fetch with BODYSTRUCTURE

```typescript
// Source: imapflow imap-flow.d.ts fetchOne + FetchQueryObject
const lock = await client.getMailboxLock(folder, { readOnly: true });
try {
  // Step 1: Get structure to identify text parts and attachments
  const meta = await client.fetchOne(uid, { uid: true, envelope: true, flags: true, bodyStructure: true }, { uid: true });
  if (!meta) return { isError: true, content: [{ type: 'text', text: 'Message not found' }] };

  // Step 2: Find text part IDs and attachment info from bodyStructure
  const { textPartId, htmlPartId, attachments } = parseBodyStructure(meta.bodyStructure);

  // Step 3: Fetch the needed body parts
  const partsToFetch = [textPartId, htmlPartId].filter(Boolean) as string[];
  const body = partsToFetch.length > 0
    ? await client.fetchOne(uid, { bodyParts: partsToFetch }, { uid: true })
    : null;

  // Step 4: Extract and convert
  const plainText = extractBody(body, textPartId, htmlPartId);
  // Apply format: 'full' | 'clean' | 'truncated'
} finally {
  lock.release();
}
```

### download_attachment — Stream to Base64

```typescript
// Source: imapflow imap-flow.d.ts download() -> DownloadObject
const lock = await client.getMailboxLock(folder, { readOnly: true });
try {
  const { meta, content } = await client.download(uid, part_id, { uid: true });
  const chunks: Buffer[] = [];
  for await (const chunk of content) {
    chunks.push(chunk as Buffer);
  }
  return {
    filename: meta.filename ?? 'attachment',
    mime_type: meta.contentType,
    size: meta.expectedSize,
    content: Buffer.concat(chunks).toString('base64'),
  };
} finally {
  lock.release();
}
```

### BODYSTRUCTURE Traversal for Attachments

```typescript
// Source: Verified against imapflow imap-flow.d.ts MessageStructureObject
function parseBodyStructure(node: MessageStructureObject, partPath: string = '1') {
  // Root node without childNodes = single-part message, body is part '1'
  // node.part is set on child nodes but may be undefined at root
  const part = node.part ?? partPath;

  if (node.childNodes) {
    // Multipart: recurse with numbered sub-paths
    node.childNodes.forEach((child, i) =>
      parseBodyStructure(child, `${partPath}.${i + 1}`)
    );
  } else {
    const isAttachment = node.disposition === 'attachment'
      || (node.type !== 'text' && node.type !== 'multipart');
    // Collect attachments, find text/plain, find text/html
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-mailbox STATUS calls for folder counts | `list({ statusQuery })` using RFC 5819 LIST-STATUS | Adopted by major servers ~2015 | Single round-trip vs N round-trips |
| Sequence-number based pagination | UID-based pagination (`search` + `fetch` with `uid: true`) | Always best practice; UID invariant vs seq | UIDs stable across expunges |
| Regex-based HTML stripping | `html-to-text` v9 | v9 released 2023; dual CJS/ESM | Handles tables, nested tags, charsets correctly |

**Deprecated/outdated:**
- `mailparser` for this use case: heavier MIME parser not needed when imapflow already provides parsed BODYSTRUCTURE. CONTEXT.md noted it as "already installed" but it is not present in node_modules or package.json — treat as unavailable.

## Open Questions

1. **`folder` parameter for read_message and download_attachment**
   - What we know: IMAP requires a mailbox to be selected before FETCH/DOWNLOAD; the UID alone is not sufficient — you must know which folder it lives in.
   - What's unclear: The CONTEXT.md tool catalog shows `read_message(account, uid, format?, max_chars?)` and `download_attachment(account, uid, part_id)` without a `folder` parameter.
   - Recommendation: Planner must decide whether agents always call `read_message` after `list_messages` (which returns UIDs from a known folder, so the agent passes `folder` implicitly), or whether the tool needs a `folder` parameter. The simplest resolution is to add an optional `folder` parameter defaulting to `INBOX`. This is an input schema concern — the handler cannot operate without knowing the folder.

2. **`list_messages` sort parameter values**
   - What we know: CONTEXT.md marks this as Claude's Discretion.
   - What's unclear: Whether sort is by UID or `internalDate` and what the parameter values are.
   - Recommendation: Use `sort?: 'newest' | 'oldest'` defaulting to `'newest'`. Implement by sorting the UID array descending (newest UID first) for `'newest'`, ascending for `'oldest'`. For strict date accuracy, fetch with `internalDate: true` and sort on the date field, but UID order is sufficient for most mailboxes.

3. **`list_messages` `folder` default**
   - What we know: `search_messages` defaults folder to `INBOX`. `list_messages` in CONTEXT.md requires `folder` as a required parameter per stubs.ts.
   - Recommendation: Keep `folder` as required for `list_messages` (consistent with the stub schema) and optional with INBOX default for `search_messages`.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^4.0.18 |
| Config file | `vitest.config.ts` |
| Quick run command | `npm test -- --reporter=verbose` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MAIL-01 | list_folders returns flat array with all mailboxes | unit | `npm test -- tests/tools/list-folders.test.ts` | ❌ Wave 0 |
| MAIL-02 | folder entries include total and unread counts | unit | `npm test -- tests/tools/list-folders.test.ts` | ❌ Wave 0 |
| MAIL-03 | list_messages accepts any folder path, not just INBOX | unit | `npm test -- tests/tools/list-messages.test.ts` | ❌ Wave 0 |
| LIST-01 | list_messages respects limit and offset | unit | `npm test -- tests/tools/list-messages.test.ts` | ❌ Wave 0 |
| LIST-02 | list_messages with search({ seen: false }) in target folder | unit | `npm test -- tests/tools/list-messages.test.ts` | ❌ Wave 0 |
| LIST-03 | list_messages sort=newest returns newest message first | unit | `npm test -- tests/tools/list-messages.test.ts` | ❌ Wave 0 |
| LIST-04 | list_messages response has no body fields, only headers | unit | `npm test -- tests/tools/list-messages.test.ts` | ❌ Wave 0 |
| READ-01 | read_message format=full returns plain text body | unit | `npm test -- tests/tools/read-message.test.ts` | ❌ Wave 0 |
| READ-02 | read_message format=truncated returns at most max_chars | unit | `npm test -- tests/tools/read-message.test.ts` | ❌ Wave 0 |
| READ-03 | read_message format=clean strips quoted reply chains | unit | `npm test -- tests/services/body-service.test.ts` | ❌ Wave 0 |
| READ-04 | read_message response.attachments has part_id/filename/size/mime_type | unit | `npm test -- tests/services/body-service.test.ts` | ❌ Wave 0 |
| READ-05 | download_attachment returns base64 content string | unit | `npm test -- tests/tools/download-attachment.test.ts` | ❌ Wave 0 |
| SRCH-01 | search_messages from param maps to SearchObject.from | unit | `npm test -- tests/tools/search-messages.test.ts` | ❌ Wave 0 |
| SRCH-02 | search_messages subject param maps to SearchObject.subject | unit | `npm test -- tests/tools/search-messages.test.ts` | ❌ Wave 0 |
| SRCH-03 | search_messages since/before become Date objects in SearchObject | unit | `npm test -- tests/tools/search-messages.test.ts` | ❌ Wave 0 |
| SRCH-04 | search_messages unread=true maps to seen: false | unit | `npm test -- tests/tools/search-messages.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/tools/list-folders.test.ts` — covers MAIL-01, MAIL-02
- [ ] `tests/tools/list-messages.test.ts` — covers MAIL-03, LIST-01, LIST-02, LIST-03, LIST-04
- [ ] `tests/tools/read-message.test.ts` — covers READ-01, READ-02
- [ ] `tests/tools/download-attachment.test.ts` — covers READ-05
- [ ] `tests/tools/search-messages.test.ts` — covers SRCH-01, SRCH-02, SRCH-03, SRCH-04
- [ ] `tests/services/body-service.test.ts` — covers READ-03, READ-04
- [ ] Dependency install: `npm install html-to-text email-reply-parser && npm install --save-dev @types/html-to-text`

## Sources

### Primary (HIGH confidence)

- `/node_modules/imapflow/lib/imap-flow.d.ts` — Complete TypeScript type definitions for all ImapFlow methods used in this phase (fetch, fetchAll, fetchOne, search, list, download, getMailboxLock)
- `/node_modules/imapflow/lib/commands/list.js` — Verified LIST-STATUS extension behavior and statusQuery fallback implementation
- `/node_modules/imapflow/README.md` — Official getMailboxLock try/finally pattern

### Secondary (MEDIUM confidence)

- [ImapFlow Fetching Messages Guide](https://imapflow.com/docs/guides/fetching-messages/) — bodyStructure, bodyParts, UID fetch examples
- [ImapFlow Searching Guide](https://imapflow.com/docs/guides/searching/) — search() return value, criteria combinations
- [ImapFlow Mailbox Management Guide](https://imapflow.com/docs/guides/mailbox-management/) — list() with specialUse
- [html-to-text npm](https://www.npmjs.com/package/html-to-text) — v9 ESM import pattern `import { convert } from 'html-to-text'`
- [email-reply-parser npm/GitHub](https://github.com/crisp-oss/email-reply-parser) — `new EmailReplyParser().read(text).getVisibleText()`

### Tertiary (LOW confidence)

- WebSearch findings on BODYSTRUCTURE traversal pattern — verified against imap-flow.d.ts types but not against a live server

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all core libraries verified against installed node_modules and npm registries
- Architecture: HIGH — imapflow API verified directly from installed `.d.ts` and source files
- Pitfalls: HIGH — `search() returns false`, BODYSTRUCTURE root node, lock release all verified from library source
- HTML/reply stripping libraries: MEDIUM — npm search results verified, exact API confirmed via published docs but not run against installed code (packages not yet installed)

**Research date:** 2026-03-12
**Valid until:** 2026-06-12 (stable libraries; imapflow API unlikely to change in 90 days)
