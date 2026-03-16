// Wave 0 scaffold — all tests are it.todo stubs.
// This file documents the contract for read_messages before the implementation exists.
// Plan 09-02 converts these stubs to real assertions alongside the implementation.
//
// Import is deferred (no top-level import of src/tools/read-messages.ts) to keep
// the full test suite green while the module does not yet exist.
//
// Contract: handleReadMessages(args, manager): Promise<ToolResult>
//   args: { account: string, uids: number[], folder?: string, format?: string, max_chars?: number }
//   manager: ConnectionManager
//   Uses client.fetch() (async generator) for batched metadata, client.download() per UID for body.
//   READ_MESSAGES_TOOL: Tool definition with name "read_messages"
import { describe, it } from "vitest";

// --- BATCH-01: Batch fetch and per-UID result handling ---
describe("read_messages", () => {
  it.todo("returns array of MessageBody for all valid UIDs");
  it.todo("returns error entry for missing UID, others succeed");
  it.todo("returns error entry when download throws, others succeed");
  it.todo("hard cap: >50 UIDs returns isError:true before IMAP call");
  it.todo("empty uids array returns empty array result");
  it.todo("account error returns isError:true ToolResult");
  it.todo("preserves UID request order in response array");

  // --- BATCH-02: Format and truncation options ---
  it.todo("format=truncated respects max_chars");
  it.todo("default format=clean and max_chars=2000 when omitted");
  it.todo("folder defaults to INBOX when omitted");

  // --- Tool definition ---
  it.todo("READ_MESSAGES_TOOL is exported and has correct name");
});
