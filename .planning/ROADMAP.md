# Roadmap: IMAP MCP Server

## Milestones

- ✅ **v0.1.0 IMAP MCP v0.1** — Phases 1–6 (shipped 2026-03-15)
- 🚧 **v0.2 Agent UX** — Phases 7–10 (in progress)

## Phases

<details>
<summary>✅ v0.1.0 IMAP MCP v0.1 (Phases 1–6) — SHIPPED 2026-03-15</summary>

- [x] Phase 1: Foundation (3/3 plans) — completed 2026-03-11
- [x] Phase 2: Connection Management (3/3 plans) — completed 2026-03-12
- [x] Phase 3: Core Read Operations (6/6 plans) — completed 2026-03-12
- [x] Phase 4: Multi-Account Unified View (3/3 plans) — completed 2026-03-14
- [x] Phase 5: Background Polling (4/4 plans) — completed 2026-03-14
- [x] Phase 6: Hardening and Release (4/4 plans) — completed 2026-03-15

Full details: `.planning/milestones/v0.1.0-ROADMAP.md`

</details>

### 🚧 v0.2 Agent UX (In Progress)

**Milestone Goal:** Reduce agent round-trips and enrich tool responses with context that LLM personal assistants need to act without guessing.

- [ ] **Phase 7: Header Enrichment** - Add to/cc recipient fields to list_messages and search_messages responses
- [ ] **Phase 8: Account Context and Tool Ergonomics** - Enrich list_accounts with display_name/email; make list_messages folder optional
- [ ] **Phase 9: Batch Read** - New read_messages tool to fetch multiple full message bodies in one call
- [ ] **Phase 10: Search and Attachment UX** - Body text search in search_messages; download_attachment by filename

## Phase Details

### Phase 7: Header Enrichment
**Goal**: Agent receives to/cc recipient data in every message listing and search result without extra calls
**Depends on**: Phase 6
**Requirements**: HDR-01, HDR-02
**Success Criteria** (what must be TRUE):
  1. A call to `list_messages` returns `to` and `cc` arrays on every message item in the response
  2. A call to `search_messages` returns `to` and `cc` arrays on every result item in the response
  3. The `to` and `cc` fields are present even when empty (empty array, not absent key)
  4. Existing tests for list_messages and search_messages continue to pass
**Plans**: TBD

### Phase 8: Account Context and Tool Ergonomics
**Goal**: Agent gets display names and email addresses from list_accounts; folder parameter no longer required for list_messages
**Depends on**: Phase 7
**Requirements**: ACTX-01, ACTX-02, SRCH-06
**Success Criteria** (what must be TRUE):
  1. A call to `list_accounts` returns `display_name` for each account when configured in the account config
  2. A call to `list_accounts` returns the `email` address for each account
  3. A call to `list_messages` with no `folder` argument succeeds and returns messages from INBOX
  4. A call to `list_messages` with an explicit `folder` argument still works as before
**Plans**: TBD

### Phase 9: Batch Read
**Goal**: Agent can retrieve full bodies for multiple messages in a single tool call instead of looping over read_message
**Depends on**: Phase 7
**Requirements**: BATCH-01, BATCH-02
**Success Criteria** (what must be TRUE):
  1. A call to `read_messages` with a list of UIDs returns a full message body for each UID in one response
  2. `read_messages` accepts `format` and `max_chars` options with the same behavior as `read_message`
  3. When a UID in the list does not exist the response includes an error entry for that UID and continues returning the others
  4. The existing `read_message` (singular) tool is unaffected
**Plans**: TBD

### Phase 10: Search and Attachment UX
**Goal**: Agent can search by message body text and download attachments by filename without needing to know part IDs
**Depends on**: Phase 8
**Requirements**: SRCH-05, ATCH-01
**Success Criteria** (what must be TRUE):
  1. A call to `search_messages` with a `body` query parameter returns only messages whose body text contains the search string
  2. Body search works across single-account and all-account (fan-out) modes
  3. A call to `download_attachment` with a `filename` argument (and no `part_id`) returns the correct attachment content
  4. When a filename matches multiple parts the first matching part is returned and no error is thrown
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | v0.1.0 | 3/3 | Complete | 2026-03-11 |
| 2. Connection Management | v0.1.0 | 3/3 | Complete | 2026-03-12 |
| 3. Core Read Operations | v0.1.0 | 6/6 | Complete | 2026-03-12 |
| 4. Multi-Account Unified View | v0.1.0 | 3/3 | Complete | 2026-03-14 |
| 5. Background Polling | v0.1.0 | 4/4 | Complete | 2026-03-14 |
| 6. Hardening and Release | v0.1.0 | 4/4 | Complete | 2026-03-15 |
| 7. Header Enrichment | v0.2 | 0/TBD | Not started | - |
| 8. Account Context and Tool Ergonomics | v0.2 | 0/TBD | Not started | - |
| 9. Batch Read | v0.2 | 0/TBD | Not started | - |
| 10. Search and Attachment UX | v0.2 | 0/TBD | Not started | - |
