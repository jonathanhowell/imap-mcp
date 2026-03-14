import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolResult } from "../types.js";
import type { Poller } from "../polling/poller.js";

export interface GetNewMailParams {
  since: string;
  account?: string;
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
    },
    required: ["since"],
  },
};

/**
 * Handle the get_new_mail MCP tool call.
 *
 * Cache-only: delegates to `poller.query()` and never touches IMAP.
 * Returns a cold-cache error if the initial poll has not yet completed.
 */
export async function handleGetNewMail(
  params: GetNewMailParams,
  poller: Poller
): Promise<ToolResult> {
  if (!poller.isCacheReady()) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "Polling has not completed yet — no cached results available. Retry in ~5 minutes.",
        },
      ],
    };
  }

  const result = poller.query(params.since, params.account);
  return {
    isError: false,
    content: [{ type: "text", text: JSON.stringify(result) }],
  };
}
