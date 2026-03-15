---
phase: 07-header-enrichment
plan: 02
subsystem: tests
tags: [tests, hdr-01, hdr-02, list-messages, search-messages, multi-account]
dependency_graph:
  requires: [07-01]
  provides: [test-coverage-hdr-01, test-coverage-hdr-02]
  affects: [tests/tools/list-messages.test.ts, tests/tools/search-messages.test.ts, tests/tools/multi-account-types.test.ts]
tech_stack:
  added: []
  patterns: [tdd-green, mock-envelope-extension]
key_files:
  created: []
  modified:
    - tests/tools/list-messages.test.ts
    - tests/tools/search-messages.test.ts
    - tests/tools/multi-account-types.test.ts
decisions:
  - "Envelope mock helper extended with fromName/to/cc opts so existing tests need no structural changes"
  - "HDR-01 and HDR-02 describe blocks placed at end of outer describe to avoid disturbing existing test order"
  - "to: [], cc: [] added inline to every envelope object in search-messages.test.ts to match updated service output"
metrics:
  duration_seconds: 172
  completed_date: "2026-03-15"
  tasks_completed: 2
  files_modified: 3
---

# Phase 7 Plan 2: Test Updates for Header Enrichment Summary

**One-liner:** Updated three test files to compile and pass with the new `to`/`cc` fields on `MessageHeader`, adding HDR-01 and HDR-02 describe blocks proving recipient formatting and empty-array guarantees.

## What Was Built

Plan 07-02 updated the three test files that reference `MessageHeader`-shaped objects following the type change from plan 07-01. Two new describe blocks cover the new to/cc behavior end-to-end.

### Task 1: list-messages.test.ts (commit `0989647`)

- Extended `makeMockMessage` with `fromName`, `to`, and `cc` opts; envelope now includes `to` and `cc` arrays
- Updated LIST-04 assertion to include `"to"` and `"cc"` in `arrayContaining`
- Added HDR-01 describe block with 3 test cases:
  1. Recipients present: `to`/`cc` contain formatted strings (`"Name <addr>"` and bare address)
  2. No recipients: `to` and `cc` are `[]`, not absent
  3. From uses bare address when no display name present

### Task 2: search-messages.test.ts + multi-account-types.test.ts (commit `bf6ff4d`)

**search-messages.test.ts:**
- Added `to: [], cc: []` to `defaultMessages` in `makeMockClient`
- Added `to: [], cc: []` to all 7 inline envelope objects (manyMessages, tenMessages, makeCapClient msgs, SRCH-MA-01 mocks, SRCH-MA-02 mock)
- Added HDR-02 describe block with 2 test cases:
  1. Recipients present: formatted strings in `to`/`cc` arrays
  2. No recipients: `to`/`cc` are `[]`, not absent

**multi-account-types.test.ts:**
- Added `to: [], cc: []` to `MultiAccountMessageHeader` literal
- Added `to: [], cc: []` to `MultiAccountSearchResultItem` literal
- Added `to: [], cc: []` to `MultiAccountResult<MultiAccountMessageHeader>` success literal

## Verification

```
Test Files: 15 passed (15)
Tests:      147 passed (147)
TypeScript: 0 errors
```

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `tests/tools/list-messages.test.ts` — exists and contains HDR-01
- `tests/tools/search-messages.test.ts` — exists and contains HDR-02
- `tests/tools/multi-account-types.test.ts` — exists with `to: []` on 3 literals
- Commits `0989647` and `bf6ff4d` — verified in git log
- Full suite: 147 tests passing, 0 TypeScript errors
