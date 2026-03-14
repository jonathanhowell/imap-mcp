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

describe("handleGetNewMail — cold cache", () => {
  function makeMockPoller(overrides: {
    isCacheReady?: () => boolean;
    query?: (since: string, account?: string) => ReturnType<Poller["query"]>;
  }) {
    return {
      isCacheReady: vi.fn(overrides.isCacheReady ?? (() => true)),
      query: vi.fn(overrides.query ?? (() => ({ results: [] }))),
    } as unknown as Poller;
  }

  it("returns isError true with agent-actionable message when cache is not ready", async () => {
    const poller = makeMockPoller({ isCacheReady: () => false });
    const result = await handleGetNewMail({ since: "2024-01-01T00:00:00Z" }, poller);
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        type: "text",
        text: "Polling has not completed yet — no cached results available. Retry in ~5 minutes.",
      },
    ]);
  });
});

describe("handleGetNewMail — cache ready, query delegation", () => {
  function makeMockPoller(overrides: {
    isCacheReady?: () => boolean;
    query?: (since: string, account?: string) => ReturnType<Poller["query"]>;
  }) {
    return {
      isCacheReady: vi.fn(overrides.isCacheReady ?? (() => true)),
      query: vi.fn(overrides.query ?? (() => ({ results: [] }))),
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
    };
    const poller = makeMockPoller({ query: () => queryResult });
    const result = await handleGetNewMail({ since: "2024-01-01T00:00:00Z" }, poller);
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(queryResult) }]);
  });

  it("passes account param through to poller.query when provided", async () => {
    const poller = makeMockPoller({});
    await handleGetNewMail({ since: "2024-01-01T00:00:00Z", account: "work" }, poller);
    expect(poller.query).toHaveBeenCalledWith("2024-01-01T00:00:00Z", "work");
  });

  it("passes undefined as account to poller.query when account is omitted", async () => {
    const poller = makeMockPoller({});
    await handleGetNewMail({ since: "2024-01-01T00:00:00Z" }, poller);
    expect(poller.query).toHaveBeenCalledWith("2024-01-01T00:00:00Z", undefined);
  });

  it("returns isError false with JSON body when query returns partial errors", async () => {
    const queryResult = { results: [], errors: { work: "unavailable" } };
    const poller = makeMockPoller({ query: () => queryResult });
    const result = await handleGetNewMail({ since: "2024-01-01T00:00:00Z" }, poller);
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(queryResult) }]);
  });
});
