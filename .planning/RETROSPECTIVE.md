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

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Days | Notes |
|-----------|--------|-------|------|-------|
| v0.1.0 | 6 | 23 | 4 | Initial build, bottom-up architecture |
