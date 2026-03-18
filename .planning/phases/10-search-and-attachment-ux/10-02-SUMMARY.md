---
phase: 10-search-and-attachment-ux
plan: "02"
subsystem: attachment-download
tags: [attachment, filename-lookup, body-structure, imap, tdd]
dependency_graph:
  requires: []
  provides: [ATCH-01]
  affects: [src/tools/download-attachment.ts]
tech_stack:
  added: []
  patterns: [filename-to-part_id resolution, case-insensitive matching, lock-before-download pattern]
key_files:
  created: []
  modified:
    - src/tools/download-attachment.ts
    - tests/tools/download-attachment.test.ts
decisions:
  - "bodyStructure lock released in finally block before downloadAttachment acquires its own lock (nested lock pitfall)"
  - "part_id takes precedence when both part_id and filename are provided — no bodyStructure fetch occurs"
  - "Added null guard for msgs[0].bodyStructure because ImapFlow types it as optional"
  - "Runtime guard fires before getClient() call — no IMAP interaction when neither param provided"
requirements_completed: [ATCH-01]
metrics:
  duration_seconds: 184
  completed_date: "2026-03-16"
  tasks_completed: 2
  files_modified: 2
---

# Phase 10 Plan 02: Filename-Based Attachment Download Summary

**One-liner:** Optional `filename` param added to `download_attachment` — agents can now download attachments by name without a prior `read_message` call to discover part IDs.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Rewrite download-attachment handler with filename lookup and update tool schema | b9bd891 | src/tools/download-attachment.ts |
| 2 | Add ATCH-01 test describe block to download-attachment tests | 15aa195 | tests/tools/download-attachment.test.ts |

## What Was Built

### Task 1: Handler Rewrite

`src/tools/download-attachment.ts` updated with:

- `DownloadAttachmentArgs.part_id` changed from `string` to `string | undefined` (optional)
- New `filename?: string` field added to `DownloadAttachmentArgs`
- Runtime guard returns `isError: true` with "Error: either part_id or filename must be provided" when neither is given — fires before any IMAP interaction
- When only `filename` provided: acquires mailbox lock, calls `client.fetchAll([uid], { bodyStructure: true }, { uid: true })`, parses with `parseBodyStructure`, finds first attachment whose `.filename.toLowerCase()` matches `filename.toLowerCase()`
- Lock released in `finally` block before `downloadAttachment()` is called (avoids nested imapflow lock deadlock)
- `DOWNLOAD_ATTACHMENT_TOOL.inputSchema.required` updated to `["account", "uid"]` — `part_id` removed
- New `filename` property added to `inputSchema.properties` with descriptive help text
- Added null guard for `msgs[0].bodyStructure` (typed as optional by ImapFlow)

### Task 2: ATCH-01 Test Block

5 new tests in `describe("ATCH-01: filename-based attachment lookup")`:

- **ATCH-01-a:** neither param → validation error before IMAP call (getClient not called)
- **ATCH-01-b:** part_id provided → direct download, no bodyStructure fetch
- **ATCH-01-c:** filename provided → resolves part_id via bodyStructure, correct download call
- **ATCH-01-d:** case-insensitive match — "Report.PDF" matches attachment with filename "report.pdf"
- **ATCH-01-e:** filename not found → descriptive error naming filename and UID; lock released; download not called

## Verification

- `npx tsc --noEmit`: PASS
- `npm test tests/tools/download-attachment.test.ts`: 9/9 tests pass
- `npm test` (full suite): 182/182 tests pass
- `grep "required" src/tools/download-attachment.ts`: confirms `["account", "uid"]` only

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added null guard for optional bodyStructure field**

- **Found during:** Task 1 TypeScript compilation
- **Issue:** `msgs[0].bodyStructure` is typed as `MessageStructureObject | undefined` in ImapFlow — passing it directly to `parseBodyStructure(root: MessageStructureObject)` caused TS2345 error
- **Fix:** Added explicit null check returning `isError: true` with "Error: message N has no bodyStructure" before the `parseBodyStructure` call
- **Files modified:** src/tools/download-attachment.ts
- **Commit:** b9bd891

## Self-Check: PASSED

- [x] `src/tools/download-attachment.ts` exists and compiles
- [x] `tests/tools/download-attachment.test.ts` contains ATCH-01 describe block with 5 tests
- [x] Commits b9bd891 and 15aa195 exist in git log
- [x] `npm test` exits 0 with 182 passing tests
