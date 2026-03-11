# Feature Research

**Domain:** IMAP MCP Server — email access for AI agents
**Researched:** 2026-03-11
**Confidence:** MEDIUM (no web access; based on IMAP RFC 3501 domain knowledge, MCP protocol design patterns, and email agent UX patterns from training data through August 2025)

---

## Note on Research Method

Web search and WebFetch were unavailable during this research session. All findings are based on:

1. IMAP RFC 3501 / RFC 9051 (IMAP4rev2) protocol knowledge — HIGH confidence
2. MCP (Model Context Protocol) tool design patterns — HIGH confidence
3. Known email agent tools (Gmail MCP, notmuch-based agents, email summarizers) — MEDIUM confidence
4. General email agent UX patterns from LLM integrations — MEDIUM confidence

Claims marked LOW confidence should be verified against actual competitor implementations before finalizing.

---

## Feature Landscape

### Table Stakes (Agents Can't Do Useful Work Without These)

These features represent the minimum for an agent to be useful with email. Missing any of these means the agent either can't access email at all, or produces unreliable results.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Connect to IMAP server | Foundation of everything | LOW | Host, port, TLS, credentials. Must support STARTTLS and implicit TLS. |
| List mailboxes/folders | Agent must know what folders exist before navigating them | LOW | IMAP LIST command. Agents need this to find INBOX, Sent, custom labels. |
| Fetch message list from folder | Browse a folder's contents | LOW | IMAP SEARCH + FETCH for headers. Return UIDs, subjects, senders, dates, read status. |
| Fetch full message by UID | Read a specific email | MEDIUM | IMAP FETCH BODY[]. Must handle MIME multipart — extract text/plain, text/html, attachments metadata. |
| Search emails (basic) | Find relevant messages without reading everything | MEDIUM | IMAP SEARCH command. Minimum: by sender, subject, date range, seen/unseen status. |
| Mark as read / unread | Agents need to manage state | LOW | IMAP STORE +FLAGS \Seen. Required for "surface unread" workflows. |
| Paginated message listing | Inboxes have thousands of messages; full dump is unusable | MEDIUM | IMAP sequence sets. Without this, large inboxes time out or overflow context windows. |
| Multi-account support | Project explicitly requires it for household use | MEDIUM | Connection pool keyed by account name. Must handle independent auth states. |
| Unified inbox view | See all accounts' recent/unread in one call | MEDIUM | Merge + sort across accounts by date. Requires multi-account to be working first. |
| TLS/SSL connection security | Credentials must not travel in plaintext | LOW | All major providers require TLS. Non-negotiable for any real use. |
| Configurable credentials (no hardcoding) | Deployment requirement from PROJECT.md | LOW | Env vars or config file. Must support per-account config. |
| Error messages agents can act on | Agent needs to know why a call failed | LOW | Distinguish: auth failure, network error, folder not found, message not found. |

### Differentiators (Competitive Advantage Over Other Email MCP Servers)

Most IMAP MCP servers (where they exist) are thin wrappers: connect, fetch, done. These features make this server genuinely useful for sustained agent workflows.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Background polling with new-mail notifications | Agent or user gets alerted when important mail arrives without constant polling from the agent side | HIGH | Requires persistent process. MCP resource subscriptions or push notifications. This is the "never miss important messages" feature from PROJECT.md. |
| Thread-aware message grouping | Agents summarizing conversations need thread context, not individual messages | MEDIUM | IMAP THREAD extension (RFC 5256) or reconstruct via References/In-Reply-To headers. Many providers support THREAD=REFERENCES. |
| Full-text body search (server-side) | Search email content, not just headers | MEDIUM | IMAP SEARCH TEXT / BODY. More powerful than header-only. Provider support varies; Gmail requires X-GM-RAW for full text. |
| Attachment metadata listing | Agent knows what's attached without downloading attachments | LOW | Parse BODYSTRUCTURE. Return filename, MIME type, size. Don't download unless explicitly requested. |
| Selective attachment download | Fetch specific attachment by ID | MEDIUM | IMAP FETCH BODY[part_number]. Requires BODYSTRUCTURE parsing first. |
| Folder/label management | Move, archive, create folders | MEDIUM | IMAP COPY + STORE \Deleted + EXPUNGE. Deferred to v1.x — read-only is safer for v1. |
| Gmail-specific extensions | Gmail uses non-standard IMAP (labels as folders, X-GM-RAW search, X-GM-THRID for threads) | MEDIUM | Detect CAPABILITY X-GM-EXT-1 and use extended commands when available. Degrades gracefully on non-Gmail. |
| Connection pooling and reuse | Agents make many sequential calls; re-authenticating every call is slow | MEDIUM | Keep persistent IMAP connections with idle/keepalive. Reconnect on drop. |
| Structured output format | Return JSON that's easy for agents to reason about, not raw MIME | MEDIUM | Parse MIME headers, decode RFC 2047 encoded words, normalize dates to ISO 8601, detect charset and decode to UTF-8. |
| Named account querying | "Check Jonathan's work email" — agent can target a specific account by name | LOW | Config maps account names to connection details. Already implied by multi-account. |
| Result size limits with continuation tokens | Large search results must be navigable without blowing up context windows | MEDIUM | Return N results + a cursor/offset for the next page. |

### Anti-Features (Things That Seem Good But Create Problems)

These are features that are commonly requested or seem obvious, but create disproportionate complexity, risk, or scope creep for v1.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Send / reply / forward email | Complete the email loop | High stakes: accidental sends, spam risk, auth requirements (SMTP is separate from IMAP), provider-specific auth (OAuth vs app passwords). Scope doubles. | Defer to v2. Design the v1 data model so adding send doesn't require rearchitecture. |
| Full attachment download by default | "I want to see what's attached" | Attachments can be megabytes. Returning them inline floods context windows and wastes tokens. | Return attachment metadata by default; require explicit fetch-attachment call with message UID + part number. |
| OAuth2 flow implementation | "Works with modern Gmail/Outlook" | OAuth2 is a full auth system: redirect flows, token refresh, provider-specific scopes. Adds significant complexity. Different for every provider. | Support OAuth2 tokens as a credential type (user provides the token), but don't implement the OAuth flow itself in v1. Use app passwords as the initial path. |
| Real-time push via IMAP IDLE for every account | "Instant new mail notifications" | IMAP IDLE requires one persistent TCP connection per monitored folder per account. With N accounts, this is N+ persistent connections. Complex reconnect logic. | Poll on a configurable interval (e.g., every 60s). Add IDLE-based push as a v1.x enhancement once polling is stable. |
| Web UI / admin dashboard | "Easy configuration" | This is an agent tool, not an app. A UI is a completely separate product surface with its own auth, hosting, and maintenance burden. | Config file or env vars. Clear documentation for setup. |
| Automatic email categorization / AI labeling | "Smart inbox" | This is an AI feature on top of the MCP layer, not part of the MCP server itself. The agent using this server should do the classification. | Let the LLM agent classify emails using the data returned by this server. Keep classification logic out of the server. |
| Message deletion | "Clean up inbox" | Destructive operations on v1 before trust is established. IMAP delete is EXPUNGE — permanent. | Expose flag-as-deleted (STORE \Deleted) but not EXPUNGE in v1. Or defer entirely to v1.x after read-only is validated. |
| Sync / local cache of entire mailbox | "Faster repeated queries" | Syncing a full mailbox is a notmuch/OfflineIMAP problem — gigabytes of email, complex delta sync, storage management. Far outside MCP server scope. | Query-on-demand with IMAP. Connection pooling handles the performance story for reasonable use. |

---

## Feature Dependencies

```
[Multi-account config]
    └──required by──> [Unified inbox view]
    └──required by──> [Named account querying]

[Connect to IMAP server]
    └──required by──> [All other features]

[List mailboxes]
    └──required by──> [Fetch message list from folder]
                          └──required by──> [Fetch full message by UID]
                                                └──required by──> [Attachment metadata]
                                                                      └──required by──> [Selective attachment download]

[Fetch full message by UID]
    └──required by──> [Thread-aware grouping] (via References/In-Reply-To parsing)

[Background polling]
    └──enhances──> [Unified inbox view] (surfaces fresh data proactively)

[Thread-aware grouping]
    └──enhances──> [Search] (search within threads, not just individual messages)

[Paginated listing]
    └──required by──> [Search] (search results can be large)

[Structured output format]
    └──enhances──> [All fetch/search features] (makes all output agent-friendly)

[Mark as read/unread]
    └──conflicts with── [Read-only v1 constraint] (must decide: include or defer)
```

### Dependency Notes

- **Multi-account required for unified inbox:** The unified inbox is just a sorted merge of per-account INBOX queries. Multi-account must be architected first or the unified view will need a rewrite.
- **Pagination required for search:** Without pagination, a search query on a large mailbox returns all matches at once. This is an agent context window overflow waiting to happen.
- **Attachment metadata requires BODYSTRUCTURE parsing:** BODYSTRUCTURE is a complex recursive IMAP response format. Once implemented, both metadata listing and selective download use the same parser.
- **Mark as read/unread is a write operation:** This conflicts with "read-only v1" framing in PROJECT.md. Decision needed: is marking-read a write operation or a state-sync operation? If included, it's the only write op in v1 and should be explicitly gated.
- **Thread grouping can be done client-side or server-side:** IMAP THREAD extension (RFC 5256) is server-side and fast but not universally supported. Reconstructing threads from References/In-Reply-To headers is universal but requires fetching all headers first. Both approaches needed for broad compatibility.

---

## MVP Definition

### Launch With (v1)

Minimum for agents to do useful, reliable email work across multiple accounts.

- [ ] Connect to IMAP server — without this, nothing works
- [ ] List mailboxes/folders — agent must navigate the account structure
- [ ] Fetch message list from folder (with pagination) — browse inbox
- [ ] Fetch full message by UID (text body, headers) — read an email
- [ ] Basic search (sender, subject, date, seen/unseen) — find relevant email
- [ ] Attachment metadata listing (no auto-download) — know what's attached without overflow
- [ ] Multi-account support with named accounts — household use requirement from day one
- [ ] Unified inbox view (recent/unread across all accounts) — the "never miss important messages" use case
- [ ] Background polling for new mail — surfaces new messages to agents proactively
- [ ] Structured, normalized output (UTF-8, ISO 8601 dates, decoded subjects) — agent-friendly responses
- [ ] Configurable credentials via env vars or config file — no hardcoding
- [ ] Connection pooling and reuse — performance for multi-call agent workflows
- [ ] Clear error responses — agent must know why a call failed

**Decision point on mark-as-read:** Lean toward including it in v1 as it enables "surface unread, mark as read" workflows that are core to the use case. But it should be optional/gated and clearly documented as the only write operation.

### Add After Validation (v1.x)

Features to add once core reading is stable and trusted.

- [ ] Thread-aware message grouping — improves summarization quality significantly; add when basic read works
- [ ] Full-text body search (IMAP SEARCH TEXT) — more powerful queries; validate basic search first
- [ ] Gmail-specific extensions (X-GM-RAW, X-GM-THRID) — add when Gmail is a confirmed primary use case
- [ ] IMAP IDLE-based push (replace polling) — add when polling is stable and latency becomes a real concern
- [ ] Selective attachment download — add when users ask for it; metadata listing covers most cases
- [ ] Folder move/archive operations — first write operation beyond flag; add carefully
- [ ] Result continuation tokens / cursor pagination — add when large-mailbox use cases appear

### Future Consideration (v2+)

- [ ] Send / reply / forward — full SMTP integration; separate scope from IMAP read
- [ ] OAuth2 flow implementation — provider-specific auth flows; adds significant complexity
- [ ] Folder/label creation and deletion — administrative operations; higher risk
- [ ] Calendar/contacts access — separate protocols (CalDAV, CardDAV); different product surface

---

## Feature Prioritization Matrix

| Feature | Agent Value | Implementation Cost | Priority |
|---------|-------------|---------------------|----------|
| Connect + auth | HIGH | LOW | P1 |
| List mailboxes | HIGH | LOW | P1 |
| Fetch message list (paginated) | HIGH | MEDIUM | P1 |
| Fetch full message by UID | HIGH | MEDIUM | P1 |
| Basic search | HIGH | MEDIUM | P1 |
| Multi-account support | HIGH | MEDIUM | P1 |
| Unified inbox view | HIGH | LOW (once multi-account works) | P1 |
| Structured/normalized output | HIGH | MEDIUM | P1 |
| Background polling | HIGH | HIGH | P1 |
| Configurable credentials | HIGH | LOW | P1 |
| Connection pooling | MEDIUM | MEDIUM | P1 |
| Attachment metadata | MEDIUM | MEDIUM | P1 |
| Error response quality | HIGH | LOW | P1 |
| Mark as read/unread | MEDIUM | LOW | P1 (with decision) |
| Thread-aware grouping | HIGH | MEDIUM | P2 |
| Full-text search | MEDIUM | LOW | P2 |
| Gmail extensions | MEDIUM | MEDIUM | P2 |
| IMAP IDLE push | MEDIUM | HIGH | P2 |
| Selective attachment download | LOW | MEDIUM | P2 |
| Send / reply / forward | HIGH | HIGH | P3 (v2) |
| OAuth2 flow | MEDIUM | HIGH | P3 (v2) |

**Priority key:**
- P1: Must have for v1 launch
- P2: Should have, add in v1.x iterations
- P3: Future consideration (v2+)

---

## Competitor Feature Analysis

Note: This analysis is based on training data through August 2025 and knowledge of similar tools. Verify against actual implementations.

| Feature | Typical thin IMAP wrapper | Gmail-specific MCP tools | Our Approach |
|---------|--------------------------|--------------------------|--------------|
| Multi-account | Usually single account | Single account (Gmail only) | Multi-account from v1 (household requirement) |
| Provider support | Gmail/Outlook specific or generic IMAP | Gmail API only | Standard IMAP — any provider |
| Background polling | Not present | Not present | v1 requirement |
| Structured output | Raw MIME or minimal parsing | Provider-formatted JSON | Normalized, agent-friendly JSON |
| Thread support | Usually absent | Present (Gmail thread IDs) | Via References headers + optional THREAD extension |
| Search | Basic or absent | Gmail search syntax | IMAP SEARCH with structured parameters |
| Attachment handling | Auto-include (context overflow risk) | Metadata or full | Metadata by default, explicit download |
| Pagination | Usually absent | Present | Required from v1 |
| Code quality | Script-quality | Variable | Open-source quality from start |

**Confidence:** LOW — based on general knowledge of the space. Verify against actual implementations like modelcontextprotocol/servers repository, any community email MCP servers, and mcp.so directory.

---

## What Agents Actually Need (Design Principles)

These are design principles derived from how agents use email tools, not just feature lists.

**1. Never return entire mailboxes.** Agents have context window limits. Every list/search operation must have a default page size (e.g., 25 messages) and explicit pagination. Return counts alongside results ("showing 25 of 847 messages").

**2. Separate metadata from content.** Listing messages should return only headers (UID, from, subject, date, flags). Body content comes from a separate fetch call. This lets agents scan many messages cheaply before deciding which to read fully.

**3. Attachment safety by default.** Return attachment name, type, and size metadata by default. Never include attachment bytes in a message fetch response unless explicitly requested. A 5MB PDF will destroy a context window.

**4. Normalized output is non-negotiable.** IMAP returns encoded subjects (RFC 2047), raw MIME structures, epoch timestamps, and various charsets. Agents should receive: decoded subject strings, UTF-8 bodies, ISO 8601 dates, and clean sender name/address pairs. Raw IMAP output is unusable without normalization.

**5. Errors must be actionable.** "Connection failed" is not useful. "Authentication failed for account 'work' — check IMAP password or app password" is. Agents need enough information to surface a useful message to the user.

**6. Account names matter for agent UX.** The agent needs to say "I checked your work email and your personal email." This requires config-level naming ("work", "personal", "household") that maps to connection details.

**7. Background polling is a first-class feature.** The "never miss important messages" value proposition requires the server to be watching for new mail proactively. This is not a nice-to-have — it's the reason an always-on MCP server is better than an agent that just connects on demand.

---

## Sources

- IMAP RFC 3501 (IMAP4rev1) — HIGH confidence, foundational protocol knowledge
- IMAP RFC 9051 (IMAP4rev2) — HIGH confidence, current standard
- IMAP THREAD extension RFC 5256 — HIGH confidence
- MCP (Model Context Protocol) specification — HIGH confidence, Anthropic-published standard
- General email agent tool patterns from LLM integrations — MEDIUM confidence
- Competitor feature analysis — LOW confidence, based on training data through August 2025; needs verification

**Verification recommended for:**
- Actual feature lists of existing IMAP MCP servers (search GitHub, mcp.so)
- modelcontextprotocol/servers repository for official email examples
- Gmail IMAP extensions documentation (Google Workspace IMAP settings)
- Provider-specific IMAP limitations (iCloud, Outlook, Fastmail)

---

*Feature research for: IMAP MCP Server — email access for AI agents*
*Researched: 2026-03-11*
