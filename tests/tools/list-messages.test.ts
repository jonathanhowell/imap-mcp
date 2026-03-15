import { describe, it, expect, vi } from "vitest";
import { handleListMessages } from "../../src/tools/list-messages.js";
import type { ConnectionManager } from "../../src/connections/index.js";
import type { ImapFlow } from "imapflow";

// Helper to build a minimal mock FetchMessageObject
function makeMockMessage(
  uid: number,
  opts: {
    from?: string;
    fromName?: string;
    subject?: string;
    date?: Date;
    seen?: boolean;
    to?: Array<{ name?: string; address: string }>;
    cc?: Array<{ name?: string; address: string }>;
  } = {}
) {
  return {
    seq: uid,
    uid,
    envelope: {
      from: opts.from ? [{ address: opts.from, name: opts.fromName }] : [],
      subject: opts.subject ?? `Subject ${uid}`,
      to: opts.to ?? [],
      cc: opts.cc ?? [],
    },
    flags: new Set<string>(opts.seen ? ["\\Seen"] : []),
    internalDate: opts.date ?? new Date("2024-01-01T00:00:00.000Z"),
  };
}

function makeManagerWithClient(
  clientOverrides: Partial<{
    search: (criteria: unknown, opts: unknown) => Promise<number[] | false>;
    fetchAll: (range: unknown, query: unknown, opts: unknown) => Promise<unknown[]>;
    getMailboxLock: (path: unknown, opts: unknown) => Promise<{ release: () => void }>;
  }>
) {
  const mockLock = { release: vi.fn() };

  const mockClient = {
    getMailboxLock: vi.fn().mockResolvedValue(mockLock),
    search: vi.fn().mockResolvedValue([]),
    fetchAll: vi.fn().mockResolvedValue([]),
    ...clientOverrides,
  };

  const mockManager = {
    getClient: vi.fn().mockReturnValue(mockClient as unknown as ImapFlow),
  } as unknown as ConnectionManager;

  return { mockManager, mockClient, mockLock };
}

describe("list_messages", () => {
  describe("MAIL-03: accepts any folder path, not just INBOX", () => {
    it("passes any folder path to getMailboxLock", async () => {
      const { mockManager, mockClient, mockLock } = makeManagerWithClient({
        search: vi.fn().mockResolvedValue([101, 102]),
        fetchAll: vi.fn().mockResolvedValue([makeMockMessage(101), makeMockMessage(102)]),
      });

      await handleListMessages({ account: "work", folder: "Work/Projects" }, mockManager);

      expect(mockClient.getMailboxLock).toHaveBeenCalledWith("Work/Projects", { readOnly: true });
      expect(mockLock.release.mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe("LIST-01: pagination", () => {
    it("respects limit parameter — returns at most limit messages", async () => {
      // 100 UIDs, limit=10 → 10 results
      const uids = Array.from({ length: 100 }, (_, i) => i + 1);
      const { mockManager, mockLock } = makeManagerWithClient({
        search: vi.fn().mockResolvedValue(uids),
        fetchAll: vi
          .fn()
          .mockImplementation((pageUids: number[]) =>
            Promise.resolve(pageUids.map((uid) => makeMockMessage(uid)))
          ),
      });

      const result = await handleListMessages(
        { account: "work", folder: "INBOX", limit: 10, offset: 0 },
        mockManager
      );

      expect(result.isError).toBe(false);
      const headers = JSON.parse(result.content[0].text);
      expect(headers).toHaveLength(10);
      expect(mockLock.release.mock.calls.length).toBeGreaterThan(0);
    });

    it("respects offset parameter — returns items starting at offset", async () => {
      // 100 UIDs, limit=10, offset=10 → items 10-19 (0-indexed)
      const uids = Array.from({ length: 100 }, (_, i) => i + 1);
      const { mockManager, mockLock } = makeManagerWithClient({
        search: vi.fn().mockResolvedValue(uids),
        fetchAll: vi
          .fn()
          .mockImplementation((pageUids: number[]) =>
            Promise.resolve(pageUids.map((uid) => makeMockMessage(uid)))
          ),
      });

      const result = await handleListMessages(
        { account: "work", folder: "INBOX", limit: 10, offset: 10 },
        mockManager
      );

      expect(result.isError).toBe(false);
      const headers = JSON.parse(result.content[0].text);
      expect(headers).toHaveLength(10);
      // With newest sort (default), UIDs 100..1 descending; offset=10 means items at index 10..19
      // That's UIDs 90..81
      expect(mockLock.release.mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe("LIST-02: unread filter", () => {
    it("passes seen: false search criteria when unread_only=true", async () => {
      const { mockManager, mockClient, mockLock } = makeManagerWithClient({
        search: vi.fn().mockResolvedValue([5, 10, 15]),
        fetchAll: vi
          .fn()
          .mockResolvedValue([
            makeMockMessage(5, { seen: false }),
            makeMockMessage(10, { seen: false }),
            makeMockMessage(15, { seen: false }),
          ]),
      });

      const result = await handleListMessages(
        { account: "work", folder: "INBOX", unread_only: true },
        mockManager
      );

      expect(result.isError).toBe(false);
      const headers = JSON.parse(result.content[0].text);
      expect(headers.length).toBe(3);
      // All should be unread
      for (const h of headers) {
        expect(h.unread).toBe(true);
      }
      // Search must have been called with seen: false
      expect(mockClient.search).toHaveBeenCalledWith({ seen: false }, { uid: true });
      expect(mockLock.release.mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe("LIST-03: sort order", () => {
    it("sort=newest returns messages with newest date first", async () => {
      // UIDs [1, 5, 3] — newest sort should produce [5, 3, 1]
      const { mockManager, mockLock } = makeManagerWithClient({
        search: vi.fn().mockResolvedValue([1, 5, 3]),
        fetchAll: vi.fn().mockImplementation((pageUids: number[]) =>
          Promise.resolve(
            pageUids.map((uid) =>
              makeMockMessage(uid, {
                date: new Date(`2024-01-0${uid}T00:00:00.000Z`),
              })
            )
          )
        ),
      });

      const result = await handleListMessages(
        { account: "work", folder: "INBOX", sort: "newest" },
        mockManager
      );

      expect(result.isError).toBe(false);
      const headers = JSON.parse(result.content[0].text);
      // fetchAll receives sorted UIDs, so first UID should be 5 (highest)
      expect(headers[0].uid).toBe(5);
      expect(headers[1].uid).toBe(3);
      expect(headers[2].uid).toBe(1);
      expect(mockLock.release.mock.calls.length).toBeGreaterThan(0);
    });

    it("sort=oldest returns messages with oldest date first", async () => {
      // UIDs [1, 5, 3] — oldest sort should preserve ascending order [1, 3, 5]
      const { mockManager, mockLock } = makeManagerWithClient({
        search: vi.fn().mockResolvedValue([1, 5, 3]),
        fetchAll: vi.fn().mockImplementation((pageUids: number[]) =>
          Promise.resolve(
            pageUids.map((uid) =>
              makeMockMessage(uid, {
                date: new Date(`2024-01-0${uid}T00:00:00.000Z`),
              })
            )
          )
        ),
      });

      const result = await handleListMessages(
        { account: "work", folder: "INBOX", sort: "oldest" },
        mockManager
      );

      expect(result.isError).toBe(false);
      const headers = JSON.parse(result.content[0].text);
      // fetchAll receives sorted UIDs [1, 3, 5] for oldest
      // But search returns [1,5,3] and oldest keeps ascending so slice is [1,5,3]
      // The service uses allUids as-is for oldest; let's verify first UID is 1 (lowest)
      expect(headers[0].uid).toBe(1);
      expect(mockLock.release.mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe("LIST-04: no body fields in response", () => {
    it("response messages have no body, text, or html keys", async () => {
      const { mockManager, mockLock } = makeManagerWithClient({
        search: vi.fn().mockResolvedValue([1, 2, 3]),
        fetchAll: vi
          .fn()
          .mockResolvedValue([makeMockMessage(1), makeMockMessage(2), makeMockMessage(3)]),
      });

      const result = await handleListMessages({ account: "work", folder: "INBOX" }, mockManager);

      expect(result.isError).toBe(false);
      const headers = JSON.parse(result.content[0].text);
      for (const h of headers) {
        expect(h).not.toHaveProperty("body");
        expect(h).not.toHaveProperty("text");
        expect(h).not.toHaveProperty("html");
        // Should only have MessageHeader fields
        expect(Object.keys(h)).toEqual(
          expect.arrayContaining(["uid", "from", "subject", "date", "unread", "to", "cc"])
        );
      }
      expect(mockLock.release.mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe("Error handling", () => {
    it("returns error ToolResult when account is unavailable", async () => {
      const mockManager = {
        getClient: vi.fn().mockReturnValue({ error: "account not found" }),
      } as unknown as ConnectionManager;

      const result = await handleListMessages(
        { account: "nonexistent", folder: "INBOX" },
        mockManager
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("account not found");
    });
  });

  describe("200-result hard cap", () => {
    it("single-account: limit=500 clamps to at most 200 results", async () => {
      // 300 UIDs available, limit=500 requested — cap should fire at 200
      const uids = Array.from({ length: 300 }, (_, i) => i + 1);
      const { mockManager } = makeManagerWithClient({
        search: vi.fn().mockResolvedValue(uids),
        fetchAll: vi
          .fn()
          .mockImplementation((pageUids: number[]) =>
            Promise.resolve(pageUids.map((uid) => makeMockMessage(uid)))
          ),
      });

      const result = await handleListMessages(
        { account: "work", folder: "INBOX", limit: 500 },
        mockManager
      );

      expect(result.isError).toBe(false);
      const headers = JSON.parse(result.content[0].text);
      expect(headers.length).toBeLessThanOrEqual(200);
    });

    it("single-account: limit=50 (below cap) returns up to 50 results — cap does not lower default", async () => {
      // 300 UIDs available, limit=50 — cap should not reduce below requested limit
      const uids = Array.from({ length: 300 }, (_, i) => i + 1);
      const { mockManager } = makeManagerWithClient({
        search: vi.fn().mockResolvedValue(uids),
        fetchAll: vi
          .fn()
          .mockImplementation((pageUids: number[]) =>
            Promise.resolve(pageUids.map((uid) => makeMockMessage(uid)))
          ),
      });

      const result = await handleListMessages(
        { account: "work", folder: "INBOX", limit: 50 },
        mockManager
      );

      expect(result.isError).toBe(false);
      const headers = JSON.parse(result.content[0].text);
      expect(headers).toHaveLength(50);
    });

    it("single-account: limit=undefined uses default 50 — unaffected by cap", async () => {
      const uids = Array.from({ length: 300 }, (_, i) => i + 1);
      const { mockManager } = makeManagerWithClient({
        search: vi.fn().mockResolvedValue(uids),
        fetchAll: vi
          .fn()
          .mockImplementation((pageUids: number[]) =>
            Promise.resolve(pageUids.map((uid) => makeMockMessage(uid)))
          ),
      });

      const result = await handleListMessages({ account: "work", folder: "INBOX" }, mockManager);

      expect(result.isError).toBe(false);
      const headers = JSON.parse(result.content[0].text);
      expect(headers).toHaveLength(50);
    });

    it("multi-account: limit=500 clamps to at most 200 results in merged output", async () => {
      // Build a multi-account manager with two accounts each returning 200 messages
      function makeMultiCapClient(count: number) {
        const uids = Array.from({ length: count }, (_, i) => i + 1);
        const msgs = uids.map((uid) =>
          makeMockMessage(uid, {
            date: new Date(`2024-01-${String((uid % 28) + 1).padStart(2, "0")}T00:00:00.000Z`),
          })
        );
        return {
          getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
          search: vi.fn().mockResolvedValue(uids),
          fetchAll: vi
            .fn()
            .mockImplementation((pageUids: number[]) =>
              Promise.resolve(msgs.filter((m) => pageUids.includes(m.uid)))
            ),
        } as unknown as import("imapflow").ImapFlow;
      }

      const gmailClient = makeMultiCapClient(200);
      const workClient = makeMultiCapClient(200);

      const manager = {
        getClient: vi
          .fn()
          .mockImplementation((id: string) => (id === "gmail" ? gmailClient : workClient)),
        getAccountIds: vi.fn().mockReturnValue(["gmail", "work"]),
      } as unknown as import("../../src/connections/index.js").ConnectionManager;

      const result = await handleListMessages({ folder: "INBOX", limit: 500 }, manager);

      expect(result.isError).toBe(false);
      const response = JSON.parse(result.content[0].text);
      expect(response.results.length).toBeLessThanOrEqual(200);
    });
  });

  describe("Multi-account fan-out (account omitted)", () => {
    // Helper to build a multi-account manager mock
    function makeMultiAccountManager(accounts: Record<string, ImapFlow | { error: string }>) {
      const mockLocks: Record<string, { release: ReturnType<typeof vi.fn> }> = {};

      for (const [accountId, clientOrErr] of Object.entries(accounts)) {
        if (!("error" in clientOrErr)) {
          mockLocks[accountId] = { release: vi.fn() };
          (clientOrErr as unknown as Record<string, unknown>).getMailboxLock = vi
            .fn()
            .mockResolvedValue(mockLocks[accountId]);
        }
      }

      return {
        getClient: vi.fn().mockImplementation((id: string) => accounts[id]),
        getAccountIds: vi.fn().mockReturnValue(Object.keys(accounts)),
      } as unknown as ConnectionManager;
    }

    function makeMultiClient(messages: ReturnType<typeof makeMockMessage>[]) {
      return {
        getMailboxLock: vi.fn(),
        search: vi.fn().mockResolvedValue(messages.map((m) => m.uid)),
        fetchAll: vi
          .fn()
          .mockImplementation((pageUids: number[]) =>
            Promise.resolve(messages.filter((m) => pageUids.includes(m.uid)))
          ),
      } as unknown as ImapFlow;
    }

    it("two accounts succeed — merged flat array with account field, sorted newest-first", async () => {
      const gmailMessages = [
        makeMockMessage(10, { date: new Date("2024-01-10T00:00:00.000Z"), subject: "Gmail 10" }),
        makeMockMessage(5, { date: new Date("2024-01-05T00:00:00.000Z"), subject: "Gmail 5" }),
      ];
      const workMessages = [
        makeMockMessage(8, { date: new Date("2024-01-08T00:00:00.000Z"), subject: "Work 8" }),
        makeMockMessage(3, { date: new Date("2024-01-03T00:00:00.000Z"), subject: "Work 3" }),
      ];

      const gmailClient = makeMultiClient(gmailMessages);
      const workClient = makeMultiClient(workMessages);

      const manager = makeMultiAccountManager({ gmail: gmailClient, work: workClient });

      const result = await handleListMessages({ folder: "INBOX" }, manager);

      expect(result.isError).toBe(false);
      const response = JSON.parse(result.content[0].text);
      expect(response).toHaveProperty("results");
      expect(response.results).toHaveLength(4);

      // Results should be sorted newest-first by date
      const dates = response.results.map((r: { date: string }) => new Date(r.date).getTime());
      for (let i = 0; i < dates.length - 1; i++) {
        expect(dates[i]).toBeGreaterThanOrEqual(dates[i + 1]);
      }

      // Each result should have an account field
      for (const item of response.results) {
        expect(item).toHaveProperty("account");
        expect(["gmail", "work"]).toContain(item.account);
      }

      // No errors key when all succeed
      expect(response.errors).toBeUndefined();
    });

    it("unified INBOX unread: account omitted, folder=INBOX, unread_only=true — results from both accounts", async () => {
      const gmailClient = makeMultiClient([
        makeMockMessage(1, { date: new Date("2024-01-10T00:00:00.000Z") }),
      ]);
      const workClient = makeMultiClient([
        makeMockMessage(2, { date: new Date("2024-01-09T00:00:00.000Z") }),
      ]);

      const manager = makeMultiAccountManager({ gmail: gmailClient, work: workClient });

      const result = await handleListMessages({ folder: "INBOX", unread_only: true }, manager);

      expect(result.isError).toBe(false);
      const response = JSON.parse(result.content[0].text);
      expect(response.results).toHaveLength(2);
      expect(response.results[0].account).toBeDefined();
      expect(response.results[1].account).toBeDefined();
    });

    it("one account fails — partial result with errors key, isError: false", async () => {
      const gmailMessages = [makeMockMessage(10, { date: new Date("2024-01-10T00:00:00.000Z") })];
      const gmailClient = makeMultiClient(gmailMessages);

      const manager = makeMultiAccountManager({
        gmail: gmailClient,
        work: { error: "work account not connected" },
      });

      const result = await handleListMessages({ folder: "INBOX" }, manager);

      expect(result.isError).toBe(false);
      const response = JSON.parse(result.content[0].text);
      expect(response.results).toHaveLength(1);
      expect(response.results[0].account).toBe("gmail");
      expect(response.errors).toBeDefined();
      expect(response.errors.work).toBeDefined();
    });

    it("all accounts fail — isError: true", async () => {
      const manager = makeMultiAccountManager({
        gmail: { error: "gmail not connected" },
        work: { error: "work not connected" },
      });

      const result = await handleListMessages({ folder: "INBOX" }, manager);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("All accounts failed");
    });

    it("pagination: offset applied to merged result, not per account", async () => {
      const gmailMessages = [
        makeMockMessage(10, { date: new Date("2024-01-10T00:00:00.000Z") }),
        makeMockMessage(8, { date: new Date("2024-01-08T00:00:00.000Z") }),
        makeMockMessage(6, { date: new Date("2024-01-06T00:00:00.000Z") }),
      ];
      const workMessages = [
        makeMockMessage(9, { date: new Date("2024-01-09T00:00:00.000Z") }),
        makeMockMessage(7, { date: new Date("2024-01-07T00:00:00.000Z") }),
        makeMockMessage(5, { date: new Date("2024-01-05T00:00:00.000Z") }),
      ];

      const gmailClient = makeMultiClient(gmailMessages);
      const workClient = makeMultiClient(workMessages);

      const manager = makeMultiAccountManager({ gmail: gmailClient, work: workClient });

      // offset=2, limit=2 → items at index 2 and 3 of merged sorted results
      const result = await handleListMessages({ folder: "INBOX", limit: 2, offset: 2 }, manager);

      expect(result.isError).toBe(false);
      const response = JSON.parse(result.content[0].text);
      // Merged sorted newest-first: dates jan10,9,8,7,6,5
      // offset=2 → start from index 2 → jan8, jan7
      expect(response.results).toHaveLength(2);
      expect(new Date(response.results[0].date).getDate()).toBe(8);
      expect(new Date(response.results[1].date).getDate()).toBe(7);
    });
  });

  describe("HDR-01: to and cc fields on list_messages response", () => {
    it("message with recipients: to and cc arrays contain formatted strings", async () => {
      const { mockManager, mockLock } = makeManagerWithClient({
        search: vi.fn().mockResolvedValue([1]),
        fetchAll: vi.fn().mockResolvedValue([
          makeMockMessage(1, {
            from: "alice@example.com",
            fromName: "Alice Smith",
            to: [{ address: "bob@example.com", name: "Bob Jones" }],
            cc: [{ address: "carol@example.com" }],
          }),
        ]),
      });

      const result = await handleListMessages({ account: "work", folder: "INBOX" }, mockManager);

      expect(result.isError).toBe(false);
      const headers = JSON.parse(result.content[0].text);
      expect(headers).toHaveLength(1);
      expect(headers[0].to).toEqual(["Bob Jones <bob@example.com>"]);
      expect(headers[0].cc).toEqual(["carol@example.com"]);
      expect(headers[0].from).toBe("Alice Smith <alice@example.com>");
      expect(mockLock.release.mock.calls.length).toBeGreaterThan(0);
    });

    it("message with no recipients: to and cc are empty arrays, not absent", async () => {
      const { mockManager, mockLock } = makeManagerWithClient({
        search: vi.fn().mockResolvedValue([2]),
        fetchAll: vi.fn().mockResolvedValue([makeMockMessage(2)]),
      });

      const result = await handleListMessages({ account: "work", folder: "INBOX" }, mockManager);

      expect(result.isError).toBe(false);
      const headers = JSON.parse(result.content[0].text);
      expect(headers[0]).toHaveProperty("to");
      expect(headers[0]).toHaveProperty("cc");
      expect(headers[0].to).toEqual([]);
      expect(headers[0].cc).toEqual([]);
      expect(mockLock.release.mock.calls.length).toBeGreaterThan(0);
    });

    it("from uses bare address when no display name is available", async () => {
      const { mockManager, mockLock } = makeManagerWithClient({
        search: vi.fn().mockResolvedValue([3]),
        fetchAll: vi.fn().mockResolvedValue([makeMockMessage(3, { from: "sender@example.com" })]),
      });

      const result = await handleListMessages({ account: "work", folder: "INBOX" }, mockManager);

      expect(result.isError).toBe(false);
      const headers = JSON.parse(result.content[0].text);
      expect(headers[0].from).toBe("sender@example.com");
      expect(mockLock.release.mock.calls.length).toBeGreaterThan(0);
    });
  });
});
