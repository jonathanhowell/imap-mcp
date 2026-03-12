import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ConnectionManager } from "../connections/index.js";
import { downloadAttachment } from "../services/attachment-service.js";
import type { ToolResult } from "../types.js";

export const DOWNLOAD_ATTACHMENT_TOOL: Tool = {
  name: "download_attachment",
  description: "Download an email attachment by account name, message UID, and part ID",
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
        description: "The BODYSTRUCTURE part ID of the attachment (e.g. '2', '1.2')",
      },
      folder: {
        type: "string",
        description: "Mailbox folder name (default: INBOX)",
      },
    },
    required: ["account", "uid", "part_id"],
  },
};

interface DownloadAttachmentArgs {
  account: string;
  uid: number;
  part_id: string;
  folder?: string;
}

export async function handleDownloadAttachment(
  args: DownloadAttachmentArgs,
  manager: ConnectionManager
): Promise<ToolResult> {
  const { account, uid, part_id, folder = "INBOX" } = args;

  const clientOrError = manager.getClient(account);
  if ("error" in clientOrError) {
    return {
      content: [{ type: "text", text: `Error: ${clientOrError.error}` }],
      isError: true,
    };
  }
  const client = clientOrError;

  try {
    const result = await downloadAttachment(client, folder, uid, part_id);
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
