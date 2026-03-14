import type { ImapFlow } from "imapflow";
import type { ConnectionManager } from "../connections/index.js";

/**
 * Fan out a service call to all accounts in parallel using Promise.allSettled.
 * Each fulfilled account's items get an `account` field added.
 * Each rejected account is recorded in the errors map.
 *
 * Per-account fetch count: callers should pass limit + offset to ensure
 * the global top-N by date are captured before the final merge+slice.
 */
export async function fanOutAccounts<T extends object>(
  accountIds: string[],
  manager: ConnectionManager,
  fn: (client: ImapFlow, accountId: string) => Promise<T[]>
): Promise<{ results: Array<T & { account: string }>; errors: Record<string, string> }> {
  const settled = await Promise.allSettled(
    accountIds.map(async (accountId) => {
      const clientResult = manager.getClient(accountId);
      if ("error" in clientResult) throw new Error(clientResult.error);
      const items = await fn(clientResult, accountId);
      return { accountId, items };
    })
  );

  const results: Array<T & { account: string }> = [];
  const errors: Record<string, string> = {};

  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i];
    const accountId = accountIds[i];
    if (outcome.status === "fulfilled") {
      for (const item of outcome.value.items) {
        results.push({ ...item, account: outcome.value.accountId });
      }
    } else {
      errors[accountId] =
        outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
    }
  }

  return { results, errors };
}

/**
 * Safe date comparator for merging multi-account results.
 * Treats missing or unparseable dates as epoch (oldest position).
 */
export function safeTime(dateStr: string): number {
  return new Date(dateStr).getTime() || 0;
}
