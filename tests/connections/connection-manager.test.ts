import { vi, describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("imapflow", () => {
  const MockImapFlow = vi.fn().mockImplementation(() => {
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

// These imports will fail at module resolution until Plan 03 creates the implementation.
// That is expected and correct for Wave 0 (TDD RED phase).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { ConnectionManager } from "../../src/connections/connection-manager.js";

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
  it("connectAll() starts a connection attempt for each account in config", () => {
    expect(true).toBe(false);
  });

  it("getClient() returns ImapFlow instance when account is 'connected'", () => {
    expect(true).toBe(false);
  });

  it("getClient() returns structured error { error: string } when account is 'reconnecting'", () => {
    expect(true).toBe(false);
  });

  it("getClient() returns structured error { error: string } when account is 'failed'", () => {
    expect(true).toBe(false);
  });

  it("getClient() returns structured error { error: string } when account_id is unknown", () => {
    expect(true).toBe(false);
  });

  it("one account failing to connect does not prevent other accounts from connecting", () => {
    expect(true).toBe(false);
  });

  it("closeAll() calls gracefulClose() on all connections using Promise.allSettled", () => {
    expect(true).toBe(false);
  });
});

// Suppress unused variable warning for makeTwoAccountConfig until implementation exists
void makeTwoAccountConfig;
