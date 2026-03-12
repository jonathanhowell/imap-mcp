import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ConnectionManager } from "../connections/index.js";
import type { ToolResult } from "../types.js";

export const LIST_ACCOUNTS_TOOL: Tool = {
  name: "list_accounts",
  description: "List all configured IMAP accounts with their current connection status",
  inputSchema: { type: "object", properties: {} },
};

export function handleListAccounts(manager: ConnectionManager): ToolResult {
  const accountIds = manager.getAccountIds();
  const accounts = accountIds.map((id) => {
    const status = manager.getStatus(id);
    if ("error" in status) {
      return { account: id, status: "error", detail: status.error };
    }
    switch (status.kind) {
      case "connected":
        return { account: id, status: "connected" };
      case "connecting":
        return { account: id, status: "connecting" };
      case "reconnecting":
        return { account: id, status: "reconnecting", attempt: status.attempt };
      case "failed":
        return { account: id, status: "failed", detail: status.reason };
    }
  });
  return {
    isError: false,
    content: [{ type: "text", text: JSON.stringify(accounts) }],
  };
}
