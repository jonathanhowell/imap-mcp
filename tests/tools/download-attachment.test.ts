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

  describe("ATCH-01: filename-based attachment lookup", () => {
    it("neither part_id nor filename → isError:true with validation message", async () => {
      const manager = {
        getClient: vi.fn().mockReturnValue({
          getMailboxLock: vi.fn(),
          download: vi.fn(),
        }),
      } as unknown as ConnectionManager;

      const result = await handleDownloadAttachment({ account: "test", uid: 42 }, manager);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("Error: either part_id or filename must be provided");
      // getClient should not have been called (guard fires before client resolution)
      expect(manager.getClient).not.toHaveBeenCalled();
    });

    it("part_id provided → uses it directly, no bodyStructure fetch", async () => {
      const content = Readable.from([Buffer.from("pdf bytes")]);
      const manager = makeMockManager({
        meta: { filename: "doc.pdf", contentType: "application/pdf", expectedSize: 9 },
        content,
      });
      // Cast to access mock
      const client = (manager.getClient as ReturnType<typeof vi.fn>).mock.results[0]?.value;

      const result = await handleDownloadAttachment(
        { account: "test", uid: 10, part_id: "2" },
        manager
      );

      expect(result.isError).toBe(false);
      // If client was obtained, verify fetchAll was NOT called for bodyStructure
      // (makeMockManager's client does not have fetchAll — calling it would throw)
      void client;
    });

    it("filename provided → resolves part_id from bodyStructure and returns content", async () => {
      const mockLock = makeMockLock();
      const attachmentContent = Readable.from([Buffer.from("attachment data")]);
      const client = {
        getMailboxLock: vi.fn().mockResolvedValue(mockLock),
        fetchAll: vi.fn().mockResolvedValue([
          {
            uid: 42,
            bodyStructure: {
              type: "multipart/mixed",
              childNodes: [
                { part: "1", type: "text/plain" },
                {
                  part: "2",
                  type: "application/pdf",
                  disposition: "attachment",
                  dispositionParameters: { filename: "invoice.pdf" },
                  size: 1024,
                },
              ],
            },
          },
        ]),
        download: vi.fn().mockResolvedValue({
          meta: { filename: "invoice.pdf", contentType: "application/pdf", expectedSize: 1024 },
          content: attachmentContent,
        }),
      };
      const manager = {
        getClient: vi.fn().mockReturnValue(client),
      } as unknown as ConnectionManager;

      const result = await handleDownloadAttachment(
        { account: "test", uid: 42, filename: "invoice.pdf" },
        manager
      );

      expect(result.isError).toBe(false);
      // fetchAll called with bodyStructure: true
      expect(client.fetchAll).toHaveBeenCalledWith([42], { bodyStructure: true }, { uid: true });
      // download called with the resolved part_id "2"
      expect(client.download).toHaveBeenCalledWith(expect.anything(), "2", expect.anything());
      // lock released before download
      expect(mockLock.release).toHaveBeenCalled();
    });

    it("filename case-insensitive: 'Report.PDF' param matches attachment filename 'report.pdf'", async () => {
      const mockLock = makeMockLock();
      const attachmentContent = Readable.from([Buffer.from("data")]);
      const client = {
        getMailboxLock: vi.fn().mockResolvedValue(mockLock),
        fetchAll: vi.fn().mockResolvedValue([
          {
            uid: 10,
            bodyStructure: {
              type: "multipart/mixed",
              childNodes: [
                {
                  part: "2",
                  type: "application/pdf",
                  disposition: "attachment",
                  dispositionParameters: { filename: "report.pdf" },
                  size: 500,
                },
              ],
            },
          },
        ]),
        download: vi.fn().mockResolvedValue({
          meta: { filename: "report.pdf", contentType: "application/pdf", expectedSize: 500 },
          content: attachmentContent,
        }),
      };
      const manager = {
        getClient: vi.fn().mockReturnValue(client),
      } as unknown as ConnectionManager;

      const result = await handleDownloadAttachment(
        { account: "test", uid: 10, filename: "Report.PDF" },
        manager
      );

      expect(result.isError).toBe(false);
      // The case-insensitive match resolved to part_id "2"
      expect(client.download).toHaveBeenCalledWith(expect.anything(), "2", expect.anything());
    });

    it("filename not found → isError:true with descriptive message naming filename and UID", async () => {
      const mockLock = makeMockLock();
      const client = {
        getMailboxLock: vi.fn().mockResolvedValue(mockLock),
        fetchAll: vi.fn().mockResolvedValue([
          {
            uid: 42,
            bodyStructure: {
              type: "multipart/mixed",
              childNodes: [
                {
                  part: "2",
                  type: "application/pdf",
                  disposition: "attachment",
                  dispositionParameters: { filename: "other.pdf" },
                  size: 100,
                },
              ],
            },
          },
        ]),
        download: vi.fn(),
      };
      const manager = {
        getClient: vi.fn().mockReturnValue(client),
      } as unknown as ConnectionManager;

      const result = await handleDownloadAttachment(
        { account: "test", uid: 42, filename: "invoice.pdf" },
        manager
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe(
        "No attachment with filename 'invoice.pdf' found in message 42"
      );
      // lock must still be released even on error path
      expect(mockLock.release).toHaveBeenCalled();
      // download must NOT have been called
      expect(client.download).not.toHaveBeenCalled();
    });
  });
});
