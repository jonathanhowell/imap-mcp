// Tests for AppConfigSchema polling field (Task 1) and Poller class (Task 2).
// Replaces Wave 0 it.todo stubs.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Task 1: AppConfigSchema polling field tests ---
import { AppConfigSchema } from "../../src/config/schema.js";

const validAccount = {
  name: "test",
  host: "imap.example.com",
  port: 993,
  username: "user@example.com",
  password: "secret",
};

describe("AppConfigSchema polling field", () => {
  it("Test 1: succeeds when polling is omitted", () => {
    expect(() => AppConfigSchema.parse({ accounts: [validAccount] })).not.toThrow();
  });

  it("Test 2: succeeds with polling.interval_seconds: 60", () => {
    expect(() =>
      AppConfigSchema.parse({
        accounts: [validAccount],
        polling: { interval_seconds: 60 },
      })
    ).not.toThrow();
  });

  it("Test 3: throws when polling.interval_seconds is 0", () => {
    expect(() =>
      AppConfigSchema.parse({
        accounts: [validAccount],
        polling: { interval_seconds: 0 },
      })
    ).toThrow();
  });

  it("Test 4: throws when polling.interval_seconds is -1", () => {
    expect(() =>
      AppConfigSchema.parse({
        accounts: [validAccount],
        polling: { interval_seconds: -1 },
      })
    ).toThrow();
  });

  it("Test 5: succeeds with empty polling object (interval_seconds is optional)", () => {
    expect(() =>
      AppConfigSchema.parse({
        accounts: [validAccount],
        polling: {},
      })
    ).not.toThrow();
  });
});

// --- Task 2: Poller class tests ---
import { Poller } from "../../src/polling/poller.js";
import type { ConnectionManager } from "../../src/connections/index.js";
import { searchMessages } from "../../src/services/search-service.js";
import { logger } from "../../src/logger.js";

vi.mock("../../src/services/search-service.js", () => ({
  searchMessages: vi.fn(),
}));

const mockSearchMessages = vi.mocked(searchMessages);

function makeMockManager(accountIds: string[] = ["acct1"]): ConnectionManager {
  return {
    getAccountIds: vi.fn().mockReturnValue(accountIds),
    getClient: vi.fn().mockReturnValue({ mailbox: "INBOX" }), // fake ImapFlow-like object
  } as unknown as ConnectionManager;
}

/**
 * Run one poll cycle and stop after it completes.
 * Uses advanceTimersByTimeAsync(0) to flush promise microtasks without
 * advancing fake time, so the poll resolves but no scheduled setTimeout fires.
 * Then stops the poller to prevent further scheduling.
 */
async function runOnePoll(poller: Poller): Promise<void> {
  poller.start();
  // Flush all pending promises/microtasks (0ms = no timer advancement)
  // Repeat to ensure nested async operations complete
  for (let i = 0; i < 10; i++) {
    await vi.advanceTimersByTimeAsync(0);
  }
  poller.stop();
}

describe("Poller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "setTimeout");
    mockSearchMessages.mockReset();
    mockSearchMessages.mockResolvedValue([]);
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("Test 1: isCacheReady() returns false before any poll", () => {
    const poller = new Poller(makeMockManager());
    expect(poller.isCacheReady()).toBe(false);
  });

  it("Test 2: isCacheReady() returns true after first poll completes", async () => {
    const manager = makeMockManager();
    const poller = new Poller(manager);
    await runOnePoll(poller);
    expect(poller.isCacheReady()).toBe(true);
  });

  it("Test 3: start() calls searchMessages for each account immediately", async () => {
    const manager = makeMockManager(["acct1", "acct2"]);
    const poller = new Poller(manager);
    await runOnePoll(poller);
    expect(mockSearchMessages).toHaveBeenCalledTimes(2);
  });

  it("Test 4: after poll resolves, globalThis.setTimeout is called with the configured interval", async () => {
    const manager = makeMockManager();
    const poller = new Poller(manager, 60);
    poller.start();
    // Flush promises so the first poll completes (no timer advancement needed)
    await vi.advanceTimersByTimeAsync(0);
    poller.stop();
    expect(globalThis.setTimeout).toHaveBeenCalledWith(expect.any(Function), 60 * 1000);
  });

  it("Test 5: after stop(), no further setTimeout calls are scheduled", async () => {
    const manager = makeMockManager();
    const poller = new Poller(manager, 60);
    // Let first poll complete (this schedules the next setTimeout)
    await runOnePoll(poller);
    const callCountBeforeStop = (globalThis.setTimeout as ReturnType<typeof vi.fn>).mock.calls
      .length;
    // stop() has already been called by runOnePoll — no new timers should fire
    // Advance timers substantially — no new loop should be scheduled
    await vi.advanceTimersByTimeAsync(120 * 1000);
    expect((globalThis.setTimeout as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      callCountBeforeStop
    );
  });

  it("Test 6: per-account exception is caught; other accounts still polled; logger.error called", async () => {
    const manager = makeMockManager(["failAcct", "okAcct"]);
    mockSearchMessages.mockRejectedValueOnce(new Error("IMAP error")).mockResolvedValueOnce([]);
    const poller = new Poller(manager);
    await runOnePoll(poller);
    expect(logger.error).toHaveBeenCalled();
    // Both accounts were attempted
    expect(mockSearchMessages).toHaveBeenCalledTimes(2);
  });

  it("Test 7: mergeIntoCache deduplicates by uid", async () => {
    const manager = makeMockManager(["acct1"]);
    const msg = {
      uid: 1,
      from: "a@b.com",
      subject: "hi",
      date: new Date().toISOString(),
      unread: false,
      folder: "INBOX",
      account: "acct1",
    };
    mockSearchMessages.mockResolvedValueOnce([msg]).mockResolvedValueOnce([msg]); // same message again on second poll
    const poller = new Poller(manager, 60);
    // First poll
    await runOnePoll(poller);
    // Start again to trigger second poll
    await runOnePoll(poller);
    const result = poller.query(new Date(0).toISOString());
    expect(result.results.length).toBe(1);
  });

  it("Test 8: query(since) returns messages newer than since, sorted newest-first", async () => {
    const manager = makeMockManager(["acct1"]);
    const older = {
      uid: 1,
      from: "a@b.com",
      subject: "old",
      date: "2020-01-01T00:00:00.000Z",
      unread: false,
      folder: "INBOX",
      account: "acct1",
    };
    const newer = {
      uid: 2,
      from: "a@b.com",
      subject: "new",
      date: "2021-01-01T00:00:00.000Z",
      unread: false,
      folder: "INBOX",
      account: "acct1",
    };
    mockSearchMessages.mockResolvedValueOnce([older, newer]);
    const poller = new Poller(manager);
    await runOnePoll(poller);
    const result = poller.query("2020-06-01T00:00:00.000Z");
    expect(result.results.length).toBe(1);
    expect(result.results[0].uid).toBe(2);
  });

  it("Test 9: query(since) without account returns messages from all accounts", async () => {
    const manager = makeMockManager(["acct1", "acct2"]);
    const msg1 = {
      uid: 1,
      from: "a@b.com",
      subject: "s1",
      date: "2021-01-01T00:00:00.000Z",
      unread: false,
      folder: "INBOX",
      account: "acct1",
    };
    const msg2 = {
      uid: 2,
      from: "c@d.com",
      subject: "s2",
      date: "2021-01-02T00:00:00.000Z",
      unread: false,
      folder: "INBOX",
      account: "acct2",
    };
    mockSearchMessages.mockResolvedValueOnce([msg1]).mockResolvedValueOnce([msg2]);
    const poller = new Poller(manager);
    await runOnePoll(poller);
    const result = poller.query(new Date(0).toISOString());
    expect(result.results.length).toBe(2);
  });

  it("Test 10: query(since, accountId) returns messages from one account only", async () => {
    const manager = makeMockManager(["acct1", "acct2"]);
    const msg1 = {
      uid: 1,
      from: "a@b.com",
      subject: "s1",
      date: "2021-01-01T00:00:00.000Z",
      unread: false,
      folder: "INBOX",
      account: "acct1",
    };
    const msg2 = {
      uid: 2,
      from: "c@d.com",
      subject: "s2",
      date: "2021-01-02T00:00:00.000Z",
      unread: false,
      folder: "INBOX",
      account: "acct2",
    };
    mockSearchMessages.mockResolvedValueOnce([msg1]).mockResolvedValueOnce([msg2]);
    const poller = new Poller(manager);
    await runOnePoll(poller);
    const result = poller.query(new Date(0).toISOString(), "acct1");
    expect(result.results.length).toBe(1);
    expect(result.results[0].account).toBe("acct1");
  });

  it("Test 11: incremental poll uses lastPollTime - 24h as since date", async () => {
    const manager = makeMockManager(["acct1"]);
    const poller = new Poller(manager, 60);
    // First poll (seed) — run and let it complete
    await runOnePoll(poller);
    // Reset call tracking
    mockSearchMessages.mockClear();
    // Run one more incremental poll
    await runOnePoll(poller);
    // The since param on the incremental call should be ~24h before lastPollTime
    expect(mockSearchMessages).toHaveBeenCalledTimes(1);
    const callArgs = mockSearchMessages.mock.calls[0][1];
    expect(callArgs).toHaveProperty("since");
    // since should be recent (within last 25 hours from real time perspective)
    const sinceTime = new Date(callArgs.since as string).getTime();
    const now = Date.now();
    expect(now - sinceTime).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(now - sinceTime).toBeLessThan(25 * 60 * 60 * 1000);
  });

  it("Test 12: default interval is 300 seconds when no intervalSeconds given", async () => {
    const manager = makeMockManager();
    const poller = new Poller(manager); // no intervalSeconds
    poller.start();
    // Flush promises so the first poll completes (no timer advancement needed)
    await vi.advanceTimersByTimeAsync(0);
    poller.stop();
    expect(globalThis.setTimeout).toHaveBeenCalledWith(expect.any(Function), 300 * 1000);
  });

  describe("query with excludeKeywords (KFLAG-03)", () => {
    it("excludes messages with matching keyword from results", () => {
      const manager = makeMockManager(["acct1"]);
      const poller = new Poller(manager);

      const sinceDate = new Date(0).toISOString();
      const entries = [
        {
          uid: 1,
          from: "a@b.com",
          subject: "processed",
          date: "2024-01-01T00:00:00Z",
          unread: false,
          folder: "INBOX",
          account: "acct1",
          keywords: ["ClaudeProcessed"],
        },
        {
          uid: 2,
          from: "c@d.com",
          subject: "no keywords",
          date: "2024-01-02T00:00:00Z",
          unread: false,
          folder: "INBOX",
          account: "acct1",
          keywords: [],
        },
        {
          uid: 3,
          from: "e@f.com",
          subject: "undefined keywords",
          date: "2024-01-03T00:00:00Z",
          unread: false,
          folder: "INBOX",
          account: "acct1",
          keywords: undefined,
        },
      ];

      // Directly populate the private cache
      (poller as unknown as Record<string, unknown>)["cache"].set("acct1", entries);
      (poller as unknown as Record<string, unknown>)["lastPollTime"] = new Date();

      const result = poller.query(sinceDate, undefined, ["ClaudeProcessed"]);
      const uids = result.results.map((m) => m.uid);
      expect(uids).not.toContain(1);
      expect(uids).toContain(2);
      expect(uids).toContain(3);
    });

    it("keyword comparison is case-insensitive", () => {
      const manager = makeMockManager(["acct1"]);
      const poller = new Poller(manager);

      const sinceDate = new Date(0).toISOString();
      const entries = [
        {
          uid: 1,
          from: "a@b.com",
          subject: "lowercase keyword",
          date: "2024-01-01T00:00:00Z",
          unread: false,
          folder: "INBOX",
          account: "acct1",
          keywords: ["claudeprocessed"],
        },
      ];

      (poller as unknown as Record<string, unknown>)["cache"].set("acct1", entries);
      (poller as unknown as Record<string, unknown>)["lastPollTime"] = new Date();

      const result = poller.query(sinceDate, undefined, ["ClaudeProcessed"]);
      expect(result.results).toHaveLength(0);
    });

    it("returns all entries when excludeKeywords is undefined", () => {
      const manager = makeMockManager(["acct1"]);
      const poller = new Poller(manager);

      const sinceDate = new Date(0).toISOString();
      const entries = [
        {
          uid: 1,
          from: "a@b.com",
          subject: "has keyword",
          date: "2024-01-01T00:00:00Z",
          unread: false,
          folder: "INBOX",
          account: "acct1",
          keywords: ["ClaudeProcessed"],
        },
        {
          uid: 2,
          from: "c@d.com",
          subject: "no keyword",
          date: "2024-01-02T00:00:00Z",
          unread: false,
          folder: "INBOX",
          account: "acct1",
          keywords: [],
        },
      ];

      (poller as unknown as Record<string, unknown>)["cache"].set("acct1", entries);
      (poller as unknown as Record<string, unknown>)["lastPollTime"] = new Date();

      const result = poller.query(sinceDate);
      expect(result.results).toHaveLength(2);
    });

    it("excludes messages matching any keyword in the array (multi-keyword)", () => {
      const manager = makeMockManager(["acct1"]);
      const poller = new Poller(manager);

      const sinceDate = new Date(0).toISOString();
      const entries = [
        {
          uid: 1,
          from: "a@b.com",
          subject: "processed",
          date: "2024-01-01T00:00:00Z",
          unread: false,
          folder: "INBOX",
          account: "acct1",
          keywords: ["ClaudeProcessed"],
        },
        {
          uid: 2,
          from: "b@c.com",
          subject: "replied",
          date: "2024-01-02T00:00:00Z",
          unread: false,
          folder: "INBOX",
          account: "acct1",
          keywords: ["ClaudeReplied"],
        },
        {
          uid: 3,
          from: "c@d.com",
          subject: "clean",
          date: "2024-01-03T00:00:00Z",
          unread: false,
          folder: "INBOX",
          account: "acct1",
          keywords: [],
        },
      ];

      (poller as unknown as Record<string, unknown>)["cache"].set("acct1", entries);
      (poller as unknown as Record<string, unknown>)["lastPollTime"] = new Date();

      const result = poller.query(sinceDate, undefined, ["ClaudeProcessed", "ClaudeReplied"]);
      const uids = result.results.map((m) => m.uid);
      expect(uids).not.toContain(1);
      expect(uids).not.toContain(2);
      expect(uids).toContain(3);
    });
  });

  describe("removeKeyword", () => {
    const accountId = "acct1";

    it("removes keyword case-insensitively from cached message keywords array", () => {
      const manager = makeMockManager([accountId]);
      const poller = new Poller(manager);

      const entries = [
        {
          uid: 42,
          from: "a@b.com",
          subject: "test",
          date: "2024-01-01T00:00:00Z",
          unread: false,
          folder: "INBOX",
          account: accountId,
          keywords: ["ClaudeProcessed", "Other"],
        },
      ];

      (poller as unknown as Record<string, unknown>)["cache"].set(accountId, entries);

      poller.removeKeyword(accountId, 42, "claudeprocessed");

      const cached = (poller as unknown as Record<string, unknown>)["cache"] as Map<
        string,
        typeof entries
      >;
      const msg = cached.get(accountId)?.find((m) => m.uid === 42);
      expect(msg?.keywords).toEqual(["Other"]);
    });

    it("is no-op when accountId not in cache", () => {
      const manager = makeMockManager([accountId]);
      const poller = new Poller(manager);

      // No entries set in cache — should not throw
      expect(() => poller.removeKeyword("nonexistent", 42, "kw")).not.toThrow();
    });

    it("is no-op when uid not found in cache entries", () => {
      const manager = makeMockManager([accountId]);
      const poller = new Poller(manager);

      const entries = [
        {
          uid: 99,
          from: "a@b.com",
          subject: "other",
          date: "2024-01-01T00:00:00Z",
          unread: false,
          folder: "INBOX",
          account: accountId,
          keywords: ["SomeKeyword"],
        },
      ];

      (poller as unknown as Record<string, unknown>)["cache"].set(accountId, entries);

      // uid 42 doesn't exist — uid 99 entry should be unchanged
      poller.removeKeyword(accountId, 42, "kw");

      const cached = (poller as unknown as Record<string, unknown>)["cache"] as Map<
        string,
        typeof entries
      >;
      const msg = cached.get(accountId)?.find((m) => m.uid === 99);
      expect(msg?.keywords).toEqual(["SomeKeyword"]);
    });
  });

  // --------------------------------------------------------------------------
  // Phase 12 Wave 0 — CONN-07 / D-15 poller skip behavior.
  // Red because pollAccount() currently calls getClient() unconditionally and
  // throws when status is non-connected. Plan 03 (state machine) + Plan 04
  // (poller skip-on-non-connected guard) turn these green.
  // --------------------------------------------------------------------------

  describe("CONN-07 / D-15 poller skip behavior", () => {
    /**
     * Build a manager mock whose getStatus() returns the supplied status per
     * accountId. Used to drive Poller's skip-on-non-connected logic.
     */
    function makeStatusAwareManager(
      statuses: Record<
        string,
        { kind: string; client?: unknown; attempt?: number; nextRetryAt?: Date; lastError?: string }
      >
    ): ConnectionManager {
      return {
        getAccountIds: vi.fn().mockReturnValue(Object.keys(statuses)),
        // getStatus must exist on the manager for the planned skip guard to consult.
        getStatus: vi.fn().mockImplementation((id: string) => statuses[id]),
        // getClient returns the client on connected accounts; for non-connected
        // accounts it returns a structured error (current shape).
        getClient: vi.fn().mockImplementation((id: string) => {
          const status = statuses[id];
          if (status.kind === "connected") return status.client ?? { mailbox: "INBOX" };
          return { error: `account "${id}" is ${status.kind}` };
        }),
      } as unknown as ConnectionManager;
    }

    it("skips non-connected accounts: no IMAP call when status is reconnecting/suspended/connecting", async () => {
      const mockClient = { mailbox: "INBOX" };
      const manager = makeStatusAwareManager({
        reconnectingAcct: {
          kind: "reconnecting",
          attempt: 3,
          nextRetryAt: new Date(),
          lastError: "ECONNRESET",
        },
        connectedAcct: { kind: "connected", client: mockClient },
      });

      const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => undefined);
      const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined);

      const poller = new Poller(manager, 60);
      await runOnePoll(poller);

      // Only the connected account triggered an IMAP search.
      expect(mockSearchMessages).toHaveBeenCalledTimes(1);

      // Exactly one debug log per skipped account per poll cycle, mentioning
      // the skipped accountId.
      const reconnectingDebugCalls = debugSpy.mock.calls.filter((args) =>
        String(args[0] ?? "").includes("reconnectingAcct")
      );
      expect(reconnectingDebugCalls.length).toBe(1);

      // The skipped account must NOT generate an error log (current behavior
      // throws → logger.error fires).
      const reconnectingErrorCalls = errorSpy.mock.calls.filter((args) =>
        String(args[0] ?? "").includes("reconnectingAcct")
      );
      expect(reconnectingErrorCalls.length).toBe(0);
    });

    it("skip is not sticky — skipped accounts are re-checked on the next poll cycle", async () => {
      const mockClient = { mailbox: "INBOX" };
      // Mutable status map so we can flip the skipped account to "connected"
      // between cycles.
      const statuses: Record<
        string,
        { kind: string; client?: unknown; attempt?: number; nextRetryAt?: Date; lastError?: string }
      > = {
        flakyAcct: {
          kind: "reconnecting",
          attempt: 3,
          nextRetryAt: new Date(),
          lastError: "ECONNRESET",
        },
      };
      const manager = makeStatusAwareManager(statuses);

      const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => undefined);

      const poller = new Poller(manager, 60);
      // Cycle 1 — flakyAcct is reconnecting → skipped, debug logged once.
      await runOnePoll(poller);

      const debugCallsCycle1 = debugSpy.mock.calls.filter((args) =>
        String(args[0] ?? "").includes("flakyAcct")
      ).length;
      expect(debugCallsCycle1).toBe(1);

      // Flip to connected for cycle 2.
      statuses.flakyAcct = { kind: "connected", client: mockClient };
      debugSpy.mockClear();
      mockSearchMessages.mockClear();

      await runOnePoll(poller);

      // Cycle 2 — flakyAcct is now connected → polled, no skip log.
      expect(mockSearchMessages).toHaveBeenCalledTimes(1);
      const debugCallsCycle2 = debugSpy.mock.calls.filter((args) =>
        String(args[0] ?? "").includes("flakyAcct")
      ).length;
      expect(debugCallsCycle2).toBe(0);
    });
  });
});
