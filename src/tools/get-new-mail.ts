import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolResult } from "../types.js";
import type { Poller } from "../polling/poller.js";

export interface GetNewMailParams {
  since: string;
  account?: string;
  exclude_keywords?: string[];
}

export const GET_NEW_MAIL_TOOL: Tool = {
  name: "get_new_mail",
  description:
    "Query messages that have arrived since a given timestamp. " +
    "Results are served from the in-memory cache — no IMAP round-trip. " +
    "Cache is populated within seconds of server start and refreshed on the configured polling interval.",
  inputSchema: {
    type: "object",
    properties: {
      since: {
        type: "string",
        description:
          "ISO 8601 timestamp — return messages with internalDate after this time (e.g. 2024-01-15T10:00:00Z).",
      },
      account: {
        type: "string",
        description: "Account name from config. Omit to query all accounts.",
      },
      exclude_keywords: {
        type: "array",
        items: { type: "string" },
        description:
          "Exclude messages that have any of these custom IMAP keywords set (e.g. ['ClaudeProcessed', 'ClaudeReplied']). " +
          "Filters cached results in-memory.",
      },
    },
    required: ["since"],
  },
};

/**
 * Handle the get_new_mail MCP tool call.
 *
 * Cache-only: delegates to `poller.query()` and never touches IMAP. The
 * returned shape is `GetNewMailResult` which always includes a
 * `freshness:{}` block and may include `errors:{}` per account. Cold-
 * cache, reconnecting, and suspended accounts surface as entries in
 * `errors:{}` with stable D-14 stock-string prefixes — the handler
 * returns isError: false in all such cases (D-15 partial-results
 * policy). Agents distinguish the three modes by matching on the
 * leading prefix of each errors entry.
 */
export async function handleGetNewMail(
  params: GetNewMailParams,
  poller: Poller
): Promise<ToolResult> {
  const result = poller.query(params.since, params.account, params.exclude_keywords);
  return {
    isError: false,
    content: [{ type: "text", text: JSON.stringify(result) }],
  };
}
