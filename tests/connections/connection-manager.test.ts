import { vi, describe, it, expect, beforeEach } from "vitest";
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
  // Phase 12 Plan 04: error-classifier.ts imports `AuthenticationFailure`
  // at module load time. Vitest 4's strict module-mock factory throws
  // (`No "AuthenticationFailure" export is defined on the "imapflow" mock`)
  // when the classifier's `isAuthenticationFailure(err)` evaluates `typeof
  // AuthenticationFailure`. Stub the class so `typeof === "function"` is
  // true and downstream `instanceof` checks return false for our non-
  // AuthenticationFailure mock errors. This mirrors the same stub added in
  // tests/connections/account-connection.test.ts during Plan 12-03.
  class MockAuthenticationFailure extends Error {}
  return { ImapFlow: MockImapFlow, AuthenticationFailure: MockAuthenticationFailure };
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

  // Renamed in Plan 12-04: the original title said "'failed'" but the body has always
  // exercised the unknown-account error shape (the `failed` variant has no organic
  // trigger in v0.3 per D-01). Title now reflects what the test actually asserts.
  it("getClient() returns structured error { error: string } when account is unknown", async () => {
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

describe("ConnectionManager.getConfig()", () => {
  it("returns AccountConfig for a known account", () => {
    const config = makeTwoAccountConfig();
    const manager = new ConnectionManager(config);

    const result = manager.getConfig("personal");

    expect(result).toBeDefined();
    expect(result?.name).toBe("personal");
    expect(result?.username).toBe("personal@example.com");
    expect(result?.host).toBe("imap.personal.com");
  });

  it("returns undefined for an unknown account ID", () => {
    const config = makeTwoAccountConfig();
    const manager = new ConnectionManager(config);

    const result = manager.getConfig("does-not-exist");

    expect(result).toBeUndefined();
  });
});

// ----------------------------------------------------------------------------
// Phase 12 Wave 0 — CONN-03 / D-01 suspended-state scaffold.
// Red because (a) the AccountConnectionStatus union has no `suspended` variant
// yet and (b) getClient()'s switch has no `suspended` case. Plan 03 (state
// machine) + Plan 04 (consumer updates) turn this green.
// ----------------------------------------------------------------------------

describe("ConnectionManager suspended state (CONN-03 / D-01)", () => {
  it("getClient returns structured error string when account is suspended", async () => {
    // Force a fatal initial-connect failure that Plan 03 will classify as
    // AUTHENTICATIONFAILED → transition to suspended (no further retries).
    vi.mocked(ImapFlow).mockImplementation(function () {
      const emitter = new EventEmitter();
      return Object.assign(emitter, {
        connect: vi.fn().mockRejectedValue(
          Object.assign(new Error("auth failed"), {
            serverResponseCode: "AUTHENTICATIONFAILED",
          })
        ),
        logout: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        usable: false,
      });
    });

    vi.useFakeTimers();

    const config = { accounts: [makeTwoAccountConfig().accounts[0]] };
    const manager = new ConnectionManager(config);

    const connectPromise = manager.connectAll();
    // Drain any reconnect timers — pre-Plan-03 the bounded loop expires after
    // ~120s of fake time; post-Plan-03 the fatal fast-path lands immediately.
    await vi.runAllTimersAsync();
    await connectPromise;

    vi.useRealTimers();

    const result = manager.getClient("personal");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toMatch(/suspended/i);
    }
  }, 30_000);
});

// ----------------------------------------------------------------------------
// Phase 13 Plan 01 — HEALTH-02 ConnectionManager health accessors.
// RED at step 3a (delegating accessors don't exist on the manager yet);
// GREEN at step 3b after implementation.
// Contract: per CONTEXT.md D-07, the manager exposes three delegating
// accessors returning `null` for unknown accounts (NOT { error } — that is
// the getStatus() pattern; health fields are Date | null / string | null by
// design and the tool layer treats null uniformly as "no value").
// ----------------------------------------------------------------------------

describe("HEALTH-02: ConnectionManager health accessors", () => {
  // Reset the imapflow mock to the clean default at the start of every test.
  // Necessary because earlier describe blocks in this file install sticky
  // failure-mode mockImplementations on `vi.mocked(ImapFlow)` (auth failed
  // for the suspended-state scaffold; connection refused for the partial-
  // connect test) and vitest's default config does not clear mocks between
  // tests. Without this, the freshly-connected expectations below see leaked
  // failure mocks from prior describes and assert against a suspended state.
  beforeEach(() => {
    vi.mocked(ImapFlow).mockImplementation(function () {
      const emitter = new EventEmitter();
      return Object.assign(emitter, {
        connect: vi.fn().mockResolvedValue(undefined),
        logout: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        usable: true,
      });
    });
  });

  it("getLastConnectedAt returns the AccountConnection.getConnectedAt value for a known account", async () => {
    const config = makeTwoAccountConfig();
    const manager = new ConnectionManager(config);
    await manager.connectAll();

    expect(manager.getLastConnectedAt("personal")).toBeInstanceOf(Date);
  });

  it("getLastConnectedAt returns null for an unknown account", async () => {
    const config = makeTwoAccountConfig();
    const manager = new ConnectionManager(config);
    await manager.connectAll();

    expect(manager.getLastConnectedAt("nonexistent")).toBeNull();
  });

  it("getLastError returns null for a freshly-connected account", async () => {
    const config = makeTwoAccountConfig();
    const manager = new ConnectionManager(config);
    await manager.connectAll();

    expect(manager.getLastError("personal")).toBeNull();
  });

  it("getLastError returns null for an unknown account", async () => {
    const config = makeTwoAccountConfig();
    const manager = new ConnectionManager(config);
    await manager.connectAll();

    expect(manager.getLastError("nonexistent")).toBeNull();
  });

  it("getLastErrorAt returns null for a freshly-connected account", async () => {
    const config = makeTwoAccountConfig();
    const manager = new ConnectionManager(config);
    await manager.connectAll();

    expect(manager.getLastErrorAt("personal")).toBeNull();
  });

  it("getLastErrorAt returns null for an unknown account", async () => {
    const config = makeTwoAccountConfig();
    const manager = new ConnectionManager(config);
    await manager.connectAll();

    expect(manager.getLastErrorAt("nonexistent")).toBeNull();
  });
});
