import { ImapFlow } from "imapflow";
import { logger } from "../logger.js";
import type { AccountConfig } from "../config/types.js";

export type AccountConnectionStatus =
  | { kind: "connecting" }
  | { kind: "connected"; client: ImapFlow }
  | { kind: "reconnecting"; attempt: number; nextRetryAt: Date }
  | { kind: "failed"; reason: string };

const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MULTIPLIER = 2;
const BACKOFF_CAP_MS = 60_000;
const BACKOFF_MAX_ATTEMPTS = 10;

function backoffDelayMs(attempt: number): number {
  const raw = BACKOFF_INITIAL_MS * Math.pow(BACKOFF_MULTIPLIER, attempt - 1);
  return Math.min(raw, BACKOFF_CAP_MS);
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

  private buildClient(): ImapFlow {
    return new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: true,
      auth: { user: this.config.username, pass: this.config.password },
      logger: false,
      connectionTimeout: 30_000,
      socketTimeout: 300_000,
    });
  }

  private wireListeners(client: ImapFlow): void {
    client.on("error", (err: Error) => {
      logger.error(`[${this.accountId}] IMAP error: ${err.message}`);
      // Do not change state here — 'close' fires after 'error' in imapflow
    });

    client.on("close", () => {
      if (this.isShuttingDown) {
        logger.info(`[${this.accountId}] Connection closed (shutting down)`);
        return;
      }
      if (this.status.kind === "reconnecting" || this.status.kind === "failed") {
        return;
      }
      logger.info(`[${this.accountId}] Connection closed unexpectedly, starting reconnect`);
      this.abortController = new AbortController();
      this.runReconnectLoop().catch((err: Error) => {
        logger.error(`[${this.accountId}] Reconnect loop error: ${err.message}`);
      });
    });
  }

  private async runReconnectLoop(): Promise<void> {
    let attempt = 1;

    while (attempt <= BACKOFF_MAX_ATTEMPTS) {
      const delayMs = backoffDelayMs(attempt);
      const nextRetryAt = new Date(Date.now() + delayMs);
      this.status = { kind: "reconnecting", attempt, nextRetryAt };
      logger.warn(
        `[${this.accountId}] Reconnecting attempt ${attempt}/${BACKOFF_MAX_ATTEMPTS} in ${delayMs}ms`
      );

      try {
        await sleep(delayMs, this.abortController.signal);
      } catch {
        // AbortError — gracefulClose() interrupted the sleep
        logger.info(`[${this.accountId}] Reconnect sleep interrupted (shutting down)`);
        return;
      }

      if (this.isShuttingDown) {
        return;
      }

      const client = this.buildClient();
      this.wireListeners(client);
      this.currentClient = client;

      try {
        await client.connect();
        this.status = { kind: "connected", client };
        logger.info(`[${this.accountId}] Reconnected successfully on attempt ${attempt}`);
        return;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`[${this.accountId}] Reconnect attempt ${attempt} failed: ${message}`);
        attempt++;
      }
    }

    const reason = `Failed to reconnect after ${BACKOFF_MAX_ATTEMPTS} attempts`;
    this.status = { kind: "failed", reason };
    logger.error(`[${this.accountId}] Permanently failed: ${reason}`);
  }

  async connect(): Promise<void> {
    this.status = { kind: "connecting" };
    logger.info(`[${this.accountId}] Connecting...`);

    const client = this.buildClient();
    this.wireListeners(client);
    this.currentClient = client;

    try {
      await client.connect();
      this.status = { kind: "connected", client };
      logger.info(`[${this.accountId}] Connected`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[${this.accountId}] Initial connect failed: ${message}`);
      this.abortController = new AbortController();
      await this.runReconnectLoop();
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
