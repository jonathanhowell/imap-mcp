import { describe, it, expect, vi } from "vitest";
import { handleGetNewMail, GET_NEW_MAIL_TOOL } from "../../src/tools/get-new-mail.js";
import type { Poller } from "../../src/polling/poller.js";

describe("GET_NEW_MAIL_TOOL schema", () => {
  it("name equals get_new_mail", () => {
    expect(GET_NEW_MAIL_TOOL.name).toBe("get_new_mail");
  });

  it("inputSchema.required contains since", () => {
    expect(GET_NEW_MAIL_TOOL.inputSchema.required).toContain("since");
  });
});

describe("handleGetNewMail — cache ready, query delegation", () => {
  function makeMockPoller(overrides: {
    query?: (
      since: string,
      account?: string,
      excludeKeywords?: string[]
    ) => ReturnType<Poller["query"]>;
  }) {
    return {
      query: vi.fn(overrides.query ?? (() => ({ results: [], freshness: {} }))),
    } as unknown as Poller;
  }

  it("calls poller.query and returns JSON result when cache is ready", async () => {
    const queryResult = {
      results: [
        {
          uid: 1,
          from: "sender@example.com",
          subject: "Hello",
          date: "2024-01-15T10:00:00Z",
          unread: true,
          account: "work",
        },
      ],
      freshness: {},
    };
    const poller = makeMockPoller({ query: () => queryResult });
    const result = await handleGetNewMail({ since: "2024-01-01T00:00:00Z" }, poller);
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(queryResult) }]);
  });

  it("passes account param through to poller.query when provided", async () => {
    const poller = makeMockPoller({});
    await handleGetNewMail({ since: "2024-01-01T00:00:00Z", account: "work" }, poller);
    expect(poller.query).toHaveBeenCalledWith("2024-01-01T00:00:00Z", "work", undefined);
  });

  it("passes undefined as account to poller.query when account is omitted", async () => {
    const poller = makeMockPoller({});
    await handleGetNewMail({ since: "2024-01-01T00:00:00Z" }, poller);
    expect(poller.query).toHaveBeenCalledWith("2024-01-01T00:00:00Z", undefined, undefined);
  });

  it("returns isError false with JSON body when query returns partial errors", async () => {
    const queryResult = {
      results: [],
      errors: { work: "unavailable" },
      freshness: {},
    };
    const poller = makeMockPoller({ query: () => queryResult });
    const result = await handleGetNewMail({ since: "2024-01-01T00:00:00Z" }, poller);
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(queryResult) }]);
  });

  it("passes exclude_keywords to poller.query()", async () => {
    const poller = makeMockPoller({});
    await handleGetNewMail(
      { since: "2024-01-01T00:00:00Z", exclude_keywords: ["Done", "Replied"] },
      poller
    );
    expect(poller.query).toHaveBeenCalledWith("2024-01-01T00:00:00Z", undefined, [
      "Done",
      "Replied",
    ]);
  });

  it("does not pass excludeKeyword when omitted", async () => {
    const poller = makeMockPoller({});
    await handleGetNewMail({ since: "2024-01-01T00:00:00Z" }, poller);
    expect(poller.query).toHaveBeenCalledWith("2024-01-01T00:00:00Z", undefined, undefined);
  });
});

describe("CACHE-02 / D-14: cold-cache returns errors not isError=true", () => {
  function makeMockPoller(queryResult: ReturnType<Poller["query"]>) {
    return {
      query: vi.fn(() => queryResult),
    } as unknown as Poller;
  }

  it("cold cache scenario returns isError: false with the cold-cache error string in JSON body", async () => {
    const queryResult = {
      results: [],
      errors: { acctA: "no cache yet — polling has not completed" },
      freshness: { acctA: { last_polled_at: null, cache_age_seconds: null } },
    };
    const poller = makeMockPoller(queryResult);
    const result = await handleGetNewMail({ since: "2024-01-01T00:00:00Z" }, poller);
    expect(result.isError).toBe(false);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.errors.acctA).toBe("no cache yet — polling has not completed");
  });

  it("response always carries a `freshness` key even when all accounts are healthy", async () => {
    const queryResult = {
      results: [
        {
          uid: 1,
          from: "x@y.com",
          subject: "hello",
          date: "2026-06-13T08:00:00Z",
          unread: false,
          account: "acctA",
        },
      ],
      freshness: { acctA: { last_polled_at: "2026-06-13T08:00:00.000Z", cache_age_seconds: 60 } },
    } as unknown as ReturnType<Poller["query"]>;
    const poller = makeMockPoller(queryResult);
    const result = await handleGetNewMail({ since: "2024-01-01T00:00:00Z" }, poller);
    expect(result.isError).toBe(false);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.freshness).toBeDefined();
    expect(parsed.freshness.acctA.last_polled_at).toBe("2026-06-13T08:00:00.000Z");
  });
});
