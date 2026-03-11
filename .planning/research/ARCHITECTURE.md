# Architecture Research

**Domain:** IMAP-backed MCP Server (multi-account email access for AI agents)
**Researched:** 2026-03-11
**Confidence:** HIGH (MCP patterns from official docs); MEDIUM (IMAP library patterns from training + library docs)

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        MCP Host (Claude Desktop, custom agents)   │
│                        MCP Client (one per server)               │
└───────────────────────────────┬──────────────────────────────────┘
                                │ stdio (JSON-RPC 2.0)
┌───────────────────────────────▼──────────────────────────────────┐
│                        MCP Layer                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  McpServer (index.ts)                                     │    │
│  │  - server.registerTool() for each tool                    │    │
│  │  - StdioServerTransport                                   │    │
│  └──────────────────────┬───────────────────────────────────┘    │
└─────────────────────────┼────────────────────────────────────────┘
                          │ function calls
┌─────────────────────────▼────────────────────────────────────────┐
│                        Service Layer                              │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────────┐    │
│  │ EmailService   │  │ SearchService  │  │  PollerService   │    │
│  │ (read/fetch)   │  │ (query/filter) │  │  (background)    │    │
│  └───────┬────────┘  └───────┬────────┘  └────────┬─────────┘    │
└──────────┼───────────────────┼─────────────────────┼─────────────┘
           │                   │                     │
┌──────────▼───────────────────▼─────────────────────▼─────────────┐
│                        IMAP Layer                                  │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │  ConnectionManager                                       │     │
│  │  - Map<accountName, ImapFlow>                            │     │
│  │  - connect / reconnect / healthcheck                     │     │
│  └──────────────┬──────────────────────────────────────────┘     │
└─────────────────┼──────────────────────────────────────────────── ┘
                  │ IMAP over TLS
┌─────────────────▼──────────────────────────────────────────────── ┐
│                        Config Layer                                │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  ConfigManager                                            │    │
│  │  - Load accounts from env / config file                   │    │
│  │  - Validate credentials at startup                        │    │
│  │  - Expose typed AccountConfig[]                           │    │
│  └──────────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────────┘

External: Gmail IMAP, Fastmail IMAP, Outlook IMAP, self-hosted servers
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| `McpServer` / `index.ts` | Register tools, connect stdio transport, bootstrap all services | Single entry point, `@modelcontextprotocol/sdk` `McpServer` |
| `ConfigManager` | Load, parse, and validate multi-account config from env or JSON | Reads `IMAP_ACCOUNTS` env var or `~/.config/imap-mcp/config.json` |
| `ConnectionManager` | Own one `ImapFlow` instance per account, manage connect/reconnect | `Map<string, ImapFlow>`, lazy-connect or eager-connect at startup |
| `EmailService` | Fetch messages, list folders, get thread content | Wraps IMAP FETCH/SELECT operations |
| `SearchService` | Execute IMAP SEARCH queries with criteria mapping | Translates tool params → IMAP SEARCH grammar |
| `PollerService` | Periodically check for new/unread mail; maintain in-memory cache | `setInterval` or IMAP IDLE per connection |
| `MessageCache` | In-memory store of recent messages per account to serve fast reads | Simple Map with TTL or LRU eviction |
| Tool handlers | Thin adapter: parse Zod-validated input → call service → format response | Each tool is a `server.registerTool()` call |

---

## Recommended Project Structure

```
src/
├── index.ts                  # Entry point: create McpServer, wire tools, start transport
├── config/
│   ├── types.ts              # AccountConfig, ServerConfig interfaces
│   └── config-manager.ts     # Load + validate accounts from env/file
├── imap/
│   ├── connection-manager.ts # Lifecycle: connect, reconnect, getClient(accountName)
│   └── imap-errors.ts        # Typed IMAP error classes
├── services/
│   ├── email-service.ts      # fetch message, get thread, list folders
│   ├── search-service.ts     # build and execute IMAP SEARCH queries
│   └── poller-service.ts     # background poll, cache refresh, new-mail detection
├── cache/
│   └── message-cache.ts      # In-memory recent-messages store per account
├── tools/
│   ├── definitions.ts        # Zod schemas + descriptions for each tool
│   ├── read-email.ts         # Tool: fetch a specific message by UID
│   ├── list-messages.ts      # Tool: list inbox / folder messages
│   ├── search-email.ts       # Tool: search by sender/subject/date/content
│   ├── get-thread.ts         # Tool: fetch full thread by thread ID
│   ├── get-unread.ts         # Tool: surface recent unread across all accounts
│   └── list-accounts.ts      # Tool: list configured account names
└── utils/
    ├── message-formatter.ts  # Convert raw IMAP message → structured text for agent
    └── logger.ts             # stderr-only logger (stdout corrupts JSON-RPC)
```

### Structure Rationale

- **`config/`:** Isolated early; nothing else starts without valid config. Easy to unit-test in isolation.
- **`imap/`:** Connection lifecycle is its own concern — errors here (TLS, auth, timeout) are distinct from business logic errors.
- **`services/`:** Business logic lives here. Services call `ConnectionManager.getClient()`, not IMAP directly. Makes testing possible by swapping the connection manager.
- **`tools/`:** Each tool is its own file. Registration in `index.ts` imports them. Keeps `index.ts` short. `definitions.ts` colocates Zod schemas so input validation is next to tool descriptions.
- **`cache/`:** Separated from services so the poller and query tools share the same cache without circular imports.
- **`utils/`:** Logger must enforce stderr-only (CRITICAL: `console.log` on stdout breaks JSON-RPC in stdio mode).

---

## Architectural Patterns

### Pattern 1: Lazy IMAP Connection with Eager Validation

**What:** Validate credentials at startup, but defer opening IMAP TCP connections until first tool call for that account.
**When to use:** Default approach — fails fast on bad config without opening idle connections to every account before any agent requests them.
**Trade-offs:** First call to a cold account has latency (~200–500ms for TLS handshake + AUTH). Subsequent calls reuse the open connection.

```typescript
// connection-manager.ts
export class ConnectionManager {
  private clients = new Map<string, ImapFlow>();

  async getClient(accountName: string): Promise<ImapFlow> {
    if (!this.clients.has(accountName)) {
      const config = this.configManager.getAccount(accountName);
      const client = new ImapFlow({ host: config.host, auth: config.auth, ... });
      await client.connect();
      this.clients.set(accountName, client);
    }
    return this.clients.get(accountName)!;
  }
}
```

### Pattern 2: Tool as Thin Adapter

**What:** Each tool handler validates input (Zod), calls a service method, and formats the result as text. No business logic in the handler.
**When to use:** Always. Keeps tool handlers testable and replaceable. Services can be called from tests without the MCP layer.
**Trade-offs:** Adds indirection (tool → service → connection manager → IMAP). Worth it for any project with >3 tools.

```typescript
// tools/search-email.ts
server.registerTool(
  "search_email",
  {
    description: "Search emails by sender, subject, date, or content",
    inputSchema: {
      account: z.string().optional().describe("Account name, or omit for all accounts"),
      from: z.string().optional(),
      subject: z.string().optional(),
      since: z.string().optional().describe("ISO date string"),
      body: z.string().optional(),
      limit: z.number().default(20),
    },
  },
  async (params) => {
    const results = await searchService.search(params);
    return { content: [{ type: "text", text: formatSearchResults(results) }] };
  }
);
```

### Pattern 3: Polling Cache Over IMAP IDLE

**What:** A background `setInterval` pings each account every N minutes to fetch unread/recent messages into an in-memory cache. Tool calls read from cache first (fast), falling back to live IMAP when needed.
**When to use:** v1. IMAP IDLE (push notifications) requires a persistent IMAP connection per account held open — more complex to manage with reconnect logic. Polling every 2–5 minutes is sufficient for the "never miss important messages" use case.
**Trade-offs:** Polling adds latency (up to N minutes for new mail to appear). IDLE is more responsive but significantly more complex (must pause on same connection used for commands, handle IDLE timeout renewal every 29 minutes per RFC). Polling is the right v1 choice; IDLE is a v2 optimization.

```typescript
// services/poller-service.ts
export class PollerService {
  private intervalId?: NodeJS.Timer;

  start(intervalMs = 3 * 60 * 1000) {
    this.intervalId = setInterval(() => this.poll(), intervalMs);
    this.poll(); // immediate first run
  }

  private async poll() {
    for (const accountName of this.configManager.getAccountNames()) {
      const client = await this.connectionManager.getClient(accountName);
      const messages = await this.emailService.fetchRecent(client, { unseen: true, limit: 50 });
      this.cache.set(accountName, messages);
    }
  }
}
```

### Pattern 4: Multi-Account Unified View via Fan-out

**What:** Tools that operate across all accounts fan out to each account in parallel, merge results, and sort before returning.
**When to use:** `get_unread`, `search_email` (when no account specified). Parallel fetch keeps latency bounded by the slowest single account rather than sum of all.
**Trade-offs:** Errors in one account should not block results from others — use `Promise.allSettled` not `Promise.all`.

```typescript
// Fan-out pattern in services
async searchAll(params: SearchParams): Promise<Message[]> {
  const accounts = this.configManager.getAccountNames();
  const results = await Promise.allSettled(
    accounts.map(name => this.searchAccount(name, params))
  );
  return results
    .filter(r => r.status === "fulfilled")
    .flatMap(r => (r as PromiseFulfilledResult<Message[]>).value)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
}
```

---

## Data Flow

### Request Flow: `search_email` Tool Call

```
MCP Client (Claude Desktop)
    │  tools/call { name: "search_email", arguments: {from: "boss@co.com"} }
    ▼
McpServer (index.ts)
    │  Zod validates input
    ▼
SearchService.search(params)
    │  check MessageCache first (fast path for recent mail)
    │  cache miss → build IMAP SEARCH criteria
    ▼
ConnectionManager.getClient("personal")
    │  return open ImapFlow connection (or connect if cold)
    ▼
ImapFlow.search([["FROM", "boss@co.com"]])
    │  returns UID list
    ▼
ImapFlow.fetchAll(uids, { envelope: true, bodyStructure: true })
    │  returns raw IMAP message objects
    ▼
MessageFormatter.format(rawMessages)
    │  convert IMAP envelope → structured { from, subject, date, preview }
    ▼
SearchService → tool handler
    │  return { content: [{ type: "text", text: formattedResults }] }
    ▼
McpServer → StdioServerTransport → stdout (JSON-RPC response)
    ▼
MCP Client receives result
```

### Request Flow: Background Poller → `get_unread` Tool

```
PollerService (setInterval, every 3 min)
    │  for each account → EmailService.fetchRecent()
    ▼
MessageCache.set(accountName, messages[])
                    ↑
                    │ (pre-populated)
MCP Client calls get_unread
    │
    ▼
Tool handler → MessageCache.getAll()   ← fast, no IMAP round-trip
    │  merge + sort across accounts
    ▼
Return formatted unread list
```

### Config Load Flow (startup)

```
process.env.IMAP_ACCOUNTS  (or config file path)
    ▼
ConfigManager.load()
    │  parse + validate with Zod
    │  throw hard error on invalid config (server does not start)
    ▼
AccountConfig[] passed to ConnectionManager, PollerService
    ▼
PollerService.start() → first poll immediately
    ▼
McpServer.connect(StdioServerTransport) — ready for tool calls
```

---

## Component Boundaries

| Boundary | Communication | Rule |
|----------|---------------|------|
| Tool handlers ↔ Services | Direct function call | Tools never import `ImapFlow` directly |
| Services ↔ ConnectionManager | `getClient(name): Promise<ImapFlow>` | Services never call `connect()`/`logout()` |
| Services ↔ Cache | Direct read/write | Poller writes; query tools read |
| PollerService ↔ EmailService | EmailService called by Poller | Poller does not do IMAP directly |
| ConfigManager ↔ everything | Read-only after startup | Nothing modifies config at runtime |
| Logger ↔ everything | Singleton, writes to stderr only | Never use `console.log` anywhere |

---

## Multi-Account Handling

### Account identification

Every tool that is account-specific accepts an optional `account` parameter (string name matching config). When omitted, the tool operates across all accounts (fan-out pattern).

### Connection isolation

Each account gets its own `ImapFlow` instance. IMAP connections are not shared across accounts — IMAP is stateful (current mailbox selection is per-connection).

### Naming convention

Account names come from config (e.g., `"personal"`, `"work"`, `"household"`). These names appear in tool responses so the agent can distinguish sources. Tool descriptions explicitly document the `account` parameter.

### Error isolation

A broken connection to one account must not crash the server. Each `getClient()` call wraps reconnect logic. Each fan-out uses `Promise.allSettled`. Errors are logged to stderr and the affected account is skipped in results (with a note in the response text).

---

## Background Polling Architecture

```
startup
   │
   ▼
PollerService.start(intervalMs)
   │  ┌─────────────────────────────────────────────────────┐
   │  │  poll()                                              │
   │  │    for each account (sequential to avoid IMAP flood) │
   │  │      getClient(account)                              │
   │  │      SELECT INBOX                                    │
   │  │      SEARCH UNSEEN (+ RECENT)                        │
   │  │      FETCH envelopes for matched UIDs                │
   │  │      cache.set(account, messages)                    │
   │  └─────────────────────────────────────────────────────┘
   │  (repeat every N minutes)
```

Key decisions:
- **Sequential per-account polling** (not parallel) to avoid opening multiple simultaneous IMAP operations on the same server — most IMAP servers handle this fine but some (Gmail) have rate limits
- **Poll INBOX only by default** — most important mail lands in INBOX; multi-folder polling is a v2 option
- **Cache TTL** — cache entries expire after 2x the poll interval so stale data is never served indefinitely
- **Reconnect on poll failure** — if a poll fails (connection dropped), call `client.logout()` + remove from map; next `getClient()` will reconnect

---

## How MCP Tools Map to IMAP Operations

| MCP Tool | IMAP Operations | Notes |
|----------|----------------|-------|
| `list_accounts` | None (config-only) | Returns account names from ConfigManager |
| `list_messages` | SELECT mailbox, SEARCH ALL/UNSEEN, FETCH envelopes | Paginated by UID range |
| `get_unread` | Served from cache (poller pre-fetched) | Falls back to live SEARCH UNSEEN |
| `search_email` | SEARCH with FROM/SUBJECT/SINCE/TEXT criteria | Maps tool params to IMAP SEARCH keys |
| `read_email` | SELECT mailbox, FETCH by UID (body[text], envelope, flags) | Returns full body; marks as seen |
| `get_thread` | SEARCH REFERENCES header match, FETCH each message | Thread reconstruction from In-Reply-To/References headers |

---

## Suggested Build Order (Component Dependencies)

```
1. ConfigManager           ← no dependencies, needed by everything
2. ConnectionManager       ← depends on ConfigManager
3. MessageCache            ← no dependencies
4. EmailService            ← depends on ConnectionManager
5. SearchService           ← depends on ConnectionManager, EmailService
6. MessageFormatter        ← no dependencies (pure functions)
7. PollerService           ← depends on ConnectionManager, EmailService, MessageCache
8. Tool definitions (Zod)  ← no runtime dependencies
9. Tool handlers           ← depend on all services
10. index.ts / McpServer   ← wires everything, starts transport
```

This order lets each component be built and tested independently before integration. The MCP server (`index.ts`) is the last thing assembled — it's thin glue.

---

## Scaling Considerations

This server runs as a local stdio process (one instance per MCP host session). Scale is measured in accounts × messages, not concurrent users.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1–5 accounts, household use | In-memory cache, in-process poller. No changes needed. |
| 10–20 accounts | Add connection pooling limits (max N open IMAP connections). Sequential polling is still fine. |
| Public release (many users) | Each user runs their own instance locally. Server-side deployment would require HTTP transport + auth, persistent storage (SQLite or similar) instead of in-memory cache, and IMAP IDLE instead of polling. |

### Scaling priorities for current scope (household)

1. **First bottleneck:** IMAP connection limit per provider (Gmail: ~15 concurrent IMAP sessions per account). Mitigation: reuse connections, never open multiple connections to the same account.
2. **Second bottleneck:** Memory — large attachments in cache. Mitigation: cache only envelopes/headers in poller; fetch full body on-demand only.

---

## Anti-Patterns

### Anti-Pattern 1: Direct IMAP calls in tool handlers

**What people do:** Import `ImapFlow` directly in tool handler files and open connections there.
**Why it's wrong:** Connection lifecycle is unmanaged (no reconnect, no reuse). Each tool invocation opens a new TCP+TLS handshake. Logic is untestable without real IMAP.
**Do this instead:** All IMAP access goes through `ConnectionManager.getClient()`. Tool handlers call services.

### Anti-Pattern 2: `console.log` anywhere in the codebase

**What people do:** Use `console.log` for debugging during development, leave it in.
**Why it's wrong:** The MCP stdio transport reads stdout. Any `console.log` output corrupts the JSON-RPC stream and causes the MCP host to drop the connection silently.
**Do this instead:** Use only `console.error()` (writes to stderr). Create a `logger.ts` utility that enforces this. Add a linting rule to ban `console.log`.

### Anti-Pattern 3: Hardcoding credentials

**What people do:** Put IMAP host, username, password directly in source code for initial testing.
**Why it's wrong:** Violates the stated constraint. Can't be open-sourced. Breaks multi-user / multi-account use.
**Do this instead:** `ConfigManager` loads from env vars (`IMAP_ACCOUNTS`) or config file from the first line of code. No credentials ever touch source files.

### Anti-Pattern 4: Fetching full message bodies in the poller

**What people do:** Pre-fetch complete email bodies (including attachments) during background polling to have them ready.
**Why it's wrong:** Large attachments can exhaust memory quickly. Most cached messages are never read by the agent.
**Do this instead:** Poller fetches only envelope data (from, to, subject, date, size, flags). Full body is fetched on-demand only when `read_email` is called with a specific UID.

### Anti-Pattern 5: Using `Promise.all` for multi-account fan-out

**What people do:** `await Promise.all(accounts.map(search))` — if one account's IMAP connection is broken, the whole call throws.
**Why it's wrong:** A misconfigured or temporarily unavailable account blocks results from working accounts.
**Do this instead:** `Promise.allSettled` + filter fulfilled results + include warning text about failed accounts in the response.

### Anti-Pattern 6: Opening a new IMAP connection per tool call

**What people do:** `connect()` at the start of every tool handler, `logout()` at the end.
**Why it's wrong:** IMAP over TLS takes 200–500ms to establish. Many IMAP providers rate-limit new connection attempts (Gmail limits to a few per minute per IP). Sequential reads feel slow.
**Do this instead:** `ConnectionManager` keeps connections open between calls. Reconnect only on error.

---

## Integration Points

### External Services (IMAP Providers)

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Gmail | IMAP over TLS port 993 | Requires App Password (or OAuth2 for v2). `PLAIN` auth with App Password is simplest for v1. |
| Fastmail | IMAP over TLS port 993 | Standard IMAP, no quirks. App passwords supported. |
| Outlook/Hotmail | IMAP over TLS port 993 | OAuth2 only for new connections since 2023; Basic auth deprecated. Flag as HIGH-RISK for v1 scope. |
| Self-hosted (Dovecot, etc.) | IMAP over TLS port 993 | Most permissive. Plain IMAP (port 143) also supported for local use. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `index.ts` ↔ tool files | Import + `server.registerTool()` | `index.ts` imports each tool registration function |
| `PollerService` ↔ `MessageCache` | Write on poll | Race condition if tool reads while poll writes; use simple lock or accept minor inconsistency |
| `ConfigManager` ↔ `ConnectionManager` | `AccountConfig[]` passed at construction | No circular dependency |

---

## Sources

- MCP Architecture overview (official): https://modelcontextprotocol.io/docs/concepts/architecture — HIGH confidence
- MCP TypeScript server tutorial (official): https://modelcontextprotocol.io/docs/develop/build-server — HIGH confidence
- `@modelcontextprotocol/sdk` TypeScript API: `McpServer`, `StdioServerTransport`, `server.registerTool()` — HIGH confidence
- IMAP RFC 3501 (IMAP4rev1) — standard protocol operations, SEARCH grammar, IDLE extension (RFC 2177) — HIGH confidence
- ImapFlow library patterns (training data + npm README) — MEDIUM confidence (verify ImapFlow API at https://imapflow.com before implementation)
- Gmail IMAP auth requirements (App Passwords vs OAuth2) — MEDIUM confidence (verify current Gmail policy; OAuth2 requirement has evolved)
- Outlook IMAP Basic Auth deprecation — MEDIUM confidence (verify current Microsoft policy; flagged as risk)

---
*Architecture research for: IMAP-backed MCP Server*
*Researched: 2026-03-11*
