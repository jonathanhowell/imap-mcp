# Phase 10: Search and Attachment UX - Context

**Gathered:** 2026-03-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Two independent tool ergonomics improvements:
1. `search_messages` — add a `body` parameter for server-side body text search (SRCH-05)
2. `download_attachment` — accept `filename` as an alternative to `part_id` so agents don't need to know the IMAP part ID (ATCH-01)

No new tools. No other response shape changes. Existing tool contracts are unaffected.

</domain>

<decisions>
## Implementation Decisions

### part_id / filename interface
- Both `part_id` and `filename` become optional parameters on `download_attachment`
- Runtime validation: if neither is provided, return error: `"Error: either part_id or filename must be provided"`
- When both are provided: `part_id` wins — use it directly, skip filename lookup (faster, unambiguous)
- `filename` is the fallback for when the agent doesn't know the part ID
- Remove `part_id` from the `required` array in the tool schema

### Filename matching
- Exact match, case-insensitive: `"report.pdf"` matches `"Report.PDF"` but not `"Q4-report.pdf"`
- First matching part returned when multiple parts share the same filename (per roadmap success criteria)
- When no attachment matches the filename: error with the filename in the message, e.g.:
  `"No attachment with filename 'invoice.pdf' found in message 42"`

### body search
- New optional `body` parameter on `search_messages`
- Tool description: `"Filter by body text content (case-insensitive partial match, server-side). May be slower than header-only searches on large mailboxes."`
- IMAP implementation: add `criteria.body = body` to the existing criteria object in `search-service.ts`
- Works in both single-account and fan-out (multi-account) modes — body is just another search criterion
- Combines with other filters (from, subject, etc.) as AND logic — standard IMAP behavior

### Claude's Discretion
- Exact TypeScript parameter types for optional `part_id`/`filename` (both `string | undefined`)
- bodyStructure fetch implementation detail for filename lookup (fetch body structure, walk parts, find first case-insensitive match)
- Test structure for the new filename path in download-attachment tests

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — SRCH-05 and ATCH-01 define the acceptance criteria for this phase

### Existing implementation to extend
- `src/tools/search-messages.ts` — `handleSearchMessages`, `SearchMessagesParams`, `SEARCH_MESSAGES_TOOL`; add `body` parameter here
- `src/services/search-service.ts` — `SearchParams` interface and `searchMessages()`; add `body` to criteria building
- `src/tools/download-attachment.ts` — `handleDownloadAttachment`, `DownloadAttachmentArgs`, `DOWNLOAD_ATTACHMENT_TOOL`; change `part_id` to optional, add `filename`
- `src/services/attachment-service.ts` — `downloadAttachment()`; called after filename→part_id lookup, no changes needed to this function itself
- `src/services/body-service.ts` — `parseBodyStructure()` may be reusable for walking body parts to find a part by filename

No external specs beyond requirements — requirements are fully captured in decisions above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `searchMessages()` criteria object in `src/services/search-service.ts` — `body` just adds `criteria.body = body` (same pattern as `from`, `subject`)
- `parseBodyStructure()` in `src/services/body-service.ts` — may be reusable for walking MIME parts to find a filename match
- `downloadAttachment(client, folder, uid, partId)` in `src/services/attachment-service.ts` — call this after filename→part_id lookup; no changes to the function signature

### Established Patterns
- `SearchParams` interface has optional fields with `criteria` object building pattern — `body` fits naturally
- `handleDownloadAttachment` already has `manager.getClient()` + try/catch pattern — filename lookup goes between client resolution and the `downloadAttachment()` call
- Error returns: `{ content: [{ type: "text", text: "Error: ..." }], isError: true }` — use this shape for "no matching filename" error

### Integration Points
- `src/services/search-service.ts` `SearchParams`: add `body?: string`
- `src/services/search-service.ts` criteria building: `if (body !== undefined) criteria.body = body`
- `src/tools/search-messages.ts` `SearchMessagesParams`: add `body?: string`
- `src/tools/search-messages.ts` `SEARCH_MESSAGES_TOOL` inputSchema: add `body` property with description including case-insensitive/performance note
- `src/tools/search-messages.ts` handler: pass `body` through to `searchMessages()` in both fan-out and single-account paths
- `src/tools/download-attachment.ts` `DownloadAttachmentArgs`: `part_id?: string`, `filename?: string`
- `src/tools/download-attachment.ts` handler: validate at least one is provided, use `part_id` if present, else look up `filename` in bodyStructure
- `src/tools/download-attachment.ts` `DOWNLOAD_ATTACHMENT_TOOL` schema: remove `part_id` from `required`, add `filename` property, update description

</code_context>

<specifics>
## Specific Ideas

- body search tool description should be modeled after the existing `folder='all'` performance warning in `SEARCH_MESSAGES_TOOL` — consistent warning style
- Filename lookup should fetch body structure for the message, walk MIME parts, find first part where `filename` (case-insensitive) matches, extract its part ID, then call `downloadAttachment()`

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 10-search-and-attachment-ux*
*Context gathered: 2026-03-16*
