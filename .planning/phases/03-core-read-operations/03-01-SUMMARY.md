---
phase: 03-core-read-operations
plan: 01
subsystem: testing
tags: [html-to-text, email-reply-parser, typescript, vitest, wave-0]

# Dependency graph
requires:
  - phase: 02-connection-management
    provides: ConnectionManager.getClient() returning ImapFlow | { error: string }
provides:
  - "html-to-text and email-reply-parser installed in node_modules"
  - "7 Phase 3 response types exported from src/types.ts (FolderEntry, MessageHeader, SearchResultItem, AttachmentMeta, MessageBody, AttachmentDownload, ToolResult)"
  - "6 Wave 0 test scaffold files covering all 16 Phase 3 requirements"
affects: [03-02, 03-03, 03-04, 03-05, 03-06]

# Tech tracking
tech-stack:
  added:
    - html-to-text ^9.0.5 (HTML to plain text conversion)
    - email-reply-parser ^2.3.5 (reply chain stripping, ships own types)
    - "@types/html-to-text ^9.0.4 (devDependency)"
  patterns:
    - "Wave 0 scaffold pattern: import-only test files with it.todo() stubs create stable test contracts before implementations"
    - "eslint-disable block pattern for intentionally unused Wave 0 scaffold imports"

key-files:
  created:
    - tests/tools/list-folders.test.ts
    - tests/tools/list-messages.test.ts
    - tests/tools/read-message.test.ts
    - tests/tools/download-attachment.test.ts
    - tests/tools/search-messages.test.ts
    - tests/services/body-service.test.ts
  modified:
    - src/types.ts (7 new Phase 3 types appended)
    - package.json (3 new dependencies)

key-decisions:
  - "eslint-disable block comment used for multi-line import suppression when eslint-disable-next-line cannot span multiline destructuring"
  - "Wave 0 scaffold imports use eslint-disable to keep import intent visible while avoiding no-unused-vars errors on todo-only test files"

patterns-established:
  - "Wave 0 scaffold: test files import not-yet-existing handlers to create compile-time contract; all cases are it.todo() until plan 03-02+ creates implementations"
  - "ToolResult interface mirrors MCP SDK CallToolResult shape — used as return type for all Phase 3 tool handlers"

requirements-completed: [MAIL-01, MAIL-02, MAIL-03, LIST-01, LIST-02, LIST-03, LIST-04, READ-01, READ-02, READ-03, READ-04, READ-05, SRCH-01, SRCH-02, SRCH-03, SRCH-04]

# Metrics
duration: 7min
completed: 2026-03-12
---

# Phase 3 Plan 01: Dependencies, Types, and Wave 0 Test Scaffolds Summary

**html-to-text and email-reply-parser installed, 7 strict Phase 3 response types defined in src/types.ts, and 41 todo stubs in 6 test scaffold files covering all 16 Phase 3 requirements**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-03-12T13:43:00Z
- **Completed:** 2026-03-12T13:48:35Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments
- Installed html-to-text (HTML stripping) and email-reply-parser (reply chain stripping) with full type coverage
- Defined 7 strict TypeScript interfaces covering all Phase 3 tool handler return shapes (no `any`, no optional where values are always present)
- Created 6 Wave 0 test scaffold files with 41 `it.todo()` stubs — every Phase 3 requirement has a named test waiting for implementation

## Task Commits

Each task was committed atomically:

1. **Task 1: Install html-to-text and email-reply-parser** - `7edad96` (chore)
2. **Task 2: Add Phase 3 response types to src/types.ts** - `f48aba9` (feat)
3. **Task 3: Create failing test scaffolds (Wave 0)** - `305ccf0` (test)

## Files Created/Modified
- `package.json` - Added html-to-text, email-reply-parser, @types/html-to-text
- `package-lock.json` - Updated lockfile for 15 new packages
- `src/types.ts` - 7 new Phase 3 types appended (FolderEntry, MessageHeader, SearchResultItem, AttachmentMeta, MessageBody, AttachmentDownload, ToolResult)
- `tests/tools/list-folders.test.ts` - Wave 0 scaffold for MAIL-01, MAIL-02
- `tests/tools/list-messages.test.ts` - Wave 0 scaffold for MAIL-03, LIST-01 through LIST-04
- `tests/tools/read-message.test.ts` - Wave 0 scaffold for READ-01, READ-02
- `tests/tools/download-attachment.test.ts` - Wave 0 scaffold for READ-05
- `tests/tools/search-messages.test.ts` - Wave 0 scaffold for SRCH-01 through SRCH-04
- `tests/services/body-service.test.ts` - Wave 0 scaffold for READ-03, READ-04

## Decisions Made
- Used `/* eslint-disable */` block comment (not `eslint-disable-next-line`) for multi-line destructured imports to suppress no-unused-vars on scaffold files where all tests are `it.todo()`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added eslint-disable comments to scaffold imports**
- **Found during:** Task 3 (Wave 0 test scaffold creation)
- **Issue:** ESLint pre-commit hook blocked commit because scaffold imports are unused (all tests are it.todo()). The plan did not mention this lint constraint.
- **Fix:** Added `// eslint-disable-next-line @typescript-eslint/no-unused-vars` before single-line imports; used `/* eslint-disable */ ... /* eslint-enable */` block for multi-line destructured import in body-service.test.ts
- **Files modified:** All 6 scaffold test files
- **Verification:** `npx eslint tests/` exits clean; pre-commit hook passes
- **Committed in:** 305ccf0 (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking lint error)
**Impact on plan:** Minimal — the fix preserves the import intent (visible contract with future implementation files) while satisfying project lint rules. No scope creep.

## Issues Encountered
- ESLint `no-unused-vars` blocked the Task 3 commit because scaffold imports are inherently unused until plan 03-02+ creates implementations. Resolved with targeted disable comments rather than disabling the rule project-wide.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All Phase 3 type contracts are locked in `src/types.ts` — plans 03-02 through 03-05 import these without modification
- All test scaffold files are in place — each plan only needs to provide implementations that make their corresponding `it.todo()` stubs go GREEN
- No blockers for plan 03-02 (list-folders and list-messages implementation)

---
*Phase: 03-core-read-operations*
*Completed: 2026-03-12*

## Self-Check: PASSED

- src/types.ts: FOUND
- tests/tools/list-folders.test.ts: FOUND
- tests/tools/list-messages.test.ts: FOUND
- tests/tools/read-message.test.ts: FOUND
- tests/tools/download-attachment.test.ts: FOUND
- tests/tools/search-messages.test.ts: FOUND
- tests/services/body-service.test.ts: FOUND
- Commit 7edad96: FOUND
- Commit f48aba9: FOUND
- Commit 305ccf0: FOUND
