import type { ImapFlow } from "imapflow";
import { Readable } from "stream";
import type { AttachmentDownload } from "../types.js";

/**
 * Download a single attachment from an IMAP message and return it as base64-encoded content.
 *
 * Acquires a mailbox lock for the specified folder, downloads the body part,
 * buffers the readable stream, and always releases the lock in a finally block.
 */
export async function downloadAttachment(
  client: ImapFlow,
  folder: string,
  uid: number,
  partId: string
): Promise<AttachmentDownload> {
  const lock = await client.getMailboxLock(folder, { readOnly: true });
  try {
    const { meta, content } = await client.download(uid, partId, { uid: true });
    const chunks: Buffer[] = [];
    for await (const chunk of content as Readable) {
      chunks.push(chunk as Buffer);
    }
    return {
      filename: meta.filename ?? "attachment",
      mime_type: meta.contentType,
      size: meta.expectedSize,
      content: Buffer.concat(chunks).toString("base64"),
    };
  } finally {
    lock.release();
  }
}
