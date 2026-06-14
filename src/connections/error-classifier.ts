/**
 * Pure-function error classifier for IMAP connection errors.
 *
 * Phase 12, Plan 02 (CONN-01). No state, no I/O, no logging — per D-04.
 *
 * Consumers (Wave 2 / Plan 03 `AccountConnection.runReconnectLoop`) call
 * `classifyConnectionError(err)` to decide whether a connect failure should
 * trigger another retry (`"transient"`) or short-circuit to `suspended`
 * (`"fatal"`). `humanReason(err)` produces a stock, credentials-safe string
 * the agent / operator can read; it never surfaces the underlying error's
 * own message text (V5 ASVS: imapflow embeds `auth.user` into some error
 * messages).
 */

export type ErrorClass = "transient" | "fatal";

/**
 * RFC 5530 server response codes that indicate an account-level condition
 * a user must fix (not a transient network blip). Retrying these spams
 * unresolvable conditions and can trip server-side lockouts. See D-05.
 *
 * Stored UPPERCASE; lookups normalize the incoming code defensively per
 * RESEARCH Assumption A4 (vendor variance on case).
 */
const FATAL_RESPONSE_CODES = new Set<string>([
  "AUTHENTICATIONFAILED",
  "LOGINDISABLED",
  "PRIVACYREQUIRED",
  "OVERQUOTA",
  "UNAVAILABLE",
  "EXPIRED",
  "ALERT",
  "CONTACTADMIN",
]);

/**
 * Stock human-readable strings keyed by RFC 5530 response code. Never includes
 * any portion of the underlying error's own message text — that field may
 * carry `auth.user` (username) under some imapflow code paths (T-12-03).
 */
const RESPONSE_CODE_REASONS: Record<string, string> = {
  AUTHENTICATIONFAILED: "Authentication failed — fix credentials",
  LOGINDISABLED: "Server has login disabled — check IMAP settings",
  PRIVACYREQUIRED: "Server requires TLS — check connection security",
  OVERQUOTA: "Account is over storage quota",
  UNAVAILABLE: "Server reported account unavailable (RFC 5530)",
  EXPIRED: "Account credentials expired — renew password",
  ALERT: "Server returned an alert — check server admin",
  CONTACTADMIN: "Server requires admin contact",
};

const TLS_FAILED_REASON = "TLS certificate validation failed";
const GENERIC_FALLBACK_REASON = "Connection failed (see logs for details)";

/**
 * Detect an imapflow `AuthenticationFailure` error via the marker property
 * the constructor sets on every instance (`authenticationFailed = true` —
 * verified in `imapflow/lib/tools.js`). The class is NOT exported from the
 * top-level entry on any tested version (^1.2.13, ^1.3.7, ^1.4.0), so an
 * `import { AuthenticationFailure } from "imapflow"` crashes Node's native
 * ESM loader at module load. The marker property is the canonical runtime
 * detection path.
 */
function isAuthenticationFailure(err: unknown): boolean {
  if (typeof err === "object" && err !== null) {
    const flag = (err as { authenticationFailed?: unknown }).authenticationFailed;
    if (flag === true) {
      return true;
    }
  }
  return false;
}

/**
 * Read a string-valued property off an unknown error object without widening
 * the type to `any`. Returns `undefined` if the property is absent or non-string.
 */
function readStringField(err: unknown, field: string): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const value = (err as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

/**
 * Classify a connection error as `"transient"` (retry per backoff loop) or
 * `"fatal"` (transition account to `suspended`, do not retry).
 *
 * Order of checks matters — most specific first:
 *   1. imapflow's typed `AuthenticationFailure` class (D-05 #1)
 *   2. imapflow's `tlsFailed` boolean flag (D-05 #2 / D-07)
 *   3. RFC 5530 `serverResponseCode` lookup (D-05 #3)
 *   4. Default: `"transient"` (D-06 + CONN-01 safe-default rule)
 *
 * Unknown / malformed errors fall through to `"transient"` so that an
 * unrecognized imapflow update, OS error code, or vendor quirk never silently
 * kills an account.
 */
export function classifyConnectionError(err: unknown): ErrorClass {
  // D-05 #1 — AuthenticationFailure (marker-property detection; see docstring).
  if (isAuthenticationFailure(err)) {
    return "fatal";
  }

  if (err instanceof Error) {
    // D-05 #2 / D-07 — trust imapflow's own flag, do not parse messages.
    const tlsFailed = (err as { tlsFailed?: unknown }).tlsFailed;
    if (tlsFailed === true) {
      return "fatal";
    }

    // D-05 #3 — RFC 5530 response code (case-normalized per A4).
    const responseCode = readStringField(err, "serverResponseCode");
    if (responseCode && FATAL_RESPONSE_CODES.has(responseCode.toUpperCase())) {
      return "fatal";
    }
  }

  // D-06 / CONN-01 — unknown defaults to transient (safe default).
  return "transient";
}

/**
 * Map a fatal error to a stock human-readable reason string suitable for
 * surfacing to an operator or agent.
 *
 * SECURITY (T-12-03 / V5 ASVS): this function never echoes the underlying
 * error's own message text, `err.toString()`, or any other field that might
 * contain `auth.user`. Stock strings only. If you need to debug the
 * underlying message, read the logs.
 *
 * Defensive for transient/unknown inputs as well — returns
 * `GENERIC_FALLBACK_REASON` rather than throwing. (Production callers should
 * only invoke this for fatal errors, but the safety net prevents a stray
 * exception from killing the reconnect machinery — see D-12.)
 */
export function humanReason(err: unknown): string {
  // AuthenticationFailure instance — most specific.
  if (isAuthenticationFailure(err)) {
    return RESPONSE_CODE_REASONS.AUTHENTICATIONFAILED;
  }

  if (err instanceof Error) {
    // TLS failure flag.
    const tlsFailed = (err as { tlsFailed?: unknown }).tlsFailed;
    if (tlsFailed === true) {
      return TLS_FAILED_REASON;
    }

    // RFC 5530 stock-string table lookup.
    const responseCode = readStringField(err, "serverResponseCode");
    if (responseCode) {
      const normalized = responseCode.toUpperCase();
      const stockReason = RESPONSE_CODE_REASONS[normalized];
      if (stockReason) {
        return stockReason;
      }
    }
  }

  // Transient / unknown fall-through — defensive only; callers should not
  // reach here in production. Stock string, never `err.message`.
  return GENERIC_FALLBACK_REASON;
}
