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
});
