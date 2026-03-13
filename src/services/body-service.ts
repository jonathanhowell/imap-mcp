import { convert } from "html-to-text";
import EmailReplyParser from "email-reply-parser";
import type { AttachmentMeta } from "../types.js";

/**
 * Minimal shape of imapflow's MessageStructureObject used for BODYSTRUCTURE traversal.
 * Only the fields we access are declared here.
 *
 * Note: imapflow sets `type` as the full content-type string (e.g. "text/plain",
 * "multipart/mixed") and sets `part` to the correct IMAP section number on each node.
 */
export interface MessageStructureObject {
  part?: string;
  type: string;
  childNodes?: MessageStructureObject[];
  disposition?: string;
  dispositionParameters?: { filename?: string };
  parameters?: { [key: string]: string };
  size?: number;
}

export interface ParsedBodyStructure {
  textPartId: string | null;
  htmlPartId: string | null;
  attachments: AttachmentMeta[];
}

/**
 * Traverse a BODYSTRUCTURE tree and extract:
 * - textPartId: first non-attachment text/plain part
 * - htmlPartId: first non-attachment text/html part
 * - attachments: all attachment or non-text/non-multipart parts
 *
 * Uses node.part (set by imapflow) for section numbers.
 * Single-part root with no part field defaults to "1".
 */
export function parseBodyStructure(root: MessageStructureObject): ParsedBodyStructure {
  let textPartId: string | null = null;
  let htmlPartId: string | null = null;
  const attachments: AttachmentMeta[] = [];

  function traverse(node: MessageStructureObject): void {
    if (node.childNodes && node.childNodes.length > 0) {
      // Multipart: recurse into children (each child already has node.part set by imapflow)
      node.childNodes.forEach((child) => traverse(child));
    } else {
      const part = node.part ?? "1"; // single-part root has no part field
      const [mainType, subtype] = node.type.split("/");
      const isAttachment = node.disposition === "attachment";
      const isText = mainType === "text";
      const isMultipart = mainType === "multipart";

      if (!isAttachment && isText && subtype === "plain" && textPartId === null) {
        textPartId = part;
      } else if (!isAttachment && isText && subtype === "html" && htmlPartId === null) {
        htmlPartId = part;
      } else if (isAttachment || (!isText && !isMultipart)) {
        const filename =
          node.dispositionParameters?.filename ?? node.parameters?.["name"] ?? "attachment";
        attachments.push({
          part_id: part,
          filename,
          size: node.size ?? 0,
          mime_type: node.type,
        });
      }
    }
  }

  traverse(root);

  return { textPartId, htmlPartId, attachments };
}

export type BodyFormat = "full" | "clean" | "truncated";

/**
 * Format a decoded message body string.
 *
 * @param rawText - Decoded body text (plain text, or HTML string if isHtml=true)
 * @param isHtml - True if rawText is HTML and should be converted to plain text
 * @param format - 'full' | 'clean' | 'truncated'
 * @param maxChars - Maximum characters for truncated format (default 2000)
 */
export function extractBody(
  rawText: string,
  isHtml: boolean,
  format: BodyFormat = "full",
  maxChars = 2000
): string {
  let plainText = rawText;

  if (isHtml) {
    plainText = convert(rawText, {
      wordwrap: false,
      selectors: [
        { selector: "a", options: { ignoreHref: true } },
        { selector: "img", format: "skip" },
      ],
    });
  }

  if (format === "clean") {
    plainText = new EmailReplyParser().read(plainText).getVisibleText();
  } else if (format === "truncated") {
    plainText = plainText.slice(0, maxChars);
  }

  return plainText;
}
