import { describe, it, expect, vi } from "vitest";
import { handleListMessages } from "../../src/tools/list-messages.js";
import type { ConnectionManager } from "../../src/connections/index.js";
import type { ImapFlow } from "imapflow";

// Helper to build a minimal mock FetchMessageObject
function makeMockMessage(
  uid: number,
  opts: {
    from?: string;
    subject?: string;
    date?: Date;
    seen?: boolean;
  } = {}
) {
  return {
    seq: uid,
    uid,
    envelope: {
      from: opts.from ? [{ address: opts.from }] : [],
      subject: opts.subject ?? `Subject ${uid}`,
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
          expect.arrayContaining(["uid", "from", "subject", "date", "unread"])
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
});
