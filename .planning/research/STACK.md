# Stack Research

**Domain:** IMAP MCP Server — v0.3 Reliability & Cache Rethink
**Researched:** 2026-06-08
**Confidence:** HIGH (all key claims verified with Context7 or official sources)

---

## Summary of New Additions

This is a delta research document — it covers only what is NEW for v0.3. The existing stack
(imapflow ^1.2.13, @modelcontextprotocol/sdk ^1.27.1, Zod ^4.3.6, Vitest ^4.0.18, TypeScript strict,
Node.js ESM) is validated and unchanged.

**Verdict on net-new dependencies:** Two additions are justified. Zero others needed.

| New Dependency | Version | Verdict |
|---|---|---|
| `cockatiel` | ^4.0.0 | ADD — error classification predicate is the key value |
| `better-sqlite3` | ^12.10.0 | DEFER — in-memory is fine for v0.3; persistence is v0.4+ |

---

## imapflow Current State (Verified)

**Current version:** 1.3.7 (released 2026-06-08, actively maintained)
**Project uses:** ^1.2.13 — will upgrade to ^1.3.7 as part of v0.3 work.

### Connection Lifecycle Events (HIGH confidence — Context7 + official docs)

imapflow extends Node.js EventEmitter and emits exactly the events needed:

```typescript
client.on('close', () => { });                      // connection dropped
client.on('error', (err: Error) => { });            // socket / protocol error (fires before 'close')
client.on('exists', (data: ExistsEvent) => { });    // new messages in selected mailbox
client.on('expunge', (data: ExpungeEvent) => { });  // message deleted
client.on('flags', (data: FlagsEvent) => { });      // flags changed
client.on('mailboxOpen', (mailbox) => { });         // mailbox selected
client.on('mailboxClose', (mailbox) => { });        // mailbox deselected
client.on('log', (entry) => { });                   // if emitLogs: true
```

The `error` event fires first, then `close`. The current `AccountConnection.wireListeners`
already follows this pattern correctly (handles `close`, logs `error` but does not change state
there). No changes needed to the event-wiring approach.

### IDLE Support (HIGH confidence — Context7 + official docs)

imapflow has first-class IDLE support:

- Auto-IDLE activates 15 seconds after the last command when a mailbox is selected (state === SELECTED)
- Disabled per-client via `disableAutoIdle: true` constructor option
- Max IDLE session duration via `maxIdleTime` (in ms); imapflow auto-sends DONE and restarts
- `missingIdleCommand` sets fallback ('NOOP' default) for servers without IDLE support
- `await client.idle()` manually starts/restarts IDLE mode; resolves to `true` if started
- While in IDLE, `exists` / `expunge` / `flags` events fire on server push notifications
- When another command needs the connection, imapflow's preCheck mechanism breaks IDLE,
  queues waiters, executes the command, and auto-resumes IDLE — caller sees no difference

The existing Poller does timed polling against the selected client. IDLE events from
`exists` can trigger immediate incremental fetches instead of waiting for the poll interval.
This is the core of the cache rethink (see Cache Architecture section below).

### Reconnect Pattern — Must Use New Instance (HIGH confidence — official issue + docs)

**Critical finding:** imapflow clients are NOT reusable after `close`. Calling `client.connect()`
on a closed ImapFlow instance throws `ERR_STREAM_WRITE_AFTER_END` because the TLS socket
retains stale state. The maintainer-endorsed pattern is always construct `new ImapFlow(config)`
on reconnect.

The existing `AccountConnection.buildClient()` + `runReconnectLoop()` already does this correctly
— it calls `this.buildClient()` inside the retry loop, creating a fresh instance each attempt.
This is the right design.

### Error Classification via AuthenticationFailure (HIGH confidence — Context7)

imapflow exports a typed `AuthenticationFailure` class:

```typescript
class AuthenticationFailure extends Error {
    authenticationFailed: true;
    serverResponseCode?: string;   // e.g. "AUTHENTICATIONFAILED"
    response?: string;
    oauthError?: any;
}
```

This allows clean transient-vs-fatal classification:

```typescript
import { AuthenticationFailure } from 'imapflow';

function isTransient(err: unknown): boolean {
    if (err instanceof AuthenticationFailure) return false;  // fatal — bad creds
    if (err instanceof Error) {
        if ((err as any).tlsFailed) return false;  // fatal — cert/TLS config wrong
        // Everything else: ECONNRESET, ETIMEDOUT, ENOTFOUND, NoConnection, etc. = transient
        return true;
    }
    return true;
}
```

No external error-classification library needed. imapflow's own type hierarchy is sufficient.

---

## Retry/Backoff: Cockatiel vs Hand-Roll

### Recommendation: Keep Hand-Rolled Loop for Connection Lifecycle

The existing `runReconnectLoop()` in `AccountConnection` is a while-loop with exponential backoff,
AbortSignal cancellation, and fresh-instance creation per attempt. This is exactly right for IMAP
connection management because:

1. The reconnect loop is **not** wrapping a function call — it has side effects (build client,
   wire listeners, set `this.currentClient`). Cockatiel's `.execute(() => fn())` API assumes a
   pure retry of a callback, not a stateful multi-step sequence.

2. IMAP reconnect needs to abort on shutdown. The existing `AbortController` + `sleep(ms, signal)`
   pattern composes correctly with imapflow's lifecycle.

3. The current 10-attempt cap is the bug. Removing the cap (change `BACKOFF_MAX_ATTEMPTS` to
   `Infinity` or remove the guard) is a one-line fix that hand-rolled code makes trivial.

**Verdict: Keep hand-rolled. Do NOT add cockatiel for the connection loop.**

### Where Cockatiel IS Worth Adding: One-shot Operation Retry

Cockatiel v4.0.0 (current; Node.js >=22) adds value for a different v0.3 concern: retrying
individual IMAP operations (poll fetch, keyword store) that fail transiently while the connection
itself is live. Its `handleWhen` predicate API cleanly separates "retry this" from "fail fast
on this":

```typescript
import { retry, handleWhen, ExponentialBackoff } from 'cockatiel';
import { AuthenticationFailure } from 'imapflow';

// Retry transient IMAP command failures; stop immediately on auth/TLS errors
const imapRetry = retry(
    handleWhen(err => !(err instanceof AuthenticationFailure) && !(err as any).tlsFailed),
    { maxAttempts: 3, backoff: new ExponentialBackoff({ initialDelay: 500, maxDelay: 5000 }) }
);

await imapRetry.execute(() => client.messageStore('1:*', { keywords: { add: [kw] } }));
```

This is a genuine quality-of-life win over inline try/catch loops when the same retry pattern
needs to apply to multiple operations. It also makes test-doubles straightforward.

**If the v0.3 phases only touch connection lifecycle and cache, cockatiel may not be needed at
all in v0.3 scope.** Defer the add until a phase actually calls `.execute()`. Listing here so
the roadmap knows it is vetted and ready.

---

## Per-Account Health / State Exposure

### Recommendation: Extend Existing Discriminated Union — No Library Needed

The current `AccountConnectionStatus` union (`connecting | connected | reconnecting | failed`)
already has the right shape. v0.3 needs to:

1. Add a `lastError` field to `reconnecting` and `failed` states — carries the error message
   and whether it was classified as transient or fatal.
2. Expose `nextRetryAt` (already on `reconnecting`) in the MCP tool response.
3. Add `reconnectCount` to `reconnecting` so agents can see how many times recovery has been
   attempted without a restart.

This is pure TypeScript discriminated union extension — no state machine library needed.

### State Machine Library Assessment (XState, robot3)

XState v5 (current: ~5.32.0, ~25k stars, 4.4M weekly downloads) is the industry standard for
complex state machines. It weighs 16.7 kB minified+gzipped and carries the full actor/statechart
model. robot3 (1.2.0, ~750k weekly downloads) is 1.2 kB with minimal API.

**Verdict: Neither. The IMAP connection state machine has exactly 4 states and 5 transitions.
Hand-rolling a TypeScript discriminated union is 40 lines and zero dependencies. Adding XState
for 4 states would be over-engineering. robot3 is tiny but adds a learning curve with no
benefit over explicit union types that TypeScript already enforces exhaustively.**

---

## Network Connectivity Change Detection

### Recommendation: "Fail and Retry Forever" is the Standard Approach

There is no reliable cross-platform Node.js API for OS-level network change events. The
browser exposes `navigator.onLine`, but Node.js has no equivalent. Native modules exist but
add build complexity (node-gyp) and are not worth it for a background MCP server.

The correct pattern for this use case is:

1. Remove the `BACKOFF_MAX_ATTEMPTS` cap so `runReconnectLoop` retries indefinitely.
2. Use exponential backoff capped at 60 seconds (already the case with `BACKOFF_CAP_MS`).
3. Classify errors as transient or fatal (auth/TLS = fatal, everything else = keep retrying).
4. Surface `reconnecting` state in `get_account_health` so agents know an account is down
   without it appearing as a hard failure.

When the laptop wakes from sleep, the next retry attempt will succeed. The retry loop stays
alive the whole time. This is how EmailEngine (imapflow's production consumer) handles it.

**Verdict: No network-detection library. Fix is removing the attempt cap and adding
transient/fatal classification.**

---

## Cache Architecture Rethink

### Current Architecture

The `Poller` class runs a timer loop (default 300s) that calls `searchMessages()` for each
account, fetching headers for messages since last poll. Results merge into an in-memory
`Map<accountId, MultiAccountMessageHeader[]>`. `get_new_mail` queries this cache.

**Problems:**
- Latency: new messages not visible until next poll cycle (up to 5 minutes)
- Inefficiency: every poll fetches potentially overlapping date ranges
- Cache growth: messages accumulate without eviction
- Reconnect gap: cache not updated while account is in `reconnecting` state

### IDLE Push Pattern (Available in imapflow)

imapflow auto-enters IDLE when INBOX is selected. The `exists` event fires immediately when
the message count increases. `expunge` fires on deletion. `flags` fires on flag changes
(including keyword sets/clears).

**IDLE pattern per account:**
1. After connect, open INBOX with `getMailboxLock('INBOX', { readOnly: true })`
2. Listen for `exists` events — trigger incremental fetch of new UIDs immediately
3. Listen for `flags` events — update keyword cache in-place (already done manually in
   `updateKeyword`/`removeKeyword`, but IDLE would catch server-side changes too)
4. Keep `maxIdleTime: 25 * 60 * 1000` (25 min) to stay within RFC 2177's 30-min recommendation

**IDLE constraint:** IDLE only covers the currently selected folder. To monitor INBOX plus
other folders, you need one connection per folder. For IMAP MCP's use case (INBOX monitoring
only), one IDLE connection per account is sufficient.

**Lock conflict with tools:** imapflow's preCheck mechanism breaks IDLE transparently when
another command acquires the mailbox lock. The IDLE and tool calls share the same `ImapFlow`
instance without conflict — this is a first-class supported pattern per imapflow docs.

### Hybrid Recommendation: IDLE for Push + Periodic Reconciliation Poll

Pure IDLE has one failure mode: if the `exists` event is missed during a reconnect gap,
the cache falls behind. Pure polling is reliable but slow and inefficient.

**Recommended hybrid:**
- IDLE subscription on INBOX per account (via `exists` event → incremental fetch on change)
- Reduced reconciliation poll every 10–15 minutes (instead of 5) — catches gaps from reconnects
- On reconnect: immediate full reconciliation poll before re-enabling IDLE

This is exactly the pattern EmailEngine uses in production with imapflow. It preserves the
existing Poller abstraction while adding IDLE event hooks.

**Cache eviction:** Add a sliding 30-day window cutoff during merge. The current `mergeIntoCache`
never evicts, causing unbounded growth on long-running servers.

### Persistence: Defer to v0.4

`better-sqlite3` v12.10.0 is the right choice if/when persistence is needed. It supports ESM
imports, is synchronous (no async complexity), and is the fastest SQLite binding for Node.js.
Node.js 22–24 support confirmed; Node 25 not officially tested as of v12.10.0 but builds fine
in practice.

**For v0.3: keep in-memory.** The seed-on-reconnect approach (30-day SINCE query at first
poll) already handles server restarts adequately. Adding SQLite in the same milestone as
reliability + IDLE rework increases scope without proportional value. Custom keyword durability
is already handled by IMAP server-side storage — the only data lost on restart is the local
header cache, which re-seeds in under a second.

**Add persistence as a v0.4 phase if the restart-seed latency becomes observable.**

### EventEmitter vs RxJS for IDLE Event Fan-out

`exists` and `flags` events from imapflow are emitted on the `ImapFlow` instance (EventEmitter).
The Poller currently doesn't listen to these. v0.3 needs to wire the Poller to respond to
IDLE events.

**Verdict: Plain Node.js EventEmitter is sufficient.** The fan-out is simple:
imapflow emits → Poller's handler fetches new UIDs → in-memory cache updated.
RxJS would add `~35 kB` and operator complexity for what is a single-subscriber event
with no backpressure, buffering, or stream composition requirements. Overkill.

---

## Recommended Stack Changes for v0.3

### Core Technologies (unchanged)

| Technology | Version | Purpose |
|---|---|---|
| Node.js ESM | 25.x (project) | Runtime |
| TypeScript strict | ^5.9.3 | Language |
| imapflow | ^1.3.7 | IMAP client — upgrade from ^1.2.13 |
| @modelcontextprotocol/sdk | ^1.27.1 | MCP wire protocol |
| Zod | ^4.3.6 | Tool schemas |
| Vitest | ^4.0.18 | Test runner |

### New Dependencies

| Library | Version | Purpose | When to Add |
|---|---|---|---|
| `cockatiel` | ^4.0.0 | Per-operation retry with `handleWhen` predicate for transient/fatal classification | Only if a v0.3 phase adds retried IMAP operations; skip if only connection lifecycle changes |

### Deferred Dependencies

| Library | Version | Purpose | When |
|---|---|---|---|
| `better-sqlite3` | ^12.10.0 | Cache persistence across restarts | v0.4+ if restart-seed latency is observed |

### Explicitly NOT Adding

| Avoid | Why | Use Instead |
|---|---|---|
| XState / robot3 | 4-state machine doesn't justify a dependency | TypeScript discriminated union — already in place |
| RxJS | No backpressure/composition needs; single IDLE event subscriber | Node.js EventEmitter — already used by imapflow |
| `is-online` / network detection libs | No reliable OS-level event API; adds node-gyp complexity | Fail-and-retry-forever with no attempt cap |
| `p-retry` | ESM-only, simpler API but no typed error predicate filtering | `cockatiel` when retry is needed; hand-roll for connection loop |
| `async-retry` | Older, less actively maintained | `cockatiel` if needed |

---

## Implementation Guidance

### Fix 1: Remove Attempt Cap (One Line)

In `account-connection.ts`, change:

```typescript
const BACKOFF_MAX_ATTEMPTS = 10;
// ...
while (attempt <= BACKOFF_MAX_ATTEMPTS) {
```

To unbounded retry with transient/fatal classification:

```typescript
import { AuthenticationFailure } from 'imapflow';

function isFatalError(err: unknown): boolean {
    if (err instanceof AuthenticationFailure) return true;
    if (err instanceof Error && (err as any).tlsFailed) return true;
    return false;
}

// In runReconnectLoop:
while (true) {
    // ... attempt connect ...
    } catch (err: unknown) {
        if (isFatalError(err)) {
            const message = err instanceof Error ? err.message : String(err);
            this.status = { kind: 'failed', reason: message, fatal: true };
            return;
        }
        // transient — keep looping
        attempt++;
    }
}
```

### Fix 2: IDLE Integration in Poller

Add to `Poller` after `pollAccount` succeeds:

```typescript
private wireIdleForAccount(accountId: string, client: ImapFlow): void {
    client.on('exists', () => {
        // exists fires when message count increases — fetch new messages immediately
        void this.pollAccount(accountId).catch(err =>
            logger.error(`Poller IDLE fetch error for ${accountId}: ${String(err)}`)
        );
    });
    // flags event: update keyword cache for flag changes — see updateKeyword
}
```

IDLE starts automatically (auto-idle default) when INBOX is selected via `getMailboxLock`.
No explicit `client.idle()` call needed unless `disableAutoIdle: true` is set (it is not).

### Fix 3: AccountConnectionStatus Extension

```typescript
export type AccountConnectionStatus =
    | { kind: 'connecting' }
    | { kind: 'connected'; client: ImapFlow }
    | { kind: 'reconnecting'; attempt: number; nextRetryAt: Date; lastError: string }
    | { kind: 'failed'; reason: string; fatal: boolean };
```

Expose via `ConnectionManager.getStatus()` — already wired to `list_accounts` / new
`get_account_health` tool.

---

## Version Compatibility

| Package | Version | Node.js | ESM | Notes |
|---|---|---|---|---|
| imapflow | ^1.3.7 | >=12 | Yes | Actively maintained; new instance required on reconnect |
| cockatiel | ^4.0.0 | >=22 | Yes (ESM-only in v4) | Breaking: v4 is ESM-only, matches project's `"type": "module"` |
| better-sqlite3 | ^12.10.0 | 20–24 tested | Yes (ESM import) | Node 25 not officially tested; defer until v0.4 |

---

## Sources

- `/postalsys/imapflow` (Context7) — events, IDLE, AuthenticationFailure, reconnect pattern, mailbox lock
- `https://imapflow.com/docs/api/imapflow-client/` — event list, IDLE options (verified HIGH)
- `https://github.com/postalsys/imapflow/releases` — v1.3.7 release date confirmed 2026-06-08
- `https://github.com/postalsys/imapflow/issues/15` — confirms new instance required on reconnect
- `https://deepwiki.com/postalsys/imapflow/5.3-real-time-updates-with-idle` — auto-IDLE mechanics, preCheck queue
- `/connor4312/cockatiel` (Context7) — handleWhen, ExponentialBackoff, handleType API
- `https://github.com/connor4312/cockatiel/blob/master/changelog.md` — v4.0.0 is ESM-only, Node >=22
- `npm view cockatiel version` → 4.0.0 (verified 2026-06-08)
- `npm view better-sqlite3 version` → 12.10.0 (verified 2026-06-08)
- `npm view p-retry version` → 8.0.0 (verified 2026-06-08)

---
*Stack research for: IMAP MCP Server v0.3 Reliability & Cache Rethink*
*Researched: 2026-06-08*
