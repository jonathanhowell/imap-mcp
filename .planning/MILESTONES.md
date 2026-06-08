# Milestones

## v0.2 Agent UX (Shipped: 2026-06-08)

**Phases completed:** 6 phases (7–11.1), 12 plans, 19 tasks
**Timeline:** 2026-03-14 → 2026-03-31 (17 days)
**Git range:** v0.1.0..HEAD (93 commits, 163 files, +13,145/-449)

**Delivered:** Reduced agent round-trips and enriched tool responses with the context that LLM personal assistants need to act without guessing.

**Key accomplishments:**

- **Header enrichment (Phase 7)** — `list_messages` and `search_messages` now return `to`/`cc` recipient arrays for every message; `from` formatted as `Name <addr>` via shared `formatAddress` helper
- **Account context & ergonomics (Phase 8)** — `list_accounts` returns `email` (username fallback) and optional `display_name`; `list_messages.folder` defaults to `INBOX`, eliminating boilerplate from every agent inbox call
- **Batch reads (Phase 9)** — New `read_messages` tool batch-fetches full bodies for up to 50 UIDs in one IMAP round-trip, with partial-success error entries and the same `format`/`max_chars` options as `read_message`
- **Body search & filename attachments (Phase 10)** — `search_messages` accepts `body` for native IMAP `SEARCH BODY`; `download_attachment` accepts `filename` so agents can fetch by name without first calling `read_message` to discover part IDs
- **Keyword flagging (Phase 11 + 11.1)** — `flag_message` / `unflag_message` tools set and clear custom IMAP keywords (e.g. `ClaudeProcessed`) with PERMANENTFLAGS capability check; `search_messages` and `get_new_mail` accept `exclude_keywords` and `include_keywords` array filters (server-side `NOT KEYWORD` + in-memory fallback for additional terms); `keywords` array surfaced on all message-listing tool responses
- **Inline-attachment surfacing (hotfix 260331-fus)** — Inline `text/calendar` and other text MIME parts now appear as downloadable attachments

**Decimal Phases:**

- Phase 11.1: unflag_message tool (inserted after Phase 11 — direct counterpart to flag_message)

**Tech debt deferred to v0.3+:**

- `read_messages` and pre-existing `read_message` (singular) build `from` as a bare address rather than via the `formatAddress` helper — inconsistent with `list_messages`/`search_messages` shape for senders with display names
- All 5 phase VALIDATION.md files remain in `draft` status with `nyquist_compliant: false` / `wave_0_complete: false`; actual test coverage is confirmed green by VERIFICATION.md (100% scores) — backfill with `/gsd:validate-phase` per phase

---

## v0.1.0 IMAP MCP v0.1 (Shipped: 2026-03-15)

**Phases completed:** 6 phases, 23 plans, 0 tasks

**Key accomplishments:**

- (none recorded)

---
