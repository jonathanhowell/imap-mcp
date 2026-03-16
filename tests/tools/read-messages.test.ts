import { Readable } from "stream";
import { describe, it, expect, vi } from "vitest";
import { handleReadMessages, READ_MESSAGES_TOOL } from "../../src/tools/read-messages.js";
import type { ConnectionManager } from "../../src/connections/index.js";

// Shared mock lock factory
function makeMockLock() {
  return { release: vi.fn() };
}

// Minimal mock envelope
function makeEnvelope(from: string, subject: string, date: Date) {
  return {
    from: [{ address: from }],
    subject,
    date,
  };
}

// Simple single-part text/plain body structure
const plainTextBodyStructure = {
  type: "text/plain",
  size: 50,
};

// Create a mock download response — content is a Readable stream of decoded bytes
function makeDownloadResponse(text: string) {
  return { content: Readable.from([Buffer.from(text, "utf-8")]) };
}

// Build a mock fetch message object
function makeFetchMsg(
  uid: number,
  _bodyText: string = "hello",
  subject: string = "Subject",
  from: string = "sender@example.com"
) {
  return {
    uid,
    envelope: makeEnvelope(from, subject, new Date("2024-01-01")),
    bodyStructure: plainTextBodyStructure,
  };
}

// Helper to build a mock ConnectionManager with fetch and download mocked
function makeMockManager(
  fetchMsgs: ReturnType<typeof makeFetchMsg>[],
  downloadMap: Map<number, string> = new Map(),
  clientOverrides: Record<string, unknown> = {}
): ConnectionManager {
  const client = {
    getMailboxLock: vi.fn().mockResolvedValue(makeMockLock()),
    fetch: vi.fn().mockReturnValue(
      (async function* () {
        for (const msg of fetchMsgs) {
          yield msg;
        }
      })()
    ),
    download: vi.fn().mockImplementation((uidStr: string) => {
      const uid = Number(uidStr);
      const text = downloadMap.get(uid) ?? "body text";
      return Promise.resolve(makeDownloadResponse(text));
    }),
    ...clientOverrides,
  };
  return {
    getClient: vi.fn().mockReturnValue(client),
  } as unknown as ConnectionManager;
}

describe("read_messages", () => {
  it("returns array of MessageBody for all valid UIDs", async () => {
    const fetchMsgs = [makeFetchMsg(42, "body 42"), makeFetchMsg(43, "body 43")];
    const downloadMap = new Map([
      [42, "body 42"],
      [43, "body 43"],
    ]);
    const manager = makeMockManager(fetchMsgs, downloadMap);

    const result = await handleReadMessages({ account: "test", uids: [42, 43] }, manager);
    expect(result.isError).toBe(false);
    const entries = JSON.parse(result.content[0].text);
    expect(Array.isArray(entries)).toBe(true);
    expect(entries).toHaveLength(2);
    expect(entries[0].uid).toBe(42);
    expect(entries[1].uid).toBe(43);
    expect(typeof entries[0].from).toBe("string");
    expect(typeof entries[0].subject).toBe("string");
    expect(Array.isArray(entries[0].attachments)).toBe(true);
  });

  it("returns error entry for missing UID, others succeed", async () => {
    // Only UID 42 is returned from fetch; UID 999 is absent
    const fetchMsgs = [makeFetchMsg(42)];
    const downloadMap = new Map([[42, "hello"]]);
    const manager = makeMockManager(fetchMsgs, downloadMap);

    const result = await handleReadMessages({ account: "test", uids: [42, 999] }, manager);
    expect(result.isError).toBe(false);
    const entries = JSON.parse(result.content[0].text);
    expect(entries).toHaveLength(2);
    // First entry: success for UID 42
    expect(entries[0].uid).toBe(42);
    expect(entries[0].error).toBeUndefined();
    // Second entry: error for missing UID 999
    expect(entries[1].uid).toBe(999);
    expect(typeof entries[1].error).toBe("string");
    expect(entries[1].error).toContain("999");
  });

  it("returns error entry when download throws, others succeed", async () => {
    const fetchMsgs = [makeFetchMsg(42), makeFetchMsg(43)];
    const client = {
      getMailboxLock: vi.fn().mockResolvedValue(makeMockLock()),
      fetch: vi.fn().mockReturnValue(
        (async function* () {
          for (const msg of fetchMsgs) {
            yield msg;
          }
        })()
      ),
      // UID 42 download throws; UID 43 succeeds
      download: vi.fn().mockImplementation((uidStr: string) => {
        if (Number(uidStr) === 42) {
          return Promise.reject(new Error("connection reset"));
        }
        return Promise.resolve(makeDownloadResponse("success body"));
      }),
    };
    const manager = { getClient: vi.fn().mockReturnValue(client) } as unknown as ConnectionManager;

    const result = await handleReadMessages({ account: "test", uids: [42, 43] }, manager);
    expect(result.isError).toBe(false);
    const entries = JSON.parse(result.content[0].text);
    expect(entries).toHaveLength(2);
    // UID 42: download failed
    expect(entries[0].uid).toBe(42);
    expect(typeof entries[0].error).toBe("string");
    expect(entries[0].error.toLowerCase()).toContain("download");
    // UID 43: success
    expect(entries[1].uid).toBe(43);
    expect(entries[1].error).toBeUndefined();
  });

  it("hard cap: >50 UIDs returns isError:true before IMAP call", async () => {
    const uids = Array.from({ length: 51 }, (_, i) => i + 1);
    // getClient should NOT be called
    const manager = {
      getClient: vi.fn().mockReturnValue({ error: "should not be called" }),
    } as unknown as ConnectionManager;

    const result = await handleReadMessages({ account: "test", uids }, manager);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Too many UIDs");
    expect(result.content[0].text).toContain("51");
    // Confirm getClient was never invoked
    expect(manager.getClient as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("empty uids array returns empty array result", async () => {
    const manager = {
      getClient: vi.fn(),
    } as unknown as ConnectionManager;

    const result = await handleReadMessages({ account: "test", uids: [] }, manager);
    expect(result.isError).toBe(false);
    const entries = JSON.parse(result.content[0].text);
    expect(Array.isArray(entries)).toBe(true);
    expect(entries).toHaveLength(0);
    expect(manager.getClient as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("account error returns isError:true ToolResult", async () => {
    const manager = {
      getClient: vi.fn().mockReturnValue({ error: "account not found" }),
    } as unknown as ConnectionManager;

    const result = await handleReadMessages({ account: "nonexistent", uids: [1, 2] }, manager);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("account not found");
  });

  it("preserves UID request order in response array", async () => {
    // Return from fetch in reversed order — response must match request order
    const fetchMsgs = [makeFetchMsg(43), makeFetchMsg(42), makeFetchMsg(44)];
    const downloadMap = new Map([
      [42, "body 42"],
      [43, "body 43"],
      [44, "body 44"],
    ]);
    const manager = makeMockManager(fetchMsgs, downloadMap);

    const result = await handleReadMessages({ account: "test", uids: [42, 43, 44] }, manager);
    expect(result.isError).toBe(false);
    const entries = JSON.parse(result.content[0].text);
    expect(entries[0].uid).toBe(42);
    expect(entries[1].uid).toBe(43);
    expect(entries[2].uid).toBe(44);
  });

  // --- BATCH-02: Format and truncation options ---
  it("format=truncated respects max_chars", async () => {
    const longBody = "x".repeat(5000);
    const fetchMsgs = [makeFetchMsg(42)];
    const downloadMap = new Map([[42, longBody]]);
    const manager = makeMockManager(fetchMsgs, downloadMap);

    const result = await handleReadMessages(
      { account: "test", uids: [42], format: "truncated", max_chars: 100 },
      manager
    );
    expect(result.isError).toBe(false);
    const entries = JSON.parse(result.content[0].text);
    expect(entries[0].body.length).toBe(100);
  });

  it("default format=clean and max_chars=2000 when omitted", async () => {
    const longBody = "y".repeat(5000);
    const fetchMsgs = [makeFetchMsg(42)];
    const downloadMap = new Map([[42, longBody]]);
    const manager = makeMockManager(fetchMsgs, downloadMap);

    // format omitted — defaults to "clean"; clean does NOT truncate to 2000
    // (clean strips reply chains but leaves the body intact otherwise)
    // For plain text with no reply chains, clean == original text
    const result = await handleReadMessages({ account: "test", uids: [42] }, manager);
    expect(result.isError).toBe(false);
    const entries = JSON.parse(result.content[0].text);
    // format=clean preserves body (no truncation) — body should be the full long text
    expect(entries[0].body.length).toBeGreaterThan(100);
  });

  it("folder defaults to INBOX when omitted", async () => {
    const fetchMsgs = [makeFetchMsg(42)];
    const downloadMap = new Map([[42, "hello"]]);
    const manager = makeMockManager(fetchMsgs, downloadMap);

    await handleReadMessages({ account: "test", uids: [42] }, manager);

    const client = (manager.getClient as ReturnType<typeof vi.fn>)();
    expect(client.getMailboxLock).toHaveBeenCalledWith("INBOX", { readOnly: true });
  });

  // --- Tool definition ---
  it("READ_MESSAGES_TOOL is exported and has correct name", () => {
    expect(READ_MESSAGES_TOOL).toBeDefined();
    expect(READ_MESSAGES_TOOL.name).toBe("read_messages");
    expect(READ_MESSAGES_TOOL.inputSchema.required).toContain("account");
    expect(READ_MESSAGES_TOOL.inputSchema.required).toContain("uids");
  });
});
