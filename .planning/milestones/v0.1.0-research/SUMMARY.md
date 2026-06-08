# Project Research Summary

**Project:** imap-mcp — IMAP MCP Server
**Domain:** MCP server wrapping IMAP email access for AI agents (multi-account, household use)
**Researched:** 2026-03-11
**Confidence:** MEDIUM-HIGH

## Executive Summary

An IMAP MCP server is a long-lived stdio subprocess that exposes email read operations as MCP tools for AI agents running in Claude Desktop or similar hosts. The recommended approach is a layered TypeScript/Node.js architecture using the official `@modelcontextprotocol/sdk`, `imapflow` for IMAP, and `mailparser` for MIME parsing. The architecture separates concerns cleanly: config management, connection management, business-logic services, and thin tool handlers. The server maintains persistent IMAP connections and a background polling loop for the duration of each client session — no separate daemon is needed for v1.

The key design constraint distinguishing this project from thin wrappers is multi-account support from day one, combined with agent-friendly output design: paginated results, metadata-first (bodies fetched on demand), and structured normalized JSON. Background polling for new mail is a first-class v1 requirement, not a later enhancement. These constraints shape every layer of the architecture and must be baked in from the start — retrofitting multi-account or pagination after the fact is a high-cost refactor.

The most important risks to manage upfront are: (1) credentials leaking into logs or MCP responses, (2) multi-account state isolation failing because UIDs are never bare integers — they are always `{account_id, uid}` tuples, and (3) the MCP stdio rule that `console.log` corrupts the JSON-RPC stream. These three issues, if not addressed at architecture time, require expensive rewrites. Everything else — IMAP IDLE vs polling, Gmail quirks, connection reconnect logic — can be iterated on, but the data model and credential handling must be right from Phase 1.

## Key Findings

### Recommended Stack

The MCP TypeScript SDK (`@modelcontextprotocol/sdk`) is the only correct choice — it is the official Tier 1 SDK from Anthropic and is used exactly as documented for building stdio-transport MCP servers. For IMAP, `imapflow` (from the PostalSys / Nodemailer author) is the clear winner over `node-imap` (callback-based, unmaintained) and `imap-simple` (a thin wrapper over the same stale base). `mailparser` handles MIME parsing and is a natural pairing from the same ecosystem. `zod` is the MCP ecosystem's default schema validation library and is used in the official TypeScript tutorial.

Node.js 22 LTS is the recommended runtime (widely installed; 24 is active LTS but 22 is the broader compatibility baseline). TypeScript 5.x with `"module": "Node16"` and `"target": "ES2022"` matches official MCP tutorial configuration. `vitest` is preferred over Jest for new ESM projects.

**Core technologies:**
- `@modelcontextprotocol/sdk` (latest 1.x): MCP server framework — official Tier 1, provides `McpServer` and `StdioServerTransport`
- `imapflow` (1.x): IMAP client — modern async/await API, supports IDLE, SASL XOAUTH2, actively maintained
- `mailparser` (3.x): MIME parsing — handles RFC 2822 encoding, attachments, multipart correctly
- `zod` (3.x): Schema validation — used in official MCP tutorial; pairs with TypeScript inference
- TypeScript (5.x) on Node.js 22 LTS: Language/runtime — type safety critical for IMAP data structures
- `vitest` (2.x): Testing — native ESM support, better fit than Jest for Node 22 + `"type": "module"`

**Critical rule:** Never use `console.log` in an stdio MCP server. stdout is the JSON-RPC channel. All logging must go to stderr via `console.error()` or a dedicated stderr logger.

### Expected Features

The project has a clearly stratified feature set. The table-stakes core (what makes the server functional at all) is well-defined and overlaps heavily with what differentiates this from thin IMAP wrappers — specifically multi-account support, background polling, and structured normalized output, all of which are v1 requirements here rather than future enhancements.

**Must have (table stakes for v1):**
- IMAP connection (TLS, configurable per-account credentials) — foundation of everything
- List mailboxes/folders — agents must navigate account structure
- Fetch message list from folder with pagination — browse inbox without context overflow
- Fetch full message by UID (text body, headers) — read an email
- Basic search (sender, subject, date, seen/unseen) — find relevant mail efficiently
- Attachment metadata (no auto-download) — know what's attached without flooding context window
- Multi-account support with named accounts — explicit household requirement from day one
- Unified inbox view across accounts — the "never miss important messages" use case
- Background polling for new mail — proactive notification, not just on-demand
- Normalized/structured output (UTF-8 bodies, ISO 8601 dates, decoded subjects) — agent-friendly responses
- Configurable credentials via env vars or config file — no hardcoding
- Connection pooling and reuse — performance for multi-call agent workflows
- Actionable error responses — agent needs to know why calls failed

**Should have (competitive differentiators, v1.x):**
- Thread-aware message grouping (via References/In-Reply-To headers) — improves summarization quality
- Full-text body search (IMAP SEARCH TEXT) — more powerful than header-only search
- Gmail-specific extensions (X-GM-RAW search, X-GM-THRID thread IDs) — primary use case optimization
- IMAP IDLE-based push notifications (replacing polling) — lower latency, lower server overhead
- Selective attachment download — explicit fetch by UID + part number

**Defer to v2+:**
- Send / reply / forward (SMTP integration) — doubles scope, separate auth requirements
- OAuth2 flow implementation — provider-specific redirect flows; accept tokens as credential type in v1
- Folder/label creation and deletion — administrative, high-risk destructive operations
- Calendar/contacts (CalDAV/CardDAV) — different protocols, different product surface

**Decision required: mark-as-read.** FEATURES.md recommends including it in v1 as the only write operation, enabling "surface unread, mark as read" workflows. It is lower risk than folder manipulation and fits the core use case. Should be explicitly gated and documented.

### Architecture Approach

The recommended architecture is a 5-layer single-process system running as a stdio MCP server subprocess. The entry point (`index.ts`) wires together a `ConfigManager` (startup validation, read-only after load), `ConnectionManager` (one `ImapFlow` instance per account, lazy-connect with eager validation), business-logic services (`EmailService`, `SearchService`, `PollerService`), a `MessageCache` (in-memory, TTL-expired, header-only), and thin tool handlers (Zod validation → service call → format response). The background `PollerService` runs a `setInterval` loop that pre-fetches unread message envelopes into the cache, so `get_unread` tool calls are served from cache without an IMAP round-trip.

**Major components:**
1. `ConfigManager` — load/validate multi-account config at startup; read-only after init; fail-fast on invalid config
2. `ConnectionManager` — own one `ImapFlow` per account; lazy-connect; reconnect with exponential backoff
3. `EmailService` + `SearchService` — business logic; call `ConnectionManager.getClient()`, never IMAP directly
4. `PollerService` — background `setInterval`; poll INBOX per account sequentially; write to `MessageCache`
5. `MessageCache` — in-memory header-only store with TTL; shared between poller (writes) and query tools (reads)
6. Tool handlers — thin adapters: Zod validates input, service executes, `MessageFormatter` normalizes output
7. `MessageFormatter` + `logger.ts` — pure utilities; logger enforces stderr-only

**Key patterns:**
- Lazy connection with eager validation: validate config at startup, open TCP on first use
- Fan-out with `Promise.allSettled`: multi-account operations run in parallel; one broken account never blocks others
- Polling cache over IMAP IDLE for v1: simpler reconnect logic; IDLE is a v2 optimization
- Tool as thin adapter: no business logic in handlers; services testable without MCP layer

**Build order (dependency-driven):** ConfigManager → ConnectionManager → MessageCache → EmailService → SearchService → MessageFormatter → PollerService → Tool definitions → Tool handlers → `index.ts`

### Critical Pitfalls

1. **Credential exposure in logs/responses** — Never build connection URL strings with credentials embedded; sanitize all error messages before surfacing in MCP responses; redact sensitive fields from all log output. Address in Phase 1 before any connection code.

2. **Multi-account state isolation failure (bare UIDs)** — UIDs are meaningless without account context. Every data structure must use `{account_id, uid}` tuples from day one. This is an architecture constraint, not a feature — retrofitting it is a breaking API change. Address in Phase 1.

3. **MCP server crash on tool error** — Every tool handler needs a top-level try/catch that converts errors to MCP error responses. An unhandled IMAP connection drop must not crash the server process. Address in Phase 1 MCP server setup.

4. **Single persistent connection without reconnect logic** — IMAP servers enforce idle timeouts (Gmail: ~20 min, Fastmail: ~10 min). The connection will drop silently and the polling loop will die. Implement exponential backoff reconnect + NOOP heartbeat. Address in Phase 2.

5. **Fetching full message bodies in list/search operations** — Use IMAP `FETCH ENVELOPE` or `BODY[HEADER.FIELDS]` for list operations; never `FETCH BODY[]` or `RFC822` except for explicit body requests. A mailbox with attachments will exhaust memory immediately. Address in Phase 3 before any performance testing.

6. **MCP tool response size blowing agent context window** — Every list/search tool must have a mandatory `limit` parameter (default 20, max 100). Bodies must never appear in list responses. Add pagination from the start. Address in tool schema design (Phase 3).

7. **UIDVALIDITY not tracked** — Cache `{account_id, mailbox, uidvalidity, uid}` tuples, not bare UIDs. Check UIDVALIDITY on every SELECT against any cached data and invalidate on mismatch. Address in Phase 3.

## Implications for Roadmap

Based on the dependency chains in the research, the natural phase structure flows from bottom to top of the architecture stack, with the most expensive-to-retrofit decisions addressed first.

### Phase 1: Foundation — Config, Credentials, and MCP Server Shell

**Rationale:** Config and credential handling must be correct before any connection code is written. Multi-account data model constraints must be established before any features are built on top. The MCP server shell (with error handling and stderr-only logging) must be in place before any tools are registered. These decisions are the most expensive to change later.

**Delivers:** A running MCP server that loads and validates multi-account config, registers no-op stub tools, and handles errors without crashing. Credential handling is correct from first commit. Logger enforces stderr-only.

**Addresses:** Multi-account config architecture, configurable credentials (no hardcoding), actionable error responses, MCP server process stability.

**Avoids:** Credential exposure in logs (Pitfall 1), multi-account state isolation failure (Pitfall 7), MCP server crash on tool error (Pitfall 10), `console.log` corrupting JSON-RPC stream (Architecture anti-pattern 2).

**Research flag:** Standard patterns — MCP SDK documentation is verified, config patterns are well-established. Skip research-phase.

### Phase 2: Connection Management

**Rationale:** Connection management is a prerequisite for all IMAP operations. Reconnect logic and connection pool limits must be implemented before feature work begins — adding reconnect later means auditing every error path in the feature layer.

**Delivers:** `ConnectionManager` with lazy-connect, exponential backoff reconnect, NOOP heartbeat, and per-account connection limits. Verified to reconnect after a simulated network drop.

**Addresses:** Connection pooling and reuse, TLS/SSL security.

**Avoids:** Single connection without reconnect (Pitfall 2), rate limiting / too many concurrent connections (Pitfall 8), opening new connection per tool call (Architecture anti-pattern 6).

**Research flag:** Standard patterns — imapflow API is well-documented. May need phase research if imapflow reconnect API has nuances not covered in training data; verify `imapflow.com` docs before implementation.

### Phase 3: Core Read Operations and Tool Design

**Rationale:** With config and connections stable, implement the core read tools in dependency order: list mailboxes → list messages (paginated) → fetch full message → basic search. Tool schema design (pagination, response size limits, `{account, uid}` tuples) must be established here and must not change after.

**Delivers:** Working MCP tools: `list_accounts`, `list_mailboxes`, `list_messages` (paginated), `read_email`, `search_email` (basic). Verified against a real large mailbox. UIDVALIDITY tracked. Attachment metadata included, bodies not auto-downloaded.

**Addresses:** List mailboxes, fetch message list with pagination, fetch full message, basic search, attachment metadata, structured/normalized output, UIDVALIDITY tracking.

**Avoids:** Full body fetch in list/search (Pitfall 5), MCP response size overflow (Pitfall 6), UIDVALIDITY not tracked (Pitfall 9), bare UIDs without account context (UX pitfall), Gmail folder name assumptions (use LIST-based discovery).

**Research flag:** Needs research-phase for IMAP SEARCH grammar details and imapflow fetch API specifics (BODYSTRUCTURE parsing, ENVELOPE fields). Gmail-specific folder naming quirks also warrant verification.

### Phase 4: Multi-Account Unified View

**Rationale:** Multi-account fan-out and unified inbox build directly on top of Phase 3's per-account tools. The fan-out pattern (`Promise.allSettled`) and result merging are isolated to the service layer — this phase wires them together without changing the underlying read tools.

**Delivers:** `get_unread` tool that returns merged, sorted unread messages across all accounts. Fan-out with per-account error isolation — one broken account returns partial results with a warning, not a total failure. Account names visible in all responses.

**Addresses:** Multi-account support, unified inbox view, named account querying.

**Avoids:** Using `Promise.all` for fan-out (Architecture anti-pattern 5 — use `Promise.allSettled`), state bleeding between accounts.

**Research flag:** Standard patterns — fan-out merge is straightforward. Skip research-phase.

### Phase 5: Background Polling

**Rationale:** Background polling is a v1 requirement but depends on all read operations being stable. The `PollerService` uses `EmailService` (Phase 3) and `MessageCache`; adding it after read operations are verified means the polling loop has a solid foundation to build on.

**Delivers:** `PollerService` with configurable interval (default 3 min), sequential per-account polling, cache pre-population of unread envelopes only (not bodies), verified survival of: IMAP connection drop, one-account failure while others continue.

**Addresses:** Background polling for new mail, connection reuse for polling.

**Avoids:** Polling full bodies into cache (Architecture anti-pattern 4), parallel polling causing IMAP rate limits, polling loop dying silently on connection drop.

**Research flag:** Standard patterns for polling loop design. IMAP IDLE implementation (v1.x enhancement) will need research-phase when added — IDLE renewal every 29 minutes has protocol-specific nuances.

### Phase 6: Quality, Hardening, and Release Prep

**Rationale:** Before public release, validate the "looks done but isn't" checklist from PITFALLS.md. Test against real large mailboxes, verify response size limits, scan git history for credential leaks, and confirm TLS enforcement.

**Delivers:** Verified response sizes against real mailboxes, reconnect tested by dropping network mid-session, no credentials in git history, ESLint rule banning `console.log`, MCP Inspector verified tool schemas.

**Addresses:** All remaining pitfall verification items.

**Research flag:** Standard — this is validation/hardening, not new technology. Skip research-phase.

### Phase Ordering Rationale

- Config/credentials/MCP shell must come before any IMAP code — the constraint "no hardcoded credentials" and "multi-account from day one" shapes the entire data model.
- Connection management before feature work — reconnect logic is far cheaper to add before features than after, and every feature depends on connection stability.
- Core reads before unified/polling — you cannot merge across accounts until per-account reads work correctly.
- Background polling last among core features — it depends on read operations being stable and tested.
- The build order from ARCHITECTURE.md (ConfigManager → ConnectionManager → MessageCache → Services → Tools → index.ts) maps directly to this phase structure.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (Connection Management):** imapflow reconnect API and NOOP heartbeat specifics — verify against `imapflow.com` docs; training data confidence is MEDIUM for library internals.
- **Phase 3 (Core Read Operations):** IMAP SEARCH grammar mapping, imapflow BODYSTRUCTURE/ENVELOPE fetch API, Gmail folder naming (LIST-based discovery details) — verify against imapflow docs and Gmail IMAP documentation.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation):** MCP SDK is well-documented with verified official sources.
- **Phase 4 (Multi-Account Fan-out):** `Promise.allSettled` merge/sort is standard Node.js pattern.
- **Phase 5 (Background Polling):** `setInterval`-based polling loop is standard; IDLE is deferred.
- **Phase 6 (Hardening):** Verification checklist, no new technology.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM-HIGH | MCP SDK verified via official docs (HIGH); imapflow/mailparser version numbers not independently verified via npm — confirm `npm view imapflow version` before pinning |
| Features | MEDIUM | IMAP RFC knowledge HIGH; competitor feature analysis LOW (training data through Aug 2025, no web access to verify actual implementations) |
| Architecture | HIGH | MCP patterns from official docs (HIGH); imapflow-specific API patterns MEDIUM — verify before implementation |
| Pitfalls | HIGH for IMAP protocol pitfalls (RFC-based); MEDIUM for MCP interaction patterns (newer protocol, pattern-based inference) |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **imapflow version pinning:** Run `npm view imapflow version` and `npm view mailparser version` before writing `package.json`. Training data confidence is MEDIUM on exact versions.
- **Gmail OAuth2 current policy:** Gmail's app password availability and OAuth2 requirements have shifted repeatedly. Verify current policy (as of 2026) before finalizing auth strategy. The safe v1 design is pluggable auth (`{ type: "password" | "oauth2" }`), accepting tokens without implementing the OAuth2 flow.
- **Outlook/Exchange auth:** Outlook deprecated Basic Auth for IMAP in 2023 per ARCHITECTURE.md. This means Outlook accounts may require OAuth2 even in v1. Flag Outlook as "may not work with app passwords" in documentation and defer full Outlook support to v1.x.
- **Competitor feature gap analysis:** FEATURES.md competitor analysis is LOW confidence (training data). Before finalizing v1 feature scope, verify against GitHub search for IMAP MCP servers and the `mcp.so` directory.
- **mark-as-read decision:** FEATURES.md recommends including it in v1 as the only write operation. This decision should be made explicit in the roadmap — it affects how "read-only v1" is framed and should be documented as intentional.
- **IMAP IDLE timing:** The 29-minute renewal requirement for IMAP IDLE (per RFC 2177) is well-established, but imapflow may handle this automatically. Verify against imapflow docs before implementing manual renewal logic in v1.x.

## Sources

### Primary (HIGH confidence)
- `https://modelcontextprotocol.io/docs/develop/build-server` — TypeScript SDK API, `McpServer`/`StdioServerTransport`, tsconfig pattern (verified 2026-03-11)
- `https://modelcontextprotocol.io/specification/2025-11-25/basic/transports` — stdio vs Streamable HTTP; "clients SHOULD support stdio whenever possible" (verified 2026-03-11)
- `https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle` — long-lived process model, session phases (verified 2026-03-11)
- `https://nodejs.org/en/about/previous-releases` — Node.js 22 Maintenance LTS, 24 Active LTS (verified 2026-03-11)
- RFC 3501 (IMAP4rev1) — SEARCH grammar, UIDVALIDITY semantics, connection state machine
- RFC 2177 (IMAP IDLE) — 29-minute renewal, capability negotiation
- RFC 4315 (IMAP UIDPLUS) — UID handling requirements
- RFC 5256 (IMAP THREAD extension)

### Secondary (MEDIUM confidence)
- imapflow npm ecosystem (PostalSys) — async IMAP client, IDLE support, SASL XOAUTH2; version not independently verified
- mailparser npm ecosystem (PostalSys) — MIME parsing, encoding handling; version not independently verified
- Gmail IMAP documentation — folder naming conventions, 15-connection limit, app password requirements
- MCP SDK documentation — tool response schema, error handling conventions

### Tertiary (LOW confidence)
- Competitor feature analysis (training data through Aug 2025) — existing IMAP MCP server feature sets; needs verification against current GitHub/mcp.so state before finalizing scope

---
*Research completed: 2026-03-11*
*Ready for roadmap: yes*
