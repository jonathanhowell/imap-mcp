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
    // Plan 12-04: the poller now consults `getStatus()` BEFORE `getClient()`
    // (D-15 / CONN-07 skip guard). Default every account to `connected` so
    // the pre-Wave-0 tests below — which exercise normal poll behavior with
    // an always-available fake client — continue to fall through to
    // `getClient()` and the IMAP search path.
    getStatus: vi.fn().mockReturnValue({ kind: "connected", client: { mailbox: "INBOX" } }),
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

  // Tests 1+2 (legacy global cache-readiness check) replaced by the CACHE-01
  // describe block below ("CACHE-01: per-account lastPolledAt") which tests
  // getLastPolledAt(id) — the per-account replacement. The legacy global
  // method is removed entirely in Plan 13-04 along with the handleGetNewMail
  // global cold-cache gate.

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

  it("Test 11: incremental poll uses lastPolledAt - 24h as since date", async () => {
    const manager = makeMockManager(["acct1"]);
    const poller = new Poller(manager, 60);
    // First poll (seed) — run and let it complete
    await runOnePoll(poller);
    // Reset call tracking
    mockSearchMessages.mockClear();
    // Run one more incremental poll
    await runOnePoll(poller);
    // The since param on the incremental call should be ~24h before lastPolledAt
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
      // CACHE-01 / Pitfall 4: migrate from global lastPollTime to per-account
      // lastPolledAt Map. Seed the Map so query() finds the account.
      const lpa = new Map<string, Date | null>();
      lpa.set("acct1", new Date());
      (poller as unknown as Record<string, unknown>)["lastPolledAt"] = lpa;

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
      // CACHE-01 / Pitfall 4: migrate from global lastPollTime to per-account
      // lastPolledAt Map.
      const lpa = new Map<string, Date | null>();
      lpa.set("acct1", new Date());
      (poller as unknown as Record<string, unknown>)["lastPolledAt"] = lpa;

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
      // CACHE-01 / Pitfall 4: migrate from global lastPollTime to per-account
      // lastPolledAt Map.
      const lpa = new Map<string, Date | null>();
      lpa.set("acct1", new Date());
      (poller as unknown as Record<string, unknown>)["lastPolledAt"] = lpa;

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
      // CACHE-01 / Pitfall 4: migrate from global lastPollTime to per-account
      // lastPolledAt Map.
      const lpa = new Map<string, Date | null>();
      lpa.set("acct1", new Date());
      (poller as unknown as Record<string, unknown>)["lastPolledAt"] = lpa;

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

  // --------------------------------------------------------------------------
  // Phase 13 / CACHE-01 — per-account lastPolledAt Map (D-11/D-12/D-13).
  // RED at the start of Plan 13-03 Task 1: getLastPolledAt does not exist on
  // Poller yet. Plan 13-03 Task 2 turns these green.
  // --------------------------------------------------------------------------
  describe("CACHE-01: per-account lastPolledAt", () => {
    it("getLastPolledAt(id) returns null before any poll", () => {
      const manager = makeMockManager(["acctA", "acctB"]);
      const poller = new Poller(manager);
      expect(poller.getLastPolledAt("acctA")).toBeNull();
      expect(poller.getLastPolledAt("acctB")).toBeNull();
    });

    it("getLastPolledAt(id) returns a Date after a successful poll for that account", async () => {
      const manager = makeMockManager(["acct1"]);
      const poller = new Poller(manager);
      await runOnePoll(poller);
      const stamp = poller.getLastPolledAt("acct1");
      expect(stamp).toBeInstanceOf(Date);
    });

    it("getLastPolledAt is stamped AFTER mergeIntoCache succeeds (NOT before)", async () => {
      // Pitfall 2 guard: if searchMessages throws (caught by poll()'s outer
      // try/catch), mergeIntoCache never runs, so the stamp must NOT happen.
      // Verify by rejecting searchMessages — getLastPolledAt should stay null.
      const manager = makeMockManager(["acct1"]);
      mockSearchMessages.mockReset();
      mockSearchMessages.mockRejectedValueOnce(new Error("simulated search failure"));
      const poller = new Poller(manager);
      await runOnePoll(poller);
      expect(poller.getLastPolledAt("acct1")).toBeNull();
    });

    it("skipped account (status reconnecting) retains its prior lastPolledAt value across a poll cycle", async () => {
      // Reuse the makeStatusAwareManager pattern from the CONN-07 describe.
      const mockClient = { mailbox: "INBOX" };
      const statuses: Record<
        string,
        { kind: string; client?: unknown; attempt?: number; nextRetryAt?: Date; lastError?: string }
      > = {
        flakyAcct: { kind: "connected", client: mockClient },
      };
      const manager = {
        getAccountIds: vi.fn().mockReturnValue(Object.keys(statuses)),
        getStatus: vi.fn().mockImplementation((id: string) => statuses[id]),
        getClient: vi.fn().mockImplementation((id: string) => {
          const status = statuses[id];
          if (status.kind === "connected") return status.client ?? { mailbox: "INBOX" };
          return { error: `account "${id}" is ${status.kind}` };
        }),
      } as unknown as ConnectionManager;

      const poller = new Poller(manager, 60);
      // Cycle 1: account connected → polled successfully → stamp recorded.
      await runOnePoll(poller);
      const cycle1Stamp = poller.getLastPolledAt("flakyAcct");
      expect(cycle1Stamp).toBeInstanceOf(Date);

      // Cycle 2: flip account to reconnecting → skipped → stamp retained.
      statuses.flakyAcct = {
        kind: "reconnecting",
        attempt: 3,
        nextRetryAt: new Date(),
        lastError: "ECONNRESET",
      };
      await runOnePoll(poller);
      const cycle2Stamp = poller.getLastPolledAt("flakyAcct");
      // Same Date instance — skipped accounts do NOT clear or refresh the
      // timestamp (D-11).
      expect(cycle2Stamp).toBe(cycle1Stamp);
    });

    it("per-account seed: account A polled before, account B never polled — A uses 24h incremental window, B uses 30-day seed window", async () => {
      const manager = makeMockManager(["acctA", "acctB"]);
      // Pre-seed acctA's lastPolledAt entry to a known Date so the per-account
      // branch in pollAccount picks the incremental path (24h since acctA's
      // stamp) for A and the seed path (30 days) for B.
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const lpa = new Map<string, Date | null>();
      lpa.set("acctA", oneHourAgo);
      const poller = new Poller(manager, 60);
      (poller as unknown as Record<string, unknown>)["lastPolledAt"] = lpa;

      mockSearchMessages.mockReset();
      mockSearchMessages.mockResolvedValue([]);
      await runOnePoll(poller);

      // Two calls — one per account. Order matches getAccountIds() order.
      expect(mockSearchMessages).toHaveBeenCalledTimes(2);
      const acctASince = new Date(
        mockSearchMessages.mock.calls[0][1].since as string
      ).getTime();
      const acctBSince = new Date(
        mockSearchMessages.mock.calls[1][1].since as string
      ).getTime();

      const now = Date.now();
      // acctA had a prior stamp 1h ago → incremental window is (stamp - 24h),
      // so since ≈ now - 25h.
      const acctAAge = now - acctASince;
      expect(acctAAge).toBeGreaterThan(24 * 60 * 60 * 1000);
      expect(acctAAge).toBeLessThan(26 * 60 * 60 * 1000);

      // acctB never polled → seed window is 30 days back.
      const acctBAge = now - acctBSince;
      expect(acctBAge).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
      expect(acctBAge).toBeLessThan(31 * 24 * 60 * 60 * 1000);
    });
  });

  // --------------------------------------------------------------------------
  // Phase 13 / D-14 — per-account error-string dispatch in poller.query().
  // RED at the start of Plan 13-04 Task 1: query() does not consult
  // manager.getStatus() yet. Plan 13-04 Task 2 (GREEN) turns these green.
  // --------------------------------------------------------------------------
  describe("D-14: query() per-account error strings", () => {
    /**
     * Build a manager mock whose getStatus() returns the supplied status per
     * accountId. Each account also has its own seedable getLastError so the
     * V5 ASVS regression test can prove the dispatch never reads raw err.message.
     */
    function makeStatusAwareManager(
      statuses: Record<
        string,
        {
          kind: string;
          client?: unknown;
          attempt?: number;
          nextRetryAt?: Date;
          lastError?: string;
          reason?: string;
          since?: Date;
        }
      >,
      lastErrors: Record<string, string> = {}
    ): ConnectionManager {
      return {
        getAccountIds: vi.fn().mockReturnValue(Object.keys(statuses)),
        getStatus: vi.fn().mockImplementation((id: string) => statuses[id]),
        getClient: vi.fn().mockImplementation((id: string) => {
          const status = statuses[id];
          if (status.kind === "connected") return status.client ?? { mailbox: "INBOX" };
          return { error: `account "${id}" is ${status.kind}` };
        }),
        getLastError: vi.fn().mockImplementation((id: string) => lastErrors[id] ?? null),
      } as unknown as ConnectionManager;
    }

    it("connected account with null lastPolledAt produces 'no cache yet — polling has not completed' error", () => {
      const manager = makeStatusAwareManager({
        acctA: { kind: "connected", client: { mailbox: "INBOX" } },
      });
      const poller = new Poller(manager);
      const result = poller.query(new Date(0).toISOString(), "acctA");
      expect(result.errors?.acctA).toBe("no cache yet — polling has not completed");
      expect(result.results.length).toBe(0);
    });

    it("reconnecting account produces 'account reconnecting (attempt N)' error with exact attempt", () => {
      const manager = makeStatusAwareManager({
        acctA: {
          kind: "reconnecting",
          attempt: 7,
          nextRetryAt: new Date(),
          lastError: "ECONNRESET",
        },
      });
      const poller = new Poller(manager);
      const result = poller.query(new Date(0).toISOString(), "acctA");
      expect(result.errors?.acctA).toBe("account reconnecting (attempt 7)");
    });

    it("suspended account produces 'account suspended: <status.reason>' error from stock string", () => {
      const manager = makeStatusAwareManager({
        acctA: {
          kind: "suspended",
          reason: "Authentication failed — fix credentials",
          since: new Date(),
        },
      });
      const poller = new Poller(manager);
      const result = poller.query(new Date(0).toISOString(), "acctA");
      expect(result.errors?.acctA).toBe(
        "account suspended: Authentication failed — fix credentials"
      );
    });

    it("V5 ASVS: suspended error string must use status.reason from humanReason, NOT a raw err.message", () => {
      // Seed status.reason with a stock string AND manager.getLastError with a raw err.message
      // that contains a credential. The dispatch must surface the stock string ONLY.
      const manager = makeStatusAwareManager(
        {
          acctA: {
            kind: "suspended",
            reason: "Authentication failed — fix credentials",
            since: new Date(),
          },
        },
        { acctA: "ECONNRESET 192.168.5.5 auth=me@example.com" }
      );
      const poller = new Poller(manager);
      const result = poller.query(new Date(0).toISOString(), "acctA");
      expect(result.errors?.acctA).toContain("Authentication failed — fix credentials");
      expect(result.errors?.acctA).not.toContain("ECONNRESET");
      expect(result.errors?.acctA).not.toContain("me@example.com");
    });

    it("partial-results: connected acctA with prior poll returns its results; reconnecting acctB returns errors entry", () => {
      const manager = makeStatusAwareManager({
        acctA: { kind: "connected", client: { mailbox: "INBOX" } },
        acctB: {
          kind: "reconnecting",
          attempt: 3,
          nextRetryAt: new Date(),
          lastError: "ECONNRESET",
        },
      });
      const poller = new Poller(manager);
      // Seed acctA with one cached message past `since` AND a non-null lastPolledAt.
      const entry = {
        uid: 1,
        from: "a@b.com",
        subject: "hi",
        date: "2024-01-01T00:00:00Z",
        unread: false,
        folder: "INBOX",
        account: "acctA",
      };
      (poller as unknown as Record<string, unknown>)["cache"] = new Map([["acctA", [entry]]]);
      const lpa = new Map<string, Date | null>();
      lpa.set("acctA", new Date());
      (poller as unknown as Record<string, unknown>)["lastPolledAt"] = lpa;

      const result = poller.query(new Date(0).toISOString());
      expect(result.results.length).toBe(1);
      expect(result.results[0].uid).toBe(1);
      expect(result.errors?.acctB).toMatch(/^account reconnecting \(attempt /);
      expect(result.errors?.acctA).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Phase 13 / CACHE-02 — freshness block in poller.query() return.
  // RED at the start of Plan 13-04 Task 1: query() returns
  // MultiAccountResult, not GetNewMailResult (no freshness key). Plan 13-04
  // Task 2 (GREEN) turns these green.
  // --------------------------------------------------------------------------
  describe("CACHE-02: freshness block", () => {
    function makeStatusAwareManager(
      statuses: Record<string, { kind: string; client?: unknown }>
    ): ConnectionManager {
      return {
        getAccountIds: vi.fn().mockReturnValue(Object.keys(statuses)),
        getStatus: vi.fn().mockImplementation((id: string) => statuses[id]),
        getClient: vi.fn().mockImplementation((id: string) => {
          const status = statuses[id];
          if (status.kind === "connected") return status.client ?? { mailbox: "INBOX" };
          return { error: `account "${id}" is ${status.kind}` };
        }),
      } as unknown as ConnectionManager;
    }

    it("result.freshness is always present (D-08 / D-09) — even when all accounts healthy", () => {
      const manager = makeStatusAwareManager({
        acctA: { kind: "connected", client: { mailbox: "INBOX" } },
      });
      const poller = new Poller(manager);
      const lpa = new Map<string, Date | null>();
      lpa.set("acctA", new Date());
      (poller as unknown as Record<string, unknown>)["lastPolledAt"] = lpa;
      (poller as unknown as Record<string, unknown>)["cache"] = new Map([["acctA", []]]);
      const result = poller.query(new Date(0).toISOString());
      expect(result.freshness).toBeDefined();
      expect(result.freshness.acctA).toBeDefined();
    });

    it("freshness[acctA].last_polled_at is the ISO string of the stamped Date", () => {
      const manager = makeStatusAwareManager({
        acctA: { kind: "connected", client: { mailbox: "INBOX" } },
      });
      const poller = new Poller(manager);
      const stampedDate = new Date("2026-06-12T08:51:33Z");
      const lpa = new Map<string, Date | null>();
      lpa.set("acctA", stampedDate);
      (poller as unknown as Record<string, unknown>)["lastPolledAt"] = lpa;
      (poller as unknown as Record<string, unknown>)["cache"] = new Map([["acctA", []]]);
      const result = poller.query(new Date(0).toISOString());
      expect(result.freshness.acctA.last_polled_at).toBe("2026-06-12T08:51:33.000Z");
    });

    it("freshness[acctA] = { last_polled_at: null, cache_age_seconds: null } when never polled (D-09)", () => {
      const manager = makeStatusAwareManager({
        acctA: { kind: "connected", client: { mailbox: "INBOX" } },
      });
      const poller = new Poller(manager);
      // Note: lastPolledAt Map exists but acctA has no entry → null
      const result = poller.query(new Date(0).toISOString());
      expect(result.freshness.acctA.last_polled_at).toBeNull();
      expect(result.freshness.acctA.cache_age_seconds).toBeNull();
    });

    it("cache_age_seconds is server-computed at query-build time using Date.now() — D-10", () => {
      const manager = makeStatusAwareManager({
        acctA: { kind: "connected", client: { mailbox: "INBOX" } },
      });
      vi.setSystemTime(new Date("2026-06-13T09:05:00Z"));
      const poller = new Poller(manager);
      const stamped = new Date("2026-06-13T09:00:00Z"); // 5 min = 300 s earlier
      const lpa = new Map<string, Date | null>();
      lpa.set("acctA", stamped);
      (poller as unknown as Record<string, unknown>)["lastPolledAt"] = lpa;
      (poller as unknown as Record<string, unknown>)["cache"] = new Map([["acctA", []]]);
      const result = poller.query(new Date(0).toISOString());
      expect(result.freshness.acctA.cache_age_seconds).toBe(300);
    });
  });
});
