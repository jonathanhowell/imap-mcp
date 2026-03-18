---
phase: 11-keyword-flagging
plan: "01"
subsystem: api
tags: [imap, imapflow, keyword-flagging, mcp-tool]

requires:
  - phase: 10-search-and-attachment-ux
    provides: download_attachment tool pattern and ConnectionManager getClient usage

provides:
  - flag_message MCP tool with PERMANENTFLAGS warning
  - keywords?: string[] field on MessageHeader
  - handleFlagMessage handler using messageFlagsAdd with uid:true
  - 7 unit tests covering success, errors, folder param, and KFLAG-04 warning behavior

affects:
  - 11-keyword-flagging (plan 02 onwards — list_messages returning keywords field)

tech-stack:
  added: []
  patterns:
    - "getMailboxLock/try/finally/lock.release() for all IMAP write operations"
    - "client.mailbox?.permanentFlags?.has() checked after lock acquisition"

key-files:
  created:
    - src/tools/flag-message.ts
    - tests/tools/flag-message.test.ts
  modified:
    - src/types.ts
    - src/index.ts

key-decisions:
  - "messageFlagsAdd([uid], [keyword], { uid: true }) — single UID wrapped in array; uid:true option for UID-mode STORE"
  - "PERMANENTFLAGS check uses client.mailbox?.permanentFlags?.has() after lock because mailbox property is only valid post-lock"
  - "Warning does NOT fail the call — KFLAG-04 specifies warn-only behavior so agents see success even on servers without custom keyword support"
  - "client.mailbox can be false (no mailbox open) so conditional chain client.mailbox && client.mailbox.permanentFlags?.has() prevents TS errors"

patterns-established:
  - "flag_message follows the same write-tool pattern as download_attachment: getClient check, getMailboxLock, try/catch/finally"

requirements-completed:
  - KFLAG-01
  - KFLAG-04

duration: 8min
completed: 2026-03-18
---

# Phase 11 Plan 01: flag_message Tool Summary

**flag_message MCP tool that sets custom IMAP keywords via messageFlagsAdd with PERMANENTFLAGS warning and 7 passing unit tests**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-18T12:05:00Z
- **Completed:** 2026-03-18T12:13:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created flag_message tool with FLAG_MESSAGE_TOOL definition and handleFlagMessage handler
- Added keywords?: string[] to MessageHeader in src/types.ts enabling future keyword surfacing
- KFLAG-04: PERMANENTFLAGS warning fires when server lacks \\* but does not fail the operation
- Registered tool in index.ts (import, TOOLS array, switch case)
- 7 test cases pass covering success, getClient error, messageFlagsAdd throw, custom folder, default folder, warning absent/present

## Task Commits

Each task was committed atomically:

1. **Task 1: Add keywords field to MessageHeader and create flag_message tool** - `86c9026` (feat)
2. **Task 2: Register flag_message in index.ts and write unit tests** - `2c7483d` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/tools/flag-message.ts` - FLAG_MESSAGE_TOOL definition and handleFlagMessage handler
- `tests/tools/flag-message.test.ts` - 7 unit tests covering all specified scenarios
- `src/types.ts` - keywords?: string[] added to MessageHeader interface
- `src/index.ts` - flag_message tool registered (import, TOOLS array, switch case)

## Decisions Made
- messageFlagsAdd([uid], [keyword], { uid: true }) — imapflow idiomatic API; bare number not valid for range parameter
- PERMANENTFLAGS check placed inside the lock because client.mailbox is only valid after getMailboxLock acquires
- client.mailbox can be false (pre-open) so used client.mailbox && client.mailbox.permanentFlags?.has() to satisfy TypeScript
- Warning-only on PERMANENTFLAGS absence — plan explicitly says warn but do NOT fail

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript error on client.mailbox.permanentFlags access**
- **Found during:** Task 1 verification (npx tsc --noEmit)
- **Issue:** client.mailbox is typed as `false | MailboxObject` in imapflow; direct .permanentFlags access caused TS2339
- **Fix:** Added null guard `client.mailbox && client.mailbox.permanentFlags?.has("\\*")` with optional chaining
- **Files modified:** src/tools/flag-message.ts
- **Verification:** npx tsc --noEmit exits 0
- **Committed in:** 86c9026 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 TypeScript type bug)
**Impact on plan:** Necessary for type correctness; behavior unchanged — runtime guard prevents false-positive warning when mailbox not yet open.

## Issues Encountered
- imapflow types: client.mailbox is `false | MailboxObject` (not always MailboxObject) — required null guard before permanentFlags access

## Next Phase Readiness
- flag_message tool complete and registered; agents can now call it to mark messages as processed
- Plan 02 can proceed to surface keywords field in list_messages responses

---
*Phase: 11-keyword-flagging*
*Completed: 2026-03-18*
