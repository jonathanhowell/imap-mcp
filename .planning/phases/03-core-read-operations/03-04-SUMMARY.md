---
phase: 03-core-read-operations
plan: 04
subsystem: api
tags: [imap, imapflow, bodystructure, html-to-text, email-reply-parser, attachment, base64]

# Dependency graph
requires:
  - phase: 03-01
    provides: types (AttachmentMeta, MessageBody, AttachmentDownload, ToolResult), html-to-text, email-reply-parser dependencies
  - phase: 02-connection-management
    provides: ConnectionManager.getClient() discriminated union, ImapFlow client with getMailboxLock/fetchOne/download

provides:
  - BODYSTRUCTURE recursive traversal with single-part/multipart handling (body-service)
  - HTML-to-text conversion via html-to-text, reply chain stripping via email-reply-parser (body-service)
  - Three body format modes: full, clean, truncated with configurable max_chars (body-service)
  - Attachment streaming download with base64 encoding via for-await buffering (attachment-service)
  - read_message MCP tool handler with optional folder (default INBOX), format, max_chars params
  - download_attachment MCP tool handler with account, uid, part_id, optional folder params
affects:
  - phase 03-05 (search-service may read body-service patterns)
  - any future phase integrating message reading

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "BODYSTRUCTURE traversal: root node with no childNodes treated as part '1'; multipart recurses with dotted path (1.1, 1.2)"
    - "Two-fetchOne pattern: first for envelope+bodyStructure, second for body part buffers (within same lock)"
    - "for-await stream buffering: content readable piped into chunks array, then Buffer.concat to base64"
    - "Lock-in-finally: getMailboxLock acquired before try, lock.release() always in finally block"
    - "Handler-wraps-service: handler owns getClient guard and lock; service accepts ImapFlow directly"

key-files:
  created:
    - src/services/body-service.ts
    - src/services/attachment-service.ts
    - src/tools/read-message.ts
    - src/tools/download-attachment.ts
    - tests/services/body-service.test.ts
    - tests/tools/read-message.test.ts
    - tests/tools/download-attachment.test.ts
  modified: []

key-decisions:
  - "Root BODYSTRUCTURE node with undefined .part is treated as part '1' — single-part messages always addressable via fetchOne bodyParts '1'"
  - "read_message default format is 'clean' (reply-chain stripped) rather than 'full' — reduces noise for agent consumers by default"
  - "read_message does two fetchOne calls under a single lock — avoids redundant bodyStructure decode in body part fetch"
  - "download_attachment acquires its own lock in attachment-service — keeps handler thin; service is independently testable"

patterns-established:
  - "BODYSTRUCTURE traversal: traverse(root, '1') with dotted child path construction"
  - "extractBody returns empty string when no parts found (null textPartId and null htmlPartId)"
  - "Tool handlers: getClient guard first, then lock acquire, then work in try/finally"

requirements-completed: [READ-01, READ-02, READ-03, READ-04, READ-05]

# Metrics
duration: pre-committed
completed: 2026-03-12
---

# Phase 03 Plan 04: Body/Attachment Services and read_message/download_attachment Handlers Summary

**BODYSTRUCTURE traversal with three body format modes (full/clean/truncated), HTML-to-text conversion, reply chain stripping, and streaming attachment download producing base64-encoded content**

## Performance

- **Duration:** pre-committed (implementation committed before summary)
- **Started:** 2026-03-12
- **Completed:** 2026-03-12
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- `parseBodyStructure` recursively traverses imapflow BODYSTRUCTURE trees, handling single-part (root node as '1') and multipart (dotted child path 1.1, 1.2, etc.) messages, extracting textPartId, htmlPartId, and an attachments array
- `extractBody` supports three format modes: full (raw text/plain or HTML-converted), clean (reply-chain stripped via EmailReplyParser), and truncated (sliced to max_chars)
- `downloadAttachment` streams imapflow `client.download()` Readable content with `for await` buffering and returns base64-encoded content with lock always released in finally
- `handleReadMessage` uses two fetchOne calls under a single lock (bodyStructure+envelope first, body parts second) and defaults format to 'clean' for agent-friendly output
- `handleDownloadAttachment` delegates to attachment-service, guarding on account availability before calling
- All 25 tests across 3 test files GREEN: READ-01 through READ-05 all pass

## Task Commits

Implementation was pre-committed before summary creation:

1. **Task 1: Implement body-service** - `89c6c25` (feat)
2. **Task 2: Implement attachment-service, read_message and download_attachment handlers** - `fbdd65d` (feat — recovery commit covering Wave 2 handlers + tests)

## Files Created/Modified

- `src/services/body-service.ts` - BODYSTRUCTURE traversal (parseBodyStructure), body extraction with format modes (extractBody)
- `src/services/attachment-service.ts` - Streaming attachment download with for-await buffering and base64 encoding
- `src/tools/read-message.ts` - read_message MCP tool handler; two-fetchOne pattern under single lock
- `src/tools/download-attachment.ts` - download_attachment MCP tool handler; delegates to attachment-service
- `tests/services/body-service.test.ts` - 16 tests covering single-part, multipart, format modes, attachment extraction
- `tests/tools/read-message.test.ts` - 8 tests covering READ-01, READ-02, format modes, error paths
- `tests/tools/download-attachment.test.ts` - 4 tests covering READ-05, filename/mime, error paths

## Decisions Made

- **Root node treated as part '1':** Root BODYSTRUCTURE node may have `.part` undefined; the traversal always starts with partPath `'1'`, so single-part messages are reliably addressable via `bodyParts: ['1']` in the second fetchOne.
- **Default format is 'clean':** MCP agent consumers benefit from pre-stripped reply chains by default. Callers requiring raw content can pass `format='full'`.
- **Two fetchOne calls under one lock:** First call fetches envelope and bodyStructure (cheap); second fetches only the needed body part buffers (potentially large). Both occur within the same `getMailboxLock` to avoid double-lock overhead while keeping fetch payloads minimal.
- **Attachment-service owns its lock:** `downloadAttachment` acquires its own lock independently, making the service self-contained and directly testable without a handler layer mock.

## Deviations from Plan

None - plan executed exactly as written. Implementation was pre-committed and all 25 tests pass.

## Issues Encountered

None - all tests GREEN on first verification run. TypeScript compiles clean. Lock-in-finally pattern verified in all service files.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- read_message and download_attachment handlers are complete and tested — ready for registration in src/index.ts if not already done
- BODYSTRUCTURE traversal pattern documented for any future phases adding message manipulation
- Phase 03-05 (search-service) can proceed independently — no body-service dependency required

---
*Phase: 03-core-read-operations*
*Completed: 2026-03-12*

## Self-Check: PASSED

- FOUND: src/services/body-service.ts (read successfully)
- FOUND: src/services/attachment-service.ts (read successfully)
- FOUND: src/tools/read-message.ts (read successfully)
- FOUND: src/tools/download-attachment.ts (read successfully)
- FOUND: .planning/phases/03-core-read-operations/03-04-SUMMARY.md (just created)
- FOUND: 89c6c25 (feat(03-04): implement body-service — confirmed in git log)
- FOUND: fbdd65d (feat(03-wave2): complete Wave 2 tool handlers and tests — confirmed in git log)
