import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ConnectionManager } from "../connections/index.js";
import type { ToolResult } from "../types.js";

export const LIST_ACCOUNTS_TOOL: Tool = {
  name: "list_accounts",
  description:
    "List all configured IMAP accounts with their current connection status, email address, and display name",
  inputSchema: { type: "object", properties: {} },
};

export function handleListAccounts(manager: ConnectionManager): ToolResult {
  const accountIds = manager.getAccountIds();
  const accounts = accountIds.map((id) => {
    const status = manager.getStatus(id);
    const cfg = manager.getConfig(id);
    const email = cfg?.email ?? cfg?.username ?? "";

    const baseEntry = {
      account: id,
      email,
      ...(cfg?.display_name ? { display_name: cfg.display_name } : {}),
    };

    if ("error" in status) {
      return { ...baseEntry, status: "error", detail: status.error };
    }
    switch (status.kind) {
      case "connected":
        return { ...baseEntry, status: "connected" };
      case "connecting":
        return { ...baseEntry, status: "connecting" };
      case "reconnecting":
        return { ...baseEntry, status: "reconnecting", attempt: status.attempt };
      case "failed":
        return { ...baseEntry, status: "failed", detail: status.reason };
    }
  });
  return {
    isError: false,
    content: [{ type: "text", text: JSON.stringify(accounts) }],
  };
}
