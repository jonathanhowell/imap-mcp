# IMAP MCP Server

## What This Is

An MCP server that wraps IMAP email providers, giving AI agents structured access to email. Initially built for personal use (and household members), structured for eventual public release. Agents can read, search, monitor, and summarize emails — with sending support planned for a second stage.

## Core Value

An agent can reliably read, search, and monitor email across multiple accounts so important messages are never missed.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Agent can read emails from one or more configured IMAP accounts
- [ ] Agent can search emails by sender, subject, date, and content
- [ ] Server polls for new mail in the background and surfaces recent/unread to agents
- [ ] Agent can get a unified inbox view across all configured accounts
- [ ] Agent can query a specific account by name
- [ ] Multiple IMAP accounts configurable (not hardcoded credentials)
- [ ] Agent can summarize email threads
- [ ] Works with any MCP-compatible client (Claude Desktop, custom agents, etc.)

### Out of Scope (v1)

- Sending/replying/forwarding emails — planned for v2
- Web UI or dashboard — agent interface only
- Hardcoded credentials — must be configurable from day one

## Context

- Standard IMAP protocol (RFC 3501) — compatible with Gmail, Outlook, Fastmail, and self-hosted mail servers
- MCP (Model Context Protocol) is Anthropic's standard for giving agents access to external tools and resources
- Household use case means multi-account is a real v1 requirement, not a stretch goal
- Public release goal means code quality, documentation, and configuration UX matter early
- Background polling will require some form of persistent server process or scheduled mechanism

## Constraints

- **Protocol**: IMAP only (no proprietary email APIs) — maximum compatibility across providers
- **Config**: Credentials must be externally configurable (env vars or config file) — no hardcoding
- **Compatibility**: Must work with any MCP-compliant client, not Claude-specific
- **Structure**: Code must be clean enough to open-source without embarrassment

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| IMAP over provider APIs | Works with any email provider, not just Gmail/Outlook | — Pending |
| Multi-account from v1 | Household use requires it; retrofitting is painful | — Pending |
| Phase 1: read-only | Safer starting point; sending has higher stakes | — Pending |

---
*Last updated: 2026-03-11 after initialization*
