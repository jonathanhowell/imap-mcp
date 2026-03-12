import { describe, it, expect, vi } from "vitest";
import { handleReadMessage } from "../../src/tools/read-message.js";
import type { ConnectionManager } from "../../src/connections/index.js";

// Shared mock lock factory
function makeMockLock() {
  return { release: vi.fn() };
}

// Minimal mock envelope
function makeEnvelope(from: string, subject: string, date: Date) {
  return {
    from: [{ address: from }],
    subject,
    date,
  };
}

// Simple single-part text/plain body structure
const plainTextBodyStructure = {
  type: "text",
  subtype: "plain",
  size: 50,
};

// Helper to build a mock ConnectionManager
function makeMockManager(clientOverrides: Record<string, unknown> = {}): ConnectionManager {
  const client = {
    getMailboxLock: vi.fn().mockResolvedValue(makeMockLock()),
    fetchOne: vi.fn(),
    ...clientOverrides,
  };
  return {
    getClient: vi.fn().mockReturnValue(client),
  } as unknown as ConnectionManager;
}

describe("read_message", () => {
  it("READ-01: format=full returns plain text body", async () => {
    const bodyPartsMap = new Map([["1", Buffer.from("Hello plain text", "utf-8")]]);
    const manager = makeMockManager();
    const client = (manager.getClient as ReturnType<typeof vi.fn>)();
    client.fetchOne
      .mockResolvedValueOnce({
        bodyStructure: plainTextBodyStructure,
        envelope: makeEnvelope("test@example.com", "Test Subject", new Date("2024-01-01")),
        flags: new Set(),
      })
      .mockResolvedValueOnce({ bodyParts: bodyPartsMap });

    const result = await handleReadMessage({ account: "test", uid: 42, format: "full" }, manager);
    expect(result.isError).toBe(false);
    const body = JSON.parse(result.content[0].text);
    expect(body.body).toBe("Hello plain text");
    expect(body.uid).toBe(42);
    expect(body.from).toBe("test@example.com");
    expect(body.subject).toBe("Test Subject");
    expect(Array.isArray(body.attachments)).toBe(true);
  });

  it("READ-01: format=full falls back to HTML-stripped body when no text/plain part", async () => {
    const htmlBodyStructure = {
      type: "text",
      subtype: "html",
      size: 100,
    };
    const bodyPartsMap = new Map([["1", Buffer.from("<p>Hello <b>HTML</b></p>", "utf-8")]]);
    const manager = makeMockManager();
    const client = (manager.getClient as ReturnType<typeof vi.fn>)();
    client.fetchOne
      .mockResolvedValueOnce({
        bodyStructure: htmlBodyStructure,
        envelope: makeEnvelope("test@example.com", "HTML Message", new Date("2024-01-01")),
        flags: new Set(),
      })
      .mockResolvedValueOnce({ bodyParts: bodyPartsMap });

    const result = await handleReadMessage({ account: "test", uid: 43, format: "full" }, manager);
    expect(result.isError).toBe(false);
    const body = JSON.parse(result.content[0].text);
    expect(body.body).toContain("Hello");
    expect(body.body).toContain("HTML");
    expect(body.body).not.toContain("<p>");
  });

  it("READ-02: format=truncated returns at most max_chars characters", async () => {
    const longText = "x".repeat(5000);
    const bodyPartsMap = new Map([["1", Buffer.from(longText, "utf-8")]]);
    const manager = makeMockManager();
    const client = (manager.getClient as ReturnType<typeof vi.fn>)();
    client.fetchOne
      .mockResolvedValueOnce({
        bodyStructure: plainTextBodyStructure,
        envelope: makeEnvelope("test@example.com", "Long Message", new Date("2024-01-01")),
        flags: new Set(),
      })
      .mockResolvedValueOnce({ bodyParts: bodyPartsMap });

    const result = await handleReadMessage(
      { account: "test", uid: 44, format: "truncated", max_chars: 100 },
      manager
    );
    expect(result.isError).toBe(false);
    const body = JSON.parse(result.content[0].text);
    expect(body.body.length).toBe(100);
  });

  it("READ-02: format=truncated defaults to 2000 chars when max_chars omitted", async () => {
    const longText = "y".repeat(5000);
    const bodyPartsMap = new Map([["1", Buffer.from(longText, "utf-8")]]);
    const manager = makeMockManager();
    const client = (manager.getClient as ReturnType<typeof vi.fn>)();
    client.fetchOne
      .mockResolvedValueOnce({
        bodyStructure: plainTextBodyStructure,
        envelope: makeEnvelope("test@example.com", "Long Default", new Date("2024-01-01")),
        flags: new Set(),
      })
      .mockResolvedValueOnce({ bodyParts: bodyPartsMap });

    const result = await handleReadMessage(
      { account: "test", uid: 45, format: "truncated" },
      manager
    );
    expect(result.isError).toBe(false);
    const body = JSON.parse(result.content[0].text);
    expect(body.body.length).toBe(2000);
  });

  it("default format is clean when format parameter omitted", async () => {
    const textWithQuote = [
      "Hello there.",
      "",
      "On Mon Jan 1 2024, Sender wrote:",
      "> Original message here",
    ].join("\n");
    const bodyPartsMap = new Map([["1", Buffer.from(textWithQuote, "utf-8")]]);
    const manager = makeMockManager();
    const client = (manager.getClient as ReturnType<typeof vi.fn>)();
    client.fetchOne
      .mockResolvedValueOnce({
        bodyStructure: plainTextBodyStructure,
        envelope: makeEnvelope("sender@example.com", "Re: Test", new Date("2024-01-01")),
        flags: new Set(),
      })
      .mockResolvedValueOnce({ bodyParts: bodyPartsMap });

    // No format specified — should default to 'clean'
    const result = await handleReadMessage({ account: "test", uid: 46 }, manager);
    expect(result.isError).toBe(false);
    const body = JSON.parse(result.content[0].text);
    // The visible text should contain the reply (clean format strips quote markers)
    expect(body.body).toContain("Hello there.");
  });

  it("response always includes attachments array", async () => {
    const bodyPartsMap = new Map([["1", Buffer.from("Simple message", "utf-8")]]);
    const manager = makeMockManager();
    const client = (manager.getClient as ReturnType<typeof vi.fn>)();
    client.fetchOne
      .mockResolvedValueOnce({
        bodyStructure: plainTextBodyStructure,
        envelope: makeEnvelope("a@b.com", "Subject", new Date("2024-01-01")),
        flags: new Set(),
      })
      .mockResolvedValueOnce({ bodyParts: bodyPartsMap });

    const result = await handleReadMessage({ account: "test", uid: 47, format: "full" }, manager);
    expect(result.isError).toBe(false);
    const body = JSON.parse(result.content[0].text);
    expect(Array.isArray(body.attachments)).toBe(true);
  });

  it("returns error ToolResult when message not found", async () => {
    const manager = makeMockManager();
    const client = (manager.getClient as ReturnType<typeof vi.fn>)();
    client.fetchOne.mockResolvedValueOnce(null);

    const result = await handleReadMessage({ account: "test", uid: 999, format: "full" }, manager);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });

  it("returns error ToolResult when account unavailable", async () => {
    const manager = {
      getClient: vi.fn().mockReturnValue({ error: "account not found" }),
    } as unknown as ConnectionManager;

    const result = await handleReadMessage(
      { account: "nonexistent", uid: 1, format: "full" },
      manager
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("account not found");
  });
});
