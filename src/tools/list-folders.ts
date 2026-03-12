import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ConnectionManager } from "../connections/index.js";
import type { ToolResult } from "../types.js";
import { listFolders } from "../services/folder-service.js";
import { logger } from "../logger.js";

export const LIST_FOLDERS_TOOL: Tool = {
  name: "list_folders",
  description: "List all folders/mailboxes in a named account with total and unread message counts",
  inputSchema: {
    type: "object",
    properties: {
      account: { type: "string", description: "Account name from config" },
    },
    required: ["account"],
  },
};

export async function handleListFolders(
  params: { account: string },
  manager: ConnectionManager
): Promise<ToolResult> {
  const result = manager.getClient(params.account);
  if ("error" in result) {
    return { isError: true, content: [{ type: "text", text: result.error }] };
  }
  try {
    const folders = await listFolders(result);
    logger.info(`list_folders: ${folders.length} folders for account "${params.account}"`);
    return {
      isError: false,
      content: [{ type: "text", text: JSON.stringify(folders) }],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`list_folders error for account "${params.account}": ${msg}`);
    return { isError: true, content: [{ type: "text", text: `IMAP error: ${msg}` }] };
  }
}
