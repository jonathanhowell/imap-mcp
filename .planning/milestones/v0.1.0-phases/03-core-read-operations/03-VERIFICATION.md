---
phase: 03-core-read-operations
verified: 2026-03-12T22:05:00Z
status: gaps_found
score: 5/6 must-have truths verified
gaps:
  - truth: "MCP server registers 6 tools: list_accounts, list_folders, list_messages, read_message, search_messages, download_attachment — all tool calls routed to real handlers"
    status: partial
    reason: "list_accounts tool is registered and wired in src/index.ts with a real handler, but handleListAccounts and ConnectionManager.getAccountIds() have zero automated test coverage. No test file for list-accounts exists and startup.test.ts does not exercise the real handler."
    artifacts:
      - path: "src/tools/list-accounts.ts"
        issue: "Implementation is correct and wired, but has no test coverage"
      - path: "src/connections/connection-manager.ts"
        issue: "getAccountIds() method added but not tested"
    missing:
      - "Create tests/tools/list-accounts.test.ts with: (1) returns JSON array of account IDs with status, (2) connected account returns status='connected', (3) failed account returns status='failed' with detail, (4) empty account list returns []"
      - "Test getAccountIds() via list-accounts handler using mocked ConnectionManager"
---

# Phase 3: Core Read Operations Verification Report

**Phase Goal:** Implement all core IMAP read operations as MCP tools — list_folders, list_messages, read_message, download_attachment, search_messages, list_accounts — with full test coverage against requirements.
**Verified:** 2026-03-12T22:05:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `src/types.ts` exports all 7 Phase 3 response types used by every tool handler | VERIFIED | File confirmed: FolderEntry, MessageHeader, SearchResultItem, AttachmentMeta, MessageBody, AttachmentDownload, ToolResult all exported |
| 2 | html-to-text and email-reply-parser installed in package.json dependencies | VERIFIED | package.json: html-to-text ^9.0.5, email-reply-parser ^2.3.5, @types/html-to-text ^9.0.4 confirmed |
| 3 | list_folders, list_messages, read_message, download_attachment, search_messages all implemented with substantive handlers and GREEN tests | VERIFIED | 5 tools: 5+8+8+4+10 = 35 tests, all GREEN. No it.todo() stubs remain. |
| 4 | All IMAP services use getMailboxLock with finally block for lock release | VERIFIED | message-service.ts:67, attachment-service.ts:30, search-service.ts:89 all have `finally { lock.release() }` |
| 5 | body-service parseBodyStructure handles single-part and multipart messages; extractBody supports full/clean/truncated modes | VERIFIED | 13 tests in body-service.test.ts GREEN covering READ-01 through READ-04 |
| 6 | MCP server registers 6 tools with real handlers — including list_accounts — with full test coverage | FAILED | list_accounts registered in index.ts and wired to handleListAccounts, but handleListAccounts and getAccountIds() have zero automated tests |

**Score:** 5/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/types.ts` | 7 Phase 3 types exported | VERIFIED | All 7 interfaces present, strict (no `any`) |
| `src/services/folder-service.ts` | `listFolders()` with statusQuery | VERIFIED | Uses `{ statusQuery: { messages: true, unseen: true } }`, SPECIAL_USE_MAP defined |
| `src/tools/list-folders.ts` | `handleListFolders`, `LIST_FOLDERS_TOOL` | VERIFIED | Both exported, wired to folder-service |
| `src/services/message-service.ts` | `listMessages()` with lock guard + pagination | VERIFIED | `|| []` normalization, `sort`, `offset`/`limit`, `finally { lock.release() }` |
| `src/tools/list-messages.ts` | `handleListMessages`, `LIST_MESSAGES_TOOL` | VERIFIED | unread_only param mapped to unreadOnly, folder required |
| `src/services/body-service.ts` | `parseBodyStructure`, `extractBody` | VERIFIED | Recursive BODYSTRUCTURE traversal, 3 format modes, html-to-text and email-reply-parser integrated |
| `src/services/attachment-service.ts` | `downloadAttachment` with for-await | VERIFIED | `for await (const chunk of content)`, base64 encoding, finally block |
| `src/tools/read-message.ts` | `handleReadMessage`, `READ_MESSAGE_TOOL` | VERIFIED | Two-fetchOne pattern under single lock, format defaults to 'clean' |
| `src/tools/download-attachment.ts` | `handleDownloadAttachment`, `DOWNLOAD_ATTACHMENT_TOOL` | VERIFIED | Delegates to attachment-service, error guard present |
| `src/services/search-service.ts` | `searchMessages` with criteria mapping | VERIFIED | from/subject/since→Date/before→Date/unread→seen mapping, folder='all' multi-folder mode, early exit |
| `src/tools/search-messages.ts` | `handleSearchMessages`, `SEARCH_MESSAGES_TOOL` | VERIFIED | Performance warning in description, max_results param |
| `src/connections/connection-manager.ts` | `getAccountIds()` method | VERIFIED (untested) | Method exists at line 82, returns `Array.from(this.connections.keys())` — no test coverage |
| `src/tools/list-accounts.ts` | `handleListAccounts`, `LIST_ACCOUNTS_TOOL` | VERIFIED (untested) | Synchronous handler with status mapping — no test file exists |
| `src/index.ts` | 6-tool registration + switch router | VERIFIED | All 6 tools in TOOLS array, switch dispatches all 6 handlers, no stubs referenced |
| `tests/tools/list-folders.test.ts` | MAIL-01/02 GREEN tests | VERIFIED | 5 real tests, all pass |
| `tests/tools/list-messages.test.ts` | MAIL-03, LIST-01-04 GREEN tests | VERIFIED | 8 real tests, all pass |
| `tests/tools/read-message.test.ts` | READ-01/02 GREEN tests | VERIFIED | 8 real tests, all pass |
| `tests/tools/download-attachment.test.ts` | READ-05 GREEN tests | VERIFIED | 4 real tests, all pass |
| `tests/tools/search-messages.test.ts` | SRCH-01-04 GREEN tests | VERIFIED | 10 real tests, all pass |
| `tests/services/body-service.test.ts` | READ-03/04 GREEN tests | VERIFIED | 13 real tests, all pass |
| `tests/tools/list-accounts.test.ts` | list_accounts handler tests | MISSING | File does not exist; no test anywhere exercises handleListAccounts |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/index.ts` | all 6 tool handlers | switch dispatch | WIRED | Lines 51-78: all 6 case branches confirmed |
| `src/tools/list-folders.ts` | `src/services/folder-service.ts` | `listFolders(result)` | WIRED | Line 28: `listFolders(result)` called, result used |
| `src/tools/list-messages.ts` | `src/services/message-service.ts` | `listMessages(clientResult, folder, opts)` | WIRED | Line 67-72: called with all opts mapped |
| `src/tools/read-message.ts` | `src/services/body-service.ts` | `parseBodyStructure()` + `extractBody()` | WIRED | Lines 79, 98: both called within lock block |
| `src/tools/download-attachment.ts` | `src/services/attachment-service.ts` | `downloadAttachment(client, folder, uid, part_id)` | WIRED | Line 56: called with result used in return |
| `src/tools/search-messages.ts` | `src/services/search-service.ts` | `searchMessages(clientResult, params)` | WIRED | Line 76: called, result returned as JSON |
| `src/tools/list-accounts.ts` | `src/connections/connection-manager.ts` | `manager.getAccountIds()` + `manager.getStatus()` | WIRED | Lines 12-13: both called, results mapped |
| `src/services/message-service.ts` | imapflow `getMailboxLock` + `search` + `fetchAll` | try/finally lock.release() | WIRED | `lock.release()` in finally at line 67 |
| `src/services/search-service.ts` | imapflow `client.search()` | criteria object | WIRED | Line 70: criteria passed with `{ uid: true }`, `|| []` normalization |
| `src/services/attachment-service.ts` | imapflow `client.download()` | `for await (const chunk of content)` | WIRED | Lines 19-22: download called, for-await buffering present |
| `src/services/folder-service.ts` | imapflow `client.list()` | `statusQuery` | WIRED | Line 13: `{ statusQuery: { messages: true, unseen: true } }` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| MAIL-01 | 03-02 | Agent can list all folders/mailboxes in a named account | SATISFIED | list-folders.test.ts MAIL-01 test GREEN; handleListFolders verified |
| MAIL-02 | 03-02 | Agent can retrieve total and unread message counts per folder | SATISFIED | list-folders.test.ts MAIL-02 test GREEN; FolderEntry.total/unread from status |
| MAIL-03 | 03-03 | Agent can list messages from any folder, not just Inbox | SATISFIED | list-messages.test.ts: "passes any folder path" test GREEN |
| LIST-01 | 03-03 | Agent can list messages with pagination (limit and offset) | SATISFIED | list-messages.test.ts limit+offset tests GREEN; slice(offset, offset+limit) in service |
| LIST-02 | 03-03 | Agent can list unread messages from specific account | SATISFIED | list-messages.test.ts unread_only test GREEN; search({ seen: false }) in service |
| LIST-03 | 03-03 | Message listings sortable by date (newest/oldest) | SATISFIED | list-messages.test.ts sort tests GREEN; UID-sort descending/ascending |
| LIST-04 | 03-03 | Message list responses include headers only — no bodies | SATISFIED | list-messages.test.ts "no body keys" test GREEN; MessageHeader has no body field |
| READ-01 | 03-04 | Agent can fetch full email: headers + plain text body | SATISFIED | body-service.test.ts READ-01 tests GREEN; read-message.test.ts tests GREEN |
| READ-02 | 03-04 | Agent can fetch truncated email body (first N characters) | SATISFIED | body-service.test.ts READ-02 truncated test GREEN; max_chars param in handler |
| READ-03 | 03-04 | Agent can fetch cleaned body: HTML→plain text, reply chains removed | SATISFIED | body-service.test.ts READ-03 tests GREEN; html-to-text and email-reply-parser integrated |
| READ-04 | 03-04 | Agent can list attachments (filename, size, MIME type) without downloading | SATISFIED | body-service.test.ts READ-04 tests GREEN; parseBodyStructure returns AttachmentMeta[] |
| READ-05 | 03-04 | Agent can download specific attachment by UID and part identifier | SATISFIED | download-attachment.test.ts READ-05 test GREEN; base64 content returned |
| SRCH-01 | 03-05 | Agent can search by sender address or domain | SATISFIED | search-messages.test.ts SRCH-01 test GREEN; criteria.from mapped |
| SRCH-02 | 03-05 | Agent can search by subject keyword | SATISFIED | search-messages.test.ts SRCH-02 test GREEN; criteria.subject mapped |
| SRCH-03 | 03-05 | Agent can search by date range (before, after, between) | SATISFIED | search-messages.test.ts SRCH-03 test GREEN; since/before converted to Date objects |
| SRCH-04 | 03-05 | Agent can filter by read/unread status | SATISFIED | search-messages.test.ts SRCH-04 test GREEN; unread=true→seen:false, unread=false→seen:true |

**Orphaned requirements check:** No Phase 3 requirements appear in REQUIREMENTS.md that are not claimed by a plan. All 16 Phase 3 IDs (MAIL-01/02/03, LIST-01-04, READ-01-05, SRCH-01-04) are mapped and verified.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| None | — | — | No TODO/FIXME/placeholder comments, no empty implementations, no console.log in source |

### Human Verification Required

None — all observable behaviors are verifiable programmatically. The server wiring is code-level (not UI), and IMAP operations are tested via vitest mocks.

### Gaps Summary

**One gap blocks complete goal achievement:** `list_accounts` is the sixth tool in the phase goal statement. It is registered, wired to a real handler (`handleListAccounts`), and dispatches correctly in `src/index.ts`. However, `handleListAccounts` in `src/tools/list-accounts.ts` and `getAccountIds()` in `src/connections/connection-manager.ts` have no automated test coverage. No test file exists at `tests/tools/list-accounts.test.ts`, and `startup.test.ts` only tests the legacy `stubs.ts` path — it does not exercise the real handler at all.

All other 5 tools have dedicated test files with real assertions. The phase goal requires "full test coverage against requirements," and `list_accounts` is missing its coverage. The implementation itself appears correct and complete.

**Root cause:** Plan 03-06 added `list-accounts.ts` and wired `src/index.ts` but did not create a corresponding test file. The Wave 0 scaffold in plan 03-01 only covered tools with requirement IDs in the PLAN frontmatter; `list_accounts` was added as a bonus tool in 03-06 without a test scaffold.

---

_Verified: 2026-03-12T22:05:00Z_
_Verifier: Claude (gsd-verifier)_
