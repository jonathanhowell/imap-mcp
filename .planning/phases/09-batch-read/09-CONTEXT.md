# Phase 9: Batch Read - Context

**Gathered:** 2026-03-16
**Status:** Ready for planning

<domain>
## Phase Boundary

A new `read_messages` tool that fetches full message bodies for multiple UIDs in a single call, reducing agent round-trips. Accepts `account + uids[]` and returns one response entry per UID. The existing `read_message` (singular) tool is unaffected.

</domain>

<decisions>
## Implementation Decisions

### Tool interface
- Tool name: `read_messages` (plural) — new tool alongside `read_message`, not a replacement
- Parameters: `account` (string, required), `uids` (number[], required), `folder` (string, optional, default: `"INBOX"`), `format` (same enum as `read_message`: `"full" | "clean" | "truncated"`, optional, default: `"clean"`), `max_chars` (number, optional, default: 2000)
- Hard cap: maximum 50 UIDs per call; return an error if exceeded (e.g. `"Too many UIDs: max 50 per call, got 87"`)
- All UIDs must be from the same folder (IMAP UIDs are scoped per-mailbox — this is not a limitation but a protocol constraint)

### Response shape
- Flat array — one entry per UID in the order requested
- Success entry: same shape as `MessageBody` from `read_message` (uid, from, subject, date, body, attachments)
- Error entry: `{ uid: number, error: string }` — when a UID does not exist or fetch fails
- No summary wrapper — just the array; agent can count successes/failures itself

### IMAP batching strategy
- Use `client.fetch(uidSet, query, { uid: true })` for the metadata phase (envelope + bodyStructure) — one IMAP round-trip for all UIDs, not a loop of `fetchOne()` calls
- Body content is still downloaded per-message via `client.download()` — unavoidable, content streaming is inherently per-part
- This means: 1 IMAP fetch round-trip for metadata + N download round-trips for content

### Claude's Discretion
- Exact UID set string format passed to `client.fetch()` (comma-joined UIDs or range notation)
- How to handle the mailbox lock for the batch (single lock covering all fetches)
- Order of operations when some UIDs are missing from fetch results

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — BATCH-01 and BATCH-02 define the acceptance criteria for this phase

### Existing implementation to model
- `src/tools/read-message.ts` — `handleReadMessage` and `READ_MESSAGE_TOOL`; new tool mirrors this interface, adapts for batch
- `src/services/body-service.ts` — `parseBodyStructure()` and `extractBody()`; reuse directly, no changes needed
- `src/types.ts` — `MessageBody` type; success entries in the batch response share this shape

No external specs beyond requirements — requirements fully captured in decisions above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `parseBodyStructure()` in `src/services/body-service.ts` — reuse as-is for each message in the batch
- `extractBody()` in `src/services/body-service.ts` — reuse as-is for each message
- `BodyFormat` type in `src/services/body-service.ts` — reuse for the `format` parameter type
- `MessageBody` type in `src/types.ts` — success entries in the response match this shape
- `READ_MESSAGE_TOOL` inputSchema in `src/tools/read-message.ts` — reference for `format`/`max_chars` descriptions

### Established Patterns
- Tool handler signature: `handleX(args, manager): Promise<ToolResult>` — follow same pattern
- `manager.getClient(account)` returns client or `{ error: string }` — same error guard pattern
- `client.getMailboxLock(folder, { readOnly: true })` + try/finally lock.release() — reuse for batch
- `client.fetchOne(uid, query, { uid: true })` → for batch, replace with `client.fetch(uidSet, query, { uid: true })`

### Integration Points
- New file: `src/tools/read-messages.ts` — handler + tool definition (mirrors `read-message.ts` structure)
- `src/index.ts` — register `READ_MESSAGES_TOOL` and `handleReadMessages` alongside existing tools

</code_context>

<specifics>
## Specific Ideas

- IMAP UIDs are scoped per-folder — this must be documented in the tool description so agents understand they cannot mix UIDs from different folders in one call
- The metadata batch (`client.fetch()`) should happen first for all UIDs; body downloads follow sequentially

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 09-batch-read*
*Context gathered: 2026-03-16*
