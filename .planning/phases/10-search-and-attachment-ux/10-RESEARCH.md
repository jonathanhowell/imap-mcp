# Phase 10: Search and Attachment UX - Research

**Researched:** 2026-03-16
**Domain:** IMAP body search criteria; MIME bodyStructure traversal for filename-based attachment lookup
**Confidence:** HIGH

## Summary

Phase 10 is two independent, additive ergonomics improvements to existing tools. No new tools. No response-shape changes. The implementation touches exactly four files (two tool handlers and two service files) in a pattern already well-established by the prior five phases.

The `body` search criterion is a native IMAP construct: imapflow's `client.search()` already accepts `{ body: "text" }` and the existing criteria-building pattern in `search-service.ts` makes adding it a one-liner. The full-text index is server-side; the client simply passes the criterion through.

The `filename` path for `download_attachment` requires a two-step lookup: fetch the message's BODYSTRUCTURE, walk the MIME part tree (already done by `parseBodyStructure` in `body-service.ts`), find the first attachment whose filename matches case-insensitively, extract its `part_id`, then delegate to the existing `downloadAttachment()` function. The only new logic is the lookup bridge between filename and part_id.

**Primary recommendation:** Add `body` to `SearchParams` and pass it through; add filename lookup in `handleDownloadAttachment` using `parseBodyStructure` on a freshly-fetched bodyStructure before calling `downloadAttachment`.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### part_id / filename interface
- Both `part_id` and `filename` become optional parameters on `download_attachment`
- Runtime validation: if neither is provided, return error: `"Error: either part_id or filename must be provided"`
- When both are provided: `part_id` wins — use it directly, skip filename lookup (faster, unambiguous)
- `filename` is the fallback for when the agent doesn't know the part ID
- Remove `part_id` from the `required` array in the tool schema

#### Filename matching
- Exact match, case-insensitive: `"report.pdf"` matches `"Report.PDF"` but not `"Q4-report.pdf"`
- First matching part returned when multiple parts share the same filename (per roadmap success criteria)
- When no attachment matches the filename: error with the filename in the message, e.g.:
  `"No attachment with filename 'invoice.pdf' found in message 42"`

#### body search
- New optional `body` parameter on `search_messages`
- Tool description: `"Filter by body text content (case-insensitive partial match, server-side). May be slower than header-only searches on large mailboxes."`
- IMAP implementation: add `criteria.body = body` to the existing criteria object in `search-service.ts`
- Works in both single-account and fan-out (multi-account) modes — body is just another search criterion
- Combines with other filters (from, subject, etc.) as AND logic — standard IMAP behavior

### Claude's Discretion
- Exact TypeScript parameter types for optional `part_id`/`filename` (both `string | undefined`)
- bodyStructure fetch implementation detail for filename lookup (fetch body structure, walk parts, find first case-insensitive match)
- Test structure for the new filename path in download-attachment tests

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SRCH-05 | Agent can search messages by body text content (partial match) | IMAP `body` criterion is natively supported by imapflow's `client.search()`; `search-service.ts` criteria-building pattern already handles `from`, `subject`, `since`, `before`, `unread` with the same `if (x !== undefined) criteria.x = x` shape |
| ATCH-01 | Agent can download an attachment by `filename` instead of `part_id` when the exact part ID is unknown | `parseBodyStructure()` in `body-service.ts` already walks the MIME tree and returns `attachments: AttachmentMeta[]` with `filename` and `part_id` on each entry; filename→part_id lookup is a filter + case-insensitive compare on that array |
</phase_requirements>

---

## Standard Stack

### Core (already installed — no new dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| imapflow | ^1.2.13 | IMAP client — `client.search()` accepts `{ body: "..." }` natively; `client.fetchAll()` with `{ bodyStructure: true }` returns the MIME tree | Project standard, in production use |
| vitest | ^4.0.18 | Test framework — all existing tests use this | Project standard |
| typescript | ^5.9.3 | Language — all source is `.ts` | Project standard |

No new packages required.

### How imapflow exposes bodyStructure for filename lookup

To fetch the bodyStructure of a message, use `client.fetchAll()` or `client.fetch()` with `{ bodyStructure: true }`. The returned message object has a `.bodyStructure` property that is a `MessageStructureObject` as defined in `src/services/body-service.ts`.

```typescript
// Confidence: HIGH — observed in existing read-message.ts implementation
const lock = await client.getMailboxLock(folder, { readOnly: true });
try {
  const [msg] = await client.fetchAll([uid], { bodyStructure: true }, { uid: true });
  const structure = parseBodyStructure(msg.bodyStructure);
  // structure.attachments is AttachmentMeta[] with .filename and .part_id
} finally {
  lock.release();
}
```

## Architecture Patterns

### Recommended Change Set

The phase touches exactly four files plus one test file:

```
src/
├── services/
│   └── search-service.ts       # Add body?: string to SearchParams; add criteria.body line
└── tools/
    ├── search-messages.ts      # Add body?: string to SearchMessagesParams; thread through both paths; add inputSchema property
    └── download-attachment.ts  # Make part_id optional; add filename?: string; add lookup logic

tests/
└── tools/
    ├── search-messages.test.ts       # New describe block for SRCH-05
    └── download-attachment.test.ts   # New describe block for ATCH-01 filename path
```

### Pattern 1: Adding a search criterion (SRCH-05)

Follows the exact same shape already used for `from`, `subject`, `seen`, `since`, `before`.

In `SearchParams` interface:
```typescript
body?: string;
```

In criteria building block:
```typescript
if (body !== undefined) criteria.body = body;
```

In `handleSearchMessages`, destructure `body` from params and pass it through both the fan-out and single-account `searchMessages()` calls.

In `SEARCH_MESSAGES_TOOL` inputSchema, add alongside the existing properties:
```typescript
body: {
  type: "string",
  description:
    "Filter by body text content (case-insensitive partial match, server-side). " +
    "May be slower than header-only searches on large mailboxes.",
},
```

### Pattern 2: filename → part_id lookup (ATCH-01)

The lookup lives between `manager.getClient()` and `downloadAttachment()` in `handleDownloadAttachment`.

Decision flow:
1. If neither `part_id` nor `filename` provided → return error immediately (before any IMAP call)
2. If `part_id` provided → use it directly (skip lookup)
3. If only `filename` provided → fetch bodyStructure, call `parseBodyStructure`, find first attachment where `filename.toLowerCase() === target.toLowerCase()`, extract its `part_id`, then call `downloadAttachment()`
4. If filename not found → return `{ content: [{ type: "text", text: "No attachment with filename '...' found in message UID" }], isError: true }`

The lock acquired for bodyStructure fetch must be released before `downloadAttachment()` acquires its own lock (imapflow does not support nested locks on the same folder).

```typescript
// Filename lookup — fetch bodyStructure, walk parts, find first case-insensitive match
const lock = await client.getMailboxLock(folder, { readOnly: true });
let resolvedPartId: string;
try {
  const msgs = await client.fetchAll([uid], { bodyStructure: true }, { uid: true });
  if (!msgs || msgs.length === 0) {
    return { content: [{ type: "text", text: `Error: message ${uid} not found` }], isError: true };
  }
  const parsed = parseBodyStructure(msgs[0].bodyStructure);
  const match = parsed.attachments.find(
    (a) => a.filename.toLowerCase() === filename.toLowerCase()
  );
  if (!match) {
    return {
      content: [{ type: "text", text: `No attachment with filename '${filename}' found in message ${uid}` }],
      isError: true,
    };
  }
  resolvedPartId = match.part_id;
} finally {
  lock.release();
}
// Now call downloadAttachment with resolvedPartId — it acquires its own lock
```

### Anti-Patterns to Avoid

- **Nested IMAP locks:** Do not hold the bodyStructure lock while calling `downloadAttachment()`. Release it first — imapflow will error on overlapping locks for the same mailbox.
- **Custom MIME walker:** `parseBodyStructure` from `body-service.ts` already exists and is tested. Use it. Do not inline a new traversal.
- **Mutating `criteria` outside the building block:** All criteria additions in `search-service.ts` use the same `if (x !== undefined) criteria.x = x` pattern. Match it exactly — do not introduce a different shape.
- **Optional chaining on `msgs[0].bodyStructure`:** `fetchAll` with `{ bodyStructure: true }` always returns the structure when the message exists. If the array is empty, the message wasn't found — handle that case directly.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MIME tree traversal | Custom recursive walker | `parseBodyStructure()` from `src/services/body-service.ts` | Already handles childNodes recursion, single-part root edge case, `dispositionParameters.filename` vs `parameters.name` fallback, tested |
| IMAP body search | Client-side body text scanning | `criteria.body = body` in `client.search()` | Server-side; handles encoding and indexing that client-side text matching cannot |
| Attachment filename index | Map or pre-computed lookup | Inline `.find()` on `parsed.attachments` | Array is small (message attachments); no index needed |

## Common Pitfalls

### Pitfall 1: Nested IMAP mailbox lock
**What goes wrong:** Calling `downloadAttachment()` (which acquires a lock) while still holding the bodyStructure lock causes imapflow to throw or hang.
**Why it happens:** `downloadAttachment` internally calls `client.getMailboxLock(folder)`. If a lock is already open for that mailbox, imapflow queues or errors.
**How to avoid:** Always release the bodyStructure lock in the `finally` block before calling `downloadAttachment`.
**Warning signs:** Test hangs indefinitely or throws "Mailbox is locked" style error.

### Pitfall 2: Case sensitivity in filename compare
**What goes wrong:** `a.filename === target` fails for `"report.pdf"` vs `"Report.PDF"`.
**Why it happens:** MIME filenames can have mixed case. Decision requires case-insensitive exact match.
**How to avoid:** `a.filename.toLowerCase() === filename.toLowerCase()`.

### Pitfall 3: Forgetting to thread `body` through the fan-out path
**What goes wrong:** Body search works in single-account mode but silently ignores the `body` param in multi-account fan-out mode.
**Why it happens:** Both `searchMessages()` call sites in `handleSearchMessages` must pass `body`. The fan-out call is easily missed.
**How to avoid:** Both calls in `handleSearchMessages` (fan-out `fanOutAccounts` lambda and single-account direct call) must include `body` in the params object.

### Pitfall 4: Schema `required` array not updated
**What goes wrong:** `download_attachment` still lists `part_id` as required — agents must always supply it, defeating ATCH-01.
**Why it happens:** Easy to update the TypeScript interface but forget the JSON Schema `required` array.
**How to avoid:** Remove `"part_id"` from `required: ["account", "uid", "part_id"]` in `DOWNLOAD_ATTACHMENT_TOOL`. The new `required` should be `["account", "uid"]`.

### Pitfall 5: Existing tests break on changed interface
**What goes wrong:** The four existing download-attachment tests all call `handleDownloadAttachment` with `part_id` as a required field. After the interface change to `part_id?: string`, the TypeScript types still accept this — no breakage. But verify the existing tests still pass unchanged.
**Why it happens:** TypeScript optional is backwards-compatible here; existing callers passing `part_id` still work.
**How to avoid:** Run `npm test` after the interface change — existing tests should be green without modification.

## Code Examples

### SRCH-05: body criterion in search-service.ts

```typescript
// Source: existing pattern in src/services/search-service.ts lines 31-38
// Add after the existing criteria assignments:
if (body !== undefined) criteria.body = body;
```

### SRCH-05: body in tool inputSchema

```typescript
// Consistent with folder description pattern in SEARCH_MESSAGES_TOOL
body: {
  type: "string",
  description:
    "Filter by body text content (case-insensitive partial match, server-side). " +
    "May be slower than header-only searches on large mailboxes.",
},
```

### ATCH-01: runtime guard (neither param provided)

```typescript
// In handleDownloadAttachment, before manager.getClient()
if (part_id === undefined && filename === undefined) {
  return {
    content: [{ type: "text", text: "Error: either part_id or filename must be provided" }],
    isError: true,
  };
}
```

### ATCH-01: filename-not-found error shape

```typescript
// Matches established error shape: { content: [{ type: "text", text: "Error: ..." }], isError: true }
return {
  content: [{ type: "text", text: `No attachment with filename '${filename}' found in message ${uid}` }],
  isError: true,
};
```

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| `part_id` required on `download_attachment` | `part_id` optional; `filename` accepted as alternative | Agents no longer need to call `read_message` first just to discover a part ID |
| search_messages has no body filter | `body` parameter added | Agents can find messages by content, not just headers |

**No deprecated patterns in this phase.** All changes are additive.

## Open Questions

None. All decisions are locked in CONTEXT.md. The existing codebase provides all reusable assets needed.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^4.0.18 |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npm test` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SRCH-05 | `body` param passed as IMAP `body` criterion | unit | `npm test -- --reporter=verbose tests/tools/search-messages.test.ts` | ✅ (add describe block) |
| SRCH-05 | `body` passes through fan-out (multi-account) path | unit | `npm test -- --reporter=verbose tests/tools/search-messages.test.ts` | ✅ (add describe block) |
| ATCH-01 | `filename` resolves to correct part and returns content | unit | `npm test -- --reporter=verbose tests/tools/download-attachment.test.ts` | ✅ (add describe block) |
| ATCH-01 | Missing both `part_id` and `filename` returns error | unit | `npm test -- --reporter=verbose tests/tools/download-attachment.test.ts` | ✅ (add describe block) |
| ATCH-01 | `part_id` wins when both provided | unit | `npm test -- --reporter=verbose tests/tools/download-attachment.test.ts` | ✅ (add describe block) |
| ATCH-01 | Filename not found returns descriptive error | unit | `npm test -- --reporter=verbose tests/tools/download-attachment.test.ts` | ✅ (add describe block) |
| ATCH-01 | Case-insensitive filename match works | unit | `npm test -- --reporter=verbose tests/tools/download-attachment.test.ts` | ✅ (add describe block) |

### Sampling Rate
- **Per task commit:** `npm test`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

None — existing test infrastructure covers all phase requirements. Both `tests/tools/search-messages.test.ts` and `tests/tools/download-attachment.test.ts` exist and import the correct modules. New test cases are added as describe blocks inside existing files; no new test files or framework config needed.

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection: `src/services/search-service.ts` — confirmed `criteria` object pattern, all existing search criterion assignments
- Direct code inspection: `src/tools/search-messages.ts` — confirmed `SearchMessagesParams`, fan-out and single-account paths, both `searchMessages()` call sites
- Direct code inspection: `src/tools/download-attachment.ts` — confirmed current required fields, error return shape, `downloadAttachment()` delegation
- Direct code inspection: `src/services/attachment-service.ts` — confirmed `downloadAttachment(client, folder, uid, partId)` signature unchanged
- Direct code inspection: `src/services/body-service.ts` — confirmed `parseBodyStructure()` returns `attachments: AttachmentMeta[]` with `filename` and `part_id`, handles all MIME structures
- Direct code inspection: `tests/tools/download-attachment.test.ts` — confirmed mock helper patterns for new tests
- Direct code inspection: `tests/tools/search-messages.test.ts` — confirmed `makeMockClient` pattern, multi-account helpers for new tests
- Direct code inspection: `tests/services/body-service.test.ts` — confirmed `parseBodyStructure` handles nested multipart, `dispositionParameters.filename`, `parameters.name` fallback

### Secondary (MEDIUM confidence)
- CONTEXT.md decisions — implementation decisions were made with full awareness of the codebase; all integration points verified against actual source

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all libraries already in use
- Architecture: HIGH — all four integration points verified by direct code inspection
- Pitfalls: HIGH — derived from actual source code structure and imapflow lock behavior

**Research date:** 2026-03-16
**Valid until:** 2026-04-15 (stable codebase, no external dependencies changing)
