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
});
