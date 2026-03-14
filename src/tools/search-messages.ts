import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ConnectionManager } from "../connections/index.js";
import type { ToolResult } from "../types.js";
import type { MultiAccountSearchResultItem, MultiAccountResult } from "../types.js";
import { searchMessages } from "../services/search-service.js";
import { fanOutAccounts, safeTime } from "./multi-account.js";

export interface SearchMessagesParams {
  account?: string;
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
      account: {
        type: "string",
        description: "Account name from config. Omit to search across all accounts.",
      },
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
    required: [],
  },
};

/**
 * Handle the search_messages MCP tool call.
 *
 * When account is omitted, fans out to all accounts and returns
 * { results, errors? } wrapper with items sorted newest-first.
 *
 * When account is provided, returns flat JSON array of SearchResultItem objects.
 */
export async function handleSearchMessages(
  params: SearchMessagesParams,
  manager: ConnectionManager
): Promise<ToolResult> {
  const { account, from, subject, since, before, unread, folder, max_results } = params;

  const MAX_RESULTS = 200;
  const effectiveMax = Math.min(max_results ?? 50, MAX_RESULTS);

  // account is intentionally not defaulted — absence signals multi-account mode
  if (account === undefined) {
    const accountIds = manager.getAccountIds();
    const { results, errors } = await fanOutAccounts(accountIds, manager, (client) =>
      searchMessages(client, {
        from,
        subject,
        since,
        before,
        unread,
        folder,
        maxResults: effectiveMax,
      })
    );

    if (results.length === 0 && Object.keys(errors).length === accountIds.length) {
      return {
        content: [{ type: "text", text: `All accounts failed: ${JSON.stringify(errors)}` }],
        isError: true,
      };
    }

    results.sort((a, b) => safeTime(b.date) - safeTime(a.date));
    const page = results.slice(0, effectiveMax);

    const response: MultiAccountResult<MultiAccountSearchResultItem> = {
      results: page,
      ...(Object.keys(errors).length > 0 ? { errors } : {}),
    };

    return { content: [{ type: "text", text: JSON.stringify(response) }], isError: false };
  }

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
    maxResults: effectiveMax,
  });

  return {
    content: [{ type: "text", text: JSON.stringify(results) }],
    isError: false,
  };
}
