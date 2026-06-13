import { describe, it, expect } from "vitest";
import { handleListAccounts } from "../../src/tools/list-accounts.js";
import type { ConnectionManager } from "../../src/connections/index.js";
import type { AccountConfig } from "../../src/config/types.js";

function makeManager(
  accounts: Array<{
    id: string;
    config: Partial<AccountConfig> & { name: string; username: string };
    status: "connected" | "connecting" | "reconnecting" | "suspended" | "error";
    attempt?: number;
    reason?: string;
    since?: Date;
    errorMessage?: string;
    lastErrorRaw?: string;
    lastConnectedAt?: Date | null;
    lastErrorAt?: Date | null;
  }>
) {
  return {
    getAccountIds: () => accounts.map((a) => a.id),
    getStatus: (id: string) => {
      const account = accounts.find((a) => a.id === id)!;
      if (account.status === "error") {
        return { error: account.errorMessage ?? "connection error" };
      }
      if (account.status === "reconnecting") {
        return {
          kind: "reconnecting" as const,
          attempt: account.attempt ?? 1,
          nextRetryAt: new Date("2026-06-13T08:05:00.000Z"),
          lastError: account.lastErrorRaw ?? "ECONNRESET",
        };
      }
      if (account.status === "suspended") {
        return {
          kind: "suspended" as const,
          reason: account.reason ?? "Authentication failed — fix credentials",
          since: account.since ?? new Date("2026-06-13T08:00:00.000Z"),
        };
      }
      return { kind: account.status as "connected" | "connecting" };
    },
    getConfig: (id: string) => {
      const account = accounts.find((a) => a.id === id);
      if (!account) return undefined;
      return {
        name: account.id,
        host: "imap.example.com",
        port: 993 as const,
        password: "secret",
        ...account.config,
      } as AccountConfig;
    },
    getLastConnectedAt: (id: string) => {
      const account = accounts.find((a) => a.id === id);
      return account?.lastConnectedAt ?? null;
    },
    getLastError: (id: string) => {
      const account = accounts.find((a) => a.id === id);
      return account?.lastErrorRaw ?? null;
    },
    getLastErrorAt: (id: string) => {
      const account = accounts.find((a) => a.id === id);
      return account?.lastErrorAt ?? null;
    },
  } as unknown as ConnectionManager;
}

function parseResult(result: ReturnType<typeof handleListAccounts>) {
  const text = result.content[0];
  if (text.type !== "text") throw new Error("expected text content");
  return JSON.parse(text.text) as unknown[];
}

describe("ACTX-02: email field on list_accounts", () => {
  it("includes email on every account entry when email is set in config", () => {
    const manager = makeManager([
      {
        id: "work",
        config: { username: "work@corp.com", email: "work@corp.com" },
        status: "connected",
      },
    ]);
    const result = handleListAccounts(manager);
    const accounts = parseResult(result) as Array<Record<string, unknown>>;
    expect(accounts[0].email).toBe("work@corp.com");
  });

  it("falls back to username when email is not set in config", () => {
    const manager = makeManager([
      { id: "personal", config: { username: "me@gmail.com" }, status: "connected" },
    ]);
    const result = handleListAccounts(manager);
    const accounts = parseResult(result) as Array<Record<string, unknown>>;
    expect(accounts[0].email).toBe("me@gmail.com");
  });

  it("includes email on accounts in error state", () => {
    const manager = makeManager([
      { id: "broken", config: { username: "broken@example.com" }, status: "error" },
    ]);
    const result = handleListAccounts(manager);
    const accounts = parseResult(result) as Array<Record<string, unknown>>;
    expect(accounts[0].email).toBe("broken@example.com");
  });

  it("includes email on accounts in connecting state", () => {
    const manager = makeManager([
      { id: "slow", config: { username: "slow@example.com" }, status: "connecting" },
    ]);
    const result = handleListAccounts(manager);
    const accounts = parseResult(result) as Array<Record<string, unknown>>;
    expect(accounts[0].email).toBe("slow@example.com");
  });

  it("includes email on accounts in reconnecting state", () => {
    const manager = makeManager([
      {
        id: "retry",
        config: { username: "retry@example.com" },
        status: "reconnecting",
        attempt: 2,
      },
    ]);
    const result = handleListAccounts(manager);
    const accounts = parseResult(result) as Array<Record<string, unknown>>;
    expect(accounts[0].email).toBe("retry@example.com");
  });
});

describe("ACTX-01: display_name field on list_accounts", () => {
  it("includes display_name when configured", () => {
    const manager = makeManager([
      {
        id: "work",
        config: { username: "work@corp.com", display_name: "Work Gmail" },
        status: "connected",
      },
    ]);
    const result = handleListAccounts(manager);
    const accounts = parseResult(result) as Array<Record<string, unknown>>;
    expect(accounts[0].display_name).toBe("Work Gmail");
  });

  it("omits display_name key entirely when not configured (not null, not undefined)", () => {
    const manager = makeManager([
      { id: "personal", config: { username: "me@gmail.com" }, status: "connected" },
    ]);
    const result = handleListAccounts(manager);
    const accounts = parseResult(result) as Array<Record<string, unknown>>;
    expect("display_name" in accounts[0]).toBe(false);
  });

  it("response shape when display_name set: { account, email, display_name, status }", () => {
    const manager = makeManager([
      {
        id: "work",
        config: { username: "work@corp.com", email: "work@corp.com", display_name: "Work Gmail" },
        status: "connected",
      },
    ]);
    const result = handleListAccounts(manager);
    const accounts = parseResult(result) as Array<Record<string, unknown>>;
    expect(accounts[0]).toMatchObject({
      account: "work",
      email: "work@corp.com",
      display_name: "Work Gmail",
      status: "connected",
    });
  });

  it("response shape when display_name absent: { account, email, status } with no display_name key", () => {
    const manager = makeManager([
      { id: "personal", config: { username: "me@gmail.com" }, status: "connected" },
    ]);
    const result = handleListAccounts(manager);
    const accounts = parseResult(result) as Array<Record<string, unknown>>;
    expect(accounts[0]).toMatchObject({
      account: "personal",
      email: "me@gmail.com",
      status: "connected",
    });
    expect("display_name" in accounts[0]).toBe(false);
  });
});

describe("HEALTH-02 / HEALTH-03: per-account health fields", () => {
  // Phase 13 contract (CONTEXT.md D-02..D-07, RESEARCH Pitfall 1):
  // Every account entry carries flat snake_case `last_connected_at`,
  // `last_error`, `last_error_at`. No nested `health:{}`. No `detail` field
  // anywhere. The reconnecting branch hardcodes `last_error: null` per V5
  // ASVS / T-12-09 — `status.lastError` carries raw `err.message` and MUST
  // NOT be surfaced.

  it("connected account has last_connected_at as ISO string, last_error: null, last_error_at: null", () => {
    const manager = makeManager([
      {
        id: "work",
        config: { username: "work@corp.com" },
        status: "connected",
        lastConnectedAt: new Date("2026-06-12T08:30:00.000Z"),
      },
    ]);
    const result = handleListAccounts(manager);
    const accounts = parseResult(result) as Array<Record<string, unknown>>;
    expect(accounts[0].status).toBe("connected");
    expect(accounts[0].last_connected_at).toBe("2026-06-12T08:30:00.000Z");
    expect(accounts[0].last_error).toBe(null);
    expect(accounts[0].last_error_at).toBe(null);
  });

  it("connected account with never-connected history exposes last_connected_at: null", () => {
    const manager = makeManager([
      {
        id: "work",
        config: { username: "work@corp.com" },
        status: "connected",
        // lastConnectedAt omitted → manager.getLastConnectedAt returns null
      },
    ]);
    const result = handleListAccounts(manager);
    const accounts = parseResult(result) as Array<Record<string, unknown>>;
    expect(accounts[0].last_connected_at).toBe(null);
  });

  it("connecting account exposes last_connected_at, last_error: null, last_error_at: null", () => {
    const manager = makeManager([
      {
        id: "slow",
        config: { username: "slow@example.com" },
        status: "connecting",
        lastConnectedAt: new Date("2026-06-12T08:30:00.000Z"),
      },
    ]);
    const result = handleListAccounts(manager);
    const accounts = parseResult(result) as Array<Record<string, unknown>>;
    expect(accounts[0].status).toBe("connecting");
    expect(accounts[0].last_connected_at).toBe("2026-06-12T08:30:00.000Z");
    expect(accounts[0].last_error).toBe(null);
    expect(accounts[0].last_error_at).toBe(null);
  });

  it("reconnecting account exposes attempt + next_retry_at + last_error: null + last_error_at: null", () => {
    const manager = makeManager([
      {
        id: "retry",
        config: { username: "retry@example.com" },
        status: "reconnecting",
        attempt: 3,
        lastErrorRaw: "ECONNRESET on imap.example.com",
        lastConnectedAt: new Date("2026-06-12T08:30:00.000Z"),
      },
    ]);
    const result = handleListAccounts(manager);
    const accounts = parseResult(result) as Array<Record<string, unknown>>;
    expect(accounts[0].status).toBe("reconnecting");
    expect(accounts[0].attempt).toBe(3);
    expect(accounts[0].next_retry_at).toBe("2026-06-13T08:05:00.000Z");
    // V5 ASVS — last_error MUST be null on reconnecting; do NOT echo lastErrorRaw
    expect(accounts[0].last_error).toBe(null);
    expect(accounts[0].last_error_at).toBe(null);
  });

  it("reconnecting account: last_error MUST NOT contain the raw error message text (T-13-03 / V5 ASVS regression guard)", () => {
    const manager = makeManager([
      {
        id: "retry",
        config: { username: "retry@example.com" },
        status: "reconnecting",
        attempt: 7,
        lastErrorRaw: "ECONNRESET on 192.168.0.5",
      },
    ]);
    const result = handleListAccounts(manager);
    const accounts = parseResult(result) as Array<Record<string, unknown>>;
    const entry = accounts[0];
    expect(String(entry.last_error).includes("ECONNRESET")).toBe(false);
    expect(String(entry.last_error).includes("192.168.0.5")).toBe(false);
  });

  it("suspended account: last_error is the stock reason, last_error_at is status.since as ISO", () => {
    const manager = makeManager([
      {
        id: "broken",
        config: { username: "broken@example.com" },
        status: "suspended",
        reason: "Authentication failed — fix credentials",
        since: new Date("2026-06-13T08:00:00.000Z"),
      },
    ]);
    const result = handleListAccounts(manager);
    const accounts = parseResult(result) as Array<Record<string, unknown>>;
    expect(accounts[0].status).toBe("suspended");
    expect(accounts[0].last_error).toBe("Authentication failed — fix credentials");
    expect(accounts[0].last_error_at).toBe("2026-06-13T08:00:00.000Z");
  });

  it("suspended account: last_connected_at is preserved as ISO when manager.getLastConnectedAt returns a Date", () => {
    const manager = makeManager([
      {
        id: "broken",
        config: { username: "broken@example.com" },
        status: "suspended",
        reason: "Authentication failed — fix credentials",
        since: new Date("2026-06-13T08:00:00.000Z"),
        lastConnectedAt: new Date("2026-06-12T08:30:00.000Z"),
      },
    ]);
    const result = handleListAccounts(manager);
    const accounts = parseResult(result) as Array<Record<string, unknown>>;
    expect(accounts[0].last_connected_at).toBe("2026-06-12T08:30:00.000Z");
  });

  it("error (unknown account) entry: last_error is status.error, last_error_at is null, last_connected_at is null", () => {
    const manager = makeManager([
      {
        id: "ghost",
        config: { username: "ghost@example.com" },
        status: "error",
        errorMessage: "connection error",
      },
    ]);
    const result = handleListAccounts(manager);
    const accounts = parseResult(result) as Array<Record<string, unknown>>;
    expect(accounts[0].status).toBe("error");
    expect(accounts[0].last_error).toBe("connection error");
    expect(accounts[0].last_error_at).toBe(null);
    expect(accounts[0].last_connected_at).toBe(null);
  });

  it("no entry contains the key 'detail' (D-03 breaking-change verification)", () => {
    const manager = makeManager([
      {
        id: "a",
        config: { username: "a@example.com" },
        status: "connected",
        lastConnectedAt: new Date("2026-06-12T08:30:00.000Z"),
      },
      { id: "b", config: { username: "b@example.com" }, status: "connecting" },
      {
        id: "c",
        config: { username: "c@example.com" },
        status: "reconnecting",
        attempt: 2,
        lastErrorRaw: "ECONNRESET",
      },
      {
        id: "d",
        config: { username: "d@example.com" },
        status: "suspended",
        reason: "Authentication failed — fix credentials",
        since: new Date("2026-06-13T08:00:00.000Z"),
      },
      { id: "e", config: { username: "e@example.com" }, status: "error" },
    ]);
    const result = handleListAccounts(manager);
    const accounts = parseResult(result) as Array<Record<string, unknown>>;
    for (const entry of accounts) {
      expect("detail" in entry).toBe(false);
    }
  });
});
