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

    // Phase 13 shape (HEALTH-02 / HEALTH-03): flat snake_case health fields
    // per CONTEXT.md D-02..D-07. `last_connected_at` is the same across every
    // branch — read via the Plan 13-01 accessor and emit as ISO string or null.
    const lastConnectedAt = manager.getLastConnectedAt(id)?.toISOString() ?? null;

    if ("error" in status) {
      // D-03 breaking change: legacy free-form error key fully removed;
      // last_error carries the same content via the flat shape.
      return {
        ...baseEntry,
        status: "error",
        last_error: status.error,
        last_error_at: null,
        last_connected_at: lastConnectedAt,
      };
    }
    switch (status.kind) {
      case "connected":
        // D-04: explicit nulls, not omitted keys.
        return {
          ...baseEntry,
          status: "connected",
          last_error: null,
          last_error_at: null,
          last_connected_at: lastConnectedAt,
        };
      case "connecting":
        return {
          ...baseEntry,
          status: "connecting",
          last_error: null,
          last_error_at: null,
          last_connected_at: lastConnectedAt,
        };
      case "reconnecting":
        // SECURITY (T-13-03 / T-12-09 / V5 ASVS — RESEARCH Pitfall 1):
        // the reconnecting status object carries a raw err.message field
        // (stamped in account-connection.ts at the reconnect-failure and
        // initial-connect-failure sites). That raw text may include
        // auth.user or transport metadata and MUST NOT be echoed. We
        // hardcode last_error to null on this branch; the agent reads
        // temporal context from `attempt` + `next_retry_at` instead.
        return {
          ...baseEntry,
          status: "reconnecting",
          attempt: status.attempt,
          next_retry_at: status.nextRetryAt.toISOString(),
          last_error: null,
          last_error_at: null,
          last_connected_at: lastConnectedAt,
        };
      case "suspended":
        // D-06: status.reason is a stock string from humanReason() — SAFE to
        // surface verbatim. status.since is the wall-clock the account
        // entered suspended (Phase 12 D-02).
        return {
          ...baseEntry,
          status: "suspended",
          last_error: status.reason,
          last_error_at: status.since.toISOString(),
          last_connected_at: lastConnectedAt,
        };
    }
  });
  return {
    isError: false,
    content: [{ type: "text", text: JSON.stringify(accounts) }],
  };
}
