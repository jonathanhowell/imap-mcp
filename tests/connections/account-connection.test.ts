import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
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

// These imports will fail at module resolution until Plan 02 creates the implementation.
// That is expected and correct for Wave 0 (TDD RED phase).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type {
  AccountConnection,
  AccountConnectionStatus,
} from "../../src/connections/account-connection.js";

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
  });

  it("starts in 'connecting' state on construction", () => {
    expect(true).toBe(false);
  });

  it("transitions to 'connected' after connect() resolves", () => {
    expect(true).toBe(false);
  });

  it("'close' event on ImapFlow triggers transition to 'reconnecting' state", () => {
    expect(true).toBe(false);
  });

  it("reconnect creates a new ImapFlow instance (not reusing the old one)", () => {
    expect(true).toBe(false);
  });

  it("backoff delay increases exponentially (attempt 1=1000ms, attempt 2=2000ms, attempt 3=4000ms)", () => {
    expect(true).toBe(false);
  });

  it("after BACKOFF_MAX_ATTEMPTS reconnect failures, transitions to 'failed' state", () => {
    expect(true).toBe(false);
  });

  it("gracefulClose() calls logout() when client is usable", () => {
    expect(true).toBe(false);
  });

  it("gracefulClose() calls close() when client.usable is false (not logout)", () => {
    expect(true).toBe(false);
  });

  it("'error' event on ImapFlow is handled (does not throw uncaught exception)", () => {
    expect(true).toBe(false);
  });

  it("shutting-down flag prevents reconnect loop from starting during gracefulClose", () => {
    expect(true).toBe(false);
  });
});

// Suppress unused variable warning for makeAccountConfig until implementation exists
void makeAccountConfig;
