import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ConnectionManager } from "../connections/index.js";
import type { ToolResult } from "../types.js";
import type { MultiAccountMessageHeader, MultiAccountResult } from "../types.js";
import { listMessages } from "../services/message-service.js";
import { fanOutAccounts, safeTime } from "./multi-account.js";

export interface ListMessagesParams {
  account?: string;
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
      account: {
        type: "string",
        description: "Account name from config. Omit to query all accounts.",
      },
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
    required: ["folder"],
  },
};

/**
 * Handle the list_messages MCP tool call.
 *
 * When account is omitted, fans out to all accounts in parallel and returns
 * a { results, errors? } wrapper. When account is provided, returns the
 * existing flat MessageHeader[] response (single-account path unchanged).
 */
export async function handleListMessages(
  params: ListMessagesParams,
  manager: ConnectionManager
): Promise<ToolResult> {
  const { account, folder, limit, offset, sort, unread_only } = params;

  const MAX_RESULTS = 200;
  const cappedLimit = Math.min(limit ?? 50, MAX_RESULTS);

  if (account === undefined) {
    const accountIds = manager.getAccountIds();
    const perAccountLimit = cappedLimit + (offset ?? 0);
    const { results, errors } = await fanOutAccounts(accountIds, manager, (client) =>
      listMessages(client, folder, { limit: perAccountLimit, sort, unreadOnly: unread_only })
    );

    if (results.length === 0 && Object.keys(errors).length === accountIds.length) {
      return {
        content: [{ type: "text", text: `All accounts failed: ${JSON.stringify(errors)}` }],
        isError: true,
      };
    }

    results.sort((a, b) => safeTime(b.date) - safeTime(a.date));
    const effectiveOffset = offset ?? 0;
    const effectiveLimit = cappedLimit;
    const page = results.slice(effectiveOffset, effectiveOffset + effectiveLimit);

    const response: MultiAccountResult<MultiAccountMessageHeader> = {
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

  const headers = await listMessages(clientResult, folder, {
    limit: cappedLimit,
    offset,
    sort,
    unreadOnly: unread_only,
  });

  return {
    content: [{ type: "text", text: JSON.stringify(headers) }],
    isError: false,
  };
}
