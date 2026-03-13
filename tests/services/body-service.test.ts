import { describe, it, expect } from "vitest";
import { extractBody, parseBodyStructure } from "../../src/services/body-service.js";
import type { MessageStructureObject } from "../../src/services/body-service.js";

describe("body-service", () => {
  // parseBodyStructure tests

  it("READ-04: parseBodyStructure handles single-part message (root node, no childNodes)", () => {
    // imapflow sets no `part` on a single-part root — we default to "1"
    const root: MessageStructureObject = {
      type: "text/plain",
      size: 100,
    };
    const result = parseBodyStructure(root);
    expect(result.textPartId).toBe("1");
    expect(result.htmlPartId).toBeNull();
    expect(result.attachments).toHaveLength(0);
  });

  it("READ-04: parseBodyStructure handles multipart/mixed with text and attachment", () => {
    // imapflow sets `part` on each child node using IMAP dot-notation
    const root: MessageStructureObject = {
      type: "multipart/mixed",
      childNodes: [
        { part: "1", type: "text/plain", size: 50 },
        {
          part: "2",
          type: "application/pdf",
          disposition: "attachment",
          dispositionParameters: { filename: "report.pdf" },
          size: 12345,
        },
      ],
    };
    const result = parseBodyStructure(root);
    expect(result.textPartId).toBe("1");
    expect(result.htmlPartId).toBeNull();
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toEqual({
      part_id: "2",
      filename: "report.pdf",
      size: 12345,
      mime_type: "application/pdf",
    });
  });

  it("READ-04: parseBodyStructure extracts attachment entries with part_id, filename, size, mime_type", () => {
    const root: MessageStructureObject = {
      type: "multipart/mixed",
      childNodes: [
        { part: "1", type: "text/plain", size: 100 },
        {
          part: "2",
          type: "image/jpeg",
          disposition: "attachment",
          dispositionParameters: { filename: "photo.jpg" },
          size: 56789,
        },
      ],
    };
    const result = parseBodyStructure(root);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].part_id).toBe("2");
    expect(result.attachments[0].filename).toBe("photo.jpg");
    expect(result.attachments[0].size).toBe(56789);
    expect(result.attachments[0].mime_type).toBe("image/jpeg");
  });

  it("non-attachment text/plain and text/html parts are not included in attachments array", () => {
    const root: MessageStructureObject = {
      type: "multipart/alternative",
      childNodes: [
        { part: "1", type: "text/plain", size: 30 },
        { part: "2", type: "text/html", size: 80 },
      ],
    };
    const result = parseBodyStructure(root);
    expect(result.textPartId).toBe("1");
    expect(result.htmlPartId).toBe("2");
    expect(result.attachments).toHaveLength(0);
  });

  it("READ-04: handles nested multipart (mixed → alternative → plain + html)", () => {
    // Gmail-typical structure: multipart/mixed wrapping multipart/alternative
    const root: MessageStructureObject = {
      type: "multipart/mixed",
      childNodes: [
        {
          part: "1",
          type: "multipart/alternative",
          childNodes: [
            { part: "1.1", type: "text/plain", size: 30 },
            { part: "1.2", type: "text/html", size: 80 },
          ],
        },
        {
          part: "2",
          type: "application/pdf",
          disposition: "attachment",
          dispositionParameters: { filename: "doc.pdf" },
          size: 9999,
        },
      ],
    };
    const result = parseBodyStructure(root);
    expect(result.textPartId).toBe("1.1");
    expect(result.htmlPartId).toBe("1.2");
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].part_id).toBe("2");
  });

  it("parseBodyStructure uses parameters.name as fallback filename", () => {
    const root: MessageStructureObject = {
      type: "application/octet-stream",
      disposition: "attachment",
      parameters: { name: "file.bin" },
      size: 999,
    };
    const result = parseBodyStructure(root);
    expect(result.attachments[0].filename).toBe("file.bin");
  });

  it("parseBodyStructure uses 'attachment' as default filename when no name present", () => {
    const root: MessageStructureObject = {
      type: "application/octet-stream",
      disposition: "attachment",
      size: 100,
    };
    const result = parseBodyStructure(root);
    expect(result.attachments[0].filename).toBe("attachment");
  });

  // extractBody tests

  it("READ-03: HTML body converted to plain text", () => {
    const html = "<p>Hello <strong>World</strong></p>";
    const result = extractBody(html, true, "full");
    expect(result).toContain("Hello");
    expect(result).toContain("World");
    // Should not contain HTML tags
    expect(result).not.toContain("<p>");
    expect(result).not.toContain("<strong>");
  });

  it("READ-03: getVisibleText strips quoted reply chains from clean format", () => {
    const textWithQuote = [
      "Thanks for your message.",
      "",
      "On Mon, Jan 1, 2024, John wrote:",
      "> This is the original message",
      "> that was sent earlier",
    ].join("\n");

    const result = extractBody(textWithQuote, false, "clean");
    expect(result).toContain("Thanks for your message.");
    // Quoted reply chain should be stripped or reduced
    expect(result).not.toContain("> This is the original message");
  });

  it("READ-02: format=truncated returns at most max_chars characters", () => {
    const result = extractBody("a".repeat(5000), false, "truncated", 100);
    expect(result.length).toBe(100);
  });

  it("format=truncated defaults to 2000 chars", () => {
    const result = extractBody("b".repeat(5000), false, "truncated");
    expect(result.length).toBe(2000);
  });

  it("READ-01: format=full returns plain text body", () => {
    const result = extractBody("Hello plain text", false, "full");
    expect(result).toBe("Hello plain text");
  });

  it("READ-01: format=full converts HTML to plain text when isHtml=true", () => {
    const result = extractBody("<p>Hello HTML</p>", true, "full");
    expect(result).toContain("Hello HTML");
    expect(result).not.toContain("<p>");
  });

  it("returns empty string for empty input", () => {
    expect(extractBody("", false, "full")).toBe("");
  });
});
