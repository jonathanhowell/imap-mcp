# Phase 12: Connection Resilience Foundation - Research

**Researched:** 2026-06-08
**Domain:** IMAP connection lifecycle — error classification, reconnect loop, TCP keepalive, EventEmitter hygiene
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**State machine (overrides STATE.md):**
- **D-01:** Reduce `AccountConnectionStatus` union to **4 reachable states**: `connecting | connected | reconnecting | suspended`. The `failed` variant is **removed from the union entirely**, not kept as defined-but-unreachable. STATE.md's "5 named states" decision is explicitly overridden by this phase. STATE.md / PROJECT.md key-decisions entry must be updated when v0.3 ships.
- **D-02:** `suspended` carries `{ kind: "suspended", reason: string, since: Date }`. `reason` is a human-readable string an agent can show a user.
- **D-03:** `reconnecting` gains a `lastError: string` field alongside existing `attempt` and `nextRetryAt`. Field is populated in Phase 12; surfaced in `list_accounts` in Phase 13.

**Error taxonomy (`src/connections/error-classifier.ts`):**
- **D-04:** `classifyConnectionError(err: unknown): "transient" | "fatal"` is a **pure function** in a new module. No state, no class. First-built component of the phase.
- **D-05:** Fatal classifications:
  - `err instanceof AuthenticationFailure` (imapflow's exported class)
  - `err.tlsFailed === true` (imapflow's TLS-failure flag)
  - RFC 5530 server response codes (any of): `AUTHENTICATIONFAILED`, `LOGINDISABLED`, `PRIVACYREQUIRED`, `OVERQUOTA`, `UNAVAILABLE`, `EXPIRED`, `ALERT`, `CONTACTADMIN`
- **D-06:** Transient classifications:
  - Network-layer error codes: `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `ECONNREFUSED`, `ENETUNREACH`, `EConnectionClosed`, `NoConnection`
  - TLS handshake transients (handshake timeout, mid-handshake `ECONNRESET`) — anything NOT flagged `tlsFailed: true`
  - Socket close events not accompanied by a fatal error
  - **Unknown / unrecognized errors default to transient** (per CONN-01).
- **D-07:** TLS rule is strict: trust imapflow's own `tlsFailed` flag, period. Don't parse error messages or Node TLS error codes.

**Reconnect loop:**
- **D-08:** **Unbounded retry** for transient errors. Delete `BACKOFF_MAX_ATTEMPTS` cap entirely. Loop runs `while (true)` until (a) connect succeeds → `connected`, (b) classifier returns `fatal` → `suspended`, or (c) `isShuttingDown` / abort signal.
- **D-09:** Backoff parameters:
  - `BACKOFF_INITIAL_MS = 1_000` (unchanged)
  - `BACKOFF_MULTIPLIER = 2` (unchanged)
  - `BACKOFF_CAP_MS = 120_000` (raised from 60_000)
  - **Full jitter**: `delay = floor(Math.random() * capped)`
- **D-10:** Race-safety: replace the `status.kind === "reconnecting"` guard with a synchronously-written boolean `reconnectInFlight`. Set true before `runReconnectLoop()` is invoked, clear in `.finally()`.
- **D-11:** Listener cleanup: call `currentClient.removeAllListeners()` on the old `ImapFlow` instance before constructing a new one in the reconnect loop.
- **D-12:** Outer `try/catch` in `runReconnectLoop()` so an unexpected throw inside the loop body doesn't kill the whole reconnect machinery silently. Add `process.on('unhandledRejection', …)` in `src/index.ts` — handler logs the rejection at `error` level and does NOT exit.

**TCP keepalive & socket timeout:**
- **D-13:** In `buildClient()`, add to `ImapFlow` constructor:
  - `socketOptions: { keepAlive: true, keepAliveInitialDelay: 60_000 }`
  - `socketTimeout: 90_000` (reduced from 300_000)

**Logging cadence:**
- **D-14:** Throttled per-attempt logging during reconnect loop:
  - **Always log:** First failure (attempt 1) at `warn`; any attempt where `error.message` differs from previously-logged error (resets throttle); successful reconnect at `info`; transition to `suspended` at `error`.
  - **Throttled:** attempts at indices `1, 2, 3, 5, 10, 20, 40, 80, 160, 320, …` log at `warn`. Other attempts log at `debug`.

**Poller skip behavior:**
- **D-15:** Per CONN-07, `Poller` skips accounts where `connection.getStatus().kind !== "connected"`. In `pollAccount()`, short-circuit before any IMAP call if status is `connecting`, `reconnecting`, or `suspended`. Emit one `debug`-level skip log per skipped account per poll cycle.

**Internal Phase 12 fields (groundwork for Phase 13):**
- Phase 12 may add internal `connectedAt: Date | null` and `lastError: string | null` fields on `AccountConnection` purely so Phase 13 has something to expose — but no tool API surface changes ship in Phase 12.

### Claude's Discretion

The CONTEXT.md decisions are exhaustive for the implementation surface. The remaining discretion areas for the researcher/planner are:
- Exact internal helper names and file organization within the constraints of `error-classifier.ts` being a new pure-function module
- Test layout (which test cases live in which file)
- Logging message phrasing (must be operator-actionable per the "self-explanatory reason" specifics)

### Deferred Ideas (OUT OF SCOPE)

- **Health field surfacing in `list_accounts` / `get_new_mail`** — Phase 13 (HEALTH-02)
- **`last_connected_at` / `last_error_at` exposure in tool responses** — Phase 13
- **Per-account `lastPollTimes` map** — Phase 13 (CACHE-01)
- **30-day cache eviction** — Phase 13 (CACHE-03)
- **`get_new_mail` cold-cache vs disconnected distinction** — Phase 13
- **`reconnect_account` MCP tool** — Phase 14 (RECONN-01)
- **`failed` state with a real trigger** (explicit `stop()` API, classifier-loop safety net, operator-controlled halt) — v0.4+
- **IDLE-based cache freshness** — future milestone (CACHE-IDLE)
- **Cache persistence to disk** — v0.4+ (CACHE-DISK)
- **`flag_message` / `unflag_message` system-flag validation** (DEBT) — separate hardening phase

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CONN-01 | Server classifies IMAP/network errors as `transient` vs `fatal`. Fatal: authentication failure, expired/invalid TLS cert. Transient: ECONNRESET, ETIMEDOUT, ENOTFOUND, socket close, TLS handshake transients. Unknown defaults to `transient`. | `error-classifier.ts` design with `AuthenticationFailure` instanceof + `tlsFailed` flag + RFC 5530 response codes. See **Standard Stack** (imapflow API) and **Code Examples** (classifier). |
| CONN-02 | Transient failures retry indefinitely with jittered exponential backoff (no max-attempts cap). | Unbounded `while(true)` loop, full-jitter formula, `BACKOFF_CAP_MS = 120_000`. See **Architecture Patterns: Reconnect Loop** and **Code Examples**. |
| CONN-03 | Fatal failures transition the account to `suspended` without retry. | Classifier returns `"fatal"` → loop exits with `status = { kind: "suspended", reason, since }`. See **State Machine** and **Code Examples**. |
| CONN-04 | TCP keepalive enabled on IMAP sockets so half-open connections surface within a bounded window. | `socketOptions: { keepAlive: true, keepAliveInitialDelay: 60_000 }` + `socketTimeout: 90_000`. See **Common Pitfalls: TCP Half-Open** and **Architecture Patterns: buildClient**. |
| CONN-05 | At most one reconnect loop runs per account at a time. | Synchronous `reconnectInFlight: boolean` flag set before `runReconnectLoop()`, cleared in `.finally()`. See **Common Pitfalls: Concurrent Reconnect** and **Code Examples**. |
| CONN-06 | `ImapFlow` event listeners are removed before each reconnect — no handler leaks. | `oldClient.removeAllListeners()` immediately before assigning `this.currentClient = newClient`. See **Common Pitfalls: Listener Leak**. |
| CONN-07 | Background poller skips accounts not in `connected` state — no IMAP calls during reconnect or while suspended. | `pollAccount()` short-circuits when `getStatus().kind !== "connected"`. Single `debug`-level skip log per account per cycle. See **Architecture Patterns: Poller Skip**. |

</phase_requirements>

## Summary

Phase 12 is a **surgical refactor of one file** (`src/connections/account-connection.ts`) plus **one new file** (`src/connections/error-classifier.ts`) plus **two small edits** (`src/polling/poller.ts` for the skip guard, `src/index.ts` for `unhandledRejection`). No new dependencies. No architectural restructuring. All key facts (event order, error shapes, fresh-instance reconnect, TCP keepalive semantics) are already verified HIGH-confidence in the pre-existing `.planning/research/` files written 2026-06-08 — this phase research re-targets that knowledge to the seven CONN-* requirements and the locked CONTEXT.md decisions.

The error classifier is the **build-first** component: pure function, no upstream dependencies, easily unit-tested across the full RFC 5530 code list. Once it ships, the reconnect-loop refactor in `AccountConnection` consumes it. The race-safety (`reconnectInFlight`), listener-leak (`removeAllListeners`), and keepalive (`socketOptions`) changes all land in the same `AccountConnection` edit. The poller skip and `unhandledRejection` handler are 5-line additions that complete the phase.

**Primary recommendation:** Build `error-classifier.ts` first with exhaustive table-driven tests; then refactor `AccountConnection.runReconnectLoop()` with the new while-true loop, jitter, listener cleanup, and race guard in one PR; then add the poller skip and `unhandledRejection` handler; then ship. Use Vitest fake timers (already the project pattern via `globalThis.setTimeout`-based `sleep`) — do not attempt to simulate TCP half-open in unit tests (document manual repro instead).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Error classification (transient/fatal) | Connection Layer (`src/connections/error-classifier.ts`) | — | Pure function operating on imapflow error objects; no I/O, no state. Lives next to `AccountConnection` because that's the only consumer. |
| Per-account connection lifecycle (state machine, reconnect, TCP keepalive, listener wiring) | Connection Layer (`src/connections/account-connection.ts`) | — | Already owns the lifecycle. v0.2 architecture is correct; only internal mechanics change. |
| Reconnect orchestration (one loop per account at a time, jittered backoff) | Connection Layer (`AccountConnection.runReconnectLoop`) | — | Per-account isolation: each `AccountConnection` owns its own loop, abort controller, and `reconnectInFlight` flag. `ConnectionManager` is a registry, not an orchestrator. |
| Connection-state inspection by consumers | Connection Layer (`ConnectionManager.getClient` / `getStatus`) | Tools Layer (consumes returned status union) | `getClient()` already returns `ImapFlow \| { error: string }` — the new `suspended` case only changes the error string, not the call shape. |
| Background poll gating | Polling Layer (`src/polling/poller.ts::pollAccount`) | Connection Layer (provides status) | Poller queries `manager.getClient()` to decide whether to do IMAP work. Per CONN-07, it short-circuits when status is not `connected`. The decision lives in the polling layer because that's the loop that ticks. |
| Unhandled-rejection safety net | Process Layer (`src/index.ts`) | — | Process-wide handler is the only place this can live. Logs and continues; never exits. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `imapflow` | `^1.3.7` | IMAP client — exports `AuthenticationFailure` class; emits `error`/`close`/`exists`/`expunge`/`flags` events; supports `socketOptions.keepAlive`; requires fresh instance per reconnect | [VERIFIED: npm registry] Currently latest. The phase upgrades from `^1.2.13` purely to access the typed `AuthenticationFailure` export and the documented `socketOptions` field. No breaking changes between 1.2 and 1.3 affect this phase. |
| TypeScript | `^5.9.3` | Discriminated union exhaustiveness checking on `AccountConnectionStatus` will catch every consumer that needs updating after dropping `failed` and adding `suspended` | [VERIFIED: existing project usage] Strict mode already enabled. |
| Vitest | `^4.0.18` | Fake-timer-driven test of backoff delays; mock `ImapFlow` constructor; emit `close`/`error` events on mocks | [VERIFIED: existing project usage] Existing `tests/connections/account-connection.test.ts` already uses this pattern correctly. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:events` (built-in) | — | `removeAllListeners()` on discarded `ImapFlow` instances; `MaxListenersExceededWarning` detection | Always — `ImapFlow` extends `EventEmitter`. |
| `AbortController` (built-in) | — | Interruptible `sleep(ms, signal)` for shutdown; already wired in v0.2 code | Reuse as-is for unbounded loop interruption. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled `while(true)` retry loop | `cockatiel ^4.0.0` (handleWhen + ExponentialBackoff) | [CITED: .planning/research/STACK.md] Cockatiel's `.execute(fn)` assumes a pure retry of a callback. The reconnect loop is **stateful** (build client, wire listeners, set `this.currentClient`) and is not a pure function call. The hand-rolled loop already exists and works; D-08 only changes the termination condition (`while(true)` instead of capped). Adding cockatiel would force restructuring around a paradigm mismatch. **Do not use.** |
| Hand-rolled discriminated union | XState v5 or robot3 for state machine | [CITED: .planning/research/STACK.md] 4-state machine with 4 transitions is 40 lines of TypeScript. XState (16.7 kB) and robot3 (1.2 kB) both add a learning curve with no benefit over `kind:` discriminants the type system already enforces. **Do not use.** |
| Synchronous boolean for race guard | Mutex library (e.g. `async-mutex`) | A single boolean flag set synchronously before `void`-await is sufficient for the synchronous `error`-then-`close` race. Node.js is single-threaded; no real concurrency to mutex. **Do not use.** |
| Strict TLS error-code parsing | Trust `imapflow.tlsFailed` flag (D-07) | [CITED: imapflow docs] imapflow itself classifies TLS errors via `tlsFailed`. Re-classifying Node.js TLS error codes (`CERT_HAS_EXPIRED`, `DEPTH_ZERO_SELF_SIGNED_CERT`, etc.) inside our classifier risks divergence from upstream when imapflow updates. D-07 locks the rule: trust the flag, nothing else. |

**Installation:**

```bash
npm install imapflow@^1.3.7
```

No other dependencies added.

**Version verification (2026-06-08):**
- `npm view imapflow version` → `1.3.7` [VERIFIED: npm registry]
- `npm view imapflow time.modified` → `2026-06-08T08:29:26.236Z` [VERIFIED: npm registry] — published earlier today, by the same maintainer (`postalsys`) responsible for prior 1.2.x releases. Treat as freshly released but legitimate.

## Package Legitimacy Audit

> Phase 12 installs **zero net-new packages**. The only stack change is upgrading the existing `imapflow` dependency.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `imapflow` | npm | 1.3.7 published 2026-06-08 (same day); package itself ~5+ years old | High (no exact figure verified; documented as actively maintained production package powering EmailEngine) | [github.com/postalsys/imapflow](https://github.com/postalsys/imapflow) — verified, official `postalsys` org | not run (no net-new install — version bump on existing dep) | Approved — version bump only |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

**Slopcheck rationale for skipping:** the phase performs a minor-version bump on an existing, long-established dependency that's the entire foundation of the codebase (already on `^1.2.13`). No new packages are being introduced. The 2026-06-08 release date of 1.3.7 is same-day, but the package, maintainer org (`postalsys`), and repository are all established and identical to prior versions — this is not a new package nor a typosquat vector. Confidence: HIGH that this is safe.

## Architecture Patterns

### System Architecture Diagram

```
                                          OS-level dead-socket detection
                                          (keepalive probes every ~60s)
                                                      │
                                                      ▼
imapflow ImapFlow instance ── 'error' event ──┐
   (one per AccountConnection)                │
                          │                   ▼
                          ├── 'close' event ──┬─► AccountConnection.wireListeners
                          │   (sync after err)│         │
                          ▼                   │         │  reconnectInFlight = true (sync)
            socketTimeout: 90s                │         │
            (90s of read silence triggers     │         ▼
             close locally)                   │   runReconnectLoop()
                                              │         │
                                              │         │  while (!isShuttingDown):
                                              │         │   1. sleep(backoffDelayMs + jitter)
                                              │         │   2. oldClient.removeAllListeners()
                                              │         │   3. buildClient() → fresh ImapFlow
                                              │         │   4. wireListeners(new)
                                              │         │   5. await client.connect()
                                              │         │      ├── success → status = connected → return
                                              │         │      └── error
                                              │         │            │
                                              │         │            ▼
                                              │         │      classifyConnectionError(err)
                                              │         │            ├── "fatal" → status = suspended → return
                                              │         │            └── "transient" → loop
                                              │         │
                                              │         └─► .finally(): reconnectInFlight = false

Poller.pollAccount(accountId):
   manager.getClient(accountId)
   getStatus().kind === "connected" ? proceed : skip (debug log once per cycle)

process.on('unhandledRejection', err):
   logger.error(...); // never exit
```

### Recommended Project Structure

```
src/
├── connections/
│   ├── account-connection.ts        # MODIFIED — see Component Responsibilities
│   ├── connection-manager.ts        # MODIFIED — switch exhaustiveness only
│   ├── error-classifier.ts          # NEW — pure function (D-04)
│   └── index.ts                     # MODIFIED if needed for re-exports
├── polling/
│   └── poller.ts                    # MODIFIED — skip guard in pollAccount (D-15)
└── index.ts                         # MODIFIED — add unhandledRejection handler (D-12)

tests/
├── connections/
│   ├── account-connection.test.ts   # EXTENDED — new cases for unbounded retry, fatal classification, race, listener cleanup, jitter, keepalive
│   ├── connection-manager.test.ts   # EXTENDED — switch covers suspended case; failed case removed
│   └── error-classifier.test.ts     # NEW — table-driven across RFC 5530 codes, network codes, tlsFailed, unknown
└── polling/
    └── poller.test.ts               # EXTENDED — skip on reconnecting/suspended/connecting
```

### Component Responsibilities

| Component | File | Responsibility | Changes in Phase 12 |
|-----------|------|----------------|---------------------|
| `classifyConnectionError` | `src/connections/error-classifier.ts` (NEW) | Pure function `(err: unknown) => "transient" \| "fatal"`. No state. | New file. |
| `AccountConnection.status` union | `src/connections/account-connection.ts` | 4-variant discriminated union `connecting \| connected \| reconnecting \| suspended` (drops `failed`; adds `suspended`; adds `lastError` to `reconnecting`). | Type rewrite. |
| `AccountConnection.buildClient` | `src/connections/account-connection.ts` | Construct fresh `ImapFlow` instance with TCP keepalive + reduced socketTimeout. | Add `socketOptions: { keepAlive: true, keepAliveInitialDelay: 60_000 }`; change `socketTimeout: 300_000` → `90_000`. |
| `AccountConnection.wireListeners` | `src/connections/account-connection.ts` | Attach `close`/`error` listeners that drive the state machine. | Replace `status.kind === "reconnecting" \|\| "failed"` guard with synchronous `reconnectInFlight` boolean check. Set flag synchronously before `void this.runReconnectLoop()`. |
| `AccountConnection.runReconnectLoop` | `src/connections/account-connection.ts` | Unbounded retry loop with jittered backoff, classification on every failure, fresh instance per attempt, old-listener cleanup, throttled logging. | Largest single change. See **Code Examples**. |
| `AccountConnection.connect` | `src/connections/account-connection.ts` | Initial-connect path; on failure delegates to `runReconnectLoop`. | Classify the initial-connect error too — if fatal, do NOT call `runReconnectLoop`; transition directly to `suspended`. |
| `ConnectionManager.getClient` | `src/connections/connection-manager.ts` | Returns `ImapFlow \| { error: string }`. | Update `switch (status.kind)`: drop `failed` case, add `suspended` case (returns `{ error: \`account "X" is suspended: ${reason}\` }`). TypeScript exhaustiveness check is the safety net. |
| `ConnectionManager.getStatus` | `src/connections/connection-manager.ts` | Returns `AccountConnectionStatus \| { error: string }`. | Type changes automatically. No logic change. |
| `Poller.pollAccount` | `src/polling/poller.ts` | Fetch+merge incremental mail per account. | Add status guard before any IMAP call: if `getStatus().kind !== "connected"`, log `debug` once and return. **Do not throw** — current code throws when `getClient` returns error, which the upper `poll()` catches as `logger.error`; that pattern is replaced by an explicit, quiet skip. |
| `Poller.poll` | `src/polling/poller.ts` | Drive per-account polls. | No structural change. The `try/catch` around `pollAccount` stays as a belt-and-suspenders safety net. |
| `index.ts` startup | `src/index.ts` | Wire-up. | Add `process.on('unhandledRejection', (err) => logger.error(...))` near top of `main()`, before `manager.connectAll()`. |

### Pattern 1: Error Classifier — Pure Function with Imported Type Check

**What:** A pure module exporting one function. No state, no class. Easy to unit-test exhaustively.

**When to use:** Always. Per D-04, this is the build-first component.

**Example:**

```typescript
// src/connections/error-classifier.ts
import { AuthenticationFailure } from "imapflow";

export type ErrorClass = "transient" | "fatal";

// RFC 5530 response codes that indicate account-level conditions a user must fix.
const FATAL_RESPONSE_CODES = new Set([
  "AUTHENTICATIONFAILED",
  "LOGINDISABLED",
  "PRIVACYREQUIRED",
  "OVERQUOTA",
  "UNAVAILABLE",
  "EXPIRED",
  "ALERT",
  "CONTACTADMIN",
]);

export function classifyConnectionError(err: unknown): ErrorClass {
  // Per D-05 #1
  if (err instanceof AuthenticationFailure) return "fatal";

  if (err instanceof Error) {
    // Per D-05 #2 / D-07
    if ((err as { tlsFailed?: boolean }).tlsFailed === true) return "fatal";

    // Per D-05 #3
    const responseCode = (err as { serverResponseCode?: string }).serverResponseCode;
    if (responseCode && FATAL_RESPONSE_CODES.has(responseCode.toUpperCase())) {
      return "fatal";
    }
  }

  // Per D-06 — unknown defaults to transient (CONN-01)
  return "transient";
}
```

[VERIFIED: existing pre-phase research, .planning/research/SUMMARY.md and STACK.md] — `AuthenticationFailure` is an exported class on `imapflow`; `tlsFailed` and `serverResponseCode` are documented properties on imapflow errors.

### Pattern 2: Race-Safe Reconnect Trigger

**What:** Synchronous boolean flag set before any await/microtask yield, replacing the racy `status.kind === "reconnecting"` check.

**When to use:** Inside `wireListeners`'s `close` handler.

**Example:**

```typescript
// In AccountConnection class
private reconnectInFlight = false;

private wireListeners(client: ImapFlow): void {
  client.on("error", (err: Error) => {
    // Per D-14: log at warn but do NOT change state — close will fire next
    logger.warn(`[${this.accountId}] IMAP error (close follows): ${err.message}`);
  });

  client.on("close", () => {
    if (this.isShuttingDown) {
      logger.info(`[${this.accountId}] Connection closed (shutting down)`);
      return;
    }
    // Race guard (D-10): boolean is written synchronously before any await
    if (this.reconnectInFlight) return;
    this.reconnectInFlight = true;

    logger.info(`[${this.accountId}] Connection closed, starting reconnect`);
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
```

[CITED: CONTEXT.md D-10] — the boolean must be set synchronously before yielding to the event loop.

### Pattern 3: Unbounded Reconnect Loop with Classification + Listener Cleanup + Throttled Logging

**What:** The core refactor. `while(true)` loop, full jitter, classify each failure, clean up listeners on each iteration.

**When to use:** Always — this replaces the existing `runReconnectLoop`.

**Example:**

```typescript
const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MULTIPLIER = 2;
const BACKOFF_CAP_MS = 120_000; // D-09: raised from 60_000

// D-09: full jitter (AWS pattern)
function backoffDelayMs(attempt: number): number {
  const raw = BACKOFF_INITIAL_MS * Math.pow(BACKOFF_MULTIPLIER, attempt - 1);
  const capped = Math.min(raw, BACKOFF_CAP_MS);
  return Math.floor(Math.random() * capped);
}

// D-14: throttled logging — log at attempts 1, 2, 3, 5, 10, 20, 40, 80, 160, ...
function shouldLogAttempt(attempt: number): boolean {
  if (attempt <= 3) return true;
  // After attempt 3: log only when attempt is a power of 2 times some base
  // Sequence: 5, 10, 20, 40, 80, 160, 320 ...
  let n = 5;
  while (n < attempt) n *= 2;
  return n === attempt;
}

private async runReconnectLoop(): Promise<void> {
  // D-12: outer try/catch — surface bugs without taking the server down
  try {
    let attempt = 1;
    let lastLoggedError: string | null = null;

    while (!this.isShuttingDown) {
      const delayMs = backoffDelayMs(attempt);
      const nextRetryAt = new Date(Date.now() + delayMs);

      // D-03: include lastError on reconnecting state
      this.status = {
        kind: "reconnecting",
        attempt,
        nextRetryAt,
        lastError: this.lastError ?? "(none yet)",
      };

      try {
        await sleep(delayMs, this.abortController.signal);
      } catch {
        // AbortError — gracefulClose interrupted; exit cleanly
        return;
      }
      if (this.isShuttingDown) return;

      // D-11: clean up old client's listeners BEFORE building a new one
      // Prevents EventEmitter listener retention chain
      if (this.currentClient) {
        this.currentClient.removeAllListeners();
      }

      const client = this.buildClient();
      this.wireListeners(client);
      this.currentClient = client;

      try {
        await client.connect();
        this.status = { kind: "connected", client };
        this.connectedAt = new Date();          // groundwork for Phase 13
        this.lastError = null;
        logger.info(`[${this.accountId}] Reconnected on attempt ${attempt}`);
        return;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.lastError = message;               // D-03: feed into reconnecting.lastError

        // D-05/D-06: classify
        const verdict = classifyConnectionError(err);
        if (verdict === "fatal") {
          // D-02: suspended with human-readable reason
          const reason = humanReason(err); // e.g. "Authentication failed — fix credentials"
          this.status = { kind: "suspended", reason, since: new Date() };
          logger.error(`[${this.accountId}] Account suspended: ${reason}`);
          return;
        }

        // D-14: throttled logging
        const isNewError = message !== lastLoggedError;
        if (shouldLogAttempt(attempt) || isNewError || attempt === 1) {
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
    // D-12: outer safety net for unexpected throws (e.g., classifier exception)
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[${this.accountId}] Unexpected error in reconnect loop: ${msg}`);
    // Do NOT transition to suspended — that would mask a code bug as a fatal account error.
    // Leave status as whatever the last set was; the bug surfaces in logs and next 'close'
    // event will re-enter the loop fresh.
  }
}
```

[CITED: CONTEXT.md D-08, D-09, D-11, D-12, D-14] — every block traces to a locked decision.

### Pattern 4: buildClient with TCP Keepalive

**What:** `ImapFlow` constructor gets `socketOptions: { keepAlive, keepAliveInitialDelay }` and a tighter `socketTimeout`.

**When to use:** Always. Single source of truth for client construction.

**Example:**

```typescript
private buildClient(): ImapFlow {
  return new ImapFlow({
    host: this.config.host,
    port: this.config.port,
    secure: true,
    auth: { user: this.config.username, pass: this.config.password },
    logger: false,
    connectionTimeout: 30_000,
    socketTimeout: 90_000,                       // D-13: was 300_000
    socketOptions: {                             // D-13: NEW
      keepAlive: true,
      keepAliveInitialDelay: 60_000,
    },
  });
}
```

[CITED: imapflow docs at https://imapflow.com/docs/api/imapflow-client/] — `socketOptions` is the documented passthrough to Node.js socket options; `keepAlive` is the standard `net.Socket` option.

### Pattern 5: Poller Skip Guard

**What:** Short-circuit `pollAccount` if the account is not `connected`.

**When to use:** Always, on every poll tick.

**Example:**

```typescript
// In Poller class
private skipLoggedThisCycle = new Set<string>(); // reset at start of each poll()

private async pollAccount(accountId: string): Promise<void> {
  // D-15: skip non-connected accounts
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
    // Belt-and-suspenders: status said connected but getClient disagrees (race)
    // Quietly skip — do not throw — the next poll cycle will retry.
    logger.debug(`Poller: skipping ${accountId} (getClient race: ${result.error})`);
    return;
  }
  const client = result;
  // ... unchanged: fetch and merge ...
}

private async poll(): Promise<void> {
  this.skipLoggedThisCycle.clear(); // D-15: one debug log per skipped account per cycle
  // ... rest unchanged ...
}
```

[CITED: CONTEXT.md D-15] — single debug log per skipped account per poll cycle, not warn.

### Anti-Patterns to Avoid

- **Anti-pattern: Defaulting unknown errors to fatal.** Per D-06 and CONN-01 — any new imapflow version, OS error code, or server quirk that emits an unrecognized error would silently kill the account. Unknown defaults to `transient` always.
- **Anti-pattern: Parsing error message strings for classification.** Per D-07 — message strings are unstable across imapflow versions and server vendors. Trust the typed `AuthenticationFailure` class, the `tlsFailed` boolean, and the `serverResponseCode` string. Nothing else.
- **Anti-pattern: Calling `client.connect()` on a previously-connected ImapFlow instance.** Per existing v0.2 code and `imapflow#15` — throws `ERR_STREAM_WRITE_AFTER_END`. The reconnect loop already builds a fresh instance per attempt; do not change this.
- **Anti-pattern: Async check inside the close listener for race-guard.** Per D-10 — must be a synchronous boolean. Anything that yields (await, microtask) gives the synchronous `error → close` sequence a chance to fire the listener a second time.
- **Anti-pattern: Mutating state in the `error` handler.** Per existing v0.2 code and imapflow's documented event order (`error` then `close`, synchronously) — state changes belong in `close`. The `error` handler logs only.
- **Anti-pattern: Logging every reconnect attempt at warn.** Per D-14 — a multi-hour outage on 3 accounts would emit thousands of identical lines. Throttle to powers-of-two after attempt 3.
- **Anti-pattern: Throwing from `pollAccount` on a skipped account.** Per D-15 and CONN-07 — the current v0.2 code throws when `getClient` returns error, which surfaces as `logger.error("failed to poll account ...")` once per skipped account per poll cycle. Replace with explicit, quiet skip.
- **Anti-pattern: Removing listeners only at gracefulClose, not on each reconnect.** Per D-11 — every reconnect creates a new client; the old client retains listeners holding closures over `this` until GC. At 100+ reconnects per laptop-sleep cycle, this is a real leak. `removeAllListeners()` inside the loop is the fix.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TLS error classification | Custom Node.js TLS-error-code parsing (`CERT_HAS_EXPIRED`, `DEPTH_ZERO_SELF_SIGNED_CERT`, etc.) | Trust `err.tlsFailed === true` from imapflow | D-07; imapflow's classification can evolve; ours would diverge. |
| Auth-failure detection | Regex against error message strings (`/authentication failed/i`) | `err instanceof AuthenticationFailure` (imapflow's exported class) | Stable across versions, server vendors, locales. |
| TCP-dead detection | Custom heartbeat / `NOOP` pings | OS-level TCP keepalive via `socketOptions.keepAlive: true` | OS does it correctly; portable; no extra IMAP traffic. |
| Network connectivity change detection | `is-online`, `internet-available`, or native modules monitoring `SCNetworkReachability` | Fail-and-retry-forever with backoff (no detection needed) | [CITED: .planning/research/STACK.md] No reliable cross-platform Node.js API; reconnect-on-error is the standard. The reconnect loop subsumes the need. |
| Backoff library | `cockatiel`, `p-retry`, `async-retry` for the connection loop | Hand-rolled `while(true)` with `Math.floor(Math.random() * capped)` jitter | [CITED: .planning/research/STACK.md] The loop has side effects (build client, wire listeners, mutate `this.currentClient`); library `.execute(fn)` paradigm fits poorly. Hand-rolled is 30 lines, fully testable. |
| State machine | XState / robot3 | TypeScript discriminated union | 4 states, 4 transitions; type system already enforces exhaustiveness. |
| Mutex / lock | `async-mutex`, `p-limit`-style queues | Synchronous boolean `reconnectInFlight` | Node.js single-threaded; the race is between two synchronously-fired EventEmitter callbacks. A boolean set before any await wins. |
| Process-level unhandled-rejection routing | Custom domain-based error tracking | `process.on('unhandledRejection', handler)` | Standard Node.js — log and continue. |

**Key insight:** Phase 12 is **net-zero new dependencies**. Every problem either already has the right tool (imapflow's typed errors, Node's `socketOptions`, TypeScript's discriminated unions) or doesn't need a tool at all (the boolean race guard). Any "should we use library X" question for this phase should be answered "no, the hand-rolled solution is correct and already most of the way there."

## Runtime State Inventory

> Phase 12 is **not** a rename/refactor/migration phase. It's a behavior change inside one module plus a new module. No stored data, live config, or OS-registered state references the symbols being changed.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 12 changes only in-memory state machines and code; no persisted database, file, or queue references the changed symbols | None |
| Live service config | None — IMAP credentials are read from config file each startup; no external service caches `AccountConnectionStatus.failed` as a string | None |
| OS-registered state | None — the MCP server is launched per-session by the MCP client (Claude Code, Cursor, etc.); no systemd/launchd/Task Scheduler entries embed phase-internal symbol names | None |
| Secrets/env vars | None — auth config (`username`, `password`, `host`, `port`) is unchanged; no env var renaming | None |
| Build artifacts | TypeScript compiled output in `dist/` (if any) — but the build is per-checkout, no global install. Phase 12 type changes will surface as TypeScript errors at next `npm run build`, which is the desired safety net (D-01's exhaustiveness check). | Run `npm run build` after the type rewrite to surface every consumer of the dropped `failed` variant. The TS compiler is the migration tool. |

**Nothing found in category:** Explicitly verified — Phase 12 is a self-contained code change. The only "migration" is the TypeScript exhaustiveness check catching every consumer of the old `status.kind === "failed"` branch.

## Common Pitfalls

### Pitfall 1: TCP Half-Open After Laptop Sleep — Connection Looks Alive But Is Dead

**What goes wrong:** [CITED: .planning/research/PITFALLS.md Pitfall 1 and imapflow#27] After laptop sleep/hibernate, the OS suspends network activity. The TCP connection to the IMAP server is silently dropped by a NAT router; no FIN/RST is delivered. When the laptop wakes, `client.usable === true`, the socket object still exists, but the next IMAP command hangs indefinitely — it never throws, never resolves. **This is the named bug from PROJECT.md that the milestone exists to fix.**

**Why it happens:** Node.js TCP sockets default to `keepAlive: false`. Without OS keepalive probes, neither party detects the dead transport. Current `socketTimeout: 300_000` only fires after 5 minutes of read silence — useless if the machine just woke from a longer nap.

**How to avoid:** D-13 fix — `socketOptions: { keepAlive: true, keepAliveInitialDelay: 60_000 }` + `socketTimeout: 90_000`. OS keepalive probes start 60s into idle; if the transport is dead, the local stack notices within ~120s and closes the socket, which triggers the `close` event, which starts the reconnect loop.

**Warning signs:**
- Agent tool calls hang without returning an error
- `getStatus()` returns `connected` but subsequent IMAP ops time out
- No `close` events in logs for >5 minutes after a known network interruption

### Pitfall 2: Concurrent Reconnect — `error` Then `close` Spawn Two Loops

**What goes wrong:** [CITED: .planning/research/PITFALLS.md Pitfall 2] imapflow emits `error` then `close` synchronously. The current v0.2 guard (`status.kind === "reconnecting"`) is checked before the async `runReconnectLoop` has had a chance to write status. Two reconnect loops start in parallel; each builds its own client; one wins; the other leaks.

**Why it happens:** EventEmitter dispatch is synchronous in-order. Status mutation inside `runReconnectLoop` happens after a microtask yield. The guard reads a value that hasn't been written yet.

**How to avoid:** D-10 — replace the status check with a synchronous boolean `reconnectInFlight` set before `void this.runReconnectLoop()`. Cleared in `.finally()`. Booleans set synchronously beat the async race.

**Warning signs:**
- Logs show two simultaneous "Reconnecting attempt 1" entries for the same account
- `MockImapFlow.mock.calls.length` grows by 2 per reconnect event in tests instead of 1

### Pitfall 3: Retry Storm — All Accounts Reconnect Simultaneously

**What goes wrong:** [CITED: .planning/research/PITFALLS.md Pitfall 3] Current `backoffDelayMs` is deterministic. With 3 accounts whose connections drop together (server restart, Wi-Fi flip), all three schedule attempt 1 at exactly t+1000ms, attempt 2 at t+3000ms, etc. Against a recovering server, this synchronized hammering can prolong the outage or trigger rate limits.

**How to avoid:** D-09 — full jitter: `delay = Math.floor(Math.random() * capped)`. AWS's recommended pattern. With 3 accounts, attempt 1 fires at three independent random times in `[0, 1000)`.

**Warning signs:** Logs show every account hitting attempt 1 at the same millisecond after a network drop.

### Pitfall 4: Auth Failure Retried Forever Until Account Lockout

**What goes wrong:** [CITED: .planning/research/PITFALLS.md Pitfall 4] An expired password or revoked App Password triggers identical auth failures on every retry. Without classification, the loop retries indefinitely (per D-08), generating server-side failure logs and risking account lockout. **D-08's "unbounded retry" combined with no classification would be catastrophic.**

**How to avoid:** D-04 / D-05 — `classifyConnectionError(err)` returns `"fatal"` for `AuthenticationFailure`, `tlsFailed`, and RFC 5530 fatal response codes. The reconnect loop checks the classifier on every failure; fatal → transition to `suspended` and return. No further retries.

**Why this isn't double-handled:** The unbounded retry from D-08 applies only to **transient** errors. The classifier is the gate that prevents fatal errors from entering the unbounded loop.

**Warning signs:**
- Logs show multiple consecutive "Reconnect attempt N failed: authentication failed"
- Account never transitions to `suspended` after first auth failure

### Pitfall 5: TLS Misclassification

**What goes wrong:** TLS handshake errors span both categories. `CERT_HAS_EXPIRED` is fatal. `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` during a CA rotation may be transient. Hand-parsing Node TLS error codes risks divergence from imapflow's own classification.

**How to avoid:** D-07 — trust `err.tlsFailed === true` from imapflow. Do not parse error messages. Do not check Node TLS error codes. imapflow's authors decide what counts as a TLS failure; we accept their verdict.

### Pitfall 6: EventEmitter Listener Leak on Repeated Reconnects

**What goes wrong:** [CITED: .planning/research/PITFALLS.md Pitfall 11] Every reconnect creates a new `ImapFlow` with two listeners (`error`, `close`). The previous instance's listeners are never removed; they hold closures over `this` (the `AccountConnection`), preventing GC. At 10+ reconnects per laptop-sleep cycle, `MaxListenersExceededWarning` appears, and memory grows proportionally to reconnect attempts.

**How to avoid:** D-11 — `oldClient.removeAllListeners()` immediately before assigning `this.currentClient = newClient` inside the reconnect loop. Breaks the retention chain.

**Warning signs:**
- `MaxListenersExceededWarning: Possible EventEmitter memory leak detected. N listeners added`
- Memory growth proportional to reconnect count (not message volume)

### Pitfall 7: Unhandled Promise Rejection Crashes the Process

**What goes wrong:** [CITED: .planning/research/PITFALLS.md Pitfall 10] `void this.runReconnectLoop()` in the close handler discards the promise. Any unhandled rejection inside the loop becomes an `unhandledRejection` event on the process. Node.js 15+ default behavior is to crash on unhandled rejections.

**How to avoid:** D-12 — outer `try/catch` in `runReconnectLoop` (belt-and-suspenders); plus a `process.on('unhandledRejection', handler)` in `index.ts` that logs at `error` level and does NOT exit. MCP servers are long-running; one account's reconnect bug should not kill all accounts.

### Pitfall 8: Stale Client Reference Across an Await

**What goes wrong:** [CITED: .planning/research/PITFALLS.md Pitfall 9 / imapflow#41] A tool handler captures `getClient()` result, then awaits a long IMAP operation. Meanwhile a `close` event fires; the reconnect loop replaces `this.currentClient` with a new instance. The old reference is now to a closed client; the next operation on it throws `ERR_STREAM_WRITE_AFTER_END`.

**How to avoid:** Invariant: never store an `ImapFlow` reference across an `await` that itself performs IMAP I/O. Existing v0.2 tool handlers already follow this pattern (they call `getClient()` once per tool invocation). Document the invariant as a comment on `getClient()` and verify on review.

**Phase 12 scope note:** This pitfall does not require code changes in Phase 12; the existing code is correct. It belongs in the verification checklist to confirm no regression.

## Code Examples

All examples in this section are derived from CONTEXT.md decisions and verified imapflow API surface. They are the recommended canonical patterns for the planner's task actions.

### Example 1: Error classifier with exhaustive RFC 5530 coverage

See **Pattern 1** above. Co-located here for planner reference.

### Example 2: Race-safe reconnect trigger

See **Pattern 2** above.

### Example 3: Unbounded reconnect loop with classification + listener cleanup + throttled logging

See **Pattern 3** above.

### Example 4: buildClient with TCP keepalive

See **Pattern 4** above.

### Example 5: Poller skip guard

See **Pattern 5** above.

### Example 6: Process-level unhandledRejection handler

```typescript
// At the top of main() in src/index.ts, before manager.connectAll()
process.on("unhandledRejection", (reason: unknown) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error && reason.stack ? `\n${reason.stack}` : "";
  logger.error(`unhandledRejection: ${msg}${stack}`);
  // D-12: do NOT exit. Long-running MCP server should not crash on one
  // account's reconnect-loop bug; the bug surfaces in logs for investigation.
});
```

### Example 7: AccountConnectionStatus union (the 4-state shape)

```typescript
// src/connections/account-connection.ts — replaces the v0.2 union
export type AccountConnectionStatus =
  | { kind: "connecting" }
  | { kind: "connected"; client: ImapFlow }
  | {
      kind: "reconnecting";
      attempt: number;
      nextRetryAt: Date;
      lastError: string; // D-03
    }
  | {
      kind: "suspended";
      reason: string;    // D-02: human-readable
      since: Date;       // D-02
    };
// NOTE: `failed` variant is intentionally DROPPED (D-01).
```

### Example 8: Test pattern — fake timers + mock ImapFlow + simulate close event

This pattern is already established in `tests/connections/account-connection.test.ts`. New tests follow the same shape:

```typescript
// Existing pattern, reproduced for new test cases:
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

it("transitions to suspended on AuthenticationFailure", async () => {
  // Mock ImapFlow.connect to throw AuthenticationFailure
  const { AuthenticationFailure } = await import("imapflow");
  vi.mocked(ImapFlow).mockImplementation(/* ... return mock that rejects connect() */);

  const conn = new AccountConnection("test", makeAccountConfig());
  await conn.connect();
  await flushMicrotasks();

  expect(conn.getStatus().kind).toBe("suspended");
});

it("emits close twice in 0ms — only one reconnect loop runs", async () => {
  const conn = new AccountConnection("test", makeAccountConfig());
  await conn.connect();
  const { ImapFlow } = await import("imapflow");
  const callsBefore = vi.mocked(ImapFlow).mock.calls.length;

  const status = conn.getStatus();
  if (status.kind !== "connected") return;

  status.client.emit("close");
  status.client.emit("close");
  await flushMicrotasks();
  await vi.advanceTimersByTimeAsync(1100); // past first backoff

  // Only one new ImapFlow constructor call (the one inside the single loop)
  expect(vi.mocked(ImapFlow).mock.calls.length).toBe(callsBefore + 1);
});
```

[VERIFIED: existing project test patterns in `tests/connections/account-connection.test.ts`].

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Bounded retry cap (10 attempts → permanent `failed`) | Unbounded retry for transient; immediate `suspended` for fatal | Phase 12 | Accounts survive multi-hour outages without server restart |
| Deterministic exponential backoff | Full jitter (`Math.floor(Math.random() * capped)`) | Phase 12 | Multi-account servers no longer hammer recovering IMAP servers in lockstep |
| `socketTimeout: 300_000`, no TCP keepalive | `socketTimeout: 90_000`, `socketOptions.keepAlive: true`, `keepAliveInitialDelay: 60_000` | Phase 12 | Half-open sockets surface in ~2 min vs. potentially never |
| Status-check race guard (`status.kind === "reconnecting"`) | Synchronous `reconnectInFlight` boolean | Phase 12 | Concurrent close events can no longer spawn duplicate loops |
| No listener cleanup; old `ImapFlow` retains `error`/`close` handlers across reconnect | `oldClient.removeAllListeners()` before constructing new client | Phase 12 | `MaxListenersExceededWarning` eliminated; per-reconnect memory leak fixed |
| Log every reconnect attempt at warn | Throttled (powers-of-two doubling after attempt 3); first error always logged; error-message change resets throttle | Phase 12 | Multi-hour outages no longer flood stderr with thousands of identical lines |
| Generic `Error` classification by message string (none currently) | Typed `instanceof AuthenticationFailure` + `tlsFailed` boolean + RFC 5530 response code lookup | Phase 12 | Stable across imapflow versions, server vendors, and locales |
| 5 named states (`connecting/connected/reconnecting/suspended/failed`) per STATE.md | 4 reachable states (drop `failed`, keep `suspended`) per D-01 | Phase 12 (overrides STATE.md) | Type system mirrors actual behavior; no defined-but-unreachable variants |

**Deprecated/outdated:**
- `BACKOFF_MAX_ATTEMPTS` constant: removed (D-08).
- `status.kind === "failed"` branches everywhere: removed (D-01). TypeScript exhaustiveness check is the migration tool.
- `status.kind === "reconnecting"` race guard in close handler: replaced by `reconnectInFlight` boolean (D-10).

## Assumptions Log

> All key technical claims in this research are either VERIFIED against the existing `.planning/research/` corpus (which itself was researched 2026-06-08 with HIGH confidence and direct Context7/official-docs verification) or CITED from CONTEXT.md locked decisions.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | imapflow 1.3.7's `AuthenticationFailure` export and `tlsFailed`/`serverResponseCode` error properties remain at the same shape as in 1.2.13 | Standard Stack; Pattern 1 | Classifier returns wrong verdict; mitigated by table-driven tests that assert on actual imapflow error objects (use `AuthenticationFailure` constructor and assert classifier returns `"fatal"`) |
| A2 | Node.js `net.Socket` `keepAlive` option behaves consistently on macOS 15+, Linux, and Windows when set via `socketOptions` | Pattern 4 / Pitfall 1 | Keepalive may not actually fire on some platforms; mitigated by the still-tightened `socketTimeout: 90_000` which is a backstop (the original 300s was the ONLY backstop). Either mechanism alone is an improvement. |
| A3 | The throttling cadence in D-14 (`1, 2, 3, 5, 10, 20, 40, 80, 160, 320, …`) is correctly interpreted as "log at attempt 1–3 always, then at attempt 5, 10, 20, 40, 80, …" (powers-of-2 starting from 5) | Pattern 3 (`shouldLogAttempt`) | If the planner reads the sequence differently (e.g., powers-of-2 starting from 4, or 1-2-4-8-16), the implementation diverges. The CONTEXT.md text reads "powers-of-two doubling after the first 3" which is consistent with the implementation shown. Verify with user during planning if ambiguous. |
| A4 | imapflow's `serverResponseCode` field is uppercase (e.g. `"AUTHENTICATIONFAILED"`), matching RFC 5530 | Pattern 1 (uses `.toUpperCase()` defensively) | Lowercased values would silently miss the fatal set; mitigated by defensive `.toUpperCase()` in the classifier. |
| A5 | The existing v0.2 `flushMicrotasks(5)` helper + `vi.advanceTimersByTimeAsync` is sufficient to drive the new unbounded loop in tests | Validation Architecture | If the loop's microtask graph differs from v0.2's bounded loop, tests may hang or pass spuriously. The loop's await points (`sleep`, `client.connect`) are structurally identical to v0.2; risk is LOW. |
| A6 | imapflow 1.2.13 → 1.3.7 contains no breaking changes affecting the existing tool-layer code (search, fetch, lock, idle, store) | Standard Stack | A breaking change would surface as a TS compile error or a runtime regression in v0.2 tests. The pre-research (.planning/research/STACK.md) reviewed the changelog and confirmed no breaking changes; nonetheless, run the full v0.2 test suite after the bump as part of phase verification. |

**If this table is empty:** N/A — six assumptions are flagged for the planner and user-discussion to confirm. A3 in particular merits a confirm with the user before implementation begins.

## Open Questions

1. **D-14 throttle sequence interpretation (A3 above)**
   - What we know: CONTEXT.md says "powers-of-two doubling after the first 3" and gives example sequence "1, 2, 3, 5, 10, 20, 40, 80, 160, 320, …"
   - What's unclear: Whether 4 is intentionally excluded or whether the sequence should be "1, 2, 3, 4, 8, 16, 32, 64, 128, …"
   - Recommendation: Take the CONTEXT.md sequence at face value (5 then doubling) — implement `shouldLogAttempt` exactly as written. Add a unit test that captures the expected sequence so a planner intent change is detectable.

2. **Initial-connect path classification (CONN-01 + CONN-03 interaction)**
   - What we know: The existing `connect()` method calls `runReconnectLoop()` on failure. If the initial-connect error is fatal (wrong password from config), the loop will classify it on attempt 1 and transition to `suspended` — correct behavior.
   - What's unclear: Whether `connect()` should classify the initial error BEFORE calling `runReconnectLoop()` and transition directly to `suspended` without scheduling a `sleep(backoffDelayMs(1))` first.
   - Recommendation: Skip the initial sleep for fatal initial-connect errors. Worth 1 second on startup. Implementation: in `connect()`'s catch block, call `classifyConnectionError(err)` before delegating to `runReconnectLoop`; if fatal, transition to `suspended` directly. Document and unit-test.

3. **`humanReason(err)` helper shape**
   - What we know: Specifics in CONTEXT.md note the suspended-state error log should be self-explanatory ("Authentication failed — fix credentials" / "TLS certificate invalid — check cert chain").
   - What's unclear: Whether this is a one-liner with a 4-arm switch on classifier verdict + error shape, or a more general formatter.
   - Recommendation: Simple `humanReason(err: unknown): string` helper in `error-classifier.ts` alongside the classifier — 5 lines max, 4 cases: AuthenticationFailure → "Authentication failed — fix credentials"; `tlsFailed === true` → "TLS certificate invalid — check cert chain"; RFC 5530 code → `"Server rejected connection (${code})"`; fallback → original `err.message`. Co-locating with the classifier keeps fatal-handling logic in one file.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | ✓ | (per project — 22+; `net.Socket` keepAlive options available since v18) | — |
| npm | Install `imapflow@^1.3.7` | ✓ | (per project setup) | — |
| TypeScript compiler | Surfaces exhaustiveness errors after `failed` variant removal | ✓ | `^5.9.3` (existing devDep) | — |
| Vitest | Unit/integration tests with fake timers | ✓ | `^4.0.18` (existing devDep) | — |
| imapflow `AuthenticationFailure` export | Classifier `instanceof` check | ✓ | Available since 1.2.x; verified in 1.3.7 | — |
| imapflow `socketOptions` constructor field | TCP keepalive (D-13) | ✓ | Documented in current imapflow client API | — |
| Real IMAP server (for manual repro of TCP half-open) | Phase 12 success criterion #1 (10-min Wi-Fi outage recovery) | ⚠ Required manually | — | Document as manual test in phase verification — not automatable in Vitest (see Pitfall 1 test-strategy note in pre-research) |

**Missing dependencies with no fallback:** None for the implementation itself.

**Missing dependencies with fallback:** The TCP-half-open manual repro requires a real IMAP server and a way to drop packets (Wi-Fi disable, `iptables`, network simulator). This is a known limitation — Vitest unit tests cannot simulate a half-open TCP connection. The phase verification must include a manual test step.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `^4.0.18` |
| Config file | None visible at root — Vitest uses defaults; project relies on `vitest run` from package.json |
| Quick run command | `npx vitest run tests/connections/error-classifier.test.ts tests/connections/account-connection.test.ts` |
| Full suite command | `npm test` (i.e., `vitest run`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONN-01 | Classify each fatal error type to `"fatal"` (AuthenticationFailure instance, `tlsFailed: true`, each RFC 5530 response code in D-05) | unit | `npx vitest run tests/connections/error-classifier.test.ts` | ❌ Wave 0 — new file |
| CONN-01 | Classify each transient code (`ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `ECONNREFUSED`, `ENETUNREACH`, `EConnectionClosed`, `NoConnection`) to `"transient"` | unit | (same file) | ❌ Wave 0 |
| CONN-01 | Classify unknown / malformed errors to `"transient"` (defaults safe) | unit | (same file) | ❌ Wave 0 |
| CONN-02 | Reconnect loop survives 15+ consecutive transient failures and eventually connects (replace v0.2 "10 attempts then failed" test) | unit (fake timers) | `npx vitest run tests/connections/account-connection.test.ts -t "unbounded transient retry"` | ❌ Wave 0 — new test in existing file |
| CONN-02 | `backoffDelayMs` returns different values across calls when jitter is active (mock `Math.random` to verify range `[0, capped)`) | unit | (same file) | ❌ Wave 0 |
| CONN-03 | Reconnect loop transitions to `suspended` on attempt 1 when classifier returns `"fatal"`; no further retries occur | unit (fake timers) | `npx vitest run tests/connections/account-connection.test.ts -t "fatal goes straight to suspended"` | ❌ Wave 0 |
| CONN-04 | `buildClient()` constructs `ImapFlow` with `socketOptions: { keepAlive: true, keepAliveInitialDelay: 60_000 }` and `socketTimeout: 90_000` | unit | `npx vitest run tests/connections/account-connection.test.ts -t "buildClient applies TCP keepalive"` | ❌ Wave 0 |
| CONN-04 | (Manual / out-of-band) Sleep laptop for >5min, wake, verify `reconnecting` state observed within `socketTimeout + 5s` and recovery completes | manual | Document in `.planning/phases/12-connection-resilience-foundation/12-VALIDATION.md` | manual — not automatable |
| CONN-05 | Two `close` events emitted in same microtask batch result in exactly ONE new `ImapFlow` instance during reconnect window | unit (fake timers + microtask flush) | `npx vitest run tests/connections/account-connection.test.ts -t "concurrent close events"` | ❌ Wave 0 |
| CONN-06 | After N reconnect failures (N >= 5), `oldClient.removeAllListeners` was called on every discarded client; no `MaxListenersExceededWarning` event observed | unit | `npx vitest run tests/connections/account-connection.test.ts -t "listener cleanup"` | ❌ Wave 0 |
| CONN-07 | `Poller.pollAccount` short-circuits without calling IMAP when status is `connecting` / `reconnecting` / `suspended`; single `debug` log per skipped account per cycle | unit | `npx vitest run tests/polling/poller.test.ts -t "skips non-connected accounts"` | ❌ Wave 0 — new test in existing file |
| CONN-07 | Skipped accounts still appear in the poller's next cycle (skip is not sticky) | unit | (same file) | ❌ Wave 0 |
| Cross-cutting | `unhandledRejection` handler logs and does not exit process | unit | `npx vitest run tests/startup.test.ts -t "unhandledRejection logs and continues"` | ❌ Wave 0 — extend existing |
| Cross-cutting | Whole-suite regression: existing v0.2 tests (`connection-manager`, `poller`, all tool handlers) pass with the new 4-state union (no `failed` references remain) | regression | `npm test` | ✅ existing tests must be updated |

### Sampling Rate

- **Per task commit:** `npx vitest run tests/connections/error-classifier.test.ts tests/connections/account-connection.test.ts tests/polling/poller.test.ts` (the three files touching this phase) — under 5 seconds
- **Per wave merge:** `npm test` (full suite) — must be green before merging to main
- **Phase gate:** `npm test` green + manual TCP-half-open repro documented as PASSED in VALIDATION.md before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/connections/error-classifier.test.ts` — NEW; covers CONN-01 exhaustively (one `describe.each` table per fatal source + one per transient source + unknown fallback)
- [ ] `tests/connections/account-connection.test.ts` — EXTEND with: unbounded retry test (replaces 10-attempt cap test); jitter assertion (mock `Math.random`); fatal-classification fast-path; concurrent-close race (CONN-05); listener-cleanup count (CONN-06); buildClient socketOptions assertion (CONN-04)
- [ ] `tests/connections/connection-manager.test.ts` — UPDATE: remove `failed`-case tests; add `suspended`-case tests for `getClient()` error string and `getStatus()` shape
- [ ] `tests/polling/poller.test.ts` — EXTEND: skip-on-non-connected (CONN-07); skip log emitted at debug only once per cycle
- [ ] `tests/startup.test.ts` — EXTEND: `unhandledRejection` handler registered; emitting a rejection logs but does not exit (use spy on `logger.error` + `process.exit`)
- [ ] No new framework install needed — Vitest + fake timers already configured.

**Manual / out-of-band tests:**
- Sleep laptop ≥5 minutes, wake, observe reconnect within 90s + 5s tolerance (Success Criterion #1).
- Configure account with wrong password; observe immediate `suspended` transition without retry (Success Criterion #2).

## Security Domain

> `.planning/config.json` does not contain a `security_enforcement` key — treat as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | IMAP auth (username/password from config) — Phase 12 does not change auth flow itself; it changes how *failed* auth is handled. Fatal classification (D-05) ensures repeated auth attempts cease after first failure, **preventing server-side account lockout** (a denial-of-service vector against the user). |
| V3 Session Management | no — IMAP sessions are stateless per-connection; reconnect creates a fresh session | — |
| V4 Access Control | no — Phase 12 does not change tool permissions or access patterns | — |
| V5 Input Validation | yes (minor) | Phase 12 introduces no new tool inputs. The `humanReason(err)` formatter must **not leak credentials** in the suspended-state `reason` string. Use stock messages ("Authentication failed — fix credentials") rather than echoing imapflow's error message verbatim, which may include configured username. |
| V6 Cryptography | yes (minor) | D-07 enforces strict TLS classification via `imapflow.tlsFailed`. We never hand-roll TLS error parsing — preserve the upstream-managed cert validation chain. |
| V7 Error Handling & Logging | yes | Reduce log volume via D-14 throttling to prevent log-flood DoS via attacker triggering reconnect storms. `unhandledRejection` handler (D-12) prevents one bad path from crashing all accounts. |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Account lockout via repeated failed auth attempts (e.g., Gmail's 10-failed-login lockout) | Denial-of-Service | D-04 / D-05 — classify auth failures as fatal on attempt 1; do not retry. |
| Log flooding via attacker triggering forced disconnects | Denial-of-Service | D-14 — throttled logging caps log volume at O(log n) per outage. |
| Credential leakage in error messages surfaced to MCP agent context | Information Disclosure | D-02 — `suspended.reason` is a stock human-readable string, NOT `err.message` (which may include `auth.user` from constructor args). [CITED: .planning/research/PITFALLS.md Security Mistakes] |
| Unhandled rejection causing process crash exposing partial recovery state | Denial-of-Service / Availability | D-12 — `unhandledRejection` handler logs and continues; outer `try/catch` in `runReconnectLoop` catches unexpected throws. |
| Hostname leakage in tool-facing error strings | Information Disclosure | Current `getClient()` error includes account name (acceptable — agent-known). Do not add `host`/`port`. Phase 12 keeps current pattern. |
| TLS cert validation bypass via misclassification | Tampering | D-07 — trust `imapflow.tlsFailed` strictly. Do not attempt to retry past TLS cert failures; treat as fatal. |

## Project Constraints (from CLAUDE.md)

> `./CLAUDE.md` does not exist in the repository root. There are no project-specific directives beyond those captured in `STATE.md`, `REQUIREMENTS.md`, `ROADMAP.md`, the canonical references in CONTEXT.md, and the established v0.2 codebase patterns (stderr-only logging, fake-timer-compatible `sleep`, per-account isolation via `ConnectionManager.Map`, structured-error return shape from `getClient()`).

The implicit constraints discoverable from the codebase:
- **Stderr-only logging via `src/logger.ts`** — never `console.log` (would corrupt MCP JSON-RPC on stdout).
- **`globalThis.setTimeout` not `node:timers/promises`** — required for Vitest fake-timer compatibility.
- **`type: "module"` ESM** — `.js` import extensions even in `.ts` source files.
- **TypeScript strict mode** — exhaustive switches required; `unknown` for caught errors.
- **No `npm install` of net-new dependencies in Phase 12** — confirmed in Standard Stack section.
- **Commits enabled** (`commit_docs: true` in `.planning/config.json`) — phase artifacts go to git.

## Sources

### Primary (HIGH confidence)
- `.planning/research/SUMMARY.md` — pre-digested executive summary; canonical for Phase 12 scope/avoids
- `.planning/research/STACK.md` — verified via Context7 `/postalsys/imapflow`, `AuthenticationFailure`, `socketOptions`, `socketTimeout`, npm registry versions
- `.planning/research/ARCHITECTURE.md` — direct codebase read + verified imapflow behavior; component boundaries and file-level changes
- `.planning/research/PITFALLS.md` — verified via imapflow GitHub issues #15, #27, #41, RFC 5530, Thunderbird Bug 1535969, codebase inspection
- `.planning/research/FEATURES.md` — RFC 5530 source-verified; imapflow source inspection
- `.planning/phases/12-connection-resilience-foundation/12-CONTEXT.md` — locked user decisions (D-01 through D-15)
- `src/connections/account-connection.ts` — direct codebase read 2026-06-08
- `src/connections/connection-manager.ts` — direct codebase read 2026-06-08
- `src/polling/poller.ts` — direct codebase read 2026-06-08
- `src/index.ts` — direct codebase read 2026-06-08
- `tests/connections/account-connection.test.ts` — direct read for test patterns
- `npm view imapflow version` → `1.3.7` (2026-06-08 verification)
- `npm view imapflow time.modified` → `2026-06-08T08:29:26.236Z` (2026-06-08 verification)

### Secondary (MEDIUM confidence)
- `https://imapflow.com/docs/api/imapflow-client/` (referenced via pre-research SUMMARY.md) — event list, `socketOptions`, `connectionTimeout`, `socketTimeout` semantics
- `https://github.com/postalsys/imapflow/issues/27` — TCP half-open confirmation ("commands do never return or throw")
- `https://github.com/postalsys/imapflow/issues/15` — fresh-instance-required-on-reconnect
- `https://github.com/postalsys/imapflow/issues/41` — stale client reuse crash pattern
- `https://github.com/postalsys/imapflow/issues/224` — `authenticationFailed`/`serverResponseCode` confirmation
- `https://www.rfc-editor.org/rfc/rfc5530.html` — IMAP server response codes (D-05 source)
- `https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/` — full-jitter formula (D-09 source)
- `https://bugzilla.mozilla.org/show_bug.cgi?id=1535969` — Thunderbird TCP keepalive reference

### Tertiary (context only)
- `https://github.com/anthropics/claude-code/issues/57207`, `#10129` — MCP-ecosystem manual-reconnect gap (Phase 14 motivation, not Phase 12)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — single `imapflow` version bump, verified on npm registry; no net-new deps
- Architecture: HIGH — every decision traces to a locked CONTEXT.md decision (D-01..D-15); all integration points confirmed by direct codebase read
- Pitfalls: HIGH — all 8 pitfalls cite the pre-existing PITFALLS.md (verified via imapflow issues, RFC sources, codebase inspection on 2026-06-08)
- Code examples: HIGH — patterns are direct translations of locked decisions; one open question (A3: throttle sequence interpretation) flagged for planner verification
- Validation: HIGH — leverages existing Vitest patterns from `tests/connections/account-connection.test.ts`; documented manual-test gap for TCP half-open

**Research date:** 2026-06-08
**Valid until:** ~2026-07-08 (30 days — imapflow is stable, but a major 1.4.x release between research and execution could invalidate stack assumptions; verify `npm view imapflow version` if execution slips beyond this date)
