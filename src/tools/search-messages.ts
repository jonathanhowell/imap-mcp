import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ConnectionManager } from "../connections/index.js";
import type { ToolResult } from "../types.js";
import { searchMessages } from "../services/search-service.js";

export interface SearchMessagesParams {
  account: string;
  from?: string;
  subject?: string;
  since?: string;
  before?: string;
  unread?: boolean;
  folder?: string;
  max_results?: number;
}

export const SEARCH_MESSAGES_TOOL: Tool = {
  name: "search_messages",
  description:
    "Search messages by sender, subject, date range, or read status. " +
    "Passing folder='all' searches all folders and may be slow on large mailboxes.",
  inputSchema: {
    type: "object",
    properties: {
      account: { type: "string", description: "Account name from config" },
      from: { type: "string", description: "Filter by sender address (partial match)" },
      subject: { type: "string", description: "Filter by subject text (partial match)" },
      since: {
        type: "string",
        description: "Return messages on or after this date (ISO 8601, e.g. 2024-01-01)",
      },
      before: {
        type: "string",
        description: "Return messages before this date (ISO 8601, e.g. 2024-12-31)",
      },
      unread: {
        type: "boolean",
        description:
          "When true, return only unread messages; when false, return only read messages",
      },
      folder: {
        type: "string",
        description:
          "Folder to search (default: INBOX). Pass 'all' to search all folders — may be slow on large mailboxes.",
      },
      max_results: {
        type: "number",
        description: "Maximum number of results to return (default 50)",
      },
    },
    required: ["account"],
  },
};

/**
 * Handle the search_messages MCP tool call.
 *
 * Returns a JSON array of SearchResultItem objects (each includes a folder field),
 * or an error ToolResult when the account is unavailable.
 */
export async function handleSearchMessages(
  params: SearchMessagesParams,
  manager: ConnectionManager
): Promise<ToolResult> {
  const { account, from, subject, since, before, unread, folder, max_results } = params;

  const clientResult = manager.getClient(account);

  if ("error" in clientResult) {
    return {
      content: [{ type: "text", text: clientResult.error }],
      isError: true,
    };
  }

  const results = await searchMessages(clientResult, {
    from,
    subject,
    since,
    before,
    unread,
    folder,
    maxResults: max_results,
  });

  return {
    content: [{ type: "text", text: JSON.stringify(results) }],
    isError: false,
  };
}
