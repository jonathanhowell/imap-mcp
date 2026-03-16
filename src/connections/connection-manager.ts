import type { ImapFlow } from "imapflow";
import { logger } from "../logger.js";
import type { AccountConfig, AppConfig } from "../config/types.js";
import { AccountConnection } from "./account-connection.js";
import type { AccountConnectionStatus } from "./account-connection.js";

export class ConnectionManager {
  private readonly connections: Map<string, AccountConnection>;
  private readonly configs: Map<string, AccountConfig>;

  constructor(config: AppConfig) {
    this.connections = new Map();
    this.configs = new Map();
    for (const account of config.accounts) {
      this.connections.set(account.name, new AccountConnection(account.name, account));
      this.configs.set(account.name, account);
    }
  }

  /**
   * Start all account connections concurrently. Individual account failures are
   * caught and logged — connectAll() itself resolves successfully regardless.
   */
  async connectAll(): Promise<void> {
    const entries = Array.from(this.connections.entries());
    const results = await Promise.allSettled(entries.map(([, connection]) => connection.connect()));

    let connected = 0;
    let failed = 0;
    for (const result of results) {
      if (result.status === "fulfilled") {
        connected++;
      } else {
        failed++;
      }
    }

    logger.info(
      `ConnectionManager: connectAll complete — ${connected} connected, ${failed} failed`
    );
  }

  /**
   * Returns the live ImapFlow client for the named account, or a structured
   * error object if the account is unavailable or unknown.
   * Callers check `'error' in result` to detect failure.
   */
  getClient(accountId: string): ImapFlow | { error: string } {
    const connection = this.connections.get(accountId);
    if (!connection) {
      return { error: `account "${accountId}" is not configured` };
    }

    const status = connection.getStatus();
    switch (status.kind) {
      case "connected":
        return status.client;
      case "reconnecting":
        return {
          error: `account "${accountId}" is unavailable (reconnecting, attempt ${status.attempt})`,
        };
      case "failed":
        return { error: `account "${accountId}" failed permanently: ${status.reason}` };
      case "connecting":
        return { error: `account "${accountId}" is connecting` };
    }
  }

  /**
   * Returns the connection status for a named account, or a structured error
   * if the account is unknown. Used by Phase 3 list_accounts tool.
   */
  getStatus(accountId: string): AccountConnectionStatus | { error: string } {
    const connection = this.connections.get(accountId);
    if (!connection) {
      return { error: `account "${accountId}" is not configured` };
    }
    return connection.getStatus();
  }

  /**
   * Returns the names of all configured accounts (regardless of connection state).
   * Used by the list_accounts tool to enumerate accounts.
   */
  getAccountIds(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Returns the AccountConfig for the named account, or undefined if the
   * account is not configured. Used by list_accounts to read display_name and email.
   */
  getConfig(accountId: string): AccountConfig | undefined {
    return this.configs.get(accountId);
  }

  /**
   * Gracefully closes all connections. Uses Promise.allSettled so one
   * failed logout does not prevent others from closing.
   */
  async closeAll(): Promise<void> {
    const results = await Promise.allSettled(
      Array.from(this.connections.values()).map((c) => c.gracefulClose())
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    logger.info(`ConnectionManager: closeAll complete — ${succeeded} closed, ${failed} errors`);
  }
}
