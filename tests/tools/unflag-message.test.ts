import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleUnflagMessage } from "../../src/tools/unflag-message.js";
import type { ConnectionManager } from "../../src/connections/index.js";
import type { ImapFlow } from "imapflow";
import { logger } from "../../src/logger.js";

/** Build a minimal mock ImapFlow client for unflag_message tests */
function makeMockClient(overrides: Partial<Record<string, unknown>> = {}): ImapFlow {
  const mockLock = { release: vi.fn() };
  const mockGetMailboxLock = vi.fn().mockResolvedValue(mockLock);
  const mockMessageFlagsRemove = vi.fn().mockResolvedValue(true);

  return {
    getMailboxLock: mockGetMailboxLock,
    messageFlagsRemove: mockMessageFlagsRemove,
    mailbox: {
      permanentFlags: new Set(["\\Seen", "\\Flagged", "\\*"]),
    },
    ...overrides,
  } as unknown as ImapFlow;
}

/** Build a mock ConnectionManager that returns the given client */
function makeManager(client: ImapFlow): ConnectionManager {
  return {
    getClient: vi.fn().mockReturnValue(client),
    getAccountIds: vi.fn().mockReturnValue([]),
  } as unknown as ConnectionManager;
}

/** Build a mock ConnectionManager that returns an error */
function makeErrorManager(message = "no such account"): ConnectionManager {
  return {
    getClient: vi.fn().mockReturnValue({ error: message }),
    getAccountIds: vi.fn().mockReturnValue([]),
  } as unknown as ConnectionManager;
}

describe("handleUnflagMessage", () => {
  it("calls messageFlagsRemove with correct args and returns success", async () => {
    const client = makeMockClient();
    const manager = makeManager(client);

    const result = await handleUnflagMessage(
      { account: "test", uid: 42, keyword: "ClaudeProcessed" },
      manager
    );

    expect(client.messageFlagsRemove).toHaveBeenCalledWith([42], ["ClaudeProcessed"], {
      uid: true,
    });
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('"success":true');
  });

  it("returns isError true when getClient returns error", async () => {
    const manager = makeErrorManager("no such account");

    const result = await handleUnflagMessage(
      { account: "missing", uid: 1, keyword: "ClaudeProcessed" },
      manager
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("no such account");
  });

  it("returns isError true when messageFlagsRemove throws", async () => {
    const client = makeMockClient({
      messageFlagsRemove: vi.fn().mockRejectedValue(new Error("STORE failed")),
    });
    const manager = makeManager(client);

    const result = await handleUnflagMessage(
      { account: "test", uid: 42, keyword: "ClaudeProcessed" },
      manager
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("STORE failed");
    expect(result.content[0].text).toContain("42");
    expect(result.content[0].text).toContain("test");
    expect(result.content[0].text).toContain("ClaudeProcessed");
  });

  it("uses custom folder when provided", async () => {
    const client = makeMockClient();
    const manager = makeManager(client);

    await handleUnflagMessage(
      { account: "test", uid: 1, keyword: "Processed", folder: "Sent" },
      manager
    );

    expect(client.getMailboxLock).toHaveBeenCalledWith("Sent");
  });

  it("defaults folder to INBOX", async () => {
    const client = makeMockClient();
    const manager = makeManager(client);

    await handleUnflagMessage({ account: "test", uid: 1, keyword: "Processed" }, manager);

    expect(client.getMailboxLock).toHaveBeenCalledWith("INBOX");
  });

  it("calls poller.removeKeyword after successful messageFlagsRemove", async () => {
    const client = makeMockClient();
    const manager = makeManager(client);
    const mockPoller = { removeKeyword: vi.fn() };

    await handleUnflagMessage(
      { account: "test", uid: 42, keyword: "ClaudeProcessed" },
      manager,
      mockPoller as unknown as import("../../src/polling/poller.js").Poller
    );

    expect(mockPoller.removeKeyword).toHaveBeenCalledWith("test", 42, "ClaudeProcessed");
  });
});

describe("PERMANENTFLAGS warning (KFLAG-04)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("logs warning when permanentFlags lacks \\*", async () => {
    const client = makeMockClient({
      mailbox: {
        permanentFlags: new Set(["\\Seen", "\\Flagged"]),
      },
    });
    const manager = makeManager(client);
    const warnSpy = vi.spyOn(logger, "warn");

    const result = await handleUnflagMessage(
      { account: "test", uid: 42, keyword: "ClaudeProcessed" },
      manager
    );

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("PERMANENTFLAGS lacks"));
    expect(result.isError).toBe(false);
  });

  it("does not log warning when permanentFlags includes \\*", async () => {
    const client = makeMockClient({
      mailbox: {
        permanentFlags: new Set(["\\Seen", "\\*"]),
      },
    });
    const manager = makeManager(client);
    const warnSpy = vi.spyOn(logger, "warn");

    await handleUnflagMessage({ account: "test", uid: 42, keyword: "ClaudeProcessed" }, manager);

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
