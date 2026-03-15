# IMAP MCP Server

## What This Is

An MCP server that wraps IMAP email providers, giving AI agents structured, normalized access to email across multiple accounts. Read-only v0.1 shipped with 7 MCP tools covering folder navigation, paginated message listing, full message reads, header-only search, attachment inspection/download, and background new-mail detection. Sending/replying is planned for v0.2.

## Core Value

An agent can reliably read, search, and monitor email across multiple accounts so important messages are never missed.

## Requirements

### Validated

- ✓ Agent can read emails from one or more configured IMAP accounts — v0.1.0
- ✓ Agent can search emails by sender, subject, date, and read/unread status — v0.1.0
- ✓ Server polls for new mail in the background and surfaces recent/unread to agents — v0.1.0
- ✓ Agent can get a unified inbox view across all configured accounts — v0.1.0
- ✓ Agent can query a specific account by name — v0.1.0
- ✓ Multiple IMAP accounts configurable (not hardcoded credentials) — v0.1.0
- ✓ Works with any MCP-compatible client (Claude Desktop, custom agents, etc.) — v0.1.0

### Active

- [ ] Agent can summarize email threads
- [ ] Agent can send/reply/forward emails
- [ ] Agent can mark messages as read/unread
- [ ] Agent can move/delete messages

### Out of Scope

- Web UI or dashboard — agent interface only
- Hardcoded credentials — must be configurable from day one
- Proprietary email APIs (Gmail API, MS Graph) — IMAP-only for maximum compatibility

## Context

Shipped v0.1.0 with ~4,700 LOC TypeScript across 23 plans in 6 phases (4 days).
Tech stack: Node.js ESM, TypeScript strict, imapflow, @modelcontextprotocol/sdk, Zod, Vitest.
142 passing tests. gitleaks clean (111 commits audited). MIT licensed.

Notable: Outlook/Microsoft is deprecating Basic Auth for IMAP — documented in README with warning.
Background polling default is 3 min (configurable); header cache avoids IMAP round-trips on agent queries.

## Constraints

- **Protocol**: IMAP only (no proprietary email APIs) — maximum compatibility across providers
- **Config**: Credentials must be externally configurable (env vars or config file) — no hardcoding
- **Compatibility**: Must work with any MCP-compliant client, not Claude-specific
- **Structure**: Code must be clean enough to open-source without embarrassment

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| IMAP over provider APIs | Works with any email provider, not just Gmail/Outlook | ✓ Good — broad compat confirmed |
| Multi-account from v1 | Household use requires it; retrofitting is painful | ✓ Good — fanOut pattern clean |
| Phase 1: read-only | Safer starting point; sending has higher stakes | ✓ Good — solid foundation |
| imapflow library | Active maintenance, TypeScript support | ✓ Good — reliable in tests |
| `{account_id, uid}` data model | Globally unique message ref across accounts | ✓ Good — no collisions |
| 200-result hard cap | Prevents context overflow in agent responses | ✓ Good — enforced server-side |
| stderr-only logging | Prevents stdout contamination of MCP JSON-RPC | ✓ Good — no protocol corruption |
| Exponential backoff reconnect | Handles transient drops without crashing | ✓ Good — isolated per-account |

---
*Last updated: 2026-03-15 after v0.1.0 milestone*
