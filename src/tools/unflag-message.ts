import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ConnectionManager } from "../connections/index.js";
import type { Poller } from "../polling/poller.js";
import type { ToolResult } from "../types.js";
import { logger } from "../logger.js";

export const UNFLAG_MESSAGE_TOOL: Tool = {
  name: "unflag_message",
  description: "Remove a custom IMAP keyword from a message.",
  inputSchema: {
    type: "object",
    properties: {
      account: { type: "string", description: "Account name from config" },
      uid: { type: "number", description: "IMAP UID of the message" },
      keyword: { type: "string", description: "Custom keyword to remove (e.g. ClaudeProcessed)" },
      folder: { type: "string", description: "Mailbox folder (default: INBOX)" },
    },
    required: ["account", "uid", "keyword"],
  },
};

interface UnflagMessageArgs {
  account: string;
  uid: number;
  keyword: string;
  folder?: string;
}

export async function handleUnflagMessage(
  args: UnflagMessageArgs,
  manager: ConnectionManager,
  poller?: Poller
): Promise<ToolResult> {
  const { account, uid, keyword, folder = "INBOX" } = args;

  const clientOrError = manager.getClient(account);
  if ("error" in clientOrError) {
    return { content: [{ type: "text", text: `Error: ${clientOrError.error}` }], isError: true };
  }
  const client = clientOrError;

  const lock = await client.getMailboxLock(folder);
  try {
    // KFLAG-04: warn if server does not support custom keywords
    if (client.mailbox && !client.mailbox.permanentFlags?.has("\\*")) {
      logger.warn(
        `[${account}] Server does not support custom IMAP keywords (PERMANENTFLAGS lacks \\*) — ClaudeProcessed flag may not persist`
      );
    }
    // Remove the keyword via STORE -FLAGS
    await client.messageFlagsRemove([uid], [keyword], { uid: true });
    poller?.removeKeyword(account, uid, keyword);
    return {
      content: [{ type: "text", text: JSON.stringify({ success: true, account, uid, keyword }) }],
      isError: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: "text",
          text: `Error unflagging message ${uid} on ${account} with keyword ${keyword}: ${message}`,
        },
      ],
      isError: true,
    };
  } finally {
    lock.release();
  }
}
