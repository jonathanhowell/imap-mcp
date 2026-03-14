import { describe, it, expect, vi } from "vitest";
import { fanOutAccounts, safeTime } from "../../src/tools/multi-account.js";
import type { ConnectionManager } from "../../src/connections/index.js";
import type { ImapFlow } from "imapflow";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SimpleItem {
  id: number;
  value: string;
}

/**
 * Build a mock ConnectionManager that returns a mock ImapFlow for each
 * account in connectedAccounts, and { error: string } for all others.
 */
function makeMockManager(
  connectedAccounts: string[],
  disconnectedAccounts: string[] = []
): ConnectionManager {
  const mockClient = {} as ImapFlow;

  return {
    getClient: vi.fn((accountId: string): ImapFlow | { error: string } => {
      if (connectedAccounts.includes(accountId)) return mockClient;
      if (disconnectedAccounts.includes(accountId))
        return { error: `account "${accountId}" is unavailable` };
      return { error: `account "${accountId}" is not configured` };
    }),
    getAccountIds: vi.fn(() => connectedAccounts),
  } as unknown as ConnectionManager;
}

// ---------------------------------------------------------------------------
// fanOutAccounts — two accounts succeed
// ---------------------------------------------------------------------------

describe("fanOutAccounts — two accounts succeed", () => {
  it("merges results from both accounts and adds account field to each item", async () => {
    const manager = makeMockManager(["personal", "work"]);
    const fn = vi.fn(async (_client: ImapFlow, accountId: string): Promise<SimpleItem[]> => {
      return accountId === "personal"
        ? [{ id: 1, value: "inbox-personal" }]
        : [{ id: 2, value: "inbox-work" }];
    });

    const { results, errors } = await fanOutAccounts(["personal", "work"], manager, fn);

    expect(results).toHaveLength(2);

    const personalResult = results.find((r) => r.account === "personal");
    expect(personalResult).toBeDefined();
    expect(personalResult?.value).toBe("inbox-personal");

    const workResult = results.find((r) => r.account === "work");
    expect(workResult).toBeDefined();
    expect(workResult?.value).toBe("inbox-work");

    expect(errors).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// fanOutAccounts — getClient returns { error } for one account
// ---------------------------------------------------------------------------

describe("fanOutAccounts — one account unavailable via getClient", () => {
  it("records error for unavailable account, succeeds for available account", async () => {
    const manager = makeMockManager(["personal"], ["work"]);
    const fn = vi.fn(async (_client: ImapFlow, _accountId: string): Promise<SimpleItem[]> => {
      return [{ id: 1, value: "inbox-personal" }];
    });

    const { results, errors } = await fanOutAccounts(["personal", "work"], manager, fn);

    expect(results).toHaveLength(1);
    expect(results[0].account).toBe("personal");

    expect(errors["work"]).toMatch(/unavailable/);
    expect(errors["personal"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// fanOutAccounts — fn() throws for one account
// ---------------------------------------------------------------------------

describe("fanOutAccounts — fn throws for one account", () => {
  it("records thrown error message, continues with other account", async () => {
    const manager = makeMockManager(["personal", "work"]);
    const fn = vi.fn(async (_client: ImapFlow, accountId: string): Promise<SimpleItem[]> => {
      if (accountId === "work") throw new Error("IMAP command failed");
      return [{ id: 1, value: "ok" }];
    });

    const { results, errors } = await fanOutAccounts(["personal", "work"], manager, fn);

    expect(results).toHaveLength(1);
    expect(results[0].account).toBe("personal");

    expect(errors["work"]).toBe("IMAP command failed");
    expect(errors["personal"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// fanOutAccounts — all accounts fail
// ---------------------------------------------------------------------------

describe("fanOutAccounts — all accounts fail", () => {
  it("returns empty results and full errors map", async () => {
    const manager = makeMockManager([], ["personal", "work"]);
    const fn = vi.fn(async (): Promise<SimpleItem[]> => []);

    const { results, errors } = await fanOutAccounts(["personal", "work"], manager, fn);

    expect(results).toHaveLength(0);
    expect(errors["personal"]).toBeDefined();
    expect(errors["work"]).toBeDefined();
    expect(fn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// safeTime
// ---------------------------------------------------------------------------

describe("safeTime", () => {
  it("returns millisecond number > 0 for a valid ISO date string", () => {
    const ms = safeTime("2024-01-15T12:00:00.000Z");
    expect(ms).toBeGreaterThan(0);
    expect(Number.isFinite(ms)).toBe(true);
  });

  it("returns 0 for an empty string (not NaN)", () => {
    const ms = safeTime("");
    expect(ms).toBe(0);
    expect(Number.isNaN(ms)).toBe(false);
  });

  it("returns 0 for an unparseable date string", () => {
    const ms = safeTime("not-a-date");
    expect(ms).toBe(0);
  });
});
