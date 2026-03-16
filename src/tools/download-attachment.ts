import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ConnectionManager } from "../connections/index.js";
import { downloadAttachment } from "../services/attachment-service.js";
import { parseBodyStructure } from "../services/body-service.js";
import type { ToolResult } from "../types.js";

export const DOWNLOAD_ATTACHMENT_TOOL: Tool = {
  name: "download_attachment",
  description:
    "Download an email attachment by account name, message UID, and either part ID or filename. " +
    "Provide part_id when known (faster). Provide filename when part ID is unknown — " +
    "the server will look up the matching attachment by filename (case-insensitive).",
  inputSchema: {
    type: "object",
    properties: {
      account: {
        type: "string",
        description: "Account name from config",
      },
      uid: {
        type: "number",
        description: "The IMAP UID of the message containing the attachment",
      },
      part_id: {
        type: "string",
        description:
          "The BODYSTRUCTURE part ID of the attachment (e.g. '2', '1.2'). " +
          "Takes precedence over filename when both are provided.",
      },
      filename: {
        type: "string",
        description:
          "Filename of the attachment (case-insensitive exact match, e.g. 'report.pdf'). " +
          "Used when part_id is unknown. Ignored if part_id is also provided.",
      },
      folder: {
        type: "string",
        description: "Mailbox folder name (default: INBOX)",
      },
    },
    required: ["account", "uid"],
  },
};

interface DownloadAttachmentArgs {
  account: string;
  uid: number;
  part_id?: string;
  filename?: string;
  folder?: string;
}

export async function handleDownloadAttachment(
  args: DownloadAttachmentArgs,
  manager: ConnectionManager
): Promise<ToolResult> {
  const { account, uid, part_id, filename, folder = "INBOX" } = args;

  // Runtime guard: at least one of part_id or filename is required
  if (part_id === undefined && filename === undefined) {
    return {
      content: [{ type: "text", text: "Error: either part_id or filename must be provided" }],
      isError: true,
    };
  }

  const clientOrError = manager.getClient(account);
  if ("error" in clientOrError) {
    return {
      content: [{ type: "text", text: `Error: ${clientOrError.error}` }],
      isError: true,
    };
  }
  const client = clientOrError;

  // Resolve part_id: use directly if provided; otherwise look up by filename
  let resolvedPartId: string;

  if (part_id !== undefined) {
    // part_id wins — skip filename lookup
    resolvedPartId = part_id;
  } else {
    // filename lookup: fetch bodyStructure, walk MIME parts, find first case-insensitive match
    const lock = await client.getMailboxLock(folder, { readOnly: true });
    try {
      const msgs = await client.fetchAll([uid], { bodyStructure: true }, { uid: true });
      if (!msgs || msgs.length === 0) {
        return {
          content: [{ type: "text", text: `Error: message ${uid} not found` }],
          isError: true,
        };
      }
      const bodyStructure = msgs[0].bodyStructure;
      if (!bodyStructure) {
        return {
          content: [{ type: "text", text: `Error: message ${uid} has no bodyStructure` }],
          isError: true,
        };
      }
      const parsed = parseBodyStructure(bodyStructure);
      const match = parsed.attachments.find(
        (a) => a.filename.toLowerCase() === (filename as string).toLowerCase()
      );
      if (!match) {
        return {
          content: [
            {
              type: "text",
              text: `No attachment with filename '${filename as string}' found in message ${uid}`,
            },
          ],
          isError: true,
        };
      }
      resolvedPartId = match.part_id;
    } finally {
      lock.release();
    }
    // Lock is released before downloadAttachment acquires its own lock (imapflow nested lock pitfall)
  }

  try {
    const result = await downloadAttachment(client, folder, uid, resolvedPartId);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      isError: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
}
