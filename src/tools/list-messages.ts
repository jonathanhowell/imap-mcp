import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ConnectionManager } from "../connections/index.js";
import type { ToolResult } from "../types.js";
import { listMessages } from "../services/message-service.js";

export interface ListMessagesParams {
  account: string;
  folder: string;
  limit?: number;
  offset?: number;
  sort?: "newest" | "oldest";
  unread_only?: boolean;
}

export const LIST_MESSAGES_TOOL: Tool = {
  name: "list_messages",
  description: "List messages in a folder with pagination and optional filtering",
  inputSchema: {
    type: "object",
    properties: {
      account: { type: "string", description: "Account name from config" },
      folder: { type: "string", description: "Mailbox folder path (e.g. INBOX, Work/Projects)" },
      limit: {
        type: "number",
        description: "Maximum number of messages to return (default 50)",
      },
      offset: {
        type: "number",
        description: "Number of messages to skip for pagination (default 0)",
      },
      sort: {
        type: "string",
        enum: ["newest", "oldest"],
        description:
          "Sort order: newest (default) returns most recent first; oldest returns earliest first",
      },
      unread_only: {
        type: "boolean",
        description: "When true, returns only unread messages (default false)",
      },
    },
    required: ["account", "folder"],
  },
};

/**
 * Handle the list_messages MCP tool call.
 *
 * Returns a JSON array of MessageHeader objects, or an error ToolResult
 * when the account is unavailable.
 */
export async function handleListMessages(
  params: ListMessagesParams,
  manager: ConnectionManager
): Promise<ToolResult> {
  const { account, folder, limit, offset, sort, unread_only } = params;

  const clientResult = manager.getClient(account);

  if ("error" in clientResult) {
    return {
      content: [{ type: "text", text: clientResult.error }],
      isError: true,
    };
  }

  const headers = await listMessages(clientResult, folder, {
    limit,
    offset,
    sort,
    unreadOnly: unread_only,
  });

  return {
    content: [{ type: "text", text: JSON.stringify(headers) }],
    isError: false,
  };
}
