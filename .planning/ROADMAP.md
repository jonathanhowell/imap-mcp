# Roadmap: IMAP MCP Server

## Overview

Six phases building from the bottom of the architecture stack to the top. Config and credential handling come first because they are the most expensive decisions to change. Connection management follows because every feature depends on it. Core read tools come next, establishing the stable API surface. Multi-account fan-out and unified inbox build on top of per-account reads. Background polling arrives once reads are stable. Hardening and release prep closes the loop before public release.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - MCP server shell, multi-account config, credential handling, and data model constraints (completed 2026-03-11)
- [x] **Phase 2: Connection Management** - Persistent IMAP connections, TLS enforcement, reconnect with exponential backoff (completed 2026-03-12)
- [ ] **Phase 3: Core Read Operations** - Mailbox navigation, paginated message listing, full message reads, basic search, attachment metadata
- [ ] **Phase 4: Multi-Account Unified View** - Named account targeting, unified unread inbox, per-account error isolation
- [ ] **Phase 5: Background Polling** - Configurable polling loop, in-memory header cache, new-mail-since query
- [ ] **Phase 6: Hardening and Release** - Response size verification, reconnect testing, credential audit, TLS enforcement, open-source readiness

## Phase Details

### Phase 1: Foundation
**Goal**: A running MCP server that loads and validates multi-account config, enforces credential hygiene from the first commit, and establishes the `{account_id, uid}` data model that all later phases build on
**Depends on**: Nothing (first phase)
**Requirements**: CONF-01, CONF-02, CONF-03
**Success Criteria** (what must be TRUE):
  1. Server starts and registers stub tools without crashing when given a valid config file
  2. Server fails fast with a clear error message when config is missing or malformed, before any IMAP connection is attempted
  3. Credentials are never written to stdout or any log output — only stderr, and only sanitized
  4. Server can be configured entirely via environment variables with no config file present
  5. All IMAP connections are refused at startup if TLS/SSL is not available (port 993 enforcement)
**Plans**: 3 plans

Plans:
- [ ] 01-01-PLAN.md — Project scaffold (package.json, tsconfig, ESLint, Prettier, Vitest, Husky)
- [ ] 01-02-PLAN.md — Core types, logger, config schema, loader, and unit tests
- [ ] 01-03-PLAN.md — MCP server entry point, stub tools, startup smoke test, example config

### Phase 2: Connection Management
**Goal**: The server maintains stable, persistent IMAP connections per account that survive drops and timeouts without crashing the server or blocking other accounts
**Depends on**: Phase 1
**Requirements**: CONN-01, CONN-02, CONN-03
**Success Criteria** (what must be TRUE):
  1. A connection opened at server start is reused across multiple tool calls without reopening
  2. After a simulated network drop, the server reconnects automatically and tool calls succeed within the next polling cycle
  3. When one account's IMAP server is unreachable, tool calls against other accounts continue to succeed
  4. The server process stays alive through at least one simulated connection drop per account
**Plans**: 3 plans

Plans:
- [ ] 02-01-PLAN.md — Install imapflow and write failing test scaffolds for AccountConnection and ConnectionManager
- [ ] 02-02-PLAN.md — Implement AccountConnection state machine with exponential backoff reconnect loop
- [ ] 02-03-PLAN.md — Implement ConnectionManager, wire into src/index.ts with graceful SIGTERM/SIGINT shutdown

### Phase 3: Core Read Operations
**Goal**: Agents can navigate mailboxes, list and read messages with pagination, search by headers, and inspect attachments — all via stable MCP tools with structured, normalized output
**Depends on**: Phase 2
**Requirements**: MAIL-01, MAIL-02, MAIL-03, LIST-01, LIST-02, LIST-03, LIST-04, READ-01, READ-02, READ-03, READ-04, READ-05, SRCH-01, SRCH-02, SRCH-03, SRCH-04
**Success Criteria** (what must be TRUE):
  1. Agent can list all folders in an account and see total and unread counts per folder
  2. Agent can retrieve a paginated list of messages from any folder, sorted by date, with only headers in the response (no bodies)
  3. Agent can fetch a full email by UID and receive a clean plain-text body (HTML stripped, quoted chains removed)
  4. Agent can search messages by sender, subject keyword, date range, and read/unread status and receive results within the pagination limit
  5. Agent can list attachment metadata for any message without triggering a download, and download a specific attachment by part identifier
**Plans**: 6 plans

Plans:
- [ ] 03-01-PLAN.md — Install deps (html-to-text, email-reply-parser), add Phase 3 types, create failing test scaffolds
- [ ] 03-02-PLAN.md — folder-service + list_folders handler (MAIL-01, MAIL-02)
- [ ] 03-03-PLAN.md — message-service + list_messages handler (MAIL-03, LIST-01–04)
- [ ] 03-04-PLAN.md — body-service, attachment-service, read_message + download_attachment handlers (READ-01–05)
- [ ] 03-05-PLAN.md — search-service + search_messages handler (SRCH-01–04)
- [ ] 03-06-PLAN.md — Wire all tools into src/index.ts, implement list_accounts, replace stubs

### Phase 4: Multi-Account Unified View
**Goal**: Agents can target any named account explicitly, or issue a single query that spans all accounts and returns a merged, sorted result with per-account error isolation
**Depends on**: Phase 3
**Requirements**: ACCT-01, ACCT-02, ACCT-03
**Success Criteria** (what must be TRUE):
  1. Every read and search tool accepts an account name parameter and returns results scoped to that account
  2. Agent can retrieve a single unified unread inbox list merged and sorted across all configured accounts
  3. When one account has an IMAP error during a multi-account query, the response returns partial results from other accounts plus a per-account error detail, rather than failing the entire request
**Plans**: TBD

### Phase 5: Background Polling
**Goal**: The server proactively polls all accounts at a configurable interval, pre-populates a header cache, and exposes a new-mail-since query so agents can detect arrivals without issuing IMAP round-trips
**Depends on**: Phase 4
**Requirements**: POLL-01, POLL-02, POLL-03
**Success Criteria** (what must be TRUE):
  1. Unread message headers are available in-memory after the first polling cycle completes, without requiring an agent tool call to trigger the fetch
  2. Agent can query for messages that have arrived since a given timestamp and receive results from the cache
  3. The polling loop continues running after a simulated IMAP drop for one account and recovers when the account reconnects
  4. Polling interval is configurable and defaults to 3 minutes when not specified
**Plans**: TBD

### Phase 6: Hardening and Release
**Goal**: The server is verified safe, stable, and clean enough to publish — credentials cannot leak, responses cannot overflow agent context, reconnect survives production conditions, and the codebase is open-source presentable
**Depends on**: Phase 5
**Requirements**: (none — this phase validates all prior requirements against production conditions)
**Success Criteria** (what must be TRUE):
  1. A search or list tool call against a mailbox with 10,000+ messages returns within 5 seconds and does not include message bodies in the response
  2. Git history contains no credentials, tokens, or plaintext passwords in any commit
  3. A linter rule is in place that prevents `console.log` from being used anywhere in the codebase
  4. MCP Inspector validates all tool schemas with no errors
  5. Server README documents configuration options, provider compatibility (including Outlook limitation), and Claude Desktop setup steps
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 3/3 | Complete   | 2026-03-11 |
| 2. Connection Management | 3/3 | Complete   | 2026-03-12 |
| 3. Core Read Operations | 1/6 | In Progress|  |
| 4. Multi-Account Unified View | 0/TBD | Not started | - |
| 5. Background Polling | 0/TBD | Not started | - |
| 6. Hardening and Release | 0/TBD | Not started | - |
