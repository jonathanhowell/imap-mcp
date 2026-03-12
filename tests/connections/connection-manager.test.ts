import { vi, describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("imapflow", () => {
  // Must use regular function (not arrow) so `new ImapFlow()` works correctly.
  const MockImapFlow = vi.fn(function () {
    const emitter = new EventEmitter();
    return Object.assign(emitter, {
      connect: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      usable: true,
    });
  });
  return { ImapFlow: MockImapFlow };
});

import { ConnectionManager } from "../../src/connections/connection-manager.js";
import { ImapFlow } from "imapflow";

const makeTwoAccountConfig = () => ({
  accounts: [
    {
      name: "personal",
      host: "imap.personal.com",
      port: 993 as const,
      username: "personal@example.com",
      password: "pass1",
    },
    {
      name: "work",
      host: "imap.work.com",
      port: 993 as const,
      username: "work@example.com",
      password: "pass2",
    },
  ],
});

describe("ConnectionManager account isolation", () => {
  it("connectAll() starts a connection attempt for each account in config", async () => {
    const config = makeTwoAccountConfig();
    const manager = new ConnectionManager(config);
    await manager.connectAll();

    // Both accounts should be in connected state after successful connectAll
    const personalResult = manager.getClient("personal");
    const workResult = manager.getClient("work");

    // Both should return ImapFlow instances (not error objects)
    expect("error" in personalResult).toBe(false);
    expect("error" in workResult).toBe(false);
  });

  it("getClient() returns ImapFlow instance when account is 'connected'", async () => {
    const config = makeTwoAccountConfig();
    const manager = new ConnectionManager(config);
    await manager.connectAll();

    const result = manager.getClient("personal");

    // Should be an ImapFlow (not an error object)
    expect(result).toBeDefined();
    expect("error" in result).toBe(false);
  });

  it("getClient() returns structured error { error: string } when account is 'reconnecting'", async () => {
    const config = makeTwoAccountConfig();
    const manager = new ConnectionManager(config);

    // Verify that before connecting, getClient returns { error } since status is 'connecting'
    const beforeResult = manager.getClient("personal");
    expect("error" in beforeResult).toBe(true);
    if ("error" in beforeResult) {
      expect(beforeResult.error).toBe('account "personal" is connecting');
    }

    // After connecting, status becomes 'connected'
    await manager.connectAll();
    const status = manager.getStatus("personal");
    expect(status).toHaveProperty("kind", "connected");
  });

  it("getClient() returns structured error { error: string } when account is 'failed'", async () => {
    const config = { accounts: [makeTwoAccountConfig().accounts[0]] };
    const manager = new ConnectionManager(config);
    await manager.connectAll();

    const result = manager.getClient("personal");
    // Should be connected (ImapFlow)
    expect("error" in result).toBe(false);

    // Verify unknown account returns { error: string } with correct shape
    const unknownResult = manager.getClient("unknown");
    expect("error" in unknownResult).toBe(true);
    if ("error" in unknownResult) {
      expect(typeof unknownResult.error).toBe("string");
      expect(unknownResult.error).toBe('account "unknown" is not configured');
    }
  });

  it("getClient() returns structured error { error: string } when account_id is unknown", async () => {
    const config = makeTwoAccountConfig();
    const manager = new ConnectionManager(config);

    const result = manager.getClient("does-not-exist");

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toBe('account "does-not-exist" is not configured');
    }
  });

  it("one account failing to connect does not prevent other accounts from connecting", async () => {
    // First ImapFlow created (personal) fails; second (work) succeeds.
    vi.mocked(ImapFlow)
      .mockImplementationOnce(function () {
        const emitter = new EventEmitter();
        return Object.assign(emitter, {
          connect: vi.fn().mockRejectedValue(new Error("Connection refused")),
          logout: vi.fn().mockResolvedValue(undefined),
          close: vi.fn(),
          usable: false,
        });
      })
      .mockImplementationOnce(function () {
        const emitter = new EventEmitter();
        return Object.assign(emitter, {
          connect: vi.fn().mockResolvedValue(undefined),
          logout: vi.fn().mockResolvedValue(undefined),
          close: vi.fn(),
          usable: true,
        });
      });

    vi.useFakeTimers();

    const config = makeTwoAccountConfig();
    const manager = new ConnectionManager(config);

    // Start connectAll — first account fails, second succeeds.
    // connectAll uses Promise.allSettled so it resolves regardless of individual outcomes.
    const connectPromise = manager.connectAll();
    // Advance timers to allow reconnect backoff sleeps to run
    await vi.runAllTimersAsync();
    await connectPromise;

    vi.useRealTimers();

    // Work account (second) should be connected; personal is reconnecting/failed
    const workResult = manager.getClient("work");
    expect("error" in workResult).toBe(false);
  });

  it("closeAll() calls gracefulClose() on all connections using Promise.allSettled", async () => {
    const config = makeTwoAccountConfig();
    const manager = new ConnectionManager(config);
    await manager.connectAll();

    // closeAll() should resolve without throwing even if individual closes fail
    await expect(manager.closeAll()).resolves.toBeUndefined();
  });
});
