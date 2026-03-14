import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ConnectionManager } from "../connections/index.js";
import type { ToolResult } from "../types.js";
import type { MultiAccountFolderEntry, MultiAccountResult } from "../types.js";
import { listFolders } from "../services/folder-service.js";
import { logger } from "../logger.js";
import { fanOutAccounts } from "./multi-account.js";

export const LIST_FOLDERS_TOOL: Tool = {
  name: "list_folders",
  description: "List all folders/mailboxes in a named account with total and unread message counts",
  inputSchema: {
    type: "object",
    properties: {
      account: {
        type: "string",
        description: "Account name from config. Omit to list folders across all accounts.",
      },
    },
    required: [],
  },
};

export async function handleListFolders(
  params: { account?: string },
  manager: ConnectionManager
): Promise<ToolResult> {
  if (params.account === undefined) {
    const accountIds = manager.getAccountIds();
    const { results, errors } = await fanOutAccounts(accountIds, manager, (client) =>
      listFolders(client)
    );

    if (results.length === 0 && Object.keys(errors).length === accountIds.length) {
      return {
        isError: true,
        content: [{ type: "text", text: `All accounts failed: ${JSON.stringify(errors)}` }],
      };
    }

    results.sort((a, b) => a.name.localeCompare(b.name));

    const response: MultiAccountResult<MultiAccountFolderEntry> = {
      results,
      ...(Object.keys(errors).length > 0 ? { errors } : {}),
    };

    return { isError: false, content: [{ type: "text", text: JSON.stringify(response) }] };
  }

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
