import { ImapFlow } from "imapflow";
import { logger } from "../logger.js";
import type { AccountConfig } from "../config/types.js";
import { classifyConnectionError, humanReason } from "./error-classifier.js";

/**
 * Phase 12 D-01: Four-state union — `failed` is removed entirely. Transient
 * errors live in `reconnecting` forever (unbounded retry per D-08); fatal
 * errors transition immediately to `suspended`.
 *
 * D-02: `suspended` carries `{ reason, since }` — `reason` is a stock string
 * from `humanReason(err)` (NEVER the raw err.message; T-12-09 / V5 ASVS).
 * D-03: `reconnecting` carries `lastError` so an agent can distinguish a
 * 3-second retry from a 4-hour retry-after-ECONNRESET.
 */
export type AccountConnectionStatus =
  | { kind: "connecting" }
  | { kind: "connected"; client: ImapFlow }
  | { kind: "reconnecting"; attempt: number; nextRetryAt: Date; lastError: string }
  | { kind: "suspended"; reason: string; since: Date };

// D-09: backoff parameters — full jitter, cap raised from 60s to 120s.
// D-08: BACKOFF_MAX_ATTEMPTS is DELETED. The loop runs `while (!isShuttingDown)`.
const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MULTIPLIER = 2;
const BACKOFF_CAP_MS = 120_000;

/**
 * Full-jitter exponential backoff (D-09 / AWS pattern). Returns a delay in
 * `[0, capped)` where `capped = min(initial * multiplier^(attempt-1), cap)`.
 *
 * Full jitter (not capped-deterministic) prevents synchronized retry storms
 * across N accounts hammering a recovering server (T-12-10).
 */
function backoffDelayMs(attempt: number): number {
  const raw = BACKOFF_INITIAL_MS * Math.pow(BACKOFF_MULTIPLIER, attempt - 1);
  const capped = Math.min(raw, BACKOFF_CAP_MS);
  return Math.floor(Math.random() * capped);
}

/**
 * D-14: throttled per-attempt logging. Always log attempts 1..3 at warn; after
 * that, only log at warn for attempts in the sequence `5, 10, 20, 40, 80, 160, …`
 * (powers-of-two doubling from 5). Other attempts log at debug. A change in
 * `err.message` also resets the throttle (handled at the call site).
 *
 * The sequence interpretation follows CONTEXT.md D-14 at face value
 * (RESEARCH Open Question 1, A3 resolution): attempts 1, 2, 3, 5, 10, 20, 40, …
 */
function shouldLogAttempt(attempt: number): boolean {
  if (attempt <= 3) return true;
  let n = 5;
  while (n < attempt) n *= 2;
  return n === attempt;
}

/**
 * Sleep using globalThis.setTimeout so that vitest fake timers can intercept it.
 * node:timers/promises.setTimeout is NOT intercepted by vitest fake timers.
 * Supports AbortSignal for early cancellation.
 */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Sleep aborted", "AbortError"));
      return;
    }

    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = (): void => {
      globalThis.clearTimeout(timer);
      reject(new DOMException("Sleep aborted", "AbortError"));
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export class AccountConnection {
  private readonly accountId: string;
  private readonly config: AccountConfig;
  private status: AccountConnectionStatus;
  private isShuttingDown: boolean;
  private abortController: AbortController;
  private currentClient: ImapFlow | null = null;

  // D-10: synchronous race guard. Concurrent `close` events emitted in the
  // same microtask batch spawn at most ONE reconnect loop. Set BEFORE any
  // await; cleared in `.finally()`.
  private reconnectInFlight = false;

  // Phase 13 groundwork (NOT surfaced to tools in Phase 12). Internal fields
  // so Phase 13's `list_accounts.last_connected_at` / `last_error` can read
  // them without another union-shape revision.
  private connectedAt: Date | null = null;
  private lastError: string | null = null;

  constructor(accountId: string, config: AccountConfig) {
    this.accountId = accountId;
    this.config = config;
    this.status = { kind: "connecting" };
    this.isShuttingDown = false;
    this.abortController = new AbortController();
  }

  getStatus(): AccountConnectionStatus {
    return this.status;
  }

  /**
   * D-13: TCP keepalive + tighter socketTimeout. Combined effect: dead /
   * half-open sockets surface within ~2 minutes of laptop wake / Wi-Fi switch
   * instead of potentially never (root-cause fix for the PROJECT.md bug).
   *
   * Note on the cast: `socketOptions` is a documented runtime constructor
   * argument on imapflow but is missing from the `^1.2.13` TypeScript
   * declarations (`ImapFlowOptions`). Plan 12-04 bumps to `^1.3.7` where the
   * type is exported and this cast becomes a no-op. Until then, we extend the
   * options object with a single field declaration. We deliberately use a
   * typed intersection (not `as any`) so future shape changes upstream still
   * trip the typechecker.
   */
  private buildClient(): ImapFlow {
    const options: ConstructorParameters<typeof ImapFlow>[0] & {
      socketOptions?: { keepAlive: boolean; keepAliveInitialDelay: number };
    } = {
      host: this.config.host,
      port: this.config.port,
      secure: true,
      auth: { user: this.config.username, pass: this.config.password },
      logger: false,
      connectionTimeout: 30_000,
      socketTimeout: 90_000, // D-13: was 300_000
      socketOptions: { keepAlive: true, keepAliveInitialDelay: 60_000 }, // D-13: NEW
    };
    return new ImapFlow(options);
  }

  private wireListeners(client: ImapFlow): void {
    client.on("error", (err: Error) => {
      // D-14: error fires before close in imapflow; log only — the close
      // handler does the state transition.
      logger.warn(`[${this.accountId}] IMAP error (close follows): ${err.message}`);
    });

    client.on("close", () => {
      if (this.isShuttingDown) {
        logger.info(`[${this.accountId}] Connection closed (shutting down)`);
        return;
      }

      // D-10: synchronous race guard. Written BEFORE any await so two `close`
      // events emitted in the same microtask batch cannot both spawn a loop.
      if (this.reconnectInFlight) return;
      this.reconnectInFlight = true;

      logger.info(`[${this.accountId}] Connection closed unexpectedly, starting reconnect`);
      this.abortController = new AbortController();

      void this.runReconnectLoop()
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error(`[${this.accountId}] Reconnect loop error: ${msg}`);
        })
        .finally(() => {
          this.reconnectInFlight = false;
        });
    });
  }

  /**
   * Unbounded transient-retry loop (D-08). Termination conditions:
   *   1. `connect()` succeeds → status `connected`, return
   *   2. classifier returns `"fatal"` → status `suspended`, return
   *   3. `isShuttingDown` flips true (gracefulClose) → return
   *
   * D-11: every discarded `ImapFlow` instance has `removeAllListeners()`
   * called on it before a new one is built (prevents EventEmitter leak).
   * D-12: an outer try/catch wraps the whole loop so an unexpected throw
   * (logger crash, classifier exception) does NOT silently kill the
   * reconnect machinery — it logs at error and leaves the state untouched.
   * D-14: per-attempt logging is throttled (see `shouldLogAttempt`).
   */
  private async runReconnectLoop(): Promise<void> {
    try {
      let attempt = 1;
      let lastLoggedError: string | null = null;

      while (!this.isShuttingDown) {
        const delayMs = backoffDelayMs(attempt);
        const nextRetryAt = new Date(Date.now() + delayMs);

        // D-03: lastError on reconnecting status — populated from the previous
        // iteration's failure (or "(none yet)" on the very first iteration).
        this.status = {
          kind: "reconnecting",
          attempt,
          nextRetryAt,
          lastError: this.lastError ?? "(none yet)",
        };

        try {
          await sleep(delayMs, this.abortController.signal);
        } catch {
          // AbortError — gracefulClose() interrupted; exit cleanly.
          return;
        }
        if (this.isShuttingDown) return;

        // D-11: clean up the previous client's listeners BEFORE constructing
        // a new one. Without this, ImapFlow's internal listeners accumulate
        // across many reconnect cycles → MaxListenersExceededWarning (T-12-08).
        if (this.currentClient) {
          this.currentClient.removeAllListeners();
        }

        const client = this.buildClient();
        this.wireListeners(client);
        this.currentClient = client;

        try {
          await client.connect();
          this.status = { kind: "connected", client };
          this.connectedAt = new Date();
          this.lastError = null;
          logger.info(`[${this.accountId}] Reconnected on attempt ${attempt}`);
          return;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.lastError = message;

          // CONN-03 / T-12-06: fatal verdict → suspended on attempt 1, no
          // further retries. humanReason returns a stock string — NEVER
          // err.message (T-12-09 mitigation).
          const verdict = classifyConnectionError(err);
          if (verdict === "fatal") {
            const reason = humanReason(err);
            this.status = { kind: "suspended", reason, since: new Date() };
            logger.error(`[${this.accountId}] Account suspended: ${reason}`);
            return;
          }

          // D-14: throttled per-attempt logging. Always log at warn on attempts
          // 1..3, on the powers-of-two sequence, or when the error message
          // changes; otherwise log at debug.
          const isNewError = message !== lastLoggedError;
          if (shouldLogAttempt(attempt) || isNewError) {
            logger.warn(
              `[${this.accountId}] Reconnect attempt ${attempt} failed: ${message}`
            );
            lastLoggedError = message;
          } else {
            logger.debug(
              `[${this.accountId}] Reconnect attempt ${attempt} failed (throttled): ${message}`
            );
          }

          attempt++;
        }
      }
    } catch (err: unknown) {
      // D-12: outer safety net for unexpected throws inside the loop
      // (logger crash, classifier exception). Log at error and leave the
      // status untouched — do NOT transition to suspended, that would mask a
      // code bug as a fatal account error. The next `close` event re-enters
      // the loop from a clean state.
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[${this.accountId}] Unexpected error in reconnect loop: ${msg}`);
    }
  }

  /**
   * Initial connect. On failure:
   *   - Fatal verdict → status `suspended`, return immediately (no sleep,
   *     no first backoff). This is the "initial-connect fatal fast-path"
   *     resolution to RESEARCH Open Question 2.
   *   - Transient → enter the unbounded reconnect loop. `reconnectInFlight`
   *     is set BEFORE the await so a concurrent `close` event cannot spawn
   *     a second loop.
   */
  async connect(): Promise<void> {
    this.status = { kind: "connecting" };
    logger.info(`[${this.accountId}] Connecting...`);

    const client = this.buildClient();
    this.wireListeners(client);
    this.currentClient = client;

    try {
      await client.connect();
      this.status = { kind: "connected", client };
      this.connectedAt = new Date();
      this.lastError = null;
      logger.info(`[${this.accountId}] Connected`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastError = message;
      logger.warn(`[${this.accountId}] Initial connect failed: ${message}`);

      // Initial-connect fatal fast-path: classify BEFORE entering the
      // reconnect loop so we skip the first sleep on credentials / TLS
      // failures (RESEARCH Open Question 2).
      const verdict = classifyConnectionError(err);
      if (verdict === "fatal") {
        const reason = humanReason(err);
        this.status = { kind: "suspended", reason, since: new Date() };
        logger.error(
          `[${this.accountId}] Account suspended on initial connect: ${reason}`
        );
        return;
      }

      // Transient — enter the unbounded reconnect loop. Set the race guard
      // so a concurrent `close` event on the failed client cannot spawn a
      // second loop.
      this.reconnectInFlight = true;
      this.abortController = new AbortController();
      try {
        await this.runReconnectLoop();
      } finally {
        this.reconnectInFlight = false;
      }
    }
  }

  async gracefulClose(): Promise<void> {
    this.isShuttingDown = true;
    this.abortController.abort();
    logger.info(`[${this.accountId}] Graceful close initiated`);

    const client = this.currentClient;
    if (!client) {
      return;
    }

    try {
      if (client.usable) {
        await client.logout();
      } else {
        client.close();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[${this.accountId}] Error during graceful close: ${message}`);
    }
  }
}
