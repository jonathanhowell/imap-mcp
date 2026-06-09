import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

// Helper to create a mock ImapFlow-like object
function makeMockClient(overrides: { connect?: () => Promise<void>; usable?: boolean } = {}) {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    connect: vi.fn().mockImplementation(overrides.connect ?? (() => Promise.resolve())),
    logout: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    usable: overrides.usable ?? true,
  });
}

// Flush all pending microtasks multiple times (helps with async chains)
async function flushMicrotasks(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

vi.mock("imapflow", () => {
  // Must use function (not arrow) so it works with `new`
  const MockImapFlow = vi.fn(function () {
    return makeMockClient();
  });
  return { ImapFlow: MockImapFlow };
});

import { AccountConnection } from "../../src/connections/account-connection.js";
import type { AccountConnectionStatus } from "../../src/connections/account-connection.js";

// Suppress unused variable warning for type import
void ({} as AccountConnectionStatus);

const makeAccountConfig = () => ({
  name: "test",
  host: "imap.example.com",
  port: 993 as const,
  username: "user@example.com",
  password: "secret",
});

describe("AccountConnection state machine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("starts in 'connecting' state on construction", () => {
    const conn = new AccountConnection("test-account", makeAccountConfig());
    expect(conn.getStatus().kind).toBe("connecting");
  });

  it("transitions to 'connected' after connect() resolves", async () => {
    const conn = new AccountConnection("test-account", makeAccountConfig());
    await conn.connect();
    expect(conn.getStatus().kind).toBe("connected");
  });

  it("'close' event on ImapFlow triggers transition to 'reconnecting' state", async () => {
    const conn = new AccountConnection("test-account", makeAccountConfig());
    await conn.connect();

    const status = conn.getStatus();
    expect(status.kind).toBe("connected");
    if (status.kind !== "connected") return;

    // Emit close event — triggers reconnect loop
    status.client.emit("close");

    // Flush microtasks to let the reconnect loop start
    await flushMicrotasks();

    expect(conn.getStatus().kind).toBe("reconnecting");
  });

  it("reconnect creates a new ImapFlow instance (not reusing the old one)", async () => {
    const { ImapFlow } = await import("imapflow");
    const MockImapFlow = vi.mocked(ImapFlow);

    const conn = new AccountConnection("test-account", makeAccountConfig());
    await conn.connect();

    const callCountAfterConnect = MockImapFlow.mock.calls.length;
    expect(callCountAfterConnect).toBe(1);

    const status = conn.getStatus();
    if (status.kind !== "connected") return;

    // Emit close to trigger reconnect (async, reconnect loop starts with sleep)
    status.client.emit("close");
    await flushMicrotasks();

    // Now in reconnecting state — advance past the 1000ms sleep
    await vi.advanceTimersByTimeAsync(1100);
    // Wait for connect() async call to complete and for buildClient to be called
    await flushMicrotasks(10);

    // A new ImapFlow should have been constructed for the reconnect attempt
    expect(MockImapFlow.mock.calls.length).toBeGreaterThan(callCountAfterConnect);
  });

  it("backoff delay increases exponentially (attempt 1=1000ms, attempt 2=2000ms, attempt 3=4000ms)", async () => {
    const { ImapFlow } = await import("imapflow");
    const MockImapFlow = vi.mocked(ImapFlow);

    // Make connect always fail
    MockImapFlow.mockImplementation(function () {
      return makeMockClient({
        connect: () => Promise.reject(new Error("connection refused")),
        usable: false,
      });
    });

    const conn = new AccountConnection("test-account", makeAccountConfig());
    // Start connect but don't await — it will enter reconnect loop
    const connectPromise = conn.connect();

    // Wait for the initial connect failure and loop to start sleeping 1000ms
    await flushMicrotasks(10);
    const statusAt0 = conn.getStatus();
    expect(statusAt0.kind).toBe("reconnecting");
    if (statusAt0.kind === "reconnecting") {
      expect(statusAt0.attempt).toBe(1);
    }

    // Advance 1000ms — sleep(1000ms) fires, attempt 1 connect runs and fails,
    // loop sets status to reconnecting attempt 2 and sleeps 2000ms
    await vi.advanceTimersByTimeAsync(1000);
    await flushMicrotasks(10);
    const statusAt1 = conn.getStatus();
    expect(statusAt1.kind).toBe("reconnecting");
    if (statusAt1.kind === "reconnecting") {
      expect(statusAt1.attempt).toBe(2);
    }

    // Advance 2000ms — sleep(2000ms) fires, attempt 2 connect runs and fails,
    // loop sets status to reconnecting attempt 3 and sleeps 4000ms
    await vi.advanceTimersByTimeAsync(2000);
    await flushMicrotasks(10);
    const statusAt2 = conn.getStatus();
    expect(statusAt2.kind).toBe("reconnecting");
    if (statusAt2.kind === "reconnecting") {
      expect(statusAt2.attempt).toBe(3);
    }

    // Advance remaining time to exhaust all attempts so connectPromise resolves
    await vi.runAllTimersAsync();
    await flushMicrotasks(20);
    await connectPromise;
  });

  it("after BACKOFF_MAX_ATTEMPTS reconnect failures, transitions to 'failed' state", async () => {
    const { ImapFlow } = await import("imapflow");
    const MockImapFlow = vi.mocked(ImapFlow);

    MockImapFlow.mockImplementation(function () {
      return makeMockClient({
        connect: () => Promise.reject(new Error("connection refused")),
        usable: false,
      });
    });

    const conn = new AccountConnection("test-account", makeAccountConfig());
    const connectPromise = conn.connect();

    // Run all timers repeatedly until stable — exhausts all 10 backoff delays
    await vi.runAllTimersAsync();
    await flushMicrotasks(20);
    // Some async chains need additional timer+microtask passes
    await vi.runAllTimersAsync();
    await flushMicrotasks(20);
    await connectPromise;

    expect(conn.getStatus().kind).toBe("failed");
  }, 30_000);

  it("gracefulClose() calls logout() when client is usable", async () => {
    const { ImapFlow } = await import("imapflow");
    const MockImapFlow = vi.mocked(ImapFlow);

    let capturedClient: ReturnType<typeof makeMockClient> | undefined;
    MockImapFlow.mockImplementation(function () {
      capturedClient = makeMockClient({ usable: true });
      return capturedClient;
    });

    const conn = new AccountConnection("test-account", makeAccountConfig());
    await conn.connect();

    expect(conn.getStatus().kind).toBe("connected");
    await conn.gracefulClose();

    expect(capturedClient!.logout).toHaveBeenCalled();
    expect(capturedClient!.close).not.toHaveBeenCalled();
  });

  it("gracefulClose() calls close() when client.usable is false (not logout)", async () => {
    const { ImapFlow } = await import("imapflow");
    const MockImapFlow = vi.mocked(ImapFlow);

    let capturedClient: ReturnType<typeof makeMockClient> | undefined;
    MockImapFlow.mockImplementation(function () {
      capturedClient = makeMockClient({ usable: false });
      return capturedClient;
    });

    const conn = new AccountConnection("test-account", makeAccountConfig());
    await conn.connect();

    await conn.gracefulClose();

    expect(capturedClient!.logout).not.toHaveBeenCalled();
    expect(capturedClient!.close).toHaveBeenCalled();
  });

  it("'error' event on ImapFlow is handled (does not throw uncaught exception)", async () => {
    const conn = new AccountConnection("test-account", makeAccountConfig());
    await conn.connect();

    const status = conn.getStatus();
    if (status.kind !== "connected") return;

    // Emitting error without a listener causes an unhandled exception.
    // If our code wires the error listener correctly, this should not throw.
    expect(() => {
      status.client.emit("error", new Error("test error"));
    }).not.toThrow();
  });

  it("shutting-down flag prevents reconnect loop from starting during gracefulClose", async () => {
    const conn = new AccountConnection("test-account", makeAccountConfig());
    await conn.connect();

    const status = conn.getStatus();
    if (status.kind !== "connected") return;
    const client = status.client;

    // Initiate graceful close first — this sets isShuttingDown = true
    const closePromise = conn.gracefulClose();

    // Then emit close event (simulates close event firing after logout/close)
    client.emit("close");

    await closePromise;
    await flushMicrotasks();

    // Should NOT have transitioned to reconnecting — shutting down flag was set
    expect(conn.getStatus().kind).not.toBe("reconnecting");
  });

  // -----------------------------------------------------------------------
  // Phase 12 Wave 0 — CONN-02..CONN-06 red scaffolds.
  // These tests fail against the current implementation and turn green as
  // Plan 03 reshapes AccountConnection (unbounded retry, full-jitter backoff,
  // suspended state, TCP keepalive, race-safe reconnect, listener cleanup).
  // -----------------------------------------------------------------------

  it("unbounded transient retry survives 15 consecutive transient failures and eventually connects", async () => {
    const { ImapFlow } = await import("imapflow");
    const MockImapFlow = vi.mocked(ImapFlow);

    // First 15 returned mock clients reject with a transient ECONNRESET; the 16th resolves.
    let callIndex = 0;
    MockImapFlow.mockImplementation(function () {
      const isLastFailure = callIndex < 15;
      callIndex++;
      return makeMockClient({
        connect: isLastFailure
          ? () => Promise.reject(new Error("ECONNRESET test"))
          : () => Promise.resolve(),
        usable: !isLastFailure,
      });
    });

    const conn = new AccountConnection("test-account", makeAccountConfig());
    const connectPromise = conn.connect();

    // Drive past the 120_000ms backoff cap 16 times so all 15 transient failures
    // get retried and the 16th attempt connects.
    for (let i = 0; i < 16; i++) {
      await flushMicrotasks(10);
      await vi.advanceTimersByTimeAsync(150_000);
    }
    await flushMicrotasks(10);
    await connectPromise.catch(() => {
      /* if current impl rejects after 10 attempts, swallow — test asserts state */
    });

    expect(conn.getStatus().kind).toBe("connected");
  }, 30_000);

  it("full-jitter backoff produces values in [0, capped) range with mocked Math.random", async () => {
    const { ImapFlow } = await import("imapflow");
    const MockImapFlow = vi.mocked(ImapFlow);

    MockImapFlow.mockImplementation(function () {
      return makeMockClient({
        connect: () => Promise.reject(new Error("ECONNRESET")),
        usable: false,
      });
    });

    // Spy on setTimeout BEFORE the connect call so we capture the first backoff delay.
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);

    const conn = new AccountConnection("test-account", makeAccountConfig());
    // Start the connect (will fail and enter the reconnect loop).
    const connectPromise = conn.connect();
    await flushMicrotasks(10);

    // For attempt 1, full-jitter cap is BACKOFF_INITIAL_MS * MULTIPLIER^(0) = 1000.
    // Math.floor(0.5 * 1000) === 500.
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 500);

    // Drive the loop forward to start attempt 2 (cap = 2000).
    randomSpy.mockReturnValue(0.999);
    await vi.advanceTimersByTimeAsync(500);
    await flushMicrotasks(10);
    // For attempt 2 the cap is 2000 — Math.floor(0.999 * 2000) === 1998.
    // (Range check: a non-jittered impl would have set 2000 exactly, so 1998 ≠ 2000.)
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1998);

    // Drain remaining timers so the test exits cleanly.
    await vi.runAllTimersAsync();
    await flushMicrotasks(20);
    await connectPromise.catch(() => undefined);
  }, 30_000);

  it("fatal goes straight to suspended on attempt 1 with no further retries", async () => {
    const { ImapFlow } = await import("imapflow");
    const MockImapFlow = vi.mocked(ImapFlow);

    // RFC 5530 AUTHENTICATIONFAILED — fatal classification per D-05.
    MockImapFlow.mockImplementation(function () {
      return makeMockClient({
        connect: () =>
          Promise.reject(
            Object.assign(new Error("auth failed"), {
              serverResponseCode: "AUTHENTICATIONFAILED",
            })
          ),
        usable: false,
      });
    });

    const conn = new AccountConnection("test-account", makeAccountConfig());
    // Don't await connect() — current (pre-Plan-03) code enters a 10-attempt
    // reconnect loop on this fatal error and would block the test. Plan 03's
    // fatal fast-path lands the call promptly; capture the promise instead.
    const connectPromise = conn.connect().catch(() => undefined);

    // Run all pending timers so any pre-Plan-03 reconnect loop drains and the
    // post-Plan-03 fatal fast-path lands its `suspended` state assignment.
    await vi.runAllTimersAsync();
    await flushMicrotasks(20);
    await connectPromise;

    const status = conn.getStatus();
    expect(status.kind).toBe("suspended");
    if (status.kind === "suspended") {
      expect(status.reason).toMatch(/authentication/i);
    }

    // Only the initial-connect client was built — no second attempt.
    expect(MockImapFlow.mock.calls.length).toBe(1);
  }, 30_000);

  it("buildClient applies TCP keepalive: socketOptions.keepAlive true, keepAliveInitialDelay 60000, socketTimeout 90000", async () => {
    const { ImapFlow } = await import("imapflow");
    const MockImapFlow = vi.mocked(ImapFlow);

    // Reset to the clean default: every mock client connects successfully.
    // Necessary because prior tests in this file install failure-mode
    // mockImplementations that vi.clearAllMocks does not reset.
    MockImapFlow.mockImplementation(function () {
      return makeMockClient();
    });

    const conn = new AccountConnection("test-account", makeAccountConfig());
    await conn.connect();

    expect(MockImapFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        socketOptions: { keepAlive: true, keepAliveInitialDelay: 60_000 },
        socketTimeout: 90_000,
      })
    );
  });

  it("concurrent close events trigger exactly one reconnect loop (one new ImapFlow constructed)", async () => {
    const { ImapFlow } = await import("imapflow");
    const MockImapFlow = vi.mocked(ImapFlow);

    // Reset to a clean default: every mock client connects successfully.
    MockImapFlow.mockImplementation(function () {
      return makeMockClient();
    });

    const conn = new AccountConnection("test-account", makeAccountConfig());
    await conn.connect();
    const callsBefore = MockImapFlow.mock.calls.length;

    const status = conn.getStatus();
    expect(status.kind).toBe("connected");
    if (status.kind !== "connected") return;

    // Emit two close events synchronously in the same microtask batch.
    // Without the race-safety guard (D-10 `reconnectInFlight`) this would start
    // TWO reconnect loops and construct TWO new ImapFlow instances.
    status.client.emit("close");
    status.client.emit("close");

    await flushMicrotasks(10);
    // Drive past the first backoff window (jitter range 0..1s for attempt 1).
    await vi.advanceTimersByTimeAsync(2_000);
    await flushMicrotasks(10);

    // Exactly ONE new client should have been built across both close events.
    expect(MockImapFlow.mock.calls.length).toBe(callsBefore + 1);
  }, 30_000);

  it("listener cleanup: removeAllListeners is invoked on every discarded client across 5 reconnect failures", async () => {
    const { ImapFlow } = await import("imapflow");
    const MockImapFlow = vi.mocked(ImapFlow);

    // Track every constructed client and instrument removeAllListeners on each.
    const builtClients: Array<{ removeAllListeners: ReturnType<typeof vi.fn> }> = [];

    let callIndex = 0;
    MockImapFlow.mockImplementation(function () {
      const isFailure = callIndex < 5;
      callIndex++;
      const client = makeMockClient({
        connect: isFailure
          ? () => Promise.reject(new Error("ECONNRESET"))
          : () => Promise.resolve(),
        usable: !isFailure,
      });
      const removeAllListenersSpy = vi.fn((event?: string | symbol) => {
        // Delegate to real EventEmitter removeAllListeners so tests stay sane.
        return (client as unknown as { _eventsCount: number }) as never;
      });
      // Overwrite EventEmitter's removeAllListeners with the spy.
      (client as unknown as { removeAllListeners: typeof removeAllListenersSpy }).removeAllListeners =
        removeAllListenersSpy;
      builtClients.push({ removeAllListeners: removeAllListenersSpy });
      return client;
    });

    const conn = new AccountConnection("test-account", makeAccountConfig());
    const connectPromise = conn.connect();

    // Drive through 5 transient failures + 1 success.
    for (let i = 0; i < 6; i++) {
      await flushMicrotasks(10);
      await vi.advanceTimersByTimeAsync(150_000);
    }
    await flushMicrotasks(20);
    await connectPromise.catch(() => undefined);

    // At least 5 of the discarded clients had removeAllListeners() invoked.
    const cleanedCount = builtClients
      .slice(0, 5)
      .filter((c) => c.removeAllListeners.mock.calls.length >= 1).length;
    expect(cleanedCount).toBeGreaterThanOrEqual(5);
  }, 30_000);
});
