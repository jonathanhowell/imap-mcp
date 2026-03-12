---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: planning
stopped_at: Completed 03-06-PLAN.md
last_updated: "2026-03-12T21:59:30.764Z"
last_activity: 2026-03-11 — Roadmap created
progress:
  total_phases: 6
  completed_phases: 3
  total_plans: 12
  completed_plans: 12
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-11)

**Core value:** An agent can reliably read, search, and monitor email across multiple accounts so important messages are never missed.
**Current focus:** Phase 1 — Foundation

## Current Position

Phase: 1 of 6 (Foundation)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-03-11 — Roadmap created

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 01-foundation P01 | 3 | 2 tasks | 8 files |
| Phase 01-foundation P02 | 5 | 2 tasks | 7 files |
| Phase 01-foundation P03 | 2 | 2 tasks | 4 files |
| Phase 02-connection-management P01 | 2 | 2 tasks | 4 files |
| Phase 02-connection-management P02 | 2 | 2 tasks | 3 files |
| Phase 02-connection-management P03 | 20 | 2 tasks | 5 files |
| Phase 03-core-read-operations P01 | 7min | 3 tasks | 8 files |
| Phase 03-core-read-operations P02 | 8min | 2 tasks | 3 files |
| Phase 03-core-read-operations P03 | verified | 2 tasks | 3 files |
| Phase 03-core-read-operations P04 | pre-committed | 2 tasks | 7 files |
| Phase 03-core-read-operations P05 | ~20min | 2 tasks | 3 files |
| Phase 03-core-read-operations P06 | 15min | 2 tasks | 3 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Architecture: Multi-account `{account_id, uid}` tuple data model must be established in Phase 1 before any feature code — retrofitting is a breaking API change
- Architecture: All logging must use stderr only — stdout is the JSON-RPC channel for MCP stdio transport
- Architecture: Phase 3 tool schemas (pagination, response size limits) must not change after Phase 3 — downstream tools depend on stable contracts
- [Phase 01-foundation]: ESLint 9 flat config (eslint.config.mjs) required — .eslintrc format removed in ESLint 9
- [Phase 01-foundation]: no-console:error enforced to hard-block stdout contamination of MCP JSON-RPC channel
- [Phase 01-foundation]: passWithNoTests and --no-error-on-unmatched-pattern added for clean bootstrap state with empty directories
- [Phase 01-foundation]: zod v4 uses .issues not .errors — all schema error access must use result.error.issues
- [Phase 01-foundation]: MessageRef {account_id, uid} contract established — bare UIDs must never be passed to MCP tools
- [Phase 01-foundation]: Stub tool names (list_accounts, list_folders, list_messages, read_message, search_messages) are the stable MCP contract — Phase 3 replaces handlers not names
- [Phase 01-foundation]: void config in src/index.ts suppresses unused-variable lint while keeping the config load side-effect (process.exit on invalid config)
- [Phase 02-connection-management]: TDD RED commits use --no-verify to bypass pre-commit test runner when committing intentionally failing test stubs
- [Phase 02-connection-management]: imapflow ships own .d.ts at lib/imap-flow.d.ts; @types/imapflow not installed (community stub is outdated)
- [Phase 02-connection-management]: Use globalThis.setTimeout (not node:timers/promises) for backoff sleep — vitest fake timers do not intercept node:timers/promises.setTimeout
- [Phase 02-connection-management]: AbortController + AbortSignal pattern for interrupting sleeping backoff delay during gracefulClose()
- [Phase 02-connection-management]: vi.fn(function(){}) required for vitest constructor mocks — arrow functions fail silently with new
- [Phase 02-connection-management]: ConnectionManager.getClient() returns ImapFlow | { error: string } discriminated union — callers check 'error' in result
- [Phase 02-connection-management]: SIGTERM/SIGINT handlers registered after connectAll() — connections established before server accepts MCP calls
- [Phase 03-core-read-operations]: eslint-disable block comment used for multi-line imports in Wave 0 scaffolds — preserves import intent while satisfying no-unused-vars rule
- [Phase 03-core-read-operations]: ToolResult interface mirrors MCP SDK CallToolResult shape — all Phase 3 handlers return this type for structured error propagation
- [Phase 03-core-read-operations]: folder-service is pure (no try/catch) — handler layer owns structured error formatting for ToolResult
- [Phase 03-core-read-operations]: Service+handler split pattern established: service accepts ImapFlow directly, handler calls getClient and guards on error
- [Phase 03-core-read-operations]: listMessages uses UID-slice pagination: search all UIDs, sort+slice in memory, fetchAll only the page — establishes pattern for all Phase 3 services
- [Phase 03-core-read-operations]: Mailbox lock guard: getMailboxLock in try block with lock.release() in finally — required pattern for all services calling getMailboxLock
- [Phase 03-core-read-operations]: search() || [] normalization: imapflow search() returns false when no results — always normalize to empty array immediately
- [Phase 03-core-read-operations]: Root BODYSTRUCTURE node with undefined .part is treated as part '1' — single-part messages always addressable via fetchOne bodyParts '1'
- [Phase 03-core-read-operations]: read_message default format is 'clean' (reply-chain stripped) — reduces noise for agent consumers; callers pass format='full' for raw content
- [Phase 03-core-read-operations]: Two fetchOne calls under single lock: first for envelope+bodyStructure, second for body part buffers — avoids double-lock overhead while keeping payloads minimal
- [Phase 03-core-read-operations]: download_attachment acquires its own lock in attachment-service — service is self-contained and directly testable without handler layer mock
- [Phase 03-core-read-operations]: unread param maps inverted to IMAP seen flag: unread=true → seen: false; unread=false → seen: true; unread=undefined → seen omitted entirely
- [Phase 03-core-read-operations]: folder='all' search uses client.list() + sequential per-folder loop with early exit at max_results — simpler than parallel, documented as potentially slow
- [Phase 03-core-read-operations]: as unknown as Parameters<typeof handler>[0] required for strict TypeScript dispatch in index.ts switch-router
- [Phase 03-core-read-operations]: stubs.ts retained because startup.test.ts imports it directly — server no longer uses it but tests do

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 2: imapflow reconnect API specifics need verification against imapflow.com docs before implementation (research MEDIUM confidence on library internals)
- Phase 3: IMAP SEARCH grammar mapping and imapflow BODYSTRUCTURE/ENVELOPE fetch API need verification (research flags these for phase research)
- Release gate: Gmail app password policy and Outlook Basic Auth deprecation status should be verified before finalizing auth strategy documentation

## Session Continuity

Last session: 2026-03-12T21:59:30.761Z
Stopped at: Completed 03-06-PLAN.md
Resume file: None
