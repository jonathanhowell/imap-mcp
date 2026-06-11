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
      case "suspended":
        // D-01 / Plan 12-04: `failed` is gone; `suspended` is the fatal terminal state
        // populated by classifyConnectionError(err) === "fatal". `status.reason` is a
        // stock string from humanReason() — never raw err.message (T-12-09 / V5 ASVS).
        // Phase 13 (HEALTH-03) will replace `status: "suspended"` here with a richer
        // health-surface object; for Phase 12 the existing { status, detail } shape
        // is preserved so the tool API does not change mid-milestone.
        return { ...baseEntry, status: "suspended", detail: status.reason };
    }
  });
  return {
    isError: false,
    content: [{ type: "text", text: JSON.stringify(accounts) }],
  };
}
