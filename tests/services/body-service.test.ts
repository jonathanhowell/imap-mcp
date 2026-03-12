import { describe, it, expect } from "vitest";
import { extractBody, parseBodyStructure } from "../../src/services/body-service.js";
import type { MessageStructureObject } from "../../src/services/body-service.js";

describe("body-service", () => {
  // parseBodyStructure tests

  it("READ-04: parseBodyStructure handles single-part message (root node, no childNodes)", () => {
    const root: MessageStructureObject = {
      type: "text",
      subtype: "plain",
      size: 100,
    };
    const result = parseBodyStructure(root);
    expect(result.textPartId).toBe("1");
    expect(result.htmlPartId).toBeNull();
    expect(result.attachments).toHaveLength(0);
  });

  it("READ-04: parseBodyStructure handles multipart/mixed with text and attachment", () => {
    const root: MessageStructureObject = {
      type: "multipart",
      subtype: "mixed",
      childNodes: [
        {
          // No part field — imapflow sets part on child nodes in real use,
          // but traversal assigns path 1.1 via partPath when node.part is undefined
          type: "text",
          subtype: "plain",
          size: 50,
        },
        {
          type: "application",
          subtype: "pdf",
          disposition: "attachment",
          dispositionParameters: { filename: "report.pdf" },
          size: 12345,
        },
      ],
    };
    const result = parseBodyStructure(root);
    expect(result.textPartId).toBe("1.1");
    expect(result.htmlPartId).toBeNull();
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toEqual({
      part_id: "1.2",
      filename: "report.pdf",
      size: 12345,
      mime_type: "application/pdf",
    });
  });

  it("READ-04: parseBodyStructure extracts attachment entries with part_id, filename, size, mime_type", () => {
    const root: MessageStructureObject = {
      type: "multipart",
      subtype: "mixed",
      childNodes: [
        {
          type: "text",
          subtype: "plain",
          size: 100,
        },
        {
          type: "image",
          subtype: "jpeg",
          disposition: "attachment",
          dispositionParameters: { filename: "photo.jpg" },
          size: 56789,
        },
      ],
    };
    const result = parseBodyStructure(root);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].part_id).toBe("1.2");
    expect(result.attachments[0].filename).toBe("photo.jpg");
    expect(result.attachments[0].size).toBe(56789);
    expect(result.attachments[0].mime_type).toBe("image/jpeg");
  });

  it("non-attachment text/plain and text/html parts are not included in attachments array", () => {
    const root: MessageStructureObject = {
      type: "multipart",
      subtype: "alternative",
      childNodes: [
        { type: "text", subtype: "plain", size: 30 },
        { type: "text", subtype: "html", size: 80 },
      ],
    };
    const result = parseBodyStructure(root);
    expect(result.textPartId).toBe("1.1");
    expect(result.htmlPartId).toBe("1.2");
    expect(result.attachments).toHaveLength(0);
  });

  it("parseBodyStructure uses parameters.name as fallback filename", () => {
    const root: MessageStructureObject = {
      type: "application",
      subtype: "octet-stream",
      disposition: "attachment",
      parameters: { name: "file.bin" },
      size: 999,
    };
    const result = parseBodyStructure(root);
    expect(result.attachments[0].filename).toBe("file.bin");
  });

  it("parseBodyStructure uses 'attachment' as default filename when no name present", () => {
    const root: MessageStructureObject = {
      type: "application",
      subtype: "octet-stream",
      disposition: "attachment",
      size: 100,
    };
    const result = parseBodyStructure(root);
    expect(result.attachments[0].filename).toBe("attachment");
  });

  // extractBody tests

  it("READ-03: HTML body converted to plain text", () => {
    const html = "<p>Hello <strong>World</strong></p>";
    const bodyPartsMap = new Map<string, Buffer>([["1", Buffer.from(html, "utf-8")]]);
    const result = extractBody(bodyPartsMap, null, "1", "full");
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

    const bodyPartsMap = new Map<string, Buffer>([["1", Buffer.from(textWithQuote, "utf-8")]]);
    const result = extractBody(bodyPartsMap, "1", null, "clean");
    expect(result).toContain("Thanks for your message.");
    // Quoted reply chain should be stripped or reduced
    expect(result).not.toContain("> This is the original message");
  });

  it("READ-02: format=truncated returns at most max_chars characters", () => {
    const longText = "a".repeat(5000);
    const bodyPartsMap = new Map<string, Buffer>([["1", Buffer.from(longText, "utf-8")]]);
    const result = extractBody(bodyPartsMap, "1", null, "truncated", 100);
    expect(result.length).toBe(100);
  });

  it("format=truncated defaults to 2000 chars", () => {
    const longText = "b".repeat(5000);
    const bodyPartsMap = new Map<string, Buffer>([["1", Buffer.from(longText, "utf-8")]]);
    const result = extractBody(bodyPartsMap, "1", null, "truncated");
    expect(result.length).toBe(2000);
  });

  it("READ-01: format=full returns plain text body when text/plain part present", () => {
    const bodyPartsMap = new Map<string, Buffer>([["1", Buffer.from("Hello plain text", "utf-8")]]);
    const result = extractBody(bodyPartsMap, "1", null, "full");
    expect(result).toBe("Hello plain text");
  });

  it("READ-01: format=full falls back to HTML-stripped body when no text/plain part", () => {
    const bodyPartsMap = new Map<string, Buffer>([
      ["2", Buffer.from("<p>Hello HTML</p>", "utf-8")],
    ]);
    const result = extractBody(bodyPartsMap, null, "2", "full");
    expect(result).toContain("Hello HTML");
    expect(result).not.toContain("<p>");
  });

  it("returns empty string when no parts found", () => {
    const bodyPartsMap = new Map<string, Buffer>();
    const result = extractBody(bodyPartsMap, null, null, "full");
    expect(result).toBe("");
  });
});
