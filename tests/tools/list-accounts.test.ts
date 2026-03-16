import { describe, it, expect } from "vitest";
import { handleListAccounts } from "../../src/tools/list-accounts.js";
import type { ConnectionManager } from "../../src/connections/index.js";
import type { AccountConfig } from "../../src/config/types.js";

function makeManager(
  accounts: Array<{
    id: string;
    config: Partial<AccountConfig> & { name: string; username: string };
    status: "connected" | "connecting" | "reconnecting" | "failed" | "error";
    attempt?: number;
    reason?: string;
    errorMessage?: string;
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
        return { kind: "reconnecting" as const, attempt: account.attempt ?? 1 };
      }
      if (account.status === "failed") {
        return { kind: "failed" as const, reason: account.reason ?? "permanent failure" };
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
