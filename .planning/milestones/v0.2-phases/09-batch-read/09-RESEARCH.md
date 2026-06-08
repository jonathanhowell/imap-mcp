# Phase 9: Batch Read - Research

**Researched:** 2026-03-16
**Domain:** IMAP batch fetch / MCP tool implementation (TypeScript, imapflow)
**Confidence:** HIGH

## Summary

Phase 9 adds a single new tool, `read_messages` (plural), that fetches full message bodies for a list of UIDs in one call. The implementation is a direct extension of the existing `read_message` (singular) tool — same handler signature, same service layer, same response shape per entry — extended to iterate over a UID array rather than a single UID.

The key implementation decision from the CONTEXT.md is to use `client.fetch()` for a batched metadata phase (one IMAP round-trip for all UIDs' envelopes and bodyStructures) followed by per-message `client.download()` calls for content. This is the highest-leverage IMAP optimization available here: metadata is truly batched; body download is inherently sequential because each part streams independently.

The codebase is already well-structured for this addition. No existing files change except `src/index.ts` (registration). The new file `src/tools/read-messages.ts` mirrors `read-message.ts` closely. Reusable service functions (`parseBodyStructure`, `extractBody`) and the `MessageBody` type are consumed as-is.

**Primary recommendation:** Copy the structure of `read-message.ts` exactly, replace `fetchOne` with a batched `client.fetch()` call that collects results into a Map keyed by UID, then iterate the requested UIDs array to build the response array with success or error entries per UID.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Tool interface:**
- Tool name: `read_messages` (plural) — new tool alongside `read_message`, not a replacement
- Parameters: `account` (string, required), `uids` (number[], required), `folder` (string, optional, default: `"INBOX"`), `format` (same enum as `read_message`: `"full" | "clean" | "truncated"`, optional, default: `"clean"`), `max_chars` (number, optional, default: 2000)
- Hard cap: maximum 50 UIDs per call; return an error if exceeded (e.g. `"Too many UIDs: max 50 per call, got 87"`)
- All UIDs must be from the same folder (IMAP UIDs are scoped per-mailbox — this is not a limitation but a protocol constraint)

**Response shape:**
- Flat array — one entry per UID in the order requested
- Success entry: same shape as `MessageBody` from `read_message` (uid, from, subject, date, body, attachments)
- Error entry: `{ uid: number, error: string }` — when a UID does not exist or fetch fails
- No summary wrapper — just the array; agent can count successes/failures itself

**IMAP batching strategy:**
- Use `client.fetch(uidSet, query, { uid: true })` for the metadata phase (envelope + bodyStructure) — one IMAP round-trip for all UIDs, not a loop of `fetchOne()` calls
- Body content is still downloaded per-message via `client.download()` — unavoidable, content streaming is inherently per-part
- This means: 1 IMAP fetch round-trip for metadata + N download round-trips for content

### Claude's Discretion
- Exact UID set string format passed to `client.fetch()` (comma-joined UIDs or range notation)
- How to handle the mailbox lock for the batch (single lock covering all fetches)
- Order of operations when some UIDs are missing from fetch results

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BATCH-01 | Agent can call `read_messages` with a list of UIDs and receive full message bodies for all of them in a single response | Enabled by `client.fetch()` batched metadata + sequential `client.download()` per UID |
| BATCH-02 | `read_messages` accepts the same `format` and `max_chars` options as `read_message` | Enabled by reusing `BodyFormat` type and `extractBody()` from `body-service.ts` with same defaults |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| imapflow | ^1.2.13 | IMAP client — `client.fetch()`, `client.download()`, `getMailboxLock()` | Already the project's IMAP library; `fetch()` is its batch metadata API |
| @modelcontextprotocol/sdk | ^1.27.1 | MCP `Tool` type, `ToolResult` shape | Already the project's MCP SDK |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| email-reply-parser | ^2.3.5 | Strip reply chains for `format=clean` | Reused via `extractBody()` — no direct use in new code |
| html-to-text | ^9.0.5 | Convert HTML parts to plain text | Reused via `extractBody()` — no direct use in new code |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `client.fetch()` for batch metadata | Loop of `client.fetchOne()` | `fetchOne` is N round-trips; `fetch` is 1 round-trip for all UIDs |
| Sequential `client.download()` per UID | Parallel Promise.all downloads | Parallel downloads risk mailbox lock contention and IMAP server throttling; sequential is safer |

**Installation:**

No new packages required. All dependencies are already installed.

## Architecture Patterns

### Recommended Project Structure

```
src/
├── tools/
│   ├── read-message.ts      # existing — unchanged
│   └── read-messages.ts     # new — mirrors read-message.ts structure
├── services/
│   └── body-service.ts      # unchanged — parseBodyStructure, extractBody reused as-is
├── types.ts                 # unchanged — MessageBody, ToolResult reused
└── index.ts                 # add READ_MESSAGES_TOOL + handleReadMessages registration
tests/
└── tools/
    └── read-messages.test.ts  # new — mirrors read-message.test.ts patterns
```

### Pattern 1: Batched Metadata Fetch via `client.fetch()`

**What:** `client.fetch()` accepts a UID set string and returns an async iterator of message objects, each with the requested fields (envelope, bodyStructure, etc.). Unlike `fetchOne`, a single IMAP UID FETCH command is issued for all UIDs.

**When to use:** Any time multiple messages' metadata is needed in one IMAP interaction.

**Example:**

```typescript
// Source: imapflow API — client.fetch signature
// uidSet can be comma-joined: "1,2,3,42" or range notation: "1:50"
const fetchedMeta = new Map<number, FetchMessageObject>();
for await (const msg of client.fetch(
  uids.join(","),
  { uid: true, envelope: true, bodyStructure: true },
  { uid: true }
)) {
  if (msg.uid !== undefined) {
    fetchedMeta.set(msg.uid, msg);
  }
}
```

### Pattern 2: Single Mailbox Lock for Entire Batch

**What:** Acquire one `getMailboxLock` before the `client.fetch()` call, hold it through all `client.download()` calls, release in `finally`. This matches the exact pattern used by `handleReadMessage`.

**When to use:** Any multi-step IMAP operation on a single folder.

**Example:**

```typescript
const lock = await client.getMailboxLock(folder, { readOnly: true });
try {
  // 1. Batch metadata fetch
  // 2. Per-UID download loop
} finally {
  lock.release();
}
```

### Pattern 3: Response Array with Per-UID Success/Error Entries

**What:** Iterate `uids` in the order given. For each UID: if metadata was not returned from `client.fetch()`, push an error entry; if download fails, push an error entry; otherwise push a `MessageBody` success entry.

**When to use:** Any batch operation where partial success is valid.

**Example:**

```typescript
type BatchEntry = MessageBody | { uid: number; error: string };
const results: BatchEntry[] = [];

for (const uid of uids) {
  const meta = fetchedMeta.get(uid);
  if (!meta) {
    results.push({ uid, error: `message with UID ${uid} not found` });
    continue;
  }
  // ... download body ...
  results.push(messageBodyObject);
}

return {
  content: [{ type: "text", text: JSON.stringify(results) }],
  isError: false,
};
```

### Pattern 4: Tool Registration in `src/index.ts`

**What:** Add import + add to `TOOLS` array + add `case "read_messages":` to switch.

**When to use:** Every new tool follows this exact pattern.

**Example:**

```typescript
// import
import { READ_MESSAGES_TOOL, handleReadMessages } from "./tools/read-messages.js";

// TOOLS array
const TOOLS = [
  ...,
  READ_MESSAGES_TOOL,
];

// switch case
case "read_messages":
  return handleReadMessages(
    params as unknown as Parameters<typeof handleReadMessages>[0],
    manager
  ) as AnyToolResult;
```

### Anti-Patterns to Avoid

- **Loop of `fetchOne()` calls:** One IMAP round-trip per UID defeats the purpose of batch. Use `client.fetch()` for metadata.
- **Parallel `Promise.all` for downloads:** IMAP connections have one active command at a time. Sequential downloads within the held lock is correct.
- **Early return on first missing UID:** The spec requires continuing and including error entries for missing UIDs. Never abort the batch.
- **`isError: true` on the ToolResult for partial failures:** Partial failure (some UIDs missing) is not a tool error — include the error entries in the array and return `isError: false`. Only return `isError: true` for account-level failures (bad account, lock failure).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Body parsing/extraction | Custom MIME traversal | `parseBodyStructure()` + `extractBody()` in `body-service.ts` | Already handles multipart, attachments, HTML conversion, reply-chain stripping |
| Content-Transfer-Encoding decoding | Manual base64/qp decode | `client.download()` | imapflow decodes automatically — `fetchOne` bodyParts returns raw encoded bytes |
| Format logic | Custom truncation/clean logic | `extractBody()` | Already handles all three format modes with correct defaults |

**Key insight:** The entire body processing pipeline already exists and is tested. The new tool's job is orchestration: batch the fetch, iterate, delegate to existing services.

## Common Pitfalls

### Pitfall 1: UID Set String Format

**What goes wrong:** Passing `uids` as an array directly to `client.fetch()` instead of a string. imapflow's `fetch()` expects a UID set string (IMAP sequence set syntax).

**Why it happens:** The parameter name `uids` naturally suggests an array type.

**How to avoid:** Always convert: `uids.join(",")` for comma-separated, or build range notation if UIDs are contiguous. Comma-separated is simpler and universally correct.

**Warning signs:** TypeScript type error on the `fetch()` call; runtime IMAP protocol error.

### Pitfall 2: Map Population from Async Iterator

**What goes wrong:** Consuming the `client.fetch()` async iterator inside the per-UID loop (calling fetch once per UID). The iterator must be consumed once up-front into a Map.

**Why it happens:** Trying to "find" a specific UID inside the loop.

**How to avoid:** Consume the entire async iterator into `Map<number, FetchMessageObject>` before beginning the download loop.

**Warning signs:** Only the last UID is processed; earlier UIDs get "not found" errors.

### Pitfall 3: Missing UIDs Not in `client.fetch()` Results

**What goes wrong:** Assuming `client.fetch()` returns an entry for every requested UID. If a UID does not exist in the mailbox, imapflow silently omits it from results — it does not throw an error.

**Why it happens:** The `fetchOne()` pattern returns `null` for missing UIDs, creating an expectation that absence is signaled explicitly. With `fetch()`, absence is simply "not in the Map."

**How to avoid:** Check `fetchedMeta.has(uid)` for every UID after consuming the iterator. Any UID absent from the Map gets an error entry.

**Warning signs:** Missing UIDs produce no output (not even an error entry) in the response array.

### Pitfall 4: Hard Cap Validation Placement

**What goes wrong:** Applying the 50-UID hard cap after acquiring the mailbox lock, wasting a lock acquisition.

**Why it happens:** Copying the error guard pattern from the account check, which comes after `getClient()`.

**How to avoid:** Validate `uids.length > 50` immediately after destructuring args, before `getClient()` or `getMailboxLock()`.

**Warning signs:** Lock acquired and released with no work done when UIDs exceed limit.

### Pitfall 5: Empty UIDs Array

**What goes wrong:** Passing `uids: []` causes `client.fetch("")` to be called with an empty UID set string, which may trigger an IMAP protocol error.

**Why it happens:** No guard for the empty case.

**How to avoid:** Return an empty array result `[]` immediately when `uids.length === 0`, before calling `getMailboxLock`.

## Code Examples

Verified patterns from existing codebase:

### `read-message.ts` Handler Structure (source to mirror)

```typescript
// Source: src/tools/read-message.ts
export async function handleReadMessage(
  args: ReadMessageArgs,
  manager: ConnectionManager
): Promise<ToolResult> {
  const { account, uid, folder = "INBOX", format = "clean", max_chars = 2000 } = args;

  const clientOrError = manager.getClient(account);
  if ("error" in clientOrError) {
    return { content: [{ type: "text", text: `Error: ${clientOrError.error}` }], isError: true };
  }
  const client = clientOrError;

  const lock = await client.getMailboxLock(folder, { readOnly: true });
  try {
    const meta = await client.fetchOne(String(uid), { uid: true, envelope: true, flags: true, bodyStructure: true }, { uid: true });
    if (!meta) {
      return { content: [{ type: "text", text: `Error: message with UID ${uid} not found` }], isError: true };
    }
    // ... parse body, build MessageBody, return
  } finally {
    lock.release();
  }
}
```

### imapflow `fetch()` Async Iterator Pattern

```typescript
// client.fetch() returns an async iterable — must be consumed with for-await
const fetchedMeta = new Map<number, FetchMessageObject>();
for await (const msg of client.fetch(
  uids.join(","),
  { uid: true, envelope: true, bodyStructure: true },
  { uid: true }
)) {
  if (msg.uid !== undefined) {
    fetchedMeta.set(msg.uid, msg);
  }
}
```

### `client.download()` Stream Consumption Pattern

```typescript
// Source: src/tools/read-message.ts lines 91-96
const { content } = await client.download(String(uid), partId, { uid: true });
const chunks: Buffer[] = [];
for await (const chunk of content as Readable) {
  chunks.push(chunk as Buffer);
}
bodyText = extractBody(Buffer.concat(chunks).toString("utf-8"), isHtml, format, max_chars);
```

### Test Mock Pattern (from `read-message.test.ts`)

```typescript
// Source: tests/tools/read-message.test.ts
function makeMockManager(clientOverrides: Record<string, unknown> = {}): ConnectionManager {
  const client = {
    getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
    fetchOne: vi.fn(),
    download: vi.fn(),
    ...clientOverrides,
  };
  return { getClient: vi.fn().mockReturnValue(client) } as unknown as ConnectionManager;
}
```

For `read-messages.test.ts`, the client mock needs a `fetch` method (async generator) instead of `fetchOne`. Pattern:

```typescript
// fetch mock returns an async iterable
fetch: vi.fn().mockImplementation(async function* () {
  yield { uid: 42, envelope: makeEnvelope(...), bodyStructure: plainTextBodyStructure };
  yield { uid: 43, envelope: makeEnvelope(...), bodyStructure: plainTextBodyStructure };
})
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| N calls to `read_message` in a loop | Single `read_messages` call with uid array | Phase 9 (now) | Reduces agent round-trips from N to 1 |
| `fetchOne` per message | `client.fetch()` batch for metadata | Phase 9 (now) | Reduces IMAP round-trips from N to 1 for metadata phase |

## Open Questions

1. **UID set string format: comma vs range notation**
   - What we know: Both are valid IMAP sequence set syntax; imapflow accepts both
   - What's unclear: Whether imapflow's `fetch()` has a preference or maximum string length concern at 50 UIDs
   - Recommendation: Use `uids.join(",")` — simple, unambiguous, works for any UID distribution; 50 UIDs produces at most ~200 chars which is trivial

2. **Behavior on download failure for one UID**
   - What we know: `client.download()` can throw if the part cannot be fetched; `read_message` does not guard this
   - What's unclear: Whether to wrap each download in try/catch to produce an error entry vs let the whole batch throw
   - Recommendation: Wrap each per-UID download in try/catch; on failure push `{ uid, error: "download failed: ..." }` and continue. This is consistent with the per-UID error entry design.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^4.0.18 |
| Config file | vitest.config.ts |
| Quick run command | `npm test -- --reporter=verbose tests/tools/read-messages.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BATCH-01 | `read_messages` returns array of MessageBody for valid UIDs | unit | `npm test -- tests/tools/read-messages.test.ts` | ❌ Wave 0 |
| BATCH-01 | Error entry `{ uid, error }` for missing UID, others succeed | unit | `npm test -- tests/tools/read-messages.test.ts` | ❌ Wave 0 |
| BATCH-01 | Hard cap: >50 UIDs returns top-level error before IMAP call | unit | `npm test -- tests/tools/read-messages.test.ts` | ❌ Wave 0 |
| BATCH-01 | Account error returns `isError: true` ToolResult | unit | `npm test -- tests/tools/read-messages.test.ts` | ❌ Wave 0 |
| BATCH-02 | `format=full` returns unmodified plain text body | unit | `npm test -- tests/tools/read-messages.test.ts` | ❌ Wave 0 |
| BATCH-02 | `format=truncated` respects `max_chars` | unit | `npm test -- tests/tools/read-messages.test.ts` | ❌ Wave 0 |
| BATCH-02 | Default `format=clean` and `max_chars=2000` | unit | `npm test -- tests/tools/read-messages.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test -- tests/tools/read-messages.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/tools/read-messages.test.ts` — covers BATCH-01 and BATCH-02 (all rows above)

No framework or fixture gaps — vitest is installed, existing test helpers in other test files serve as models.

## Sources

### Primary (HIGH confidence)

- `src/tools/read-message.ts` — exact handler structure, lock pattern, download pattern to mirror
- `src/services/body-service.ts` — `parseBodyStructure()`, `extractBody()`, `BodyFormat` type — reused verbatim
- `src/types.ts` — `MessageBody`, `ToolResult` type shapes — confirmed
- `src/index.ts` — registration pattern confirmed
- `tests/tools/read-message.test.ts` — mock patterns for vitest unit tests
- `vitest.config.ts` — test discovery config, `tests/**/*.test.ts` glob
- `.planning/phases/09-batch-read/09-CONTEXT.md` — all implementation decisions

### Secondary (MEDIUM confidence)

- imapflow README / API — `client.fetch()` accepts UID set string, returns async iterator; `{ uid: true }` option for UID-mode fetch

### Tertiary (LOW confidence)

None — all claims are grounded in existing source code or the locked CONTEXT.md decisions.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — confirmed from package.json and existing source imports
- Architecture: HIGH — direct inspection of existing tool files; new tool mirrors established pattern exactly
- Pitfalls: HIGH — derived from reading imapflow's API behavior (async iterator vs fetchOne null) and the batching contract specified in CONTEXT.md
- Test patterns: HIGH — derived from reading existing test files

**Research date:** 2026-03-16
**Valid until:** 2026-04-16 (stable codebase, no fast-moving external dependencies)
