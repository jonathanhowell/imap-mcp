import { ConnectionManager } from "../connections/index.js";
import { searchMessages } from "../services/search-service.js";
import { logger } from "../logger.js";
import type { MultiAccountMessageHeader, MultiAccountResult } from "../types.js";

/**
 * Poller manages background IMAP polling and an in-memory cache of recent messages.
 * The get_new_mail tool delegates to this interface — handlers never touch IMAP directly.
 *
 * Implementation is provided in Plan 05-02. This file is the interface contract used by
 * the get_new_mail handler and its tests.
 */
export class Poller {
  private cache = new Map<string, MultiAccountMessageHeader[]>();
  private lastPollTime: Date | null = null;
  private stopped = false;

  constructor(
    private readonly manager: ConnectionManager,
    private readonly intervalSeconds: number = 300
  ) {}

  /**
   * Start the polling loop. Runs first poll immediately, then schedules
   * subsequent polls at intervalSeconds intervals.
   */
  start(): void {
    this.stopped = false;
    void this.runLoop();
  }

  /**
   * Stop the polling loop after the current poll completes.
   */
  stop(): void {
    this.stopped = true;
  }

  /**
   * Returns true once the initial poll has completed and the cache is populated.
   * Callers should return an error to the agent if this returns false.
   */
  isCacheReady(): boolean {
    return this.lastPollTime !== null;
  }

  /**
   * Query cached messages that arrived after `since`.
   * @param since ISO 8601 timestamp — return messages with internalDate after this time.
   * @param account Account name from config. Omit to query all accounts.
   * @param excludeKeywords Exclude messages that have any of these custom IMAP keywords set (case-insensitive).
   */
  query(
    since: string,
    account?: string,
    excludeKeywords?: string[]
  ): MultiAccountResult<MultiAccountMessageHeader> {
    const sinceTime = new Date(since).getTime() || 0;
    const accountIds = account ? [account] : this.manager.getAccountIds();

    const results: MultiAccountMessageHeader[] = [];
    const errors: Record<string, string> = {};

    for (const id of accountIds) {
      const entries = this.cache.get(id);
      if (entries === undefined) {
        errors[id] = "account not found in cache";
      } else {
        const filtered = entries.filter(
          (m) =>
            (new Date(m.date).getTime() || 0) > sinceTime &&
            (excludeKeywords === undefined ||
              excludeKeywords.length === 0 ||
              !(m.keywords ?? []).some((mk) =>
                excludeKeywords.some((ek) => mk.toLowerCase() === ek.toLowerCase())
              ))
        );
        results.push(...filtered);
      }
    }

    // Sort newest-first
    results.sort((a, b) => (new Date(b.date).getTime() || 0) - (new Date(a.date).getTime() || 0));

    return Object.keys(errors).length > 0 ? { results, errors } : { results };
  }

  private async runLoop(): Promise<void> {
    await this.poll();
    if (!this.stopped) {
      globalThis.setTimeout(() => void this.runLoop(), this.intervalSeconds * 1000);
    }
  }

  private async poll(): Promise<void> {
    const accountIds = this.manager.getAccountIds();
    for (const accountId of accountIds) {
      try {
        await this.pollAccount(accountId);
      } catch (err) {
        logger.error(`Poller: failed to poll account ${accountId}: ${String(err)}`);
      }
    }
    this.lastPollTime = new Date();
  }

  private async pollAccount(accountId: string): Promise<void> {
    const result = this.manager.getClient(accountId);
    if ("error" in result) {
      throw new Error(`getClient error for ${accountId}: ${result.error}`);
    }

    const client = result;

    let since: string;
    let maxResults: number;

    if (this.lastPollTime === null) {
      // Seed: last 30 days
      since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      maxResults = 1000;
    } else {
      // Incremental: lastPollTime - 24h to handle IMAP SEARCH SINCE day-granularity
      since = new Date(this.lastPollTime.getTime() - 24 * 60 * 60 * 1000).toISOString();
      maxResults = 100;
    }

    const messages = await searchMessages(client, {
      since,
      folder: "INBOX",
      maxResults,
    });

    const headers: MultiAccountMessageHeader[] = messages.map((m) => ({
      ...m,
      account: accountId,
    }));

    this.mergeIntoCache(accountId, headers);
  }

  /**
   * Immediately adds a keyword to a cached message's keywords array.
   * Called by flag_message after a successful IMAP STORE so the cache reflects
   * the new flag without waiting for the next poll cycle.
   */
  updateKeyword(accountId: string, uid: number, keyword: string): void {
    const entries = this.cache.get(accountId);
    if (!entries) return;
    const msg = entries.find((m) => m.uid === uid);
    if (!msg) return;
    const keywords = msg.keywords ?? [];
    if (!keywords.some((k) => k.toLowerCase() === keyword.toLowerCase())) {
      msg.keywords = [...keywords, keyword];
    }
  }

  /**
   * Immediately removes a keyword from a cached message's keywords array.
   * Called by unflag_message after a successful IMAP STORE so the cache reflects
   * the removal without waiting for the next poll cycle.
   */
  removeKeyword(accountId: string, uid: number, keyword: string): void {
    const entries = this.cache.get(accountId);
    if (!entries) return;
    const msg = entries.find((m) => m.uid === uid);
    if (!msg) return;
    msg.keywords = (msg.keywords ?? []).filter((k) => k.toLowerCase() !== keyword.toLowerCase());
  }

  private mergeIntoCache(accountId: string, incoming: MultiAccountMessageHeader[]): void {
    const existing = this.cache.get(accountId) ?? [];
    const existingUids = new Set(existing.map((m) => m.uid));
    const deduplicated = incoming.filter((m) => !existingUids.has(m.uid));
    this.cache.set(accountId, [...existing, ...deduplicated]);
  }
}
