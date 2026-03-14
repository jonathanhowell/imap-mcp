---
phase: 05-background-polling
plan: "04"
subsystem: api
tags: [imap, mcp, polling, background-polling, integration, typescript]

# Dependency graph
requires:
  - phase: 05-02
    provides: Poller class with start/stop/isCacheReady/query; AppConfigSchema with polling.interval_seconds
  - phase: 05-03
    provides: GET_NEW_MAIL_TOOL schema and handleGetNewMail handler

provides:
  - src/index.ts wired with Poller lifecycle (start after connectAll, stop before closeAll)
  - get_new_mail tool registered in TOOLS array and dispatched in switch router
  - Phase 5 integration complete — background polling loop live in server

affects:
  - All future phases that read src/index.ts (tool registration pattern established)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Poller lifecycle pattern: instantiate after connectAll(), start() before shutdown handler, stop() as first shutdown action
    - Tool registration pattern: import tool constant and handler, add to TOOLS array, add case in switch router
    - config.polling?.interval_seconds ?? 300 default for polling interval

key-files:
  created: []
  modified:
    - src/index.ts

key-decisions:
  - "Poller instantiated with config.polling?.interval_seconds ?? 300 — uses optional chaining for absent polling config block"
  - "poller.stop() called before manager.closeAll() in shutdown — prevents setTimeout re-entry during connection teardown"
  - "Poller.start() called before shutdown handler registration — sequencing ensures first poll begins before signal handlers are registered"

patterns-established:
  - "Integration seam pattern: plans 02+03 build the parts, plan 04 wires them into index.ts — separation of concerns between building and wiring"

requirements-completed: [POLL-01, POLL-02, POLL-03]

# Metrics
duration: 2min
completed: 2026-03-14
---

# Phase 5 Plan 04: Integration Wiring Summary

**Poller lifecycle and get_new_mail tool wired into src/index.ts — background polling loop and new MCP tool live in running server**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-14T13:51:23Z
- **Completed:** 2026-03-14T13:52:43Z
- **Tasks:** 1 (+ human-verify checkpoint)
- **Files modified:** 1

## Accomplishments

- Added `Poller` and `GET_NEW_MAIL_TOOL`/`handleGetNewMail` imports to src/index.ts
- Added `GET_NEW_MAIL_TOOL` to the TOOLS array (tool now appears in tools/list responses)
- Instantiated Poller after `connectAll()` with `config.polling?.interval_seconds ?? 300`
- Called `poller.start()` before shutdown handler (correct startup sequence)
- Updated shutdown to call `poller.stop()` before `manager.closeAll()` (safe teardown)
- Added `case "get_new_mail"` in switch router dispatching to `handleGetNewMail(params, poller)`
- Build succeeds, all 135 tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire Poller and get_new_mail into src/index.ts** - `1462742` (feat(05-04): wire Poller and get_new_mail into src/index.ts)

## Files Created/Modified

- `src/index.ts` — Added Poller+get_new_mail imports, GET_NEW_MAIL_TOOL in TOOLS array, Poller instantiation+start+stop wiring, `case "get_new_mail"` in switch router

## Decisions Made

- Followed plan exactly — four targeted changes as specified (imports, TOOLS array, Poller instantiation/start/stop, switch case)
- No structural changes needed; existing patterns (tool registration, switch router) applied directly

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 5 is complete: test scaffolds (05-01), Poller class (05-02), get_new_mail handler (05-03), and index.ts wiring (05-04) all done
- The server now runs a background polling loop starting 5 seconds after startup
- get_new_mail tool is registered and accessible via MCP tools/list and tools/call
- All 135 tests pass; TypeScript build clean
- Requirements POLL-01, POLL-02, POLL-03 satisfied

---
*Phase: 05-background-polling*
*Completed: 2026-03-14*

## Self-Check: PASSED

- FOUND: src/index.ts
- FOUND: .planning/phases/05-background-polling/05-04-SUMMARY.md
- FOUND: commit 1462742 (feat(05-04): wire Poller and get_new_mail into src/index.ts)
- All 135 tests pass (npm test)
- TypeScript build clean (npm run build)
