# Phase 2: Connection Management - Research

**Researched:** 2026-03-11
**Domain:** imapflow connection lifecycle, state machine design, exponential backoff
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Connection Timing**
- Connect all accounts eagerly at server startup (not lazily on first tool call)
- If an account fails to connect at startup: log the error to stderr and continue serving other accounts. Do NOT block or abort startup.
- After startup, a background loop proactively retries failed accounts — they come back automatically without server restart
- This supersedes the Phase 1 CONTEXT.md note about lazy-connect; eager is correct given the MCP server lifecycle

**Reconnect Strategy**
- Exponential backoff with a cap: start fast (e.g. 1s), double each attempt up to a maximum interval (e.g. 60s)
- After the max retry limit, mark the account as permanently failed for this session. No more reconnect attempts.
- During the reconnect window: tool calls against that account return an error immediately — do NOT queue or hold calls

**Account Isolation**
- Fully independent per-account state: each account has its own connection object, reconnect loop, and backoff state. No shared connection pool.
- When a tool call targets a downed account: return a structured error with the account name and current status
- For multi-account operations: return partial results from working accounts plus an `errors` array listing which accounts failed
- If imapflow throws an unexpected error mid-call: treat it as a connection drop — log it, mark the account as reconnecting, trigger the reconnect loop, return error to the caller

**Connection Lifecycle**
- `ConnectionManager` is instantiated in `main()` after config loads, then passed into tool handlers as a dependency — no module-level singleton
- Register SIGTERM and SIGINT handlers: on shutdown, close all IMAP connections gracefully before exiting
- Connection status per account is exposed so the Phase 3 `list_accounts` tool can include it (connected / reconnecting / failed)

**Testing**
- Unit tests: test ConnectionManager state machine, reconnect logic, and error handling with mocked imapflow — fast, no real IMAP server required
- Integration tests: happy-path connect/disconnect against a real IMAP server — Claude's discretion on test server approach (Docker-based or env-var credentials)

### Claude's Discretion
- Exact exponential backoff parameters (initial delay, multiplier, cap, max retries)
- Integration test IMAP server infrastructure choice
- imapflow event/API specifics for detecting drops and performing reconnect

### Deferred Ideas (OUT OF SCOPE)
- None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CONN-01 | Server maintains persistent IMAP connections per account (not opened on every tool call) | ConnectionManager holds one ImapFlow instance per account; `usable` property checked before each use |
| CONN-02 | Connections automatically reconnect with exponential backoff after drop or timeout | imapflow `close` event triggers reconnect loop; new ImapFlow() required each attempt (maintainer confirmed) |
| CONN-03 | One broken account connection does not crash the server or block operations on other accounts | Per-account state isolation; try/catch at connection boundary; errors returned as structured results |
</phase_requirements>

## Summary

Phase 2 implements a `ConnectionManager` class that maintains one imapflow `ImapFlow` instance per configured account. Connections open eagerly at server startup and are automatically re-established after drops via exponential backoff. Each account operates completely independently — a failed account returns structured errors to callers while other accounts continue serving requests.

The critical imapflow design constraint — confirmed by the library maintainer — is that `ImapFlow` instances are **not reusable**: once a connection closes, you must construct a `new ImapFlow(...)` object for the next attempt. This shapes the entire reconnect loop: it is not a matter of calling `connect()` on an existing object; it creates a fresh instance each cycle.

The library (v1.2.13, March 2026) is actively maintained. Versions 1.2.12–1.2.13 fixed unhandled promise rejections on `close()` race conditions and IDLE recovery — exactly the scenarios this phase will exercise. Using the latest version is important for stability.

**Primary recommendation:** Implement a `AccountConnection` class that owns the per-account state machine (`connecting` | `connected` | `reconnecting` | `failed`), the backoff counter, and the current `ImapFlow` instance. `ConnectionManager` holds a `Map<string, AccountConnection>` keyed by `account_id`, delegates lifecycle calls, and exposes `getClient(account_id)` to Phase 3 tool handlers.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| imapflow | 1.2.13 | IMAP client — connection, auth, mailbox ops | Only modern Node.js IMAP client with async/await; used by EmailEngine (production scale); ships its own .d.ts |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:events | built-in | EventEmitter base for imapflow | imapflow extends EventEmitter; no install needed |
| node:timers/promises | built-in | `setTimeout` as a promise for backoff delays | Clean async sleep in reconnect loop |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| imapflow | node-imap | node-imap is callback-based, no active maintenance; imapflow is the ecosystem successor |
| node:timers/promises | setTimeout + wrapper | Functionally identical; `timers/promises` is cleaner in async context and abortable via AbortController |

**Installation:**
```bash
npm install imapflow
```

imapflow ships its own TypeScript definitions (`lib/imap-flow.d.ts`) — no `@types/imapflow` needed. The `@types/imapflow` package on npm is a community stub that is outdated; use the bundled types.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── connections/
│   ├── account-connection.ts   # Per-account state machine + ImapFlow lifecycle
│   ├── connection-manager.ts   # Map<account_id, AccountConnection>, startup, shutdown
│   └── index.ts                # Re-exports: ConnectionManager, AccountConnectionStatus
├── config/                     # (Phase 1 — unchanged)
├── tools/                      # (Phase 1 stubs — unchanged)
├── logger.ts                   # (Phase 1 — unchanged)
├── types.ts                    # (Phase 1 — unchanged)
└── index.ts                    # (Phase 1 — wired with ConnectionManager)
tests/
├── connections/
│   ├── account-connection.test.ts   # Unit: state machine with mocked ImapFlow
│   └── connection-manager.test.ts   # Unit: startup, shutdown, getClient isolation
├── config.test.ts              # (Phase 1)
├── startup.test.ts             # (Phase 1)
└── types-logger.test.ts        # (Phase 1)
```

### Pattern 1: Per-Account State Machine

**What:** Each `AccountConnection` instance holds a discriminated union status and transitions through states in response to imapflow events and backoff timer completion.

**When to use:** Any time an account's connection status is read or mutated — all transitions go through a single `setState()` method.

**States:**
```typescript
// Source: derived from imapflow API + CONTEXT.md decisions
type AccountConnectionStatus =
  | { kind: 'connecting' }
  | { kind: 'connected'; client: ImapFlow }
  | { kind: 'reconnecting'; attempt: number; nextRetryAt: Date }
  | { kind: 'failed'; reason: string };
```

**Transitions:**
```
connecting  → connected       (connect() resolves)
connecting  → reconnecting    (connect() rejects or close event fires during connect)
connected   → reconnecting    (close event fires on live connection)
connected   → connecting      (impossible — only entry from reconnecting or initial)
reconnecting → connecting     (backoff timer fires, attempt < maxAttempts)
reconnecting → failed         (attempt >= maxAttempts)
failed      → (terminal)      (no further transitions this session)
```

### Pattern 2: ImapFlow Construction and Event Wiring

**What:** The imapflow `ImapFlow` object must be constructed fresh each reconnect attempt. Events are wired on the new instance immediately after construction, before `connect()` is called.

**Critical constraint (confirmed by maintainer):** Do NOT call `connect()` on a disconnected ImapFlow instance. Construct a new one.

```typescript
// Source: imapflow official docs (imapflow.com) + GitHub issue #63 maintainer response
function buildClient(account: AccountConfig): ImapFlow {
  return new ImapFlow({
    host: account.host,
    port: account.port,   // always 993 (enforced by schema)
    secure: true,          // TLS — CONF-03 requires this
    auth: {
      user: account.username,
      pass: account.password,
    },
    logger: false,         // suppress imapflow internal logging; we use our own logger
    connectionTimeout: 30_000,
    socketTimeout: 300_000,
  });
}
```

**Event wiring on each new instance:**
```typescript
// Source: imapflow type definitions (lib/imap-flow.d.ts)
client.on('error', (err: Error) => {
  // Log the error — do NOT re-throw
  // imapflow emits 'error' before 'close' on most failure paths
  logger.error(`[${accountId}] IMAP error: ${err.message}`);
});

client.on('close', () => {
  // Transition to reconnecting and start backoff loop
  // 'close' fires for both graceful logout and unexpected drops
  scheduleReconnect();
});
```

**Important:** The `error` event MUST have a listener attached before `connect()`. Node.js `EventEmitter` throws unhandled `error` events as exceptions, which would crash the process.

### Pattern 3: Exponential Backoff Reconnect Loop

**What:** After a `close` event, the per-account reconnect loop sleeps an exponentially increasing delay, then constructs a new ImapFlow and attempts `connect()`.

**Recommended parameters (Claude's discretion):**
- Initial delay: 1 second
- Multiplier: 2x
- Cap: 60 seconds
- Max attempts: 10 (covers ~20 minutes of total wait time across all attempts)

```typescript
// Source: standard backoff pattern, parameters per CONTEXT.md discretion
const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MULTIPLIER = 2;
const BACKOFF_CAP_MS = 60_000;
const BACKOFF_MAX_ATTEMPTS = 10;

function backoffDelay(attempt: number): number {
  // attempt is 1-indexed: first retry uses delay at attempt=1
  const raw = BACKOFF_INITIAL_MS * Math.pow(BACKOFF_MULTIPLIER, attempt - 1);
  return Math.min(raw, BACKOFF_CAP_MS);
}
// Delays: 1s, 2s, 4s, 8s, 16s, 32s, 60s, 60s, 60s, 60s
```

**Backoff sleep using node:timers/promises:**
```typescript
import { setTimeout as sleep } from 'node:timers/promises';

// In the reconnect loop:
await sleep(backoffDelay(attempt));
```

### Pattern 4: Structured Error Response for Downed Accounts

**What:** When a tool call targets an account that is not in `connected` state, return a structured error without attempting any IMAP operation.

```typescript
// Source: CONTEXT.md decision
function getClientOrError(accountId: string): ImapFlow | { error: string } {
  const conn = this.connections.get(accountId);
  if (!conn) return { error: `account "${accountId}" is not configured` };

  const status = conn.getStatus();
  if (status.kind === 'connected') return status.client;
  if (status.kind === 'reconnecting') {
    return { error: `account "${accountId}" is unavailable (reconnecting, attempt ${status.attempt})` };
  }
  if (status.kind === 'failed') {
    return { error: `account "${accountId}" failed permanently: ${status.reason}` };
  }
  return { error: `account "${accountId}" is connecting` };
}
```

### Pattern 5: Graceful Shutdown

**What:** SIGTERM and SIGINT handlers close all connections before process exit.

```typescript
// Source: CONTEXT.md decision + imapflow API (logout() is graceful, close() is immediate)
async function shutdown(): Promise<void> {
  logger.info('Shutting down — closing IMAP connections');
  await Promise.allSettled(
    Array.from(connections.values()).map((conn) => conn.gracefulClose())
  );
  process.exit(0);
}

process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT',  () => { void shutdown(); });
```

Use `Promise.allSettled` (not `Promise.all`) so a failure on one account's `logout()` does not prevent others from closing.

In `AccountConnection.gracefulClose()`: if `status.kind === 'connected'`, call `await client.logout()`. Otherwise call `client.close()` (synchronous, no-op if not connected).

### Anti-Patterns to Avoid

- **Reusing an ImapFlow instance after close:** The maintainer explicitly states this is unsupported. Always `new ImapFlow()` on reconnect.
- **Calling `client.close()` without a `close` event listener already attached:** This can cause unhandled rejection in imapflow pre-1.2.13. Use the latest version and always wire listeners before calling `connect()`.
- **Putting ConnectionManager in module scope:** The CONTEXT.md decision requires it to be created in `main()` and injected — not a singleton.
- **Sharing a single ImapFlow connection across accounts:** The design is one connection per account, isolated.
- **Queuing or blocking tool calls during reconnect:** The decision is explicit — fail fast with a structured error during the reconnect window.
- **Emitting the `error` event without a listener:** imapflow extends Node.js `EventEmitter`. An unhandled `error` event kills the process. Always attach `client.on('error', ...)` before `client.connect()`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| IMAP protocol framing | Custom TCP socket parser | imapflow | IMAP has LITERAL+ literals, continuation responses, IDLE keep-alive — highly stateful |
| TLS handshake + cert validation | Raw `tls.connect()` wrapper | imapflow `secure: true` option | imapflow uses Node.js `tls` internally with correct defaults (TLSv1.2 min, rejectUnauthorized: true) |
| Connection health check | Polling `noop()` on a timer | imapflow `socketTimeout` + `close` event | imapflow's socket inactivity timeout handles dead connections; `close` fires automatically |

**Key insight:** The reconnect loop itself is hand-rolled (intentionally — imapflow delegates this to callers), but everything below the TCP/TLS/IMAP protocol layer is handled by imapflow.

## Common Pitfalls

### Pitfall 1: Reusing ImapFlow Instances After Disconnect
**What goes wrong:** Calling `connect()` on a previously disconnected `ImapFlow` instance throws `ERR_STREAM_WRITE_AFTER_END` or an "Unexpected close" error.
**Why it happens:** imapflow maintains significant internal state (parser position, capability cache, current mailbox UIDVALIDITY) that cannot be reset without constructing a new object.
**How to avoid:** In the reconnect loop, always discard the old instance and construct `new ImapFlow(options)`.
**Warning signs:** `ERR_STREAM_WRITE_AFTER_END` errors, `Unexpected close` errors immediately after calling `connect()`.

### Pitfall 2: Unhandled `error` Event Crashes Server
**What goes wrong:** If `ImapFlow` emits `error` and no listener is attached, Node.js throws an uncaught exception and crashes the process.
**Why it happens:** Node.js `EventEmitter` semantics: unhandled `error` events are fatal.
**How to avoid:** Wire `client.on('error', handler)` on every newly constructed ImapFlow instance before calling `client.connect()`.
**Warning signs:** Server exits with uncaught exception stack trace containing imapflow internals.

### Pitfall 3: Race Between `close` Event and Shutdown
**What goes wrong:** The `close` event fires during graceful shutdown, triggering a reconnect loop that schedules a new connection attempt while the process is exiting.
**Why it happens:** `logout()` or `close()` during shutdown fires the `close` event handler synchronously (or nearly so), which normally starts reconnect.
**How to avoid:** Use a `isShuttingDown` flag. Check it in the `close` event handler before starting the reconnect loop.
**Warning signs:** New connection attempts logged after "Shutting down" log message.

### Pitfall 4: `logout()` Throws on Already-Closed Connection
**What goes wrong:** Calling `logout()` on a connection that is already in a bad state throws an error (reported in imapflow issue #161, partially fixed in recent versions).
**Why it happens:** imapflow's LOGOUT command handler may reject if the socket is already closed.
**How to avoid:** In `gracefulClose()`, check `client.usable` before calling `logout()`. Fall back to `client.close()` if not usable. Wrap in try/catch regardless.
**Warning signs:** Error logged during shutdown: "Error thrown every time logout is called".

### Pitfall 5: Reconnect Loop Not Gated on `maxAttempts`
**What goes wrong:** A permanently unreachable server causes the reconnect loop to run indefinitely, logging noise and consuming resources.
**Why it happens:** Without a counter, every `close` event restarts the loop.
**How to avoid:** Increment an attempt counter in the reconnect loop. When `attempt > BACKOFF_MAX_ATTEMPTS`, transition to `failed` state and do not schedule another attempt.
**Warning signs:** Log output shows reconnect attempts continuing beyond expected cap, no `permanently failed` log entry.

### Pitfall 6: imapflow Internal Logs Polluting stdout
**What goes wrong:** imapflow's default logger uses `console.log`, which writes to stdout — contaminating the MCP JSON-RPC channel.
**Why it happens:** imapflow uses `pino` internally and defaults to logging to stdout.
**How to avoid:** Always pass `logger: false` in `ImapFlowOptions`. This disables imapflow's internal logging entirely.
**Warning signs:** JSON blobs appearing in stdout that are not MCP protocol messages; Claude/client sees malformed responses.

## Code Examples

### Constructing ImapFlow from AccountConfig
```typescript
// Source: imapflow lib/imap-flow.d.ts (verified from package 1.2.13)
import { ImapFlow, ImapFlowOptions } from 'imapflow';
import type { AccountConfig } from '../config/types.js';

function buildImapFlowOptions(account: AccountConfig): ImapFlowOptions {
  return {
    host: account.host,
    port: account.port,        // 993 enforced by Zod schema (CONF-03)
    secure: true,              // TLS required
    auth: {
      user: account.username,
      pass: account.password,
    },
    logger: false,             // suppress stdout pollution (CRITICAL)
    connectionTimeout: 30_000, // 30s — fail fast on unreachable hosts
    socketTimeout: 300_000,    // 5min inactivity (imapflow default)
  };
}
```

### Checking Connection Health
```typescript
// Source: imapflow lib/imap-flow.d.ts — usable: boolean property
if (client.usable) {
  // Safe to issue IMAP commands
} else {
  // Connection is down — return error to caller
}
```

### Safe Graceful Close
```typescript
// Source: imapflow lib/imap-flow.d.ts — logout(): Promise<void>, close(): void
async function gracefulClose(client: ImapFlow): Promise<void> {
  try {
    if (client.usable) {
      await client.logout();
    } else {
      client.close();
    }
  } catch (err) {
    // logout() can throw on already-closed connections (issue #161)
    // Log and continue — connection is effectively closed
    logger.warn(`Error during IMAP logout: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```

### Backoff Delay Calculation
```typescript
// Source: standard exponential backoff pattern; parameters per CONTEXT.md discretion
const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MULTIPLIER = 2;
const BACKOFF_CAP_MS = 60_000;
const BACKOFF_MAX_ATTEMPTS = 10;

function backoffDelayMs(attempt: number): number {
  // attempt: 1-indexed count of this reconnect attempt
  const raw = BACKOFF_INITIAL_MS * Math.pow(BACKOFF_MULTIPLIER, attempt - 1);
  return Math.min(raw, BACKOFF_CAP_MS);
}
// Sequence: 1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000, 60000
```

### Mocking ImapFlow in Vitest Unit Tests
```typescript
// Source: Vitest mocking guide (vitest.dev) — vi.mock for ESM modules
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// Mock factory: return an EventEmitter-based mock so tests can emit 'close'/'error'
vi.mock('imapflow', () => {
  const MockImapFlow = vi.fn().mockImplementation(() => {
    const emitter = new EventEmitter();
    return Object.assign(emitter, {
      connect: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      usable: true,
    });
  });
  return { ImapFlow: MockImapFlow };
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| node-imap (callback-based) | imapflow (async/await) | ~2020 | Clean async error handling, no callback hell |
| Manual TLS connection handling | imapflow `secure: true` | imapflow v1 | TLS cert validation and SNI handled correctly by default |
| Polling for connection health | `close` event + `socketTimeout` | imapflow v1 | Reliable drop detection without NOOP polling overhead |

**Deprecated/outdated:**
- `node-imap`: Last major update 2020, callback API, no active maintenance. Do not use.
- `@types/imapflow` on npm: Community stub, outdated relative to bundled types. Use bundled `lib/imap-flow.d.ts` directly.

## Open Questions

1. **Integration test server approach**
   - What we know: CONTEXT.md leaves this to Claude's discretion; unit tests cover state machine with mocks
   - What's unclear: Whether to use a Docker IMAP server (e.g., Greenmail, Dovecot) or test against a real IMAP account via env vars
   - Recommendation: Use env-var credentials approach (skip integration tests if `IMAP_TEST_*` env vars not set). This is simpler to set up, works in CI with secrets, and avoids Docker dependency. Greenmail is an option if offline testing is needed.

2. **Shutdown during active reconnect delay**
   - What we know: `setTimeout` promises can be cancelled with `AbortController` (node:timers/promises supports `signal` option)
   - What's unclear: Whether the plan should explicitly use AbortController to interrupt a sleeping backoff delay on shutdown, or just rely on `process.exit(0)` in the SIGTERM handler
   - Recommendation: Use an `AbortController` scoped to each `AccountConnection`. Abort it in `gracefulClose()` to interrupt any sleeping backoff delay immediately. This prevents delays of up to 60s on shutdown.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | `vitest.config.ts` (exists) |
| Quick run command | `npx vitest run tests/connections/` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONN-01 | ConnectionManager returns same ImapFlow client across multiple `getClient()` calls without reconnecting | unit | `npx vitest run tests/connections/account-connection.test.ts` | ❌ Wave 0 |
| CONN-01 | All accounts start connecting at startup before any tool call | unit | `npx vitest run tests/connections/connection-manager.test.ts` | ❌ Wave 0 |
| CONN-02 | `close` event triggers backoff reconnect loop with new ImapFlow instance | unit | `npx vitest run tests/connections/account-connection.test.ts` | ❌ Wave 0 |
| CONN-02 | Backoff delays increase exponentially up to cap | unit | `npx vitest run tests/connections/account-connection.test.ts` | ❌ Wave 0 |
| CONN-02 | After `BACKOFF_MAX_ATTEMPTS`, account transitions to `failed` state | unit | `npx vitest run tests/connections/account-connection.test.ts` | ❌ Wave 0 |
| CONN-03 | `getClient()` on failed account returns structured error; other accounts unaffected | unit | `npx vitest run tests/connections/connection-manager.test.ts` | ❌ Wave 0 |
| CONN-03 | Exception in one account's connect loop does not propagate to manager | unit | `npx vitest run tests/connections/connection-manager.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/connections/`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/connections/account-connection.test.ts` — covers CONN-01, CONN-02 state machine
- [ ] `tests/connections/connection-manager.test.ts` — covers CONN-01, CONN-03 isolation
- [ ] `src/connections/account-connection.ts` — implementation file (new)
- [ ] `src/connections/connection-manager.ts` — implementation file (new)
- [ ] `src/connections/index.ts` — re-exports (new)
- [ ] Framework: `npm install imapflow` — imapflow not yet in package.json

## Sources

### Primary (HIGH confidence)
- imapflow npm package v1.2.13 `lib/imap-flow.d.ts` — extracted directly via `npm pack`; authoritative TypeScript API
- imapflow GitHub releases page — v1.2.13 confirmed latest (March 9, 2026)
- imapflow official docs (imapflow.com/docs/api/imapflow-client/) — constructor options, events, lifecycle

### Secondary (MEDIUM confidence)
- GitHub issue #63 (postalsys/imapflow) — maintainer statement: "ImapFlow objects have a lot of state so they can't be reused. You need to create a new object yourself whenever an old object disconnects."
- GitHub issue #15 (postalsys/imapflow) — maintainer: "ImapFlow is built in way where the client is not reusable. Once it closes, it is done, you have to create a new ImapFlow object"
- Vitest docs (vitest.dev/guide/mocking) — `vi.mock()` pattern for ESM module mocking

### Tertiary (LOW confidence)
- WebSearch aggregation on imapflow reconnect patterns — used for corroboration only; primary facts sourced from official docs and package files

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — imapflow version verified from npm registry and package contents; bundled .d.ts extracted directly
- Architecture: HIGH — imapflow API confirmed from type definitions; state machine pattern is standard; decisions locked in CONTEXT.md
- Pitfalls: HIGH — maintainer-confirmed constraints (non-reusable instances, unhandled error event behavior); recent changelog confirms close/race fixes in 1.2.12-1.2.13
- Backoff parameters: MEDIUM — sensible defaults derived from common patterns; exact values are Claude's discretion per CONTEXT.md

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (imapflow API is stable; backoff conventions are mature)
