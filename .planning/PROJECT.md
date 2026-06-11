# IMAP MCP Server

## Current State

**Shipped:** v0.2 Agent UX (2026-06-08)
**Active:** v0.3 Reliability & Cache Rethink (started 2026-06-08) — Phase 12 (Connection Resilience Foundation) implementation complete (2026-06-11), pending real-network human UAT

Production-ready MCP server wrapping IMAP email providers. Agents get structured, normalized access across multiple accounts with the context they need to act without extra round-trips. v0.2 added rich message metadata (to/cc, display names, custom keywords), batch reads, body search, and a keyword-tagging system for tracking which messages an agent has already processed.

## Current Milestone: v0.3 Reliability & Cache Rethink

**Goal:** Make IMAP accounts self-heal from transient failures and reconsider whether the polling/cache architecture is the right pattern for "what's new" queries.

**Target features:**
- Account auto-recovery from network drops without server restart (unbounded backoff retry)
- Transient vs fatal failure classification (auth/permanent stays failed; network/server drops keep retrying)
- Per-account health exposed to agents (status + last-error reason, queryable)
- Cache architecture rethink — research-driven decision on what `get_new_mail` and the poller cache should be (keep / replace / hybrid)

**Key context:**
- Focused milestone — no write ops, no SMTP, no thread summarization (deferred)
- The network-drop bug (accounts permanently fail after laptop sleep / Wi-Fi change) is treated as a symptom of a broader resilience gap, not a one-off fix
- Cache direction stays open until domain research surfaces the right pattern
- Phase numbering continues from v0.2 (next phase = **Phase 12**)

## What This Is

An MCP server that wraps IMAP email providers, giving AI agents structured access to email across multiple accounts. Twelve MCP tools cover folder navigation, paginated message listing, batch and single-message reads, header + body search, attachment inspection/download (by `part_id` or `filename`), background new-mail detection, and custom-keyword tagging (set/clear/filter) so agents can mark messages as processed. Read-mostly with limited write surface (custom IMAP keywords only); inline `text/calendar` MIME parts surface as downloadable attachments. Sending, replies, and message moves remain planned for v0.3+.

## Core Value

An agent can reliably read, search, monitor, and tag email across multiple accounts — with the context it needs to act without guessing or re-fetching.

## Requirements

### Validated

- ✓ Agent can read emails from one or more configured IMAP accounts — v0.1.0
- ✓ Agent can search emails by sender, subject, date, and read/unread status — v0.1.0
- ✓ Server polls for new mail in the background and surfaces recent/unread to agents — v0.1.0
- ✓ Agent can get a unified inbox view across all configured accounts — v0.1.0
- ✓ Agent can query a specific account by name — v0.1.0
- ✓ Multiple IMAP accounts configurable (not hardcoded credentials) — v0.1.0
- ✓ Works with any MCP-compatible client (Claude Desktop, custom agents, etc.) — v0.1.0
- ✓ Agent receives rich message metadata (to/cc arrays, account display name/email, custom keywords) without extra calls — v0.2
- ✓ Agent can batch-fetch multiple full message bodies in one call (up to 50 UIDs) — v0.2
- ✓ Agent can search messages by body text content (server-side IMAP BODY) — v0.2
- ✓ Agent can tag messages with custom IMAP keywords to track processing state, with set/clear/filter — v0.2
- ✓ Agent can download attachments by filename without first calling `read_message` for part IDs — v0.2
- ✓ `list_messages.folder` defaults to INBOX, eliminating boilerplate from inbox calls — v0.2
- ✓ Accounts auto-recover from transient network failures without server restart (unbounded jittered backoff) — v0.3 Phase 12 *(substrate verified; awaits real-network human UAT)*
- ✓ Server distinguishes transient vs fatal account failures via pure-function classifier; fatal → suspended fast-path, transient → retry loop — v0.3 Phase 12 *(substrate verified; awaits real-network human UAT)*

### Active

**v0.3 milestone scope:**
- [ ] Agents can query per-account health (connection status + last-error reason)
- [ ] `get_new_mail` and poller cache architecture rethought based on domain research

**Deferred to later milestones:**
- [ ] Agent can mark messages as read/unread (standard `\Seen` flag)
- [ ] Agent can send / reply / forward emails (SMTP integration)
- [ ] Agent can move messages between folders
- [ ] Agent can delete or archive messages
- [ ] Agent can summarize email threads (requires THREAD-extension handling)

### Out of Scope

- Web UI or dashboard — agent interface only
- Hardcoded credentials — must remain externally configurable
- Proprietary email APIs (Gmail API, MS Graph) — IMAP-only for maximum compatibility
- Thread / conversation grouping — requires IMAP THREAD extension, not universally supported

## Context

Shipped v0.2 adds ~2,700 LOC of TypeScript on top of v0.1's ~4,700 (totals ≈7,400 in `src/`) across 12 plans in 6 phases over 17 days.
Tech stack: Node.js ESM, TypeScript strict, `imapflow`, `@modelcontextprotocol/sdk`, Zod, Vitest.
Twelve MCP tools (was seven in v0.1). Test suite green; v0.2 added ~7 new keyword tests plus full coverage for batch reads, body search, and filename attachments.
Outlook/Microsoft Basic Auth deprecation still relevant — documented in README. Background polling default 3 min (configurable); poller cache now stores per-message custom IMAP keywords so server-side `NOT KEYWORD` filtering and in-memory fallback both work against fresh state.

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
| `imapflow` library | Active maintenance, TypeScript support | ✓ Good — reliable in v0.1 and v0.2 |
| `{account_id, uid}` data model | Globally unique message ref across accounts | ✓ Good — no collisions |
| 200-result hard cap | Prevents context overflow in agent responses | ✓ Good — enforced server-side |
| stderr-only logging | Prevents stdout contamination of MCP JSON-RPC | ✓ Good — no protocol corruption |
| Exponential backoff reconnect | Handles transient drops without crashing | ✓ Good — isolated per-account |
| `formatAddress(name, addr)` helper for `Name <addr>` rendering | Consistent display across `list_messages`/`search_messages` for senders with display names | ✓ Good — applied in Phase 7; ⚠ Revisit: not yet applied to `read_message`/`read_messages` (tech debt) |
| `read_messages` as new tool, not a replacement for `read_message` | Singular call stays simple for one-off reads; batch tool covers multi-UID workflow | ✓ Good — both ship side by side |
| Batch read: one metadata fetch + per-UID body downloads, hard cap 50 UIDs | Single round-trip for headers keeps latency low; cap prevents pathological requests | ✓ Good — partial-success error entries handle missing UIDs |
| Body search uses imapflow native `{ body: "text" }` (server-side) | Avoids client-side body scanning over potentially huge mailboxes | ✓ Good — performant on test accounts |
| Custom IMAP keywords (e.g. `ClaudeProcessed`) for "agent has handled this" | Persists across sessions on the IMAP server itself — no local state required | ✓ Good — supported by Gmail, Fastmail, dovecot |
| `PERMANENTFLAGS \*` warning (no hard fail) when server rejects custom keywords | Users on legacy servers (some Exchange) still get the tool; warning prevents silent loss | ✓ Good — KFLAG-04 satisfied |
| Server-side `NOT KEYWORD` for first exclusion + in-memory filter for additional exclusions/inclusions | IMAP search only supports one NOT KEYWORD per query; in-memory fallback keeps array semantics | ✓ Good — array params in `exclude_keywords`/`include_keywords` |
| Case-insensitive keyword comparison in poller cache | Some IMAP servers normalize keyword case; agent-facing API should be tolerant | ✓ Good — Phase 11 |
| Poller cache stores per-message custom keywords (filtered from flags Set, excluding `\`-prefixed system flags) | Allows `get_new_mail` to filter by keyword without re-fetching | ✓ Good — Phase 11; `Poller.removeKeyword` keeps cache fresh for `unflag_message` (Phase 11.1) |
| `download_attachment(filename)` releases the `bodyStructure` lock before nested call | Avoids the nested-lock pitfall in imapflow's mailbox lock model | ✓ Good — Phase 10 |
| `exclude_keyword` (singular) → `exclude_keywords` (array) hotfix mid-milestone, plus new `include_keywords` | Real-world agent use surfaced need for multi-keyword filtering with OR semantics | ✓ Good — applied as in-place hotfix before milestone ship |

## Tech Debt (carried into v0.3)

- `read_messages` and pre-existing `read_message` (singular) construct `from` as a bare address rather than via the shared `formatAddress` helper — inconsistent shape vs `list_messages`/`search_messages` for senders with display names. Fix is one-line per tool.
- All 5 v0.2 phase VALIDATION.md files remain in `draft` status with `nyquist_compliant: false` and `wave_0_complete: false` — sign-off checklist never completed even though VERIFICATION.md scores are 100% across the board. Backfill with `/gsd:validate-phase` per phase if Nyquist tracking is needed for v0.3.

## Future Milestones

After v0.3, likely candidates (deferred from v0.2 or v0.3 scoping):

- Write operations (`\Seen` toggle, move, delete) — major surface, high stakes
- SMTP send / reply / forward
- Thread / conversation summarization
- Address `from` formatting tech debt (`read_message[s]`) if not folded into a v0.3 phase

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

<details>
<summary>Archived: v0.1.0 launch context</summary>

Shipped v0.1.0 with ~4,700 LOC TypeScript across 23 plans in 6 phases (4 days). Initial scope: 7 read-only MCP tools (folder list/select, paginated messages, full read, header search, attachment inspect/download, background new-mail). 142 passing tests at ship. gitleaks clean (111 commits audited). MIT licensed.

Outlook/Microsoft began deprecating Basic Auth for IMAP — documented in README. Background polling default 3 min (configurable); header cache avoids IMAP round-trips on agent queries.

</details>

---
*Last updated: 2026-06-11 — Phase 12 (Connection Resilience Foundation) complete*
