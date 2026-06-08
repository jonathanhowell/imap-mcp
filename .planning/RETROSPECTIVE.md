# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v0.1.0 — IMAP MCP v0.1

**Shipped:** 2026-03-15
**Phases:** 6 | **Plans:** 23

### What Was Built
- 7 MCP tools: `list_accounts`, `list_folders`, `list_messages`, `read_message`, `search_messages`, `download_attachment`, `get_new_mail`
- Persistent per-account IMAP connections with exponential backoff reconnect and per-account error isolation
- Background polling loop with in-memory header cache (3 min default); agents query cache instead of issuing IMAP round-trips
- Multi-account fan-out with merged/sorted unified inbox and partial-error responses
- 200-result server-side hard cap preventing agent context overflow
- gitleaks clean history, pre-commit credential guard, full README + MIT LICENSE

### What Worked
- Bottom-up phase ordering (config → connections → tools → multi-account → polling → hardening) meant each phase had a stable foundation and almost no rework
- TDD RED→GREEN pattern across phases kept implementation honest and caught edge cases early
- Keeping stdout clean (stderr-only logger enforced by ESLint `no-console`) was set up in Phase 1 and paid dividends throughout — zero MCP protocol corruption issues
- `{account_id, uid}` data model established in Phase 1 made multi-account fan-out in Phase 4 straightforward — no retrofitting needed
- Wave-based parallel plan execution within phases kept execution fast

### What Was Inefficient
- imapflow mock fidelity required careful setup; some test phases needed extra mock work beyond the happy path
- Phase 5 (background polling) required revisiting the connection manager interface slightly to expose what the poller needed — could have been anticipated in Phase 2

### Patterns Established
- ESLint `no-console` as error from day one — prevents stdout contamination across all future phases
- `fanOutAccounts` helper pattern for multi-account operations — clean, testable, reusable
- Lock guard pattern (`getMailboxLock` in try/finally) for all IMAP mailbox operations
- `search() || []` normalization for imapflow's false-return edge case

### Key Lessons
1. Setting credential hygiene constraints (TLS enforcement, stderr-only, no-console) in Phase 1 is zero-cost and high-value — do this first on every project
2. The `{account_id, uid}` data model decision was load-bearing — any ambiguity here would have caused expensive rework in Phase 4
3. 200-result cap should have been in Phase 3 scope, not Phase 6 — adding it retroactively required updating two handlers and their tests

### Cost Observations
- Model mix: sonnet for all agents (balanced profile)
- Sessions: ~6 sessions across 4 days
- Notable: wave-based parallel execution within phases (e.g., Phase 6 Wave 2 ran 06-02 + 06-03 in parallel) measurably reduced wall-clock time

---

## Milestone: v0.2 — Agent UX

**Shipped:** 2026-06-08
**Phases:** 6 (7–11.1) | **Plans:** 12 | **Tasks:** 19

### What Was Built
- **Header enrichment** — `to`/`cc` recipient arrays on every `list_messages`/`search_messages` response, plus `from` formatted as `Name <addr>` via a shared `formatAddress` helper
- **Account context** — `list_accounts` returns `email` (username fallback) and optional `display_name` via a new `ConnectionManager.getConfig()` surface
- **Ergonomics** — `list_messages.folder` defaults to INBOX (`?? "INBOX"` applied once in the handler before fan-out vs. single-account branching)
- **Batch reads** — new `read_messages` tool: one metadata round-trip via `client.fetch(uids.join(","))`, per-UID body downloads, partial-success error entries, hard cap 50 UIDs
- **Body search** — `search_messages.body` threaded through both fan-out and single-account paths, using imapflow's native `{ body: "text" }` for server-side IMAP `SEARCH BODY`
- **Filename attachments** — `download_attachment.filename` resolves to `part_id` via a bodyStructure scan, with the bodyStructure lock released in `finally` before the nested download lock
- **Keyword tagging** — `flag_message`/`unflag_message` set/clear custom IMAP keywords; `PERMANENTFLAGS \*` warning-only on legacy servers (KFLAG-04); `search_messages`/`get_new_mail` `exclude_keywords` (array) + `search_messages.include_keywords` (array, OR semantics), with server-side `NOT KEYWORD` for the first exclusion + in-memory fallback for additional terms
- **Cache fidelity** — poller cache stores per-message custom keywords (filtered from flags Set, excluding `\`-prefixed system flags); `Poller.removeKeyword` keeps cache fresh for `unflag_message` without waiting for the next poll cycle
- **Hotfix** — inline `text/calendar` and other text MIME parts surface as downloadable attachments (260331-fus)

### What Worked
- Phase ordering driven by dependency graph (`HDR` → `ACTX` → `BATCH`/`SRCH` in parallel → `KFLAG`) matched the real coupling and avoided rework
- The `formatAddress` helper extracted in Phase 7 was a small, well-scoped abstraction that made `Name <addr>` rendering consistent across the listing tools
- Hard cap of 50 UIDs on `read_messages` placed BEFORE `getClient()` — no IMAP interaction on bad requests, fail-fast
- TDD Wave 0 scaffold (`it.todo` stubs) in Phase 9 let the failing test file be committed without breaking the pre-commit suite — RED phase without infrastructure pain
- Mid-milestone hotfix (`exclude_keyword` → `exclude_keywords`/`include_keywords` arrays) was applied cleanly because the API surface was already isolated in handlers — no cascading changes
- Phase 11.1 (`unflag_message`) inserted as decimal phase after Phase 11 — preserved sequencing without renumbering
- The milestone audit (`/gsd:audit-milestone`) caught zero requirement gaps and surfaced two real tech-debt items before they could compound

### What Was Inefficient
- VALIDATION.md sign-off was skipped on all 5 audited phases — `nyquist_compliant: false` / `wave_0_complete: false` in frontmatter even though VERIFICATION.md scored 100%. The validation step needs to be enforced or de-prioritized, not silently skipped
- `from` is built as a bare address in `read_messages` (Phase 9) and pre-existing `read_message` — the `formatAddress` helper from Phase 7 wasn't applied here. Should have been a cross-phase check during Phase 9 planning
- Two SUMMARY.md files (10-02, 07-02) had malformed `**One-liner:**` placement that broke `summary-extract` regex extraction — caused noisy auto-generated MILESTONES.md entry that had to be manually rewritten
- The audit was completed BEFORE Phase 11.1 and KFLAG-05 hotfix landed — audit timing should follow the last code change, not precede it

### Patterns Established
- **Decimal phase insertion** (Phase 11 → 11.1) for urgent direct counterparts to just-shipped tools — proved cleaner than retrofitting Phase 11 scope
- **Hard caps before IMAP interaction** (`if (uids.length > 50) throw`) as a fail-fast pattern for any batch tool
- **Warning-only capability checks** (`PERMANENTFLAGS \*`) — don't block the user on legacy servers, log a warning and continue
- **Nested-lock pattern** — release outer lock in `finally` before calling another tool that acquires its own lock (avoided in `download_attachment` by filename)
- **In-memory fallback for array params** when underlying protocol only supports one of the terms (one `NOT KEYWORD` server-side + filter the rest in memory)
- **Case-insensitive keyword comparison** in caches and filters — defensive against server-side normalization
- **Conditional spread for optional fields** (`...(displayName && { display_name: displayName })`) — key absent from JSON when not configured, not `null`/`undefined`

### Key Lessons
1. **Apply newly-extracted helpers everywhere they belong, not just in the phase that creates them.** `formatAddress` was added in Phase 7 but never applied to `read_message`/`read_messages` — visible as a shape inconsistency, deferred as tech debt.
2. **Run the milestone audit AFTER the final code change, not before.** Decimal phases and hotfixes landed post-audit and weren't validated by the same gate.
3. **Plan VALIDATION.md sign-off into Wave 0 or skip the artifact.** Half-checked validation files are worse than no validation files — VERIFICATION.md already covered actual coverage.
4. **`summary-extract` regex assumes a specific `**One-liner:** content` format on the same line.** Plan templates should enforce this so MILESTONES.md auto-generation doesn't need manual cleanup.

### Cost Observations
- Model mix: sonnet for executor, opus for planner (balanced profile, unchanged from v0.1)
- Sessions: ~7 sessions across 17 calendar days (much more spread out than v0.1's 4-day sprint)
- Notable: parallel plan execution within Phase 9 (Wave 0 scaffold + Wave 1 implementation) ran sequentially due to TDD dependency — but Plans 10-01 / 10-02 within Phase 10 were independent and could have parallelized further

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Days | Notes |
|-----------|--------|-------|------|-------|
| v0.1.0 | 6 | 23 | 4 | Initial build, bottom-up architecture |
| v0.2 | 6 (incl. 1 decimal) | 12 | 17 | Tool enrichment + write-surface (keywords); decimal-phase insertion validated |
