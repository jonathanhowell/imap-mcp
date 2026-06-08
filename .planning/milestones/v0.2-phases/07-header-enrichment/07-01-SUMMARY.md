---
phase: 07-header-enrichment
plan: 01
subsystem: api
tags: [imap, typescript, envelope, message-headers, imapflow]

# Dependency graph
requires:
  - phase: 03-core-read-operations
    provides: listMessages and searchMessages service functions using MessageHeader type
  - phase: 04-multi-account-unified-view
    provides: MultiAccountMessageHeader and MultiAccountSearchResultItem that extend MessageHeader
provides:
  - MessageHeader type with required to and cc string array fields
  - formatAddress helper in message-service.ts for Name <addr> formatting
  - formatAddress helper in search-service.ts for Name <addr> formatting
  - Both service mapping closures populate to and cc from envelope data
affects: [07-02, 08-account-info, 09-read-messages, 10-download-attachment]

# Tech tracking
tech-stack:
  added: []
  patterns: [formatAddress helper for IMAP envelope address formatting, type guard filter for defined addresses]

key-files:
  created: []
  modified:
    - src/types.ts
    - src/services/message-service.ts
    - src/services/search-service.ts

key-decisions:
  - "formatAddress returns Name <addr> when both fields present, bare address when name absent, empty string when address undefined"
  - "to and cc are required (non-optional) fields on MessageHeader to guarantee arrays in all responses"
  - "Filter uses type guard predicate (e): e is { name?: string; address: string } to narrow before map"

patterns-established:
  - "formatAddress pattern: module-level helper function before exported service function"
  - "Address array mapping: filter for defined address then map through formatAddress"

requirements-completed: [HDR-01, HDR-02]

# Metrics
duration: 6min
completed: 2026-03-15
---

# Phase 7 Plan 01: Header Enrichment — Type and Service Updates Summary

**MessageHeader enriched with required `to: string[]` and `cc: string[]` fields; both service mapping closures updated to populate recipient arrays and format `from` using `Name <addr>` pattern via `formatAddress` helper**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-03-15T22:07:53Z
- **Completed:** 2026-03-15T22:13:00Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Added `to: string[]` and `cc: string[]` as required fields on `MessageHeader` in `src/types.ts`; downstream interfaces (`SearchResultItem`, `MultiAccountMessageHeader`, `MultiAccountSearchResultItem`) inherit fields automatically
- Added `formatAddress` helper to `message-service.ts` and updated `listMessages` mapping closure to populate `from`, `to`, and `cc` from envelope data without additional IMAP round-trips
- Added `formatAddress` helper to `search-service.ts` and updated `searchFolder` mapping closure to populate `from`, `to`, and `cc`; `folder` field preserved on `SearchResultItem`
- `npx tsc --noEmit` passes with zero errors after all three changes

## Task Commits

Each task was committed atomically:

1. **Task 1: Add to/cc to MessageHeader type** - `70e9d77` (feat)
2. **Task 2: Update message-service.ts mapping closure** - `0b8223e` (feat)
3. **Task 3: Update search-service.ts mapping closure** - `648e640` (feat)

## Files Created/Modified
- `src/types.ts` - Added `to: string[]` and `cc: string[]` required fields to `MessageHeader` interface
- `src/services/message-service.ts` - Added `formatAddress` helper; updated `listMessages` mapping to use it for `from`, `to`, `cc`
- `src/services/search-service.ts` - Added `formatAddress` helper; updated `searchFolder` mapping to use it for `from`, `to`, `cc`

## Decisions Made
- `to` and `cc` are required (non-optional) to guarantee every API response always includes arrays — callers never need to guard against undefined
- `formatAddress` returns `"Name <addr>"` when both fields present, bare address when name absent, empty string when address is undefined — consistent with IMAP envelope semantics
- Type guard predicate `(e): e is { name?: string; address: string }` used in filter before map to satisfy TypeScript type narrowing without casting

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All source files compile cleanly; test files will show TypeScript errors until plan 07-02 updates test fixtures to include `to` and `cc` fields
- `formatAddress` pattern established and ready to be referenced in any future service updates

## Self-Check

- [x] `src/types.ts` contains `to: string[]` and `cc: string[]` in `MessageHeader`
- [x] `src/services/message-service.ts` contains `formatAddress` (4 references: definition + from, to map, cc map)
- [x] `src/services/search-service.ts` contains `formatAddress` (4 references: definition + from, to map, cc map)
- [x] Commits `70e9d77`, `0b8223e`, `648e640` exist in git log
- [x] `npx tsc --noEmit` passes with zero errors

## Self-Check: PASSED

---
*Phase: 07-header-enrichment*
*Completed: 2026-03-15*
