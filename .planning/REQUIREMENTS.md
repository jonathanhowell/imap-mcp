# Requirements: IMAP MCP Server

**Defined:** 2026-03-15
**Core Value:** An agent can reliably read, search, and monitor email across multiple accounts so important messages are never missed.

## v0.2 Requirements

### Account Context

- [x] **ACTX-01**: `list_accounts` response includes `display_name` for each account (when configured)
- [x] **ACTX-02**: `list_accounts` response includes the email address for each account

### Message Header Enrichment

- [x] **HDR-01**: `list_messages` response includes `to` and `cc` recipient fields for each message
- [x] **HDR-02**: `search_messages` response includes `to` and `cc` recipient fields for each result

### Batch Operations

- [x] **BATCH-01**: Agent can call `read_messages` with a list of UIDs and receive full message bodies for all of them in a single response
- [x] **BATCH-02**: `read_messages` accepts the same `format` and `max_chars` options as `read_message`

### Search Enhancements

- [x] **SRCH-05**: Agent can search messages by body text content (partial match)
- [x] **SRCH-06**: `list_messages` `folder` parameter is optional, defaulting to INBOX when omitted

### Attachment UX

- [x] **ATCH-01**: Agent can download an attachment by `filename` instead of `part_id` when the exact part ID is unknown

### Keyword Flagging

- [x] **KFLAG-01**: A `flag_message` tool sets a custom IMAP keyword (e.g. `ClaudeProcessed`) on a message identified by account and UID, using IMAP STORE `+FLAGS`
- [x] **KFLAG-02**: `search_messages` accepts an optional `exclude_keyword` parameter; when set, messages that have that keyword are excluded from results
- [x] **KFLAG-03**: `get_new_mail` accepts an optional `exclude_keyword` parameter; when set, messages that have that keyword are excluded from the cache query result
- [x] **KFLAG-04**: When a mailbox is opened, the server's `PERMANENTFLAGS` response is checked; if `\*` is absent, a warning is logged indicating custom keywords may not persist

## v0.3 Requirements (deferred)

### Write Operations

- **WRITE-01**: Agent can mark a message as read or unread
- **WRITE-02**: Agent can move a message to a different folder
- **WRITE-03**: Agent can delete or archive a message

### Monitoring

- **MON-01**: `get_new_mail` response includes cache metadata (last_polled, cache_age_seconds)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Sending / replying / forwarding | High stakes write operation — planned for v0.3+ |
| Web UI or dashboard | Agent interface only |
| OAuth / provider APIs | IMAP-only for maximum compatibility |
| Thread / conversation grouping | Requires IMAP THREAD extension, not universally supported |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ACTX-01 | Phase 8 | Complete |
| ACTX-02 | Phase 8 | Complete |
| HDR-01 | Phase 7 | Complete |
| HDR-02 | Phase 7 | Complete |
| BATCH-01 | Phase 9 | Complete |
| BATCH-02 | Phase 9 | Complete |
| SRCH-05 | Phase 10 | Complete |
| SRCH-06 | Phase 8 | Complete |
| ATCH-01 | Phase 10 | Complete |
| KFLAG-01 | Phase 11 | Not started |
| KFLAG-02 | Phase 11 | Not started |
| KFLAG-03 | Phase 11 | Not started |
| KFLAG-04 | Phase 11 | Not started |

**Coverage:**
- v0.2 requirements: 13 total
- Mapped to phases: 13
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-15*
*Last updated: 2026-03-15 — traceability filled after v0.2 roadmap creation*
