---
phase: 08-account-context-and-tool-ergonomics
plan: 01
subsystem: api
tags: [imap, zod, connection-manager, list-accounts, account-config]

# Dependency graph
requires:
  - phase: 02-connection-management
    provides: ConnectionManager class with getStatus/getAccountIds methods
  - phase: 01-foundation
    provides: AccountSchema and AppConfigSchema via zod
provides:
  - AccountSchema with optional email field (z.string().optional())
  - ConnectionManager.getConfig() returning AccountConfig | undefined
  - list_accounts response enriched with email (username fallback) and conditional display_name
affects:
  - 09-read-messages
  - 10-attachment-download

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Conditional object spread for optional response keys (absent vs undefined)
    - Config map mirroring connections map in ConnectionManager
    - Username fallback pattern for email display

key-files:
  created:
    - tests/tools/list-accounts.test.ts
  modified:
    - src/config/schema.ts
    - src/connections/connection-manager.ts
    - src/tools/list-accounts.ts
    - tests/config.test.ts
    - tests/connections/connection-manager.test.ts

key-decisions:
  - "email falls back to username when email not set in config so every account entry always has an email field"
  - "display_name uses conditional spread so the key is absent from JSON when not configured, not null or undefined"
  - "ConnectionManager stores a private configs Map populated alongside connections in constructor"

patterns-established:
  - "Conditional spread pattern: ...(cfg?.display_name ? { display_name: cfg.display_name } : {}) keeps absent fields out of JSON"
  - "Config retrieval via getConfig(accountId) mirrors existing getStatus(accountId) pattern"

requirements-completed: [ACTX-01, ACTX-02]

# Metrics
duration: 2min
completed: 2026-03-16
---

# Phase 8 Plan 01: Account Context and Tool Ergonomics Summary

**list_accounts enriched with email (username fallback) and conditional display_name via new getConfig() on ConnectionManager and optional email field on AccountSchema**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-16T07:53:21Z
- **Completed:** 2026-03-16T07:55:37Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Added `email: z.string().optional()` to AccountSchema; AccountConfig type gains the field automatically via z.infer
- Added private `configs` Map to ConnectionManager populated in constructor; exposed via `getConfig(accountId)` public method
- Enriched `handleListAccounts` to include `email` (cfg.email ?? cfg.username fallback) and conditionally spread `display_name` so the key is entirely absent when not configured
- Created full test suite for list_accounts covering all five connection states and ACTX-01/ACTX-02 requirements

## Task Commits

Each task was committed atomically:

1. **Task 1: Add email field to AccountSchema and getConfig() to ConnectionManager** - `be0a596` (feat)
2. **Task 2: Enrich handleListAccounts with email and conditional display_name** - `3541c51` (feat)

_Note: TDD tasks - each task went RED then GREEN before commit_

## Files Created/Modified

- `src/config/schema.ts` - Added `email: z.string().optional()` field to AccountSchema
- `src/connections/connection-manager.ts` - Added `configs` Map, populated in constructor, exposed via `getConfig()` method
- `src/tools/list-accounts.ts` - Calls `getConfig()`, builds `email` with username fallback, conditionally spreads `display_name`
- `tests/config.test.ts` - Added "email field on AccountSchema" describe block with two tests
- `tests/connections/connection-manager.test.ts` - Added "ConnectionManager.getConfig()" describe block with two tests
- `tests/tools/list-accounts.test.ts` - New file with ACTX-01 and ACTX-02 test suites (9 tests)

## Decisions Made

- email falls back to username when email not set in config so every account entry always has an email field regardless of config
- display_name uses conditional spread `...(cfg?.display_name ? { display_name: cfg.display_name } : {})` so the key is absent from JSON when not configured (not null, not undefined-present)
- ConnectionManager stores a private `configs` Map populated alongside `connections` in constructor — no additional query overhead

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- list_accounts now returns `email` and optional `display_name` on every account entry in all connection states
- Agents can identify accounts by email address without additional round-trips
- ConnectionManager.getConfig() available for any future tool needing account config details
- Ready for Phase 9 (read_messages tool) and Phase 10 (attachment download)

## Self-Check: PASSED

All files found. All commits verified.

---
*Phase: 08-account-context-and-tool-ergonomics*
*Completed: 2026-03-16*
