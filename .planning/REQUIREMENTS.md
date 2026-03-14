# Requirements: IMAP MCP Server

**Defined:** 2026-03-11
**Core Value:** An agent can reliably read, search, and monitor email across multiple accounts so important messages are never missed.

## v1 Requirements

### Configuration (CONF)

- [x] **CONF-01**: User can configure multiple named email accounts (e.g. "personal", "work") via a config file
- [x] **CONF-02**: IMAP credentials can be supplied via environment variables as an alternative to the config file
- [x] **CONF-03**: Server enforces TLS/SSL for all IMAP connections (port 993); plain-text connections are rejected at startup

### Connection Management (CONN)

- [x] **CONN-01**: Server maintains persistent IMAP connections per account (not opened on every tool call)
- [x] **CONN-02**: Connections automatically reconnect with exponential backoff after drop or timeout
- [x] **CONN-03**: One broken account connection does not crash the server or block operations on other accounts

### Mailbox Navigation (MAIL)

- [x] **MAIL-01**: Agent can list all folders/mailboxes in a named account
- [x] **MAIL-02**: Agent can retrieve total and unread message counts per folder
- [x] **MAIL-03**: Agent can list messages from any folder, not just Inbox

### Message Listing (LIST)

- [x] **LIST-01**: Agent can list messages in a folder with pagination (limit and offset parameters)
- [x] **LIST-02**: Agent can list unread messages from a specific account or across all accounts
- [x] **LIST-03**: Message listings are sortable by date (newest-first or oldest-first)
- [x] **LIST-04**: Message list responses include headers only (sender, subject, date, UID) — no bodies

### Message Reading (READ)

- [x] **READ-01**: Agent can fetch a full email by account name and UID (headers + plain text body)
- [x] **READ-02**: Agent can fetch a truncated email body (first N characters, configurable)
- [x] **READ-03**: Agent can fetch a cleaned email body: HTML converted to plain text, quoted reply chains and thread history removed
- [x] **READ-04**: Agent can list attachments for a message (filename, size, MIME type) without downloading content
- [x] **READ-05**: Agent can download a specific attachment by message UID and part identifier

### Search (SRCH)

- [x] **SRCH-01**: Agent can search messages by sender address or domain
- [x] **SRCH-02**: Agent can search messages by subject keyword
- [x] **SRCH-03**: Agent can search messages by date range (before, after, or between dates)
- [x] **SRCH-04**: Agent can filter messages by read/unread status

### Multi-Account (ACCT)

- [x] **ACCT-01**: All tool calls accept an optional account name parameter to target a specific account
- [x] **ACCT-02**: Agent can retrieve a unified unread inbox merged and sorted across all configured accounts
- [x] **ACCT-03**: When an operation spans multiple accounts, per-account errors return partial results with error details rather than failing the entire request

### Background Polling (POLL)

- [ ] **POLL-01**: Server polls all configured accounts at a configurable interval (default: 3 minutes)
- [ ] **POLL-02**: Server pre-fetches unread message headers into an in-memory cache so agent queries are served without an IMAP round-trip
- [ ] **POLL-03**: Agent can query what new messages have arrived since a given timestamp

## v2 Requirements

### Write Operations

- **WRIT-01**: Agent can mark messages as read or unread
- **WRIT-02**: Agent can move messages between folders
- **WRIT-03**: Agent can delete messages (move to Trash)

### Email Composition (v2+)

- **SEND-01**: Agent can compose and send a new email via SMTP
- **SEND-02**: Agent can reply to an existing email thread
- **SEND-03**: Agent can forward an email to another recipient

### Advanced Search

- **SRCH-05**: Agent can search message bodies using full-text IMAP SEARCH TEXT
- **SRCH-06**: Agent can combine multiple search criteria in a single query (AND conditions)

### Enhanced Features

- **FEAT-01**: Agent can group messages into threads (via References/In-Reply-To headers)
- **FEAT-02**: Server generates and caches LLM summaries of emails on request
- **FEAT-03**: Per-account configurable polling intervals
- **FEAT-04**: IMAP IDLE push notifications replacing polling (lower latency)

## Out of Scope

| Feature | Reason |
|---------|--------|
| OAuth2 redirect flow implementation | Provider-specific complexity; v1 accepts pre-obtained tokens/app passwords as credentials |
| Folder/label creation and deletion | High-risk destructive operations; not needed for read-only use case |
| Calendar/contacts (CalDAV/CardDAV) | Different protocols; separate product surface |
| Web UI or dashboard | Agent interface only; no human-facing UI planned |
| Outlook / Hotmail support | Deprecated Basic Auth for IMAP; requires OAuth2 which is out of scope for v1 |
| Real-time sync / IMAP IDLE (v1) | Polling covers the use case; IDLE adds reconnect complexity deferred to v2 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CONF-01 | Phase 1 | Complete |
| CONF-02 | Phase 1 | Complete |
| CONF-03 | Phase 1 | Complete |
| CONN-01 | Phase 2 | Complete |
| CONN-02 | Phase 2 | Complete |
| CONN-03 | Phase 2 | Complete |
| MAIL-01 | Phase 3 | Complete |
| MAIL-02 | Phase 3 | Complete |
| MAIL-03 | Phase 3 | Complete |
| LIST-01 | Phase 3 | Complete |
| LIST-02 | Phase 3 | Complete |
| LIST-03 | Phase 3 | Complete |
| LIST-04 | Phase 3 | Complete |
| READ-01 | Phase 3 | Complete |
| READ-02 | Phase 3 | Complete |
| READ-03 | Phase 3 | Complete |
| READ-04 | Phase 3 | Complete |
| READ-05 | Phase 3 | Complete |
| SRCH-01 | Phase 3 | Complete |
| SRCH-02 | Phase 3 | Complete |
| SRCH-03 | Phase 3 | Complete |
| SRCH-04 | Phase 3 | Complete |
| ACCT-01 | Phase 4 | Complete |
| ACCT-02 | Phase 4 | Complete |
| ACCT-03 | Phase 4 | Complete |
| POLL-01 | Phase 5 | Pending |
| POLL-02 | Phase 5 | Pending |
| POLL-03 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 28 total
- Mapped to phases: 28
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-11*
*Last updated: 2026-03-11 after initial definition*
