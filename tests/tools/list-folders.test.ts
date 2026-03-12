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
});
