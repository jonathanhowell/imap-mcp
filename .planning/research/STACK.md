# Stack Research

**Domain:** MCP Server wrapping IMAP email access
**Researched:** 2026-03-11
**Confidence:** MEDIUM-HIGH (MCP SDK verified via official docs; IMAP library versions from training data + npm ecosystem knowledge — imapflow version needs npm-verify before pinning)

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| TypeScript | 5.x (latest) | Primary language | Type safety critical for complex IMAP data structures and MCP schema definitions; official MCP docs show TypeScript as co-equal Tier 1 SDK alongside Python; better tooling for async email parsing workflows than Python's asyncio |
| Node.js | 22.x LTS (Jod) | Runtime | Node 22 is the current maintenance LTS as of March 2026 (24 is active LTS but 22 is widely installed); imapflow and all IMAP libraries are Node-native; async I/O model suits IMAP's connection-heavy nature |
| `@modelcontextprotocol/sdk` | latest (1.x) | MCP server framework | Official Tier 1 SDK from Anthropic/MCP project; provides `McpServer`, `StdioServerTransport`, tool/resource registration; the only correct choice — community alternatives lag behind spec |
| `imapflow` | 1.x (latest) | IMAP client | Modern async IMAP client from PostalSys (same author as Nodemailer); full IMAP4rev1 + extensions; native Promise/async-await API; supports IDLE for push notifications; actively maintained; replaces `node-imap` which is callback-based and stale |
| `zod` | 3.x | Schema validation | Official MCP TypeScript tutorial uses zod for tool input validation; pairs naturally with McpServer's type system; validates IMAP account config at startup |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `mailparser` | 3.x | Email MIME parsing | Parse raw RFC 2822 messages from IMAP into structured objects (headers, body text, HTML, attachments); imapflow returns raw bytes — mailparser turns them into usable data |
| `dotenv` | 16.x | Environment variable loading | Load per-account credentials from `.env` files; keep secrets out of code and config files checked into git |
| `vitest` | 2.x | Testing framework | Fast, native ESM support, compatible with Node 22; preferred over Jest for new TS/ESM projects in 2025+ |
| `@types/node` | 22.x | Node.js type definitions | Needed for TypeScript compilation; pin to match Node runtime version |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| TypeScript compiler (`tsc`) | Compile TS to JS for distribution | Configure `"module": "Node16"`, `"target": "ES2022"` per official MCP tutorial tsconfig |
| `tsx` or `ts-node` | Run TypeScript directly in development | `tsx` is faster and has better ESM support; use for local dev only, compile for distribution |
| MCP Inspector | Test and debug MCP server interactively | Official tool from `@modelcontextprotocol/inspector`; run via `npx @modelcontextprotocol/inspector node build/index.js`; essential for verifying tool schemas and responses without a full AI client |
| ESLint + TypeScript plugin | Linting | Public release goal means code quality matters; `@typescript-eslint/eslint-plugin` catches async pitfalls common in IMAP code |

## Transport Decision

**Use stdio transport for v1.**

Rationale from official MCP spec (verified):
- stdio transport: client spawns server as subprocess; server runs as long-lived process for the duration of the client connection
- Streamable HTTP transport: for remote multi-client servers

For an IMAP MCP server used with Claude Desktop or similar local clients, stdio is the correct and standard choice. The MCP spec explicitly states "Clients SHOULD support stdio whenever possible."

Key implication for background polling: the stdio MCP server process stays alive for the full duration of the client session. This means the server can maintain persistent IMAP connections and run a polling loop in the background using `setInterval` or IMAP IDLE — the process is not restarted per-request. Background state is possible within a session.

**Important logging rule (verified from official docs):** In stdio mode, `console.log()` writes to stdout and will corrupt the JSON-RPC message stream. Use `console.error()` for all logging, or a logger configured to write to stderr.

## Background Polling Strategy

IMAP new-mail detection has two approaches; choose based on server capability:

| Approach | How | When to Use |
|----------|-----|-------------|
| IMAP IDLE (push) | Keep an IDLE connection open; server pushes EXISTS/RECENT notifications | Preferred when the IMAP server supports IDLE (RFC 2177) — Gmail, Fastmail, Outlook all support it; zero polling overhead |
| Periodic polling (fallback) | `setInterval` every N minutes, FETCH recent UIDs | Use when IDLE is not supported, or for simpler initial implementation |

imapflow supports IDLE natively. Recommended implementation: maintain one persistent IMAP connection per account in IDLE mode; on notification, fetch new message headers; store in-memory cache for `get_recent_emails` tool responses.

The MCP server process lifetime matches the client session lifetime, so the IDLE loop runs for the life of the session. No separate daemon or cron job needed for v1.

## Configuration Strategy

**Use environment variables with a YAML/JSON config file for account definitions.**

Rationale: The PROJECT.md requirement is "no hardcoded credentials, must be externally configurable." Two-layer approach:

1. **Account config** (`~/.config/imap-mcp/accounts.json` or env var pointing to a file): defines account names, hostnames, usernames
2. **Credentials** (environment variables or OS keychain): passwords/tokens — never in config files

Pattern:
```
IMAP_MCP_CONFIG_PATH=/path/to/accounts.json
IMAP_MCP_ACCOUNT_GMAIL_PASSWORD=app-specific-password
IMAP_MCP_ACCOUNT_FASTMAIL_PASSWORD=...
```

Claude Desktop passes env vars to MCP server processes via the `env` key in `claude_desktop_config.json`.

## Installation

```bash
# Core dependencies
npm install @modelcontextprotocol/sdk imapflow mailparser zod dotenv

# Type definitions
npm install -D @types/node typescript tsx

# Testing
npm install -D vitest

# Dev/debugging
npm install -D @modelcontextprotocol/inspector
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| TypeScript | Python | Choose Python if the team is primarily Python-fluent; Python FastMCP SDK is also Tier 1 and has a nice decorator API; the difference is ecosystem, not capability |
| `imapflow` | `node-imap` | Never — node-imap is callback-based, not updated for modern async patterns, and has known issues with newer Node.js versions |
| `imapflow` | `imap-simple` | Never for new projects — imap-simple is a thin wrapper over node-imap with the same underlying staleness |
| `zod` for config | `joi` or `yup` | Only if the codebase already uses joi/yup; zod has best TS inference and is the MCP ecosystem default |
| `mailparser` | Manual MIME parsing | Never — RFC 2822 MIME parsing is extremely complex; mailparser handles encoding, attachments, multipart correctly |
| stdio transport | Streamable HTTP | Only for a future v2 remote/multi-user deployment; not for v1 local use |
| `vitest` | `jest` | Jest works fine but requires more ESM configuration for Node 22 + `"type": "module"` projects |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `node-imap` | Last meaningful update was 2019; callback-based API makes async error handling painful; doesn't handle IMAP IDLE cleanly in modern Node; known issues with TLS on Node 18+ | `imapflow` |
| `imap-simple` | Wrapper over node-imap, inherits all the same problems | `imapflow` |
| `console.log()` for logging | In stdio transport mode, stdout is the JSON-RPC channel — any `console.log()` will corrupt the protocol stream and break the server | `console.error()` or a logger targeting stderr |
| Hardcoded connection pooling limits | IMAP has per-account connection limits (typically 5-10 for Gmail); exceeding them causes auth errors | Track connection count per account; use a single connection for IDLE + open new connections only for active requests |
| HTTP+SSE transport (deprecated) | The old SSE transport from protocol version 2024-11-05 is deprecated; replaced by Streamable HTTP in 2025-11-25 | stdio (for local) or Streamable HTTP (for remote) |
| Storing raw email bodies in memory | Full email bodies can be large; caching everything causes memory growth over long sessions | Cache only headers and metadata; fetch body on demand |

## Stack Patterns by Variant

**If targeting Claude Desktop as primary client (v1 personal use):**
- Use stdio transport
- Single-process architecture; background IDLE loop runs in same process
- Config via env vars passed through Claude Desktop's `env` key
- No authentication layer needed (local process)

**If targeting remote/multi-user deployment (v2 future):**
- Switch to Streamable HTTP transport
- Add OAuth 2.1 authentication per MCP spec
- Extract background polling to separate process with IPC
- Add per-user session isolation

**If IMAP accounts require OAuth (Gmail, Outlook in 2025+):**
- imapflow supports SASL XOAUTH2 authentication
- Use `googleapis` or `@azure/msal-node` to obtain access tokens
- Store refresh tokens in OS keychain, not environment variables
- v1 can use app-specific passwords (Gmail, Fastmail both support these)

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@modelcontextprotocol/sdk` latest | Node.js 18+ | Official requirement from MCP docs; Node 22 verified compatible |
| `imapflow` 1.x | Node.js 14+ | Well within Node 22 range |
| `mailparser` 3.x | Node.js 12+ | No version concerns |
| `zod` 3.x | TypeScript 4.5+ | Requires `strictNullChecks: true`; already required by MCP SDK |
| TypeScript `"module": "Node16"` | Node.js 16+ | Required for proper `.js` extension resolution in ESM; Node 22 compatible |

## Sources

- `https://modelcontextprotocol.io/docs/develop/build-server` — TypeScript SDK package name (`@modelcontextprotocol/sdk`), installation command, McpServer/StdioServerTransport API, tsconfig pattern (HIGH confidence, official docs, verified 2026-03-11)
- `https://modelcontextprotocol.io/docs/sdk` — SDK tier listing: TypeScript and Python both Tier 1; Go and C# also Tier 1 (HIGH confidence, official docs, verified 2026-03-11)
- `https://modelcontextprotocol.io/specification/2025-11-25/basic/transports` — Transport mechanisms: stdio vs Streamable HTTP; stdio recommendation; "clients SHOULD support stdio whenever possible" (HIGH confidence, official spec, verified 2026-03-11)
- `https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle` — Server lifecycle: long-lived process model, session phases (HIGH confidence, official spec, verified 2026-03-11)
- `https://modelcontextprotocol.io/docs/learn/architecture` — MCP architecture: local stdio server is subprocess model; Streamable HTTP is for remote (HIGH confidence, official docs, verified 2026-03-11)
- `https://nodejs.org/en/about/previous-releases` — Node.js 24 is Active LTS (Krypton); Node 22 is Maintenance LTS (Jod); Node 20 also Maintenance LTS (HIGH confidence, official Node.js, verified 2026-03-11)
- `imapflow` npm ecosystem — Modern async IMAP client from PostalSys (author of Nodemailer); supports IMAP4rev1, IDLE, SASL XOAUTH2; active maintenance; callback-based `node-imap` is the legacy alternative (MEDIUM confidence — version number not independently verified via npm due to tool restrictions; verify `npm view imapflow version` before pinning)
- `mailparser` npm ecosystem — Standard MIME email parsing for Node.js; part of PostalSys ecosystem alongside imapflow; compatible pairing (MEDIUM confidence — version not independently verified)

---
*Stack research for: IMAP MCP Server (MCP server wrapping IMAP email access)*
*Researched: 2026-03-11*
