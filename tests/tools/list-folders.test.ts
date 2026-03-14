import { vi, describe, it, expect, beforeEach } from "vitest";
import type { ImapFlow } from "imapflow";
import type { ConnectionManager } from "../../src/connections/index.js";
import { handleListFolders } from "../../src/tools/list-folders.js";

// Minimal mock of ImapFlow with a list() method
function makeClient(listImpl: () => Promise<unknown>): ImapFlow {
  return { list: vi.fn().mockImplementation(listImpl) } as unknown as ImapFlow;
}

// Minimal mock of ConnectionManager
function makeManager(client: ImapFlow | { error: string }): ConnectionManager {
  return {
    getClient: vi.fn().mockReturnValue(client),
  } as unknown as ConnectionManager;
}

describe("list_folders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("MAIL-01: returns flat array with all mailboxes", async () => {
    const mockFolders = [
      { path: "INBOX", status: { messages: 5, unseen: 2 } },
      { path: "Sent", specialUse: "\\Sent", status: { messages: 10, unseen: 0 } },
      { path: "Trash", specialUse: "\\Trash", status: { messages: 3, unseen: 0 } },
    ];
    const client = makeClient(() => Promise.resolve(mockFolders));
    const manager = makeManager(client);

    const result = await handleListFolders({ account: "personal" }, manager);

    expect(result.isError).toBe(false);
    const folders = JSON.parse(result.content[0].text);
    expect(folders).toHaveLength(3);
    expect(folders[0].name).toBe("INBOX");
    expect(folders[1].name).toBe("Sent");
    expect(folders[2].name).toBe("Trash");
  });

  it("MAIL-02: each folder entry includes total and unread counts", async () => {
    const mockFolders = [{ path: "INBOX", status: { messages: 10, unseen: 3 } }];
    const client = makeClient(() => Promise.resolve(mockFolders));
    const manager = makeManager(client);

    const result = await handleListFolders({ account: "personal" }, manager);

    expect(result.isError).toBe(false);
    const folders = JSON.parse(result.content[0].text);
    expect(folders[0].total).toBe(10);
    expect(folders[0].unread).toBe(3);
  });

  it("returns special_use Inbox for \\\\Inbox specialUse flag", async () => {
    const mockFolders = [
      { path: "INBOX", specialUse: "\\Inbox", status: { messages: 1, unseen: 0 } },
    ];
    const client = makeClient(() => Promise.resolve(mockFolders));
    const manager = makeManager(client);

    const result = await handleListFolders({ account: "personal" }, manager);

    expect(result.isError).toBe(false);
    const folders = JSON.parse(result.content[0].text);
    expect(folders[0].special_use).toBe("Inbox");
  });

  it("returns special_use null for folders with no special-use flag", async () => {
    const mockFolders = [{ path: "Archive", status: { messages: 0, unseen: 0 } }];
    const client = makeClient(() => Promise.resolve(mockFolders));
    const manager = makeManager(client);

    const result = await handleListFolders({ account: "personal" }, manager);

    expect(result.isError).toBe(false);
    const folders = JSON.parse(result.content[0].text);
    expect(folders[0].special_use).toBeNull();
  });

  it("returns error ToolResult when account is unavailable", async () => {
    const manager = makeManager({ error: 'account "x" is not configured' });

    const result = await handleListFolders({ account: "x" }, manager);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('account "x" is not configured');
  });

  describe("Multi-account fan-out (account omitted)", () => {
    function makeMultiAccountManager(
      accounts: Record<string, ImapFlow | { error: string }>
    ): ConnectionManager {
      return {
        getClient: vi.fn().mockImplementation((id: string) => accounts[id]),
        getAccountIds: vi.fn().mockReturnValue(Object.keys(accounts)),
      } as unknown as ConnectionManager;
    }

    function makeMultiClient(folders: { path: string; status: { messages: number; unseen: number }; specialUse?: string }[]): ImapFlow {
      return {
        list: vi.fn().mockResolvedValue(folders),
      } as unknown as ImapFlow;
    }

    it("two accounts succeed — merged array with account field, sorted alphabetically by name", async () => {
      const gmailClient = makeMultiClient([
        { path: "INBOX", status: { messages: 5, unseen: 2 } },
        { path: "Sent", specialUse: "\\Sent", status: { messages: 10, unseen: 0 } },
      ]);
      const workClient = makeMultiClient([
        { path: "Archive", status: { messages: 100, unseen: 0 } },
        { path: "INBOX", status: { messages: 3, unseen: 1 } },
      ]);

      const manager = makeMultiAccountManager({ gmail: gmailClient, work: workClient });

      const result = await handleListFolders({}, manager);

      expect(result.isError).toBe(false);
      const response = JSON.parse(result.content[0].text);
      expect(response).toHaveProperty("results");
      expect(response.results).toHaveLength(4);

      // Each result should have an account field
      for (const item of response.results) {
        expect(item).toHaveProperty("account");
        expect(["gmail", "work"]).toContain(item.account);
      }

      // Results sorted alphabetically by name
      const names = response.results.map((r: { name: string }) => r.name);
      const sortedNames = [...names].sort((a, b) => a.localeCompare(b));
      expect(names).toEqual(sortedNames);

      // No errors key when all succeed
      expect(response.errors).toBeUndefined();
    });

    it("one account fails — partial result with errors key, isError: false", async () => {
      const gmailClient = makeMultiClient([
        { path: "INBOX", status: { messages: 5, unseen: 2 } },
      ]);

      const manager = makeMultiAccountManager({
        gmail: gmailClient,
        work: { error: "work account not connected" },
      });

      const result = await handleListFolders({}, manager);

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

      const result = await handleListFolders({}, manager);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("All accounts failed");
    });

    it("single-account path unchanged when account is provided", async () => {
      const mockFolders = [{ path: "INBOX", status: { messages: 5, unseen: 2 } }];
      const client = makeClient(() => Promise.resolve(mockFolders));
      const manager = makeManager(client);

      const result = await handleListFolders({ account: "personal" }, manager);

      expect(result.isError).toBe(false);
      // Single-account path returns flat JSON array, not a { results } wrapper
      const parsed = JSON.parse(result.content[0].text);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe("INBOX");
    });
  });
});
