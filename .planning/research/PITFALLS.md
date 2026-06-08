# Pitfalls Research

**Domain:** IMAP MCP Server — Adding Resilience & Cache Rethink to a Live Agent-Facing System
**Researched:** 2026-06-08
**Confidence:** HIGH (core connection/IDLE pitfalls verified via imapflow GitHub issues, RFC 5530, Thunderbird keepalive bug; cache pitfalls verified against codebase inspection)

---

## Critical Pitfalls

### Pitfall 1: TCP Half-Open After Laptop Sleep — Connection Looks Alive But Is Dead

**What goes wrong:**
After laptop sleep/hibernate or a Wi-Fi change, the OS suspends network activity. The TCP connection to the IMAP server is silently dropped by a NAT router or stateful firewall — the router removes the connection record and sends no FIN/RST. When the laptop wakes, the `ImapFlow` client has `usable: true`, the socket object still exists, but the next `getMailboxLock` or any IMAP command hangs indefinitely — it never throws, never resolves. This is the root cause of the original "accounts permanently fail after laptop sleep / Wi-Fi change" bug documented in PROJECT.md.

**Why it happens:**
Node.js TCP sockets default to `keepAlive: false`. Without OS-level keepalive probes, neither party detects the dead transport. `imapflow`'s `socketTimeout` (currently configured at `300_000` ms in `account-connection.ts`) is the only safeguard, but it only fires on *inactivity* after 5 minutes — which is fine for gradual silence but useless if the machine just woke from a 30-minute nap and the socket reads as "open". The `close` event that triggers `runReconnectLoop` in `AccountConnection` never fires because the OS thinks the socket is still live. The `imapflow` issue #27 (confirmed) documents this exact failure: "commands do never return or throw after connection troubles."

**How to avoid:**
Enable TCP keepalive in `buildClient()`:
```typescript
new ImapFlow({
  host: ...,
  port: ...,
  secure: true,
  auth: { ... },
  socketOptions: {
    keepAlive: true,
    keepAliveInitialDelay: 60_000, // start probing after 60s idle
  },
  connectionTimeout: 30_000,
  socketTimeout: 90_000, // reduce from 300s — forces close sooner on dead sockets
})
```
Reducing `socketTimeout` from 300s to 90s is the single highest-leverage change: it limits the window between a real failure and the `close` event that triggers `runReconnectLoop`. Combined with TCP keepalive (which sends OS-level probes every ~60s), dead connections surface within ~2 minutes instead of potentially never. Thunderbird's implementation (Bug 1535969) uses 100s idle time, 5s retry interval, 4 probes — meaning broken connections resolve within ~120s. This codebase should target the same order of magnitude.

**Warning signs:**
- Agent tool calls hang without returning an error (commands that never reject)
- `getStatus()` returns `{ kind: "connected" }` but subsequent IMAP ops time out
- No `close` events appear in logs for >5 minutes after a known network interruption
- Tests pass but the behavior fails after laptop wake (see test strategy below)

**Test strategy:**
In Vitest, emit the `error` event followed by `close` on the mock client to simulate what a dead socket eventually triggers. There is no way to fake a half-open TCP connection in unit tests — integration test via a real IMAP server with `iptables -I OUTPUT -d <imap-host> -j DROP` or a proxy that drops packets. Document this as a mandatory manual repro: configure the account, let it connect, sleep the test machine, wake, verify `runReconnectLoop` fires within `socketTimeout` + 5s.

**Phase to address:** Connection Lifecycle phase (first v0.3 phase). The `buildClient()` change is one block; the `socketTimeout` reduction is one line. Both must land together.

---

### Pitfall 2: Concurrent Reconnect Triggered by Both `close` and `error` Events

**What goes wrong:**
`wireListeners` attaches `on('close', ...)` and `on('error', ...)` to each `ImapFlow` instance. If a server closes a connection with an error, imapflow emits `error` and then `close` in sequence. The current `wireListeners` in `account-connection.ts` guards against double-reconnect by checking `this.status.kind === "reconnecting"` before starting the loop — but this guard is race-prone: if the event loop processes both events in the same microtask batch before the status write from `runReconnectLoop` is visible, two reconnect loops can start simultaneously. imapflow GitHub issue #41 documents a related pattern: using a client that hasn't been fully cleaned up causes `ERR_STREAM_WRITE_AFTER_END`.

**Why it happens:**
Node.js EventEmitter events are synchronous by default. `on('close')` fires synchronously after `on('error')`. The `runReconnectLoop()` call at the end of the `close` handler is `async` — the status write inside `runReconnectLoop` doesn't happen until after the event loop yields. If anything causes `close` to fire twice (network blip, then server IDLE timeout), the guard check `this.status.kind === "reconnecting"` may be evaluated before the first loop has written its status.

**How to avoid:**
Replace the status-check guard with a single boolean flag:
```typescript
private reconnectInFlight: boolean = false;

// In close handler:
if (this.reconnectInFlight || this.isShuttingDown) return;
this.reconnectInFlight = true;
void this.runReconnectLoop().finally(() => { this.reconnectInFlight = false; });
```
This flag is written synchronously before yielding to the event loop, making the guard race-free. The existing `abortController` approach is also needed for gracefulClose interruption — keep both.

**Warning signs:**
- Logs show two simultaneous "Reconnecting attempt 1/10" entries for the same account
- `MockImapFlow.mock.calls.length` grows by 2 per reconnect event in tests (instead of 1)
- Memory growth: two reconnect loops each holding references to their own `AbortController` and `ImapFlow` instance

**Test strategy:**
In `account-connection.test.ts`: emit `close` twice in rapid succession from the same connected client; assert `MockImapFlow` was constructed exactly once during the reconnect window. Use `vi.advanceTimersByTimeAsync(0)` between the two emits to flush the microtask queue and expose the race.

**Phase to address:** Connection Lifecycle phase. Add the `reconnectInFlight` guard alongside the `socketTimeout` reduction.

---

### Pitfall 3: Retry Storm — All Accounts Reconnect Simultaneously With No Jitter

**What goes wrong:**
The current `backoffDelayMs` function is deterministic: `min(1000 * 2^(attempt-1), 60000)`. With two accounts, both emit `close` at the same time (e.g., server restart, Wi-Fi drop), and both schedule their first reconnect at exactly `t+1000ms`, second attempt at `t+3000ms`, etc. Against a recovering server, this synchronized hammering can trigger rate limits or prolong the outage. Against a home IMAP server, it may not matter — but the pattern is structurally wrong and becomes a problem as account count grows.

**Why it happens:**
Jitter is a deliberate design choice that must be added intentionally. The current implementation omits it because it wasn't needed for a single-account scenario and the original code was written before multi-account retry behavior was considered a risk.

**How to avoid:**
Add full jitter to `backoffDelayMs`:
```typescript
function backoffDelayMs(attempt: number): number {
  const raw = BACKOFF_INITIAL_MS * Math.pow(BACKOFF_MULTIPLIER, attempt - 1);
  const capped = Math.min(raw, BACKOFF_CAP_MS);
  return Math.floor(Math.random() * capped); // full jitter: [0, capped)
}
```
Full jitter (not "equal jitter") gives the best throughput under load (AWS exponential backoff with jitter reference). For this codebase, `BACKOFF_CAP_MS` of 120s is more appropriate than 60s for IMAP — IMAP servers are not HTTP APIs and may stay down for several minutes during maintenance windows.

**Warning signs:**
- Logs show every account hitting attempt 1 at the same millisecond after a network drop
- Server logs (if accessible) show synchronized AUTH bursts
- Test: `vi.advanceTimersByTimeAsync(1000)` advances all accounts' timers identically — all hit at once

**Test strategy:**
Mock `Math.random` to return 0 and 1 to verify the jitter range. In integration tests, simulate simultaneous `close` on all account clients and assert the reconnect attempts are desynchronized (non-identical delay times). Unit test: verify `backoffDelayMs` returns different values on repeated calls when `Math.random` is not mocked.

**Phase to address:** Connection Lifecycle phase. One-line change to `backoffDelayMs`, plus increasing `BACKOFF_CAP_MS` to 120s.

---

### Pitfall 4: Auth Failures Classified as Transient — Infinite Retries Against a Locked Account

**What goes wrong:**
`runReconnectLoop` retries all connection failures identically, including auth failures. An expired password, revoked App Password, or account locked due to abuse signals will trigger 10 sequential auth attempts, all of which fail with the same `NO [AUTHENTICATIONFAILED]` response — burning through retries, generating server-side failure logs, and potentially triggering account lockout. After all 10 attempts, the account enters `{ kind: "failed" }` permanently and the user must restart the server — but by then the account may be temp-banned by the server.

**Why it happens:**
The error thrown by `client.connect()` during auth failure is a JavaScript `Error` object with a message string — there is no structured error type in imapflow that distinguishes auth failures from network failures without parsing the message or checking a `code` property.

**How to avoid:**
Inspect the thrown error before incrementing the retry counter. imapflow throws errors with a `responseCode` property for server-response errors (type `ImapResponseError` or similar — verify in imapflow source). Classify as fatal immediately for:
- Response codes matching `AUTHENTICATIONFAILED`, `PRIVACYREQUIRED`, `LOGINDISABLED` (RFC 5530)
- Error message matching patterns: `/"NO.*authenti/i`, `/"BAD.*command/i`
```typescript
function isFatalConnectError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes("authentication failed") ||
    msg.includes("invalid credentials") ||
    msg.includes("login failed") ||
    msg.includes("authenticationfailed") ||
    (err instanceof Error && "responseCode" in err && 
      ["authenticationfailed", "privacyrequired", "logindisabled"].includes(
        String((err as Record<string, unknown>).responseCode).toLowerCase()
      ))
  );
}
```
If `isFatalConnectError` returns true, skip the retry loop and transition directly to `{ kind: "failed", reason: "Authentication failed — check credentials" }`.

**Warning signs:**
- Logs show 10 consecutive "Reconnect attempt N failed: authentication failed" for the same account
- Account transitions to `failed` after exhausting all attempts (instead of immediately)
- Time between first auth failure and `failed` state is `sum(backoff delays)` ≈ 2 minutes

**Test strategy:**
In `account-connection.test.ts`: mock `client.connect()` to reject with `new Error("A1 NO [AUTHENTICATIONFAILED] Login failed.")`. Assert that `getStatus().kind === "failed"` after the FIRST attempt (attempt 0 or 1), not after 10. Assert `MockImapFlow.mock.calls.length === 1` (no retries). Contrast with network error test where retries do occur.

**Phase to address:** Transient vs. Fatal Classification phase (second v0.3 phase). The classification function should be co-located with `runReconnectLoop` in `account-connection.ts`.

---

### Pitfall 5: TLS Errors Misclassified — Always Fatal or Always Transient

**What goes wrong:**
TLS handshake errors span both categories. `CERT_HAS_EXPIRED` is fatal and should never retry. `CERT_UNTRUSTED` during an intermediate CA rotation may be transient (the cert propagates within minutes). An HSTS or certificate pinning violation is permanent. A `DEPTH_ZERO_SELF_SIGNED_CERT` is permanently fatal for production deployments. Treating all TLS errors as transient causes infinite retries against a server whose cert is truly expired; treating them all as fatal breaks accounts during legitimate CA rotations.

**Why it happens:**
TLS errors are `Error` objects with a `code` property set by the Node.js TLS module. Teams often check only `err.message` rather than `err.code`, or apply a single "TLS error = fatal" rule without considering the intermediate CA rotation case.

**How to avoid:**
Classify by `err.code` (from Node.js TLS constants):
- Immediately fatal: `CERT_HAS_EXPIRED`, `ERR_TLS_CERT_ALTNAME_INVALID`, `DEPTH_ZERO_SELF_SIGNED_CERT`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`
- Transient (retry up to 3 attempts only, then fail): `CERT_UNTRUSTED`, `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`
- Treat `UNABLE_TO_GET_INTERMEDIATE_CERT` as transient with short cap (3 retries, 30s max backoff)

The key implementation detail: pass `tls_cert_error_codes` through the same `isFatalConnectError` function with a secondary boolean for "retry-limited fatal."

**Warning signs:**
- Logs showing TLS error followed by 10 retries (all identical) — a transient-misclassified fatal
- Account never recovering after an intermediate CA renewal that took 5 minutes — a fatal-misclassified transient
- `CERT_HAS_EXPIRED` appearing in logs with "Reconnect attempt 2" — should have stopped at 1

**Test strategy:**
Mock `client.connect()` to reject with `Object.assign(new Error("Certificate has expired"), { code: "CERT_HAS_EXPIRED" })`. Assert immediate transition to `failed`. For the transient TLS case, mock `CERT_UNTRUSTED` and assert retries occur but cap at 3 regardless of `BACKOFF_MAX_ATTEMPTS`.

**Phase to address:** Transient vs. Fatal Classification phase.

---

### Pitfall 6: The Poller Cache `mergeIntoCache` Never Evicts — Unbounded Memory Growth

**What goes wrong:**
`mergeIntoCache` in `poller.ts` only ever appends to the cache — deduplication prevents duplicates but nothing ever removes stale entries. A long-running server with an account that receives 100 messages/day will accumulate ~3,000 entries per month with no bound. Keyword arrays on each entry add additional per-message overhead. At scale (6 months, 18,000 entries per account, 3 accounts = 54,000 objects), this becomes a memory pressure source and linear-scan queries slow noticeably.

**Why it happens:**
The cache was designed for "seed: last 30 days, then incremental" but has no corresponding eviction of entries older than the seed window. The two concerns — adding new entries and removing old entries — were implemented independently; eviction was never implemented.

**How to avoid:**
Add a cache trim step in `mergeIntoCache` (or as a separate method called after each poll):
```typescript
private trimCache(accountId: string): void {
  const cutoff = Date.now() - CACHE_RETENTION_MS; // e.g., 30 * 24 * 60 * 60 * 1000
  const entries = this.cache.get(accountId);
  if (!entries) return;
  this.cache.set(accountId, entries.filter(m => new Date(m.date).getTime() >= cutoff));
}
```
`CACHE_RETENTION_MS` should match the seed window (30 days) so the cache never holds more than `~maxResults * accounts` entries. Trim after each merge, not before (avoids evicting something just added).

**Warning signs:**
- `poller.query(new Date(0).toISOString()).results.length` grows without bound in integration tests
- Node.js `process.memoryUsage().heapUsed` increasing steadily over days in production
- Query latency increasing as the linear `.filter()` scan grows

**Test strategy:**
In `poller.test.ts`: run 1000 poll cycles with mock messages dated 31+ days ago. Assert `poller.query(new Date(0).toISOString()).results.length` stays bounded (< `maxResults * accountCount`). Check `process.memoryUsage()` before and after.

**Phase to address:** Cache Architecture phase.

---

### Pitfall 7: Cache Divergence — `get_new_mail` and `list_messages` Show Different Truths

**What goes wrong:**
`get_new_mail` queries the in-memory `Poller` cache. `list_messages` issues a live IMAP `SEARCH` against the server. If a message was flagged with `ClaudeProcessed` via `flag_message`, `Poller.updateKeyword` updates the cache immediately. But if the agent calls `list_messages` before the poller's next poll, the live IMAP data and the cache are in sync because keywords are stored server-side. However, if messages were moved, deleted, or expired from the server between polls, `get_new_mail` returns entries that no longer exist, while `list_messages` shows the actual state. The agent sees two conflicting truths in the same session.

**Why it happens:**
The cache is poll-driven with a 5-minute default interval. Any server-side change between polls (deletion, folder move, server expunge) creates a divergence window. The cache has no mechanism to invalidate individual entries when the underlying message disappears.

**How to avoid:**
Two complementary strategies:
1. **Staleness declaration in tool responses**: Add `cache_age_seconds` to `get_new_mail` responses (derived from `Date.now() - this.lastPollTime.getTime()`). Agents can decide whether to trust the cache or issue a fresh `list_messages`. This is the minimum viable fix.
2. **On-demand freshness option**: Add a `fresh: boolean` option to `get_new_mail` that bypasses the cache and issues a live IMAP search. The poller cache remains for the common case; `fresh: true` is for real-time decisions.

The cache-vs-IMAP divergence is structural and cannot be eliminated without IMAP IDLE or on-demand polling. The goal is to make the divergence visible to the agent, not to hide it.

**Warning signs:**
- Agent decision based on `get_new_mail` returns a UID that `read_message` cannot find (`NO [NONEXISTENT]` from server)
- `list_messages` returns N messages; `get_new_mail` returns N+K messages where K are ghost entries from before a server expunge
- `get_new_mail` returning messages with `keywords: ["ClaudeProcessed"]` but `list_messages` for the same UID shows no keywords (poller populated before flag was set, and no `updateKeyword` was called)

**Test strategy:**
In `poller.test.ts`: manually populate cache with a message, then mock `searchMessages` to return an empty array (simulating server expunge). Run one more poll cycle. Assert that `query()` returns zero results (the expunged message should not survive the poll). Currently, `mergeIntoCache` only appends and never removes — this test will fail, which is the correct RED state.

**Phase to address:** Cache Architecture phase. The `cache_age_seconds` field is the Phase 12 minimum. The `fresh` option and poll-driven eviction of expunged messages are Phase 13+.

---

### Pitfall 8: `runReconnectLoop` Has a Bounded Retry Limit — Accounts Stay Failed Through Long Outages

**What goes wrong:**
`BACKOFF_MAX_ATTEMPTS = 10` with `BACKOFF_CAP_MS = 60_000` means the account gives up after approximately 2 minutes of total backoff time (sum of 1s + 2s + 4s + 8s + 16s + 32s + 60s * 4 = ~3m15s). A domestic ISP outage, a router reboot, or an IMAP server maintenance window of 10 minutes leaves accounts permanently failed. The agent sees `{ kind: "failed" }` indefinitely and must restart the server. This is the documented bug in PROJECT.md that v0.3 is supposed to fix.

**Why it happens:**
A bounded retry limit was added as a safety valve against infinite loops (reasonable), but the cap of 10 attempts was chosen without considering realistic outage durations. It conflates "retry hard enough to recover from transient drops" with "stop so we don't spin forever."

**How to avoid:**
Switch to unbounded retries with an increasing cap, but only for transient failures (see Pitfall 4). Fatal errors (auth) stop immediately. For transient errors, retry forever with a cap of 120s:
```typescript
// No BACKOFF_MAX_ATTEMPTS constant — loop continues until isShuttingDown
// or until isFatalConnectError returns true
while (!this.isShuttingDown) {
  const delayMs = backoffDelayMs(Math.min(attempt, 7)); // cap progression at attempt 7 = 64s with jitter
  // ... attempt connect ...
  // if isFatalConnectError: break and set failed
  // if success: return
  attempt++;
}
```
The agent-facing status `{ kind: "reconnecting", attempt, nextRetryAt }` already exposes the state; agents querying health during a long outage will see "reconnecting" which is accurate and actionable.

**Warning signs:**
- Account enters `{ kind: "failed" }` after a network event, and the last logged attempt was `10/10`
- User reports "had to restart the server after the router rebooted"
- `nextRetryAt` in the reconnecting status is more than 2 minutes in the future (impossible with current cap) — would be the right behavior if unbounded

**Test strategy:**
Existing tests already cover the 10-attempt exhaustion path. Add a new test: mock `client.connect()` to fail 15 times, then succeed on attempt 16. Assert `getStatus().kind === "connected"`. This test will hang with current code (loop exits at 10) — that's the RED state that confirms the bounded limit is the bug.

**Phase to address:** Connection Lifecycle phase. Remove `BACKOFF_MAX_ATTEMPTS`; add `isFatalConnectError` guard.

---

### Pitfall 9: `getClient()` Returns a Stale Client Mid-Reconnect — Tool Calls Fail Silently on Wrong Object

**What goes wrong:**
`ConnectionManager.getClient(accountId)` returns `{ error: "account is unavailable (reconnecting)" }` during `runReconnectLoop`. A tool handler that receives this error returns it to the agent as a structured error entry (partial-success pattern). This is correct behavior. The subtle trap: if a tool call arrives at the exact moment `runReconnectLoop` completes and writes `this.status = { kind: "connected", client }`, the *new* `ImapFlow` client (from `buildClient()`) is a different object than the one that was connected before the drop. Any code holding a direct reference to the *old* client — e.g., a concurrent `getMailboxLock` that was initiated just before the drop — now holds a reference to a closed/useless client.

**Why it happens:**
The `AccountConnection` exposes the client via `status.client` (read through `getClient()`). At the moment `runReconnectLoop` writes the new status, any in-flight operation that grabbed the old client reference before the status write is using a zombie client. This is inherent to the single-reference architecture.

**How to avoid:**
All IMAP operations should call `getClient()` at the start of the operation and not cache the returned reference across await points. The current tool handlers do this correctly (they call `getClient()` once per tool invocation, not once at startup). The pitfall occurs only if code stores the `ImapFlow` object in a variable across multiple await points where the connection could die. Document this as an invariant: "never store a client reference across an `await` that itself performs IMAP I/O."

**Warning signs:**
- An IMAP operation throws `ERR_STREAM_WRITE_AFTER_END` or "stream closed" — indicates operation used a closed client
- Tool call succeeds in returning but the IMAP response is malformed — stale sequence numbers on the wrong client
- `imapflow` issue #41 documents exactly this pattern

**Test strategy:**
Simulate by: starting an operation that holds a client reference, emitting `close` on the client mid-operation (forcing reconnect to create a new client), then completing the operation with the old reference. Assert the error is surfaced as a tool error entry rather than an unhandled rejection.

**Phase to address:** Connection Lifecycle phase. Codify the "don't cache client across awaits" rule as a comment in `getClient()` and verify existing tool handlers comply.

---

### Pitfall 10: Unhandled Promise Rejections During Reconnect Loop Crash the Process

**What goes wrong:**
`runReconnectLoop` is called with `void this.runReconnectLoop()` in the `close` event handler (line 95 in `account-connection.ts`). This correctly discards the promise but means any unhandled rejection inside the loop (a scenario not anticipated in the `try/catch` blocks) becomes an `unhandledRejection` event on the process. Node.js behavior for unhandled rejections has changed over versions — in Node.js 15+, unhandled rejections crash the process. The `catch` on the `.catch((err) => logger.error(...))` at line 96 catches rejections from `runReconnectLoop` itself, but if `runReconnectLoop` throws synchronously (not via `await`), the outer `.catch()` doesn't help.

**Why it happens:**
The `void`-then-`.catch()` pattern is necessary because the `close` event handler cannot be async (it's an EventEmitter callback). The risk is a code path inside `runReconnectLoop` that throws synchronously or rejects from an unguarded `await`. Currently the `sleep()` and `client.connect()` calls are wrapped in `try/catch`, so the risk is low — but any future change that adds an unguarded `await` inside the loop creates a silent process-kill risk.

**How to avoid:**
Wrap the entire body of `runReconnectLoop` in a top-level try/catch:
```typescript
private async runReconnectLoop(): Promise<void> {
  try {
    // ... all the retry logic ...
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[${this.accountId}] Unexpected error in reconnect loop: ${msg}`);
    this.status = { kind: "failed", reason: `Unexpected reconnect error: ${msg}` };
  }
}
```
This is belt-and-suspenders — the inner `try/catch` around `sleep` and `connect` should still exist. Add a `process.on("unhandledRejection", ...)` handler in `index.ts` that logs and does NOT crash (set to warn, not rethrow), since MCP servers are long-running processes where a single account reconnect failure should not kill all accounts.

**Warning signs:**
- Process exits with `UnhandledPromiseRejectionWarning` or `[ERR_UNHANDLED_REJECTION]` in logs
- All accounts go dark simultaneously after one account's reconnect fails
- Vitest showing `UnhandledPromiseRejection` warnings during reconnect tests

**Test strategy:**
In `account-connection.test.ts`: mock `client.connect()` to throw synchronously (not `Promise.reject()`, but `throw new Error(...)`) inside a mock implementation. Assert the process does not crash (no unhandled rejection) and account transitions to `failed` with a meaningful reason.

**Phase to address:** Connection Lifecycle phase. The outer try/catch in `runReconnectLoop` + process-level unhandledRejection handler should be in the same phase as the reconnect loop refactor.

---

### Pitfall 11: EventEmitter Listener Leak on Repeated Reconnects

**What goes wrong:**
Each reconnect in `runReconnectLoop` calls `buildClient()` (new `ImapFlow`) then `wireListeners(client)`. `wireListeners` attaches `on('error', ...)` and `on('close', ...)` to the new client. These listeners hold a closure over `this` (the `AccountConnection`). If the previous client was not fully destroyed — for instance, because `gracefulClose` threw and the socket was leaked — the old client's listeners remain live, holding a reference to `AccountConnection` and preventing GC. With 10 reconnect attempts each creating a new client, up to 10 zombie clients with 2 listeners each are held in memory. Node.js warns at >10 listeners on the same emitter (`MaxListenersExceededWarning`), which appears in stderr as a false alarm about a completely different emitter.

**Why it happens:**
The `wireListeners` function adds new listeners to each new `ImapFlow` instance (correct), but does not clean up listeners from the *previous* instance. When the previous instance is discarded (by setting `this.currentClient = client` to the new one), the old reference may not be GC'd if an external reference holds it (e.g., the status.client reference visible through `getClient()`).

**How to avoid:**
In `runReconnectLoop`, before assigning `this.currentClient = client`, call `this.currentClient?.removeAllListeners()` on the old client if it's no longer needed:
```typescript
const oldClient = this.currentClient;
const client = this.buildClient();
this.wireListeners(client);
this.currentClient = client;
// Remove listeners from the old client to prevent retention
oldClient?.removeAllListeners();
```
This breaks the GC retention chain. Also verify the `close` event listener does not create a new `AbortController` without cleaning up the old one (current code replaces `this.abortController` without aborting the old one first — should call `this.abortController.abort()` before replacing it).

**Warning signs:**
- `MaxListenersExceededWarning: Possible EventEmitter memory leak detected. N listeners added`
- Memory growth proportional to reconnect attempts (not just message volume)
- `process.listenerCount('unhandledRejection')` growing on each reconnect cycle

**Test strategy:**
After 5 reconnect attempts (all failing), assert `ImapFlow` mock instances have had `removeAllListeners()` called on all but the current one. Check `(conn as any).currentClient` is the most recently constructed instance.

**Phase to address:** Connection Lifecycle phase.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `BACKOFF_MAX_ATTEMPTS = 10` instead of unbounded retry | Prevents infinite loops during dev | Accounts go permanently failed through any outage > 3 minutes | Never in production — must be removed in v0.3 Phase 12 |
| `socketTimeout: 300_000` (5 minutes) | Generous window avoids false disconnects | Half-open TCP connections after sleep are not detected for up to 5 minutes | Drop to 90s once TCP keepalive is enabled |
| No jitter in backoff delays | Simpler, deterministic (testable) | Thundering-herd reconnect storms at scale | Acceptable with 1 account; unacceptable at ≥2 |
| Bounded Poller cache (no eviction) | Simple implementation | Unbounded memory growth on long-running servers | Never — add 30-day TTL eviction in Phase 13+ |
| `get_new_mail` returns no cache age metadata | Simpler response shape | Agent cannot tell if cache is 4 seconds or 4 hours stale | Acceptable in MVP; must be added before any real-time decision tool uses the cache |
| No `isFatalConnectError` check | Uniform retry logic | Auth failures exhaust all retries (~3 min of failed logins) | Never — classification must land in Phase 12 or 13 |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| imapflow + Node.js long-lived client | No permanent `error` listener → process crash on socket timeout | Always attach `client.on('error', ...)` in `wireListeners` before calling `connect()` (current code does this correctly) |
| imapflow + reconnect | Calling `client.connect()` on an already-connected or previously-logged-out client instance (`ERR_STREAM_WRITE_AFTER_END`) | Always call `buildClient()` to create a fresh `ImapFlow` instance for each connect attempt (current code does this correctly) |
| imapflow `socketTimeout` vs. IDLE | `socketTimeout: 300_000` fires during IDLE, cutting the IDLE session | Set `socketTimeout` below 29 minutes but above expected IDLE probe frequency (90–120s is the right range) |
| imapflow `getMailboxLock` during reconnect | Lock acquired on old client, reconnect replaces client, lock on old object | Never store the `ImapFlow` object across `await` points that perform I/O |
| IMAP IDLE + multiple folders × accounts | One IDLE connection per folder × account × server — easily hits server connection limits | IDLE is only practical for INBOX per account; polling remains necessary for all other folders |
| RFC 5530 `AUTHENTICATIONFAILED` vs. transient `UNAVAILABLE` | Retrying auth failures until account is locked | Classify by response code, not by error message substring |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Linear scan of growing Poller cache in `query()` | `get_new_mail` latency increases linearly with cache size | Add 30-day cache eviction in `mergeIntoCache` | At ~5,000 entries (≈50 days × 100 msgs/day × 1 account) |
| Poller `pollAccount` issues `searchMessages` on a reconnecting account | `getClient` returns `{ error }`, poller throws, logs spam "failed to poll account X" every 5 minutes | Check `status.kind` in `pollAccount` before calling `getClient`; skip polling if reconnecting | Immediately — logs will be noisy from first reconnect onward |
| `connectAll` + poller `start()` on partially-connected servers | All accounts poll simultaneously at startup; seed poll (30 days, 1000 msgs) for all accounts at once | Stagger initial polls by `Math.random() * 10_000` ms per account | 3+ accounts with large mailboxes |
| `read_messages` batch on post-reconnect client | `getClient` returns a fresh client; batch acquires lock; if server is busy post-reconnect, 50-UID batch may timeout | Reduce batch retry window for newly-reconnected clients; check `client.usable` at batch start | First batch call after reconnect |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Auth credentials in error messages surfaced to agents | MCP tool error response leaks IMAP username/password to agent context | Never include `this.config.username` or `this.config.password` in error strings; `reason` field in `AccountConnectionStatus.failed` should say "Authentication failed — check config" not the actual credential |
| IMAP server hostname in tool-facing error strings | Leaks internal network topology to agent | Strip host from `{ error: ... }` strings returned by `getClient()` — or include it intentionally as a debug aid (current code does include account name, which is acceptable) |
| `socketTimeout: 300_000` in combination with `keepAlive: false` | Dead connections hold sockets open for 5 minutes; process file-descriptor limit under stress | Enable `keepAlive` + reduce `socketTimeout` |

---

## "Looks Done But Isn't" Checklist

- [ ] **Reconnect loop:** Guard against double-reconnect with `reconnectInFlight` flag — verify `close` emitted twice causes only one reconnect loop to start
- [ ] **Auth failure classification:** Verify that a mock auth failure transitions to `{ kind: "failed" }` after attempt 1, not after 10
- [ ] **Jitter:** Verify `backoffDelayMs(1)` returns a different value across 10 calls (non-deterministic when jitter is active)
- [ ] **Unbounded retries:** Verify account recovers on attempt 15+ (currently impossible with `BACKOFF_MAX_ATTEMPTS = 10`)
- [ ] **Cache eviction:** Verify `poller.query(new Date(0).toISOString()).results.length` does not grow after 1000 poll cycles with old messages
- [ ] **Listener cleanup:** Verify no `MaxListenersExceededWarning` appears after 5 consecutive reconnect failures
- [ ] **TCP keepalive:** Verify `socketTimeout` triggers `close` event within 90s of a simulated dead connection (manual integration test only — not automatable in Vitest)
- [ ] **Poller skip on reconnecting account:** Verify poller logs "skipping account X: reconnecting" rather than "failed to poll account X" during reconnect window

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Account permanently failed (bounded retries exhausted) | LOW | Restart the MCP server process (10-second downtime); all accounts reconnect; cache is cold until first poll completes |
| Auth failure causing account lockout (Gmail: 10+ failed logins) | MEDIUM | Wait for server lockout to expire (usually 1–24h); verify credentials; restart server with corrected config |
| Cache divergence (agent decision on ghost message) | LOW | Agent receives `NO [NONEXISTENT]` error from `read_message`; report to agent as tool error; agent should re-query `list_messages` for fresh state |
| EventEmitter listener leak (process OOM) | HIGH | Restart process; add `removeAllListeners()` to reconnect loop; monitor heap in next session |
| Poller cache unbounded growth | MEDIUM | Restart process (cache reseeds from last 30 days); add eviction logic before next deploy |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| TCP half-open / ghost socket | Phase 12 (Connection Lifecycle) | Manual: sleep laptop for 5 min, wake, assert reconnect fires within socketTimeout + 5s |
| Concurrent double-reconnect | Phase 12 (Connection Lifecycle) | Test: emit `close` twice in 0ms interval; assert `MockImapFlow.calls.length === 1` per reconnect window |
| Retry storm / no jitter | Phase 12 (Connection Lifecycle) | Test: 3 accounts, simultaneous `close`, assert first attempt delays are non-identical |
| Auth failure infinite retry | Phase 13 (Transient vs Fatal) | Test: auth error → `failed` state after 1 attempt; network error → retries continue |
| TLS error misclassification | Phase 13 (Transient vs Fatal) | Test: `CERT_HAS_EXPIRED` → immediate `failed`; `CERT_UNTRUSTED` → max 3 retries |
| Unbounded memory growth (cache) | Phase 14 (Cache Architecture) | Test: 1000 poll cycles, assert cache size bounded by `maxResults × accountCount` |
| Cache divergence | Phase 14 (Cache Architecture) | Test: poll with expunged message; assert post-poll cache does not contain it |
| `get_new_mail` cache age opacity | Phase 14 (Cache Architecture) | Test: `get_new_mail` response includes `cache_age_seconds > 0` after first poll |
| Bounded retry limit (10 attempts) | Phase 12 (Connection Lifecycle) | Test: mock 15 failures then success; assert account eventually connects |
| Unhandled rejection in reconnect loop | Phase 12 (Connection Lifecycle) | Test: synchronous throw inside mocked `connect()`; assert no `unhandledRejection` event fires |
| EventEmitter listener leak | Phase 12 (Connection Lifecycle) | Test: 5 reconnect failures; assert `removeAllListeners` called on discarded clients |
| Poller polling reconnecting account | Phase 12 (Connection Lifecycle) | Test: `getClient` returns error; assert poller logs "skipping" not "failed", does not throw |

---

## Sources

- imapflow GitHub issue #11: ETIMEDOUT on IDLE — `socketTimeout` interaction with IDLE timeout: https://github.com/andris9/imapflow/issues/11
- imapflow GitHub issue #27: Commands never return after connection troubles (hanging promises): https://github.com/postalsys/imapflow/issues/27
- imapflow GitHub issue #41: Crash when connecting same client twice (`ERR_STREAM_WRITE_AFTER_END`): https://github.com/andris9/imapflow/issues/41
- imapflow GitHub issue #63: Unexpected close in reconnect: https://github.com/postalsys/imapflow/issues/63
- Twenty.com GitHub issue #20509: Unhandled `error` event on ImapFlow crashes server: https://github.com/twentyhq/twenty/issues/20509
- Mozilla Bugzilla #1535969: TCP keepalive for IMAP — suspend/resume detection: https://bugzilla.mozilla.org/show_bug.cgi?id=1535969
- RFC 5530: IMAP Response Codes — `AUTHENTICATIONFAILED`, `UNAVAILABLE`, `OVERQUOTA`, `INUSE`: https://www.rfc-editor.org/rfc/rfc5530.html
- RFC 2177: IMAP4 IDLE Command — 29-minute client-side restart requirement: https://datatracker.ietf.org/doc/html/rfc2177
- AWS Architecture Blog: Exponential Backoff with Full Jitter: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
- imapflow Client API docs — `socketTimeout`, `connectionTimeout`, `usable` property: https://imapflow.com/docs/api/imapflow-client/
- Codebase: `src/connections/account-connection.ts` — current reconnect loop, backoff, wireListeners
- Codebase: `src/polling/poller.ts` — current cache mergeIntoCache, no eviction
- Codebase: `tests/connections/account-connection.test.ts` — current test coverage gaps (no auth-failure classification, no jitter, no concurrent-reconnect tests)

---
*Pitfalls research for: IMAP MCP Server v0.3 Reliability & Cache Rethink*
*Researched: 2026-06-08*
