import { ConnectionManager } from "../connections/index.js";
import { searchMessages } from "../services/search-service.js";
import { logger } from "../logger.js";
import type {
  AccountFreshness,
  GetNewMailResult,
  MultiAccountMessageHeader,
} from "../types.js";

/**
 * Poller manages background IMAP polling and an in-memory cache of recent messages.
 * The get_new_mail tool delegates to this interface — handlers never touch IMAP directly.
 *
 * Implementation is provided in Plan 05-02. This file is the interface contract used by
 * the get_new_mail handler and its tests.
 */
export class Poller {
  private cache = new Map<string, MultiAccountMessageHeader[]>();
  // D-11 / CACHE-01: per-account poll timestamps. `null` means the account
  // has been registered but never successfully polled (e.g. account in
  // reconnect from server start). Stamped AFTER mergeIntoCache succeeds
  // — RESEARCH Pitfall 2: never stamp before merge or a thrown
  // searchMessages call would falsely advance the timestamp.
  private lastPolledAt = new Map<string, Date | null>();
  private stopped = false;

  // D-15 / CONN-07: per-cycle tracking — at most one `debug` log per skipped
  // account per poll cycle. Cleared at the start of every `poll()` so the
  // skip is not sticky (skipped accounts are re-evaluated next cycle).
  private skipLoggedThisCycle = new Set<string>();

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
   * D-12 / CACHE-01: per-account poll-time read path. Returns null when
   * the account has never been successfully polled (initial state, OR
   * account has been registered but always-skipped due to non-connected
   * status). Used by `query()` to build the `freshness:{}` block.
   */
  getLastPolledAt(accountId: string): Date | null {
    return this.lastPolledAt.get(accountId) ?? null;
  }

  /**
   * Query cached messages that arrived after `since`. Returns a
   * `GetNewMailResult` whose shape is:
   *
   * ```
   * {
   *   results: MultiAccountMessageHeader[],
   *   errors?: Record<accountId, stockErrorString>,
   *   freshness: Record<accountId, { last_polled_at, cache_age_seconds }>
   * }
   * ```
   *
   * The `freshness` block is ALWAYS present (D-08 / D-09 — explicit nulls
   * for never-polled accounts; never an absent key).
   *
   * D-14 per-account error dispatch:
   *   - `connected` + no prior poll → `errors[id] = "no cache yet — polling has not completed"`
   *   - `reconnecting` → `errors[id] = "account reconnecting (attempt N)"`
   *   - `connecting` → `errors[id] = "account reconnecting (attempt 1)"` (functionally indistinguishable for the agent)
   *   - `suspended` → `errors[id] = "account suspended: <status.reason>"`
   *     (`status.reason` is the stock string from `humanReason()` — NEVER
   *     `err.message`. V5 ASVS / T-12-09).
   *   - `connected` + has prior poll → cached results pushed (D-15
   *     partial-results policy).
   *
   * @param since ISO 8601 timestamp — return messages with internalDate after this time.
   * @param account Account name from config. Omit to query all accounts.
   * @param excludeKeywords Exclude messages that have any of these custom IMAP keywords set (case-insensitive).
   */
  query(since: string, account?: string, excludeKeywords?: string[]): GetNewMailResult {
    const sinceTime = new Date(since).getTime() || 0;
    const accountIds = account ? [account] : this.manager.getAccountIds();
    const nowMs = Date.now();

    const results: MultiAccountMessageHeader[] = [];
    const errors: Record<string, string> = {};
    const freshness: Record<string, AccountFreshness> = {};

    for (const id of accountIds) {
      // D-08 / D-09 / D-10: build freshness for every account in scope,
      // regardless of healthy/error mode. last_polled_at uses the per-account
      // map; cache_age_seconds is server-computed using Date.now() to avoid
      // client clock skew (D-10).
      const lastPolled = this.lastPolledAt.get(id) ?? null;
      freshness[id] = {
        last_polled_at: lastPolled?.toISOString() ?? null,
        cache_age_seconds:
          lastPolled === null ? null : Math.floor((nowMs - lastPolled.getTime()) / 1000),
      };

      // D-14: per-account error dispatch.
      const status = this.manager.getStatus(id);
      if ("error" in status) {
        // Unknown account — preserve existing semantics.
        errors[id] = status.error;
        continue;
      }
      if (status.kind === "suspended") {
        // V5 ASVS: status.reason is the stock string from humanReason() — SAFE.
        errors[id] = `account suspended: ${status.reason}`;
        continue;
      }
      if (status.kind === "reconnecting") {
        errors[id] = `account reconnecting (attempt ${status.attempt})`;
        continue;
      }
      if (status.kind === "connecting") {
        // Functionally indistinguishable from attempt-1 reconnect for the agent
        // (cache unavailable, transient). Reuses the same stock prefix so
        // D-14 stays at exactly three enumerated prefixes.
        errors[id] = `account reconnecting (attempt 1)`;
        continue;
      }
      // status.kind === "connected" — check whether we have a poll yet.
      if (lastPolled === null) {
        errors[id] = "no cache yet — polling has not completed";
        continue;
      }
      // D-15: connected + has prior poll → push cached results normally.
      const entries = this.cache.get(id);
      if (entries === undefined) {
        errors[id] = "account not found in cache";
        continue;
      }
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

    // Sort newest-first
    results.sort((a, b) => (new Date(b.date).getTime() || 0) - (new Date(a.date).getTime() || 0));

    // D-08: freshness is ALWAYS present. errors is only present when non-empty
    // to keep parity with existing search-service shape (D-17).
    return Object.keys(errors).length > 0
      ? { results, errors, freshness }
      : { results, freshness };
  }

  private async runLoop(): Promise<void> {
    await this.poll();
    if (!this.stopped) {
      globalThis.setTimeout(() => void this.runLoop(), this.intervalSeconds * 1000);
    }
  }

  private async poll(): Promise<void> {
    // D-15: reset the per-cycle skip tracker so each new cycle re-evaluates
    // every account (skip is NOT sticky — a recovered reconnect must be
    // polled the very next cycle).
    this.skipLoggedThisCycle.clear();

    const accountIds = this.manager.getAccountIds();
    for (const accountId of accountIds) {
      try {
        await this.pollAccount(accountId);
      } catch (err) {
        logger.error(`Poller: failed to poll account ${accountId}: ${String(err)}`);
      }
    }
    // D-11: per-account stamping happens inside pollAccount() after
    // mergeIntoCache succeeds. The old global timestamp field is gone.
  }

  private async pollAccount(accountId: string): Promise<void> {
    // D-15 / CONN-07: skip non-connected accounts silently. Consult the
    // manager's `getStatus()` BEFORE any IMAP call so non-connected accounts
    // (connecting / reconnecting / suspended) never hit the network. One
    // `debug` log per skipped account per poll cycle, then quiet `return`
    // (no throw — the outer `try/catch` in `poll()` is for legitimate
    // mid-fetch errors, not expected skip states).
    const status = this.manager.getStatus(accountId);
    if ("error" in status || status.kind !== "connected") {
      if (!this.skipLoggedThisCycle.has(accountId)) {
        const reason = "error" in status ? status.error : `status: ${status.kind}`;
        logger.debug(`Poller: skipping ${accountId} (${reason})`);
        this.skipLoggedThisCycle.add(accountId);
      }
      return;
    }

    const result = this.manager.getClient(accountId);
    if ("error" in result) {
      // Belt-and-suspenders: status said connected but getClient disagrees
      // (race between getStatus and getClient — e.g., a `close` event landed
      // between the two calls). Quietly skip — the next poll cycle re-checks.
      logger.debug(`Poller: skipping ${accountId} (getClient race: ${result.error})`);
      return;
    }

    const client = result;

    let since: string;
    let maxResults: number;

    // D-13: per-account seed vs incremental decision.
    const accountLastPolled = this.lastPolledAt.get(accountId) ?? null;
    if (accountLastPolled === null) {
      // Seed: last 30 days
      since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      maxResults = 1000;
    } else {
      // Incremental: lastPolledAt - 24h to handle IMAP SEARCH SINCE day-granularity
      since = new Date(accountLastPolled.getTime() - 24 * 60 * 60 * 1000).toISOString();
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

    // D-11 / RESEARCH Pitfall 2: stamp AFTER mergeIntoCache so a thrown
    // searchMessages call (caught by poll()'s outer try/catch) leaves
    // lastPolledAt unchanged for this account.
    this.lastPolledAt.set(accountId, new Date());
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
