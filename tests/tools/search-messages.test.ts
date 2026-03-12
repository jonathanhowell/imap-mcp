import { describe, it, expect, vi } from "vitest";
import { handleSearchMessages } from "../../src/tools/search-messages.js";
import type { ConnectionManager } from "../../src/connections/index.js";
import type { ImapFlow } from "imapflow";

/** Build a minimal mock ImapFlow client for search tests */
function makeMockClient(overrides: Partial<Record<string, unknown>> = {}): ImapFlow {
  const defaultMessages = [
    {
      uid: 1,
      envelope: {
        from: [{ address: "alice@example.com" }],
        subject: "Invoice #001",
        date: new Date("2024-03-01T10:00:00Z"),
      },
      flags: new Set<string>(),
      internalDate: new Date("2024-03-01T10:00:00Z"),
    },
  ];

  const mockSearch = vi.fn().mockResolvedValue([1]);
  const mockFetchAll = vi.fn().mockResolvedValue(defaultMessages);
  const mockLock = { release: vi.fn() };
  const mockGetMailboxLock = vi.fn().mockResolvedValue(mockLock);
  const mockList = vi.fn().mockResolvedValue([{ path: "INBOX" }, { path: "Sent" }]);

  return {
    search: mockSearch,
    fetchAll: mockFetchAll,
    getMailboxLock: mockGetMailboxLock,
    list: mockList,
    ...overrides,
  } as unknown as ImapFlow;
}

/** Build a mock ConnectionManager that returns the given client */
function makeManager(client: ImapFlow): ConnectionManager {
  return {
    getClient: vi.fn().mockReturnValue(client),
  } as unknown as ConnectionManager;
}

/** Build a mock ConnectionManager that returns an error */
function makeErrorManager(message = "account unavailable"): ConnectionManager {
  return {
    getClient: vi.fn().mockReturnValue({ error: message }),
  } as unknown as ConnectionManager;
}

describe("search_messages", () => {
  it("SRCH-01: from param is passed to IMAP search", async () => {
    const client = makeMockClient();
    const manager = makeManager(client);

    await handleSearchMessages({ account: "personal", from: "alice@example.com" }, manager);

    expect(client.search).toHaveBeenCalledWith(
      expect.objectContaining({ from: "alice@example.com" }),
      { uid: true }
    );
  });

  it("SRCH-02: subject param is passed to IMAP search", async () => {
    const client = makeMockClient();
    const manager = makeManager(client);

    await handleSearchMessages({ account: "personal", subject: "invoice" }, manager);

    expect(client.search).toHaveBeenCalledWith(expect.objectContaining({ subject: "invoice" }), {
      uid: true,
    });
  });

  it("SRCH-03: since param is converted to Date object in search criteria", async () => {
    const client = makeMockClient();
    const manager = makeManager(client);

    await handleSearchMessages({ account: "personal", since: "2024-01-01" }, manager);

    const searchCall = (client.search as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(searchCall.since).toBeInstanceOf(Date);
    expect(searchCall.since.getFullYear()).toBe(2024);
  });

  it("SRCH-03: before param is converted to Date object in search criteria", async () => {
    const client = makeMockClient();
    const manager = makeManager(client);

    await handleSearchMessages({ account: "personal", before: "2024-12-31" }, manager);

    const searchCall = (client.search as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(searchCall.before).toBeInstanceOf(Date);
  });

  it("SRCH-04: unread=true maps to seen: false in search criteria", async () => {
    const client = makeMockClient();
    const manager = makeManager(client);

    await handleSearchMessages({ account: "personal", unread: true }, manager);

    expect(client.search).toHaveBeenCalledWith(expect.objectContaining({ seen: false }), {
      uid: true,
    });
  });

  it("SRCH-04: unread=false maps to seen: true in search criteria", async () => {
    const client = makeMockClient();
    const manager = makeManager(client);

    await handleSearchMessages({ account: "personal", unread: false }, manager);

    expect(client.search).toHaveBeenCalledWith(expect.objectContaining({ seen: true }), {
      uid: true,
    });
  });

  it("defaults folder to INBOX when folder param omitted", async () => {
    const client = makeMockClient();
    const manager = makeManager(client);

    await handleSearchMessages({ account: "personal" }, manager);

    expect(client.getMailboxLock).toHaveBeenCalledWith("INBOX", { readOnly: true });
  });

  it("caps results at max_results (default 50)", async () => {
    // Mock 100 UIDs returned from search, but max_results=5
    const manyUids = Array.from({ length: 100 }, (_, i) => i + 1);
    const manyMessages = Array.from({ length: 5 }, (_, i) => ({
      uid: i + 1,
      envelope: {
        from: [{ address: `user${i}@example.com` }],
        subject: `Message ${i}`,
        date: new Date("2024-01-01"),
      },
      flags: new Set<string>(),
      internalDate: new Date("2024-01-01"),
    }));

    const client = makeMockClient({
      search: vi.fn().mockResolvedValue(manyUids),
      fetchAll: vi.fn().mockResolvedValue(manyMessages),
    });
    const manager = makeManager(client);

    const result = await handleSearchMessages({ account: "personal", max_results: 5 }, manager);

    const parsed = JSON.parse(result.content[0].text) as unknown[];
    expect(parsed).toHaveLength(5);

    // fetchAll should have been called with only 5 UIDs
    const fetchAllCall = (client.fetchAll as ReturnType<typeof vi.fn>).mock.calls[0][0] as number[];
    expect(fetchAllCall).toHaveLength(5);
  });

  it("each result includes folder field", async () => {
    const client = makeMockClient();
    const manager = makeManager(client);

    const result = await handleSearchMessages({ account: "personal", folder: "INBOX" }, manager);
    const parsed = JSON.parse(result.content[0].text) as Array<{ folder: string }>;

    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0]).toHaveProperty("folder", "INBOX");
  });

  it("returns error ToolResult when account unavailable", async () => {
    const manager = makeErrorManager("account unavailable");

    const result = await handleSearchMessages({ account: "missing" }, manager);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("account unavailable");
  });
});
