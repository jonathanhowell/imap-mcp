# Pitfalls Research

**Domain:** IMAP MCP Server (multi-account email access for AI agents)
**Researched:** 2026-03-11
**Confidence:** HIGH for IMAP protocol pitfalls (well-established); MEDIUM for MCP-specific pitfalls (pattern-based, protocol is newer)

---

## Critical Pitfalls

### Pitfall 1: Leaked Credentials in Process Environment / Logs

**What goes wrong:**
Credentials passed as environment variables get logged in error stack traces, serialized into MCP tool responses (e.g., "connection failed for imap://user:password@host"), or exposed in debug output. IMAP passwords and OAuth tokens appear in plaintext in log files, crash reports, or MCP client response history.

**Why it happens:**
Developers build connection strings by concatenating credentials into URLs (the most convenient format for IMAP libraries), then log those connection strings on error. Error objects thrown by IMAP libraries often include the full connection config in their message or `cause` field.

**How to avoid:**
- Never build `imaps://user:pass@host` URL strings; pass credentials as separate config fields
- Create a redaction wrapper that scrubs known sensitive fields before any log statement
- Sanitize error messages before surfacing them in MCP tool responses — map library errors to safe messages
- Use a secrets management approach (env vars loaded at startup into opaque config objects, not spread into strings)

**Warning signs:**
- Any log line containing `@` and a hostname together
- Error messages with the word "auth" that also contain account identifiers
- MCP tool error responses that contain connection details

**Phase to address:**
Foundation / credentials configuration phase (before any real connection code is written)

---

### Pitfall 2: Single Persistent Connection Without Reconnect Logic

**What goes wrong:**
The server opens one IMAP connection per account at startup and assumes it stays open indefinitely. IMAP connections drop silently after server-side idle timeouts (typically 30 minutes per RFC 3501, but Gmail uses ~20 minutes, Fastmail ~10 minutes). The server believes it is connected, all subsequent commands hang or throw confusing errors, and the polling loop dies silently.

**Why it happens:**
IMAP has a connection-oriented model and libraries like `imapflow` make initial connection easy. Developers test with short sessions and never observe the timeout. TCP keepalives are not enough — IMAP servers enforce their own application-level timeouts independent of TCP.

**How to avoid:**
- Implement exponential backoff reconnection with jitter (start at 1s, cap at 5min)
- Use IMAP NOOP command on a heartbeat interval (every 5-10 minutes) to prevent server-side timeout
- Wrap every command in try/catch; distinguish "connection lost" errors from "command failed" errors
- Maintain a connection state machine: DISCONNECTED → CONNECTING → AUTHENTICATED → SELECTED → (back to AUTHENTICATED on folder close)
- Test reconnection explicitly: kill the network mid-session and verify recovery

**Warning signs:**
- Polling loop runs but reports 0 new messages for extended periods without explanation
- Error logs showing "Connection reset by peer" or "ECONNRESET" without subsequent reconnection
- Mailbox state not refreshed after server restarts

**Phase to address:**
Connection management phase (core infrastructure, before building any features on top)

---

### Pitfall 3: Gmail App Password vs OAuth2 Confusion

**What goes wrong:**
The server is built and tested against a Gmail account using an app password. At public release, Google's policies around app passwords shift (as they have repeatedly), or users have 2FA + Workspace accounts that require OAuth2 only. The authentication layer needs to be rebuilt. Alternatively, OAuth2 tokens expire after 1 hour and the server has no refresh logic, causing hourly silent failures.

**Why it happens:**
App passwords are simpler to implement for personal use. Gmail's XOAUTH2 SASL mechanism requires OAuth2 flow implementation, which feels out of scope for "just connecting to IMAP." Developers defer OAuth2 until they have a user who needs it, then discover the architecture doesn't support it.

**How to avoid:**
- Design the auth layer as a pluggable interface from the start: `{ type: "password" | "oauth2", credentials: ... }`
- For OAuth2: store refresh tokens, not access tokens; implement token refresh before expiry (not on failure)
- For the initial personal-use phase, app passwords are acceptable IF the auth interface is already abstracted
- Document clearly that Gmail Workspace accounts may require OAuth2 regardless of app password availability

**Warning signs:**
- Authentication hardcoded to `AUTH LOGIN` or `AUTH PLAIN` only
- Access token stored without accompanying refresh token or expiry time
- No mechanism to update credentials without restarting the server

**Phase to address:**
Auth abstraction in foundation phase; OAuth2 refresh logic before any public release

---

### Pitfall 4: IMAP IDLE Not Supported by All Servers — Polling Fallback Missing

**What goes wrong:**
The server implements IMAP IDLE (RFC 2177) for push-like new-mail notification and assumes all IMAP servers support it. Non-IDLE servers (some self-hosted, corporate exchange IMAP frontends) fail silently or throw on the IDLE command. The agent never receives new mail notifications for these accounts.

**Why it happens:**
Gmail, Outlook, and Fastmail all support IDLE, so testing against major providers never reveals the gap. IDLE is listed as an extension in the capability list, not guaranteed.

**How to avoid:**
- Always check `CAPABILITY` response before attempting IDLE
- Implement a polling fallback: if IDLE capability absent, use periodic NOOP + UID FETCH for new messages
- Set the fallback poll interval explicitly (e.g., 60 seconds) and make it configurable
- IDLE connections must be renewed every 29 minutes per RFC 2177 (servers may drop after 30 min); implement re-IDLE cycling

**Warning signs:**
- No capability check before IDLE command
- IDLE code path with no else/fallback branch
- Polling interval hardcoded or missing entirely

**Phase to address:**
Background polling / new-mail monitoring phase

---

### Pitfall 5: Fetching Full Message Bodies for Search/List Operations

**What goes wrong:**
To list or search emails, the server fetches complete message bodies (including attachments) to populate subject/sender/date fields. A mailbox with 10,000 messages and inline attachments causes the server to download gigabytes of data, exhaust memory, and time out. Even for a small household mailbox, fetching bodies on startup for indexing is slow and unnecessary.

**Why it happens:**
IMAP FETCH supports fetching any subset of message data, but the lazy approach (fetch everything) "just works" in small test scenarios. IMAP ENVELOPE and BODY[HEADER.FIELDS] are less obvious but fetch only what is needed.

**How to avoid:**
- Use `FETCH ... (FLAGS ENVELOPE)` or `FETCH ... (FLAGS BODY[HEADER.FIELDS (FROM TO SUBJECT DATE)])` for list/search operations
- Never fetch `RFC822` or `BODY[]` unless the full body is explicitly needed (e.g., thread summarization)
- For search: use IMAP server-side `SEARCH` command before fetching — reduces network traffic dramatically
- When body IS needed (summarization), fetch `BODY[TEXT]` only, not `BODY[]` (skips attachments)
- Implement size guards: refuse to fetch/return bodies larger than a configurable threshold (e.g., 500KB)

**Warning signs:**
- `FETCH RFC822` or `FETCH BODY[]` in list/search code paths
- Memory usage spikes during search operations
- Long startup time proportional to mailbox size

**Phase to address:**
Core read operations phase; performance testing against a real large mailbox before shipping

---

### Pitfall 6: MCP Tool Response Size Exceeding Context Window

**What goes wrong:**
A tool like `get_inbox` or `search_emails` returns 500 emails with full headers and body previews. The MCP response is 200KB+ of JSON. This either crashes the MCP client context window, causes token budget exhaustion, or simply makes the agent useless (it can't process that much data effectively). The agent then asks for "all unread emails" and the server dutifully returns thousands.

**Why it happens:**
The natural implementation returns "everything" and relies on the caller to filter. MCP tools are synchronous request/response — there is no streaming or pagination built into the MCP tool call model. Developers don't anticipate that agents will make maximally broad queries.

**How to avoid:**
- Every list/search tool must have a mandatory `limit` parameter (suggest default: 20, max: 100)
- Return structured summaries, not raw email content: `{uid, from, subject, date, snippet}` not full bodies
- Implement cursor/offset pagination for multi-page results
- Add a separate `get_email_body` tool that requires a specific UID — never return bodies in list tools
- Document tool parameter constraints clearly in the MCP tool description so agents understand limits

**Warning signs:**
- Tool schema with no `limit` or `max_results` parameter
- Tool response containing `body` or `text` fields in list operations
- No pagination mechanism in search tools

**Phase to address:**
MCP tool design phase (before implementing any tools — get the schema right first)

---

### Pitfall 7: Multi-Account State Isolation Failure

**What goes wrong:**
With multiple IMAP accounts, shared mutable state (selected folder, connection object, message cache) bleeds between accounts. A search against account A returns results from account B's last-selected folder. The unified inbox interleaves UIDs from different accounts without namespacing, so `get_email_body(uid=12345)` is ambiguous and returns the wrong email.

**Why it happens:**
Single-account designs use global/singleton connection objects. When multi-account is added, the connection manager is extended with a map, but the tool layer still assumes a single "current" account context.

**How to avoid:**
- From the start, every internal data structure includes `account_id` as a first-class field
- UIDs are always `{account_id, uid}` tuples — never bare UIDs
- Each account has its own connection instance with no shared state
- Tool parameters always include `account` (or `account_id`) — avoid implicit "current account" state
- Unified inbox results explicitly label their account origin

**Warning signs:**
- Any global `currentConnection` or `selectedFolder` variable
- Search results that only include a UID without an account identifier
- "List all accounts" returns accounts but tool calls don't require specifying which one

**Phase to address:**
Foundation / architecture phase — this is a constraint on the entire data model, not a feature to add later

---

### Pitfall 8: No Rate Limiting / Too Many Concurrent IMAP Connections

**What goes wrong:**
Gmail limits free accounts to 15 simultaneous IMAP connections. The server opens a new connection per operation, or opens parallel connections for multi-account polling, and hits Gmail's limit. The account gets a LOGINDISABLED or connection-refused response. In extreme cases, Google temporarily bans the app or triggers account security alerts.

**Why it happens:**
IMAP libraries make it easy to open connections. Parallel polling across accounts and an on-demand connection-per-request model can silently exceed per-account limits. The Gmail limit is 15 connections total across all clients — if the user has Gmail open in a browser + phone + this server, the server may only have 3-5 slots available.

**How to avoid:**
- Use a connection pool with a configurable maximum per account (default: 2-3)
- For household use (2-4 accounts), a single shared connection per account (one for polling, one for on-demand requests) is safer than a pool
- Implement connection queuing: if all slots are busy, queue the request rather than opening a new connection
- Respect IMAP `[ALERT]` responses — these are the server telling you something important about account status

**Warning signs:**
- No maximum connection count configuration
- New connection opened for every tool call
- `LOGINDISABLED` or `[ALERT]` responses appearing in logs

**Phase to address:**
Connection management phase

---

### Pitfall 9: Treating IMAP UIDs as Stable Across Sessions

**What goes wrong:**
The server caches message UIDs to avoid re-fetching. After server maintenance, folder compaction, or a UIDVALIDITY change, those UIDs now refer to different messages or no messages at all. The agent retrieves "email UID 12345" and gets the wrong email — or worse, a confusing error that it interprets as a transient failure and retries.

**Why it happens:**
UIDs within a session are stable, and developers test in sessions that don't cross UIDVALIDITY changes. UIDVALIDITY is a per-mailbox value that changes when UIDs are reassigned (e.g., after import, migration, or some server operations). RFC 3501 requires clients to check UIDVALIDITY.

**How to avoid:**
- Cache `{account_id, mailbox, uidvalidity, uid}` tuples, not bare UIDs
- On every mailbox SELECT, check current UIDVALIDITY against cached value
- If UIDVALIDITY changed, invalidate the entire cache for that mailbox
- Return UID + UIDVALIDITY to agents in tool responses; validate before use
- For the personal-use v1 scope, simply not caching UIDs across server restarts is an acceptable simplification — but document the limitation

**Warning signs:**
- Stored UIDs without accompanying UIDVALIDITY
- No UIDVALIDITY check after SELECT command
- Long-lived server that caches UIDs in memory without invalidation logic

**Phase to address:**
Core read operations phase; caching phase if caching is implemented

---

### Pitfall 10: MCP Tool Errors Crashing the Server Process

**What goes wrong:**
An unhandled exception in an IMAP operation (network timeout, unexpected server response, malformed message) propagates out of the MCP tool handler and crashes the entire server process. All accounts and all polling loops go down because one search against one account failed.

**Why it happens:**
MCP tool handlers feel like regular async functions. It's natural to `await imap.search(...)` without a try/catch. A connection drop during a tool call throws, the promise rejects, and if the MCP SDK doesn't catch it, the process crashes.

**How to avoid:**
- Every MCP tool handler must have a top-level try/catch that converts errors to MCP error responses
- Distinguish between recoverable errors (return error to agent, connection stays up) and fatal errors (reconnect, don't crash process)
- Use process-level uncaught exception/rejection handlers as a last resort — they should log and alert, not silently ignore
- The polling loop must be isolated from tool call failures: separate try/catch, separate error handling

**Warning signs:**
- Tool handlers with `await` and no surrounding try/catch
- Single process exit on ECONNRESET
- Polling loop and request handler sharing the same connection object

**Phase to address:**
MCP server foundation phase (before any tools are added)

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Single hardcoded IMAP account | Faster first demo | Multi-account requires full refactor of data model | Never — PROJECT.md explicitly forbids it |
| Polling-only (no IDLE) | Simpler initial implementation | Higher server-side connection overhead, slower new-mail detection | Acceptable as v1 if IDLE is in the backlog, but architecture must support it |
| No token refresh (app passwords only) | No OAuth2 complexity | Cannot support Workspace accounts or post-app-password Gmail | Acceptable as v1 for personal use IF auth is abstracted behind an interface |
| In-memory message cache only | Simpler, no storage dependency | Cache lost on restart, re-fetches everything each startup for large mailboxes | Acceptable for v1 household scale |
| Synchronous sequential account polling | Easier reasoning | Slow with 4+ accounts (each poll waits for previous to complete) | Acceptable up to 3-4 accounts; bad beyond that |
| Fetch full ENVELOPE for all list operations | Simpler code | Slow over high-latency connections for large mailboxes | Never — use targeted FETCH fields from the start |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Gmail IMAP | Using standard folder names (`INBOX`, `Sent`) | Gmail uses `[Gmail]/Sent Mail`, `[Gmail]/All Mail` — use LIST command to discover actual folder names |
| Gmail IMAP | Attempting IMAP SEARCH against All Mail folder | All Mail is huge; server-side search is very slow — use Gmail-specific search headers or limit to INBOX |
| Outlook/Exchange IMAP | Assuming IMAP IDLE works reliably | Microsoft's IMAP IDLE implementation has known reliability issues; always have polling fallback |
| Fastmail IMAP | Treating UID SEARCH as fast | Fastmail is generally good, but SEARCH across large mailboxes still benefits from date-range prefiltering |
| Any IMAP provider | Assuming `\Seen` flag set = read | Some providers have additional read-state mechanisms; `\Seen` is the reliable standard but may lag |
| Any IMAP provider | Opening a SELECT without checking UIDVALIDITY | Must check UIDVALIDITY on every SELECT against any cached data for that mailbox |
| MCP SDK | Returning raw JS Error objects as tool results | MCP error responses have a specific schema; return `{ isError: true, content: [...] }` not thrown exceptions |
| MCP SDK | Assuming tool calls are serialized | MCP clients may call multiple tools concurrently; tool handlers must be safe to run in parallel |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Fetching full message body for list operations | Slow list response, high memory usage | Use FETCH ENVELOPE or BODY[HEADER.FIELDS] for lists | Any mailbox with attachments; immediately obvious |
| Polling every account on a fixed global interval | Polling takes longer than the interval with 4+ accounts | Per-account independent intervals; async parallel polling with connection limits | 3+ accounts with slow IMAP servers |
| No IMAP SEARCH — filtering client-side | Fetching all UIDs then filtering in Node.js | Use IMAP SEARCH command on the server; only fetch matching UIDs | Any mailbox over ~1000 messages |
| Re-fetching all UIDs on every poll cycle | Startup is fast but every poll is slow | Use IMAP CONDSTORE/HIGHESTMODSEQ or track last-seen UID to fetch only new messages | Mailboxes with 10k+ messages |
| Unmarshalling entire mailbox into memory | Memory grows proportional to mailbox size | Stream-process or page results; never load all UIDs into a single array | Mailboxes with 50k+ messages; large attachments |
| Blocking the Node.js event loop with IMAP parsing | Unresponsive to tool calls during large fetches | IMAP libraries (imapflow) are async but confirm no sync parsing in hot paths | Large emails (>1MB bodies) |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Storing credentials in plaintext config file checked into git | Full account compromise; credentials in git history forever | `.gitignore` the config file; use env vars or secrets manager; add pre-commit hook checking for credentials |
| Returning email content without sanitization in MCP responses | If agent logs responses, email content (including sensitive personal data) persists in logs | Implement truncation and optional redaction; be explicit about what gets logged |
| No TLS verification for IMAP connections | Man-in-the-middle credential interception | Always use `imaps://` (port 993 with TLS); never disable certificate verification even for self-hosted |
| OAuth2 refresh token stored in memory only | Token lost on restart, requires re-authorization | Persist refresh tokens in encrypted storage (keychain, encrypted file); handle absent tokens gracefully |
| MCP tool accepting arbitrary folder names without validation | Path traversal equivalent — could expose unexpected server behavior | Validate folder names against the LIST result; reject names containing unexpected characters |
| Logging full email body content | Personal email content in log files | Log only metadata (uid, from, subject, date) never body content |

---

## UX Pitfalls (Agent Experience)

| Pitfall | Agent Impact | Better Approach |
|---------|-------------|-----------------|
| Returning bare UIDs without account context | Agent can't call `get_email_body` without knowing which account the UID belongs to | Always return `{account, uid}` pairs; make this the canonical identifier |
| Tool names that don't convey scope | Agent calls `search_emails` not knowing it only searches one account | Name tools clearly: `search_account_emails` vs `search_all_emails`; document scope explicitly |
| No "recent/unread" shortcut tool | Agent must construct a complex SEARCH query to find new mail | Provide a `get_recent_unread` tool that encapsulates common patterns |
| Returning raw IMAP flag names (`\Seen`, `\Answered`) | Agent has to know IMAP semantics to interpret flags | Translate flags to human-readable: `{read: true, replied: true, flagged: false}` |
| Thread/conversation not modeled | Agent gets individual emails with no grouping | Include `thread_id` or `in_reply_to` / `references` in responses; let agents understand threads |
| Error messages containing IMAP protocol details | Agent may interpret "BAD [PARSE] ..." as a user-facing error | Translate IMAP error codes to meaningful messages before returning |

---

## "Looks Done But Isn't" Checklist

- [ ] **Connection management:** Reconnection tested by actually dropping the network mid-session — not just catching the initial error
- [ ] **IMAP IDLE:** IDLE renewal (re-IDLE every 29 minutes) implemented — not just initial IDLE setup
- [ ] **Multi-account:** UIDs verified to be namespaced with account_id throughout — grep codebase for bare `uid` fields being returned without account context
- [ ] **Gmail compatibility:** Folder names discovered via LIST, not hardcoded — test against a real Gmail account, not just generic IMAP
- [ ] **Background polling:** Polling loop verified to survive: (a) IMAP connection drop, (b) server process restart, (c) invalid credentials for one account while others are valid
- [ ] **Credential security:** `git log -p` scan of repo history shows no credentials committed at any point
- [ ] **Response size:** Largest possible tool response measured against a real mailbox — not just a test mailbox with 5 emails
- [ ] **MCP error handling:** All tool handlers tested with a deliberately broken IMAP connection — confirm server stays running and returns error responses rather than crashing
- [ ] **UIDVALIDITY:** UIDVALIDITY tracked and checked — not just UIDs alone
- [ ] **TLS:** Verified that TLS is enforced and certificate errors are not silently ignored (`rejectUnauthorized: false` never in production code)

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Credentials leaked in git history | HIGH | Rotate all exposed credentials immediately; use `git filter-branch` or BFG Repo Cleaner to purge history; audit all log files for exposed values |
| Single-connection architecture needs multi-account retrofit | HIGH | Full rewrite of connection layer; all tool handlers need account_id parameter added; data model migration if any persistence exists |
| Bare UIDs without account_id in public API | MEDIUM | Breaking API change; all callers must update; cannot be done incrementally |
| No reconnect logic | MEDIUM | Add reconnect wrapper around connection object; test thoroughly against timeout scenarios |
| Full-body fetches in list operations | LOW | Surgical change to FETCH arguments; measurable via before/after performance test |
| Missing rate limiting | LOW-MEDIUM | Add connection pool with limit; existing tests should still pass |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Credential exposure | Phase 1: Foundation / Config | Scan codebase for credential strings in errors/logs; no credentials in git history |
| Multi-account isolation (bare UIDs) | Phase 1: Foundation / Architecture | All data structures include account_id; API contracts reviewed before implementation |
| MCP server crash on tool error | Phase 1: MCP Server Core | Kill IMAP connection during tool call; verify server returns error response and continues running |
| Single connection without reconnect | Phase 2: Connection Management | Drop network mid-session; verify automatic reconnection within 60 seconds |
| Rate limiting / connection pools | Phase 2: Connection Management | Connect 4+ accounts simultaneously; verify no more than N connections per account |
| Full body fetch in list operations | Phase 3: Core Read Operations | Benchmark against a mailbox with 1000+ messages; measure memory and latency |
| IMAP SEARCH not used | Phase 3: Core Read Operations | Verify SEARCH commands appear in IMAP protocol trace; no client-side filtering of all-UIDs |
| IMAP IDLE missing fallback | Phase 4: Background Polling | Test against a server without IDLE capability (or mock); verify polling fallback activates |
| IDLE renewal not implemented | Phase 4: Background Polling | Run server for 35+ minutes; verify IDLE is renewed and new mail is still detected |
| MCP response too large | Phase 3 / Tool design | Call search with no filters against a large mailbox; measure response size |
| UIDVALIDITY not tracked | Phase 3: Core Read Operations | Simulate UIDVALIDITY change; verify cache invalidation |
| Gmail folder name incompatibility | Phase 3: Core Read Operations | Test against a real Gmail account; verify LIST-based discovery |

---

## Sources

- RFC 3501 (IMAP4rev1) — connection state machine, UIDVALIDITY semantics, SEARCH command specification
- RFC 2177 (IMAP IDLE) — 29-minute renewal requirement, capability negotiation
- RFC 4315 (IMAP UIDPLUS) — UID handling and UIDVALIDITY requirements
- Gmail IMAP documentation (support.google.com/mail/answer/7190) — folder naming conventions, connection limits (15 per account), All Mail search behavior
- imapflow library (imapflow.com) — Node.js IMAP client patterns, connection management API
- MCP SDK documentation (modelcontextprotocol.io) — tool response schema, error handling conventions
- Domain knowledge: IMAP protocol implementation experience, connection management patterns from imaplib/node-imap community issues

*Note: Web search and WebFetch were unavailable during this research session. All findings are based on well-established RFC specifications and widely-documented library patterns (HIGH confidence for IMAP protocol behavior; MEDIUM confidence for MCP-specific interaction patterns).*

---
*Pitfalls research for: IMAP MCP Server*
*Researched: 2026-03-11*
