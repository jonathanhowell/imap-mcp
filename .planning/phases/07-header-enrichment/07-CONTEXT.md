# Phase 7: Header Enrichment - Context

**Gathered:** 2026-03-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Add `to` and `cc` recipient fields to `list_messages` and `search_messages` responses. Both fields must always be present (empty array when no recipients, not absent key). The `get_new_mail` cache also gains these fields as a natural consequence of the shared type hierarchy. No new tools, no other response shape changes except the `from` field format update (see below).

</domain>

<decisions>
## Implementation Decisions

### Recipient address format
- Each entry in `to` and `cc` is a plain string
- Format: `"Name <address>"` when display name is available (e.g. `"Alice Smith <alice@example.com>"`)
- Fall back to bare address when name is absent (e.g. `"bob@example.com"`)
- Both fields are always present — empty array `[]` when no recipients, never omitted

### from field format
- Update `from` to also use `"Name <addr>"` format for consistency with `to`/`cc`
- Before: `"sender@example.com"` (bare address only)
- After: `"Alice Smith <alice@example.com>"` (name when available, bare address as fallback)
- Existing tests that assert on `from` will need to be updated to reflect the new format

### get_new_mail cache scope
- The poller cache (`Poller.ts`) stores `MultiAccountMessageHeader[]`, which extends `MessageHeader`
- Adding `to` and `cc` to `MessageHeader` automatically propagates to cached entries
- `get_new_mail` responses will include `to` and `cc` — consistent with list/search, no extra IMAP calls needed

### Claude's Discretion
- Exact TypeScript type for the new fields (`to: string[]`, `cc: string[]` on `MessageHeader`)
- Helper function to format a single imapflow address object as `"Name <addr>"` string
- How to handle the edge case where `address` is undefined on an envelope entry (skip the entry)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — HDR-01 and HDR-02 define the acceptance criteria for this phase; also specifies the empty-array guarantee

### Existing type contracts
- `src/types.ts` — `MessageHeader`, `SearchResultItem`, `MultiAccountMessageHeader`, `MultiAccountSearchResultItem` — all must gain `to` and `cc` fields
- `src/services/message-service.ts` — `listMessages()` fetches `envelope`; mapping logic needs `to`/`cc` extraction
- `src/services/search-service.ts` — `searchFolder()` fetches `envelope`; mapping logic needs `to`/`cc` extraction

No external specs beyond requirements — requirements are fully captured in decisions above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `envelope` is already fetched in both `message-service.ts` (`fetchAll`) and `search-service.ts` (`fetchAll`) — `envelope.to` and `envelope.cc` are available with zero additional IMAP round-trips
- imapflow `envelope.to`/`envelope.cc` are `Array<{name?: string, address?: string, ...}>` — name and address are both optional

### Established Patterns
- Current `from` extraction: `msg.envelope?.from?.[0]?.address ?? ""` — needs updating to include name
- All response fields are flat scalars — `to`/`cc` as `string[]` fits this pattern (arrays of scalars)
- TypeScript strict mode — `MessageHeader` type change propagates via inheritance to all downstream types

### Integration Points
- `src/types.ts` `MessageHeader`: add `to: string[]` and `cc: string[]`; update `from` format documentation
- `src/services/message-service.ts`: update `messages.map()` to extract and format `to`/`cc`; update `from` extraction
- `src/services/search-service.ts`: same update in `searchFolder()`
- `src/polling/poller.ts`: no code change needed — type propagation handles it automatically
- Existing tests that assert on `from` values or `MessageHeader` shape will need updating

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 07-header-enrichment*
*Context gathered: 2026-03-15*
