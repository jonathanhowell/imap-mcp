import { convert } from "html-to-text";
import EmailReplyParser from "email-reply-parser";
import type { AttachmentMeta } from "../types.js";

/**
 * Minimal shape of imapflow's MessageStructureObject used for BODYSTRUCTURE traversal.
 * Only the fields we access are declared here.
 */
export interface MessageStructureObject {
  part?: string;
  type: string;
  subtype?: string;
  childNodes?: MessageStructureObject[];
  disposition?: string;
  dispositionParameters?: { filename?: string };
  parameters?: { charset?: string; name?: string };
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
 * Root node with no childNodes (single-part): treated as part '1' regardless of node.part.
 */
export function parseBodyStructure(root: MessageStructureObject): ParsedBodyStructure {
  let textPartId: string | null = null;
  let htmlPartId: string | null = null;
  const attachments: AttachmentMeta[] = [];

  function traverse(node: MessageStructureObject, partPath: string): void {
    const part = partPath;

    if (node.childNodes && node.childNodes.length > 0) {
      // Multipart: recurse into children
      node.childNodes.forEach((child, i) => traverse(child, `${partPath}.${i + 1}`));
    } else {
      const isAttachment = node.disposition === "attachment";
      const isText = node.type === "text";
      const isMultipart = node.type === "multipart";

      if (!isAttachment && isText && node.subtype === "plain" && textPartId === null) {
        textPartId = part;
      } else if (!isAttachment && isText && node.subtype === "html" && htmlPartId === null) {
        htmlPartId = part;
      } else if (isAttachment || (!isText && !isMultipart)) {
        const filename =
          node.dispositionParameters?.filename ??
          (node.parameters as { name?: string } | undefined)?.name ??
          "attachment";
        attachments.push({
          part_id: part,
          filename,
          size: node.size ?? 0,
          mime_type: `${node.type}/${node.subtype ?? "octet-stream"}`,
        });
      }
    }
  }

  traverse(root, "1");

  return { textPartId, htmlPartId, attachments };
}

export type BodyFormat = "full" | "clean" | "truncated";

/**
 * Extract and format message body from fetched body parts.
 *
 * @param bodyPartsMap - Map from part id to Buffer (as returned by imapflow fetchOne bodyParts)
 * @param textPartId - Part id for text/plain part, or null
 * @param htmlPartId - Part id for text/html part, or null
 * @param format - 'full' | 'clean' | 'truncated'
 * @param maxChars - Maximum characters for truncated format (default 2000)
 */
export function extractBody(
  bodyPartsMap: Map<string, Buffer>,
  textPartId: string | null,
  htmlPartId: string | null,
  format: BodyFormat = "full",
  maxChars = 2000
): string {
  let plainText = "";

  if (textPartId !== null && bodyPartsMap.has(textPartId)) {
    plainText = bodyPartsMap.get(textPartId)!.toString("utf-8");
  } else if (htmlPartId !== null && bodyPartsMap.has(htmlPartId)) {
    const html = bodyPartsMap.get(htmlPartId)!.toString("utf-8");
    plainText = convert(html, {
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
