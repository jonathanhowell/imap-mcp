import { describe, it, expect, vi } from "vitest";
import { Readable } from "stream";
import { handleDownloadAttachment } from "../../src/tools/download-attachment.js";
import type { ConnectionManager } from "../../src/connections/index.js";

// Helper to build a mock lock
function makeMockLock() {
  return { release: vi.fn() };
}

// Helper to build a mock ConnectionManager whose client.download() returns a mock stream
function makeMockManager(downloadResult: {
  meta: { filename?: string; contentType: string; expectedSize: number };
  content: Readable;
}): ConnectionManager {
  const client = {
    getMailboxLock: vi.fn().mockResolvedValue(makeMockLock()),
    download: vi.fn().mockResolvedValue(downloadResult),
  };
  return {
    getClient: vi.fn().mockReturnValue(client),
  } as unknown as ConnectionManager;
}

describe("download_attachment", () => {
  it("READ-05: returns base64-encoded content string", async () => {
    const content = Readable.from([Buffer.from("hello world")]);
    const manager = makeMockManager({
      meta: { filename: "test.txt", contentType: "text/plain", expectedSize: 11 },
      content,
    });

    const result = await handleDownloadAttachment(
      { account: "test", uid: 42, part_id: "2" },
      manager
    );
    expect(result.isError).toBe(false);
    const data = JSON.parse(result.content[0].text);
    expect(data.content).toBe(Buffer.from("hello world").toString("base64"));
  });

  it("returns filename and mime_type from attachment metadata", async () => {
    const content = Readable.from([Buffer.from("pdf content")]);
    const manager = makeMockManager({
      meta: { filename: "report.pdf", contentType: "application/pdf", expectedSize: 100 },
      content,
    });

    const result = await handleDownloadAttachment(
      { account: "test", uid: 10, part_id: "2" },
      manager
    );
    expect(result.isError).toBe(false);
    const data = JSON.parse(result.content[0].text);
    expect(data.filename).toBe("report.pdf");
    expect(data.mime_type).toBe("application/pdf");
    expect(data.size).toBe(100);
  });

  it("returns error ToolResult when account unavailable", async () => {
    const manager = {
      getClient: vi.fn().mockReturnValue({ error: "account not found" }),
    } as unknown as ConnectionManager;

    const result = await handleDownloadAttachment(
      { account: "nonexistent", uid: 1, part_id: "2" },
      manager
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("account not found");
  });

  it("returns error ToolResult when part_id not found", async () => {
    const client = {
      getMailboxLock: vi.fn().mockResolvedValue(makeMockLock()),
      download: vi.fn().mockRejectedValue(new Error("part not found")),
    };
    const manager = {
      getClient: vi.fn().mockReturnValue(client),
    } as unknown as ConnectionManager;

    const result = await handleDownloadAttachment(
      { account: "test", uid: 42, part_id: "99" },
      manager
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("part not found");
  });
});
