# Architecture Research

**Domain:** IMAP MCP server — Reliability & Cache Rethink (v0.3)
**Researched:** 2026-06-08
**Confidence:** HIGH (codebase read directly; imapflow docs verified via Context7)

---

## What Exists Today (Baseline)

Reading the source directly, the current architecture as of v0.2:

```
MCP Agent
    │  JSON-RPC / stdio
    ▼
src/index.ts  ──  Server (MCP SDK)
    │                     │
    │            12 tool handlers (src/tools/)
    │                     │
    │            ConnectionManager  ──  Map<accountId, AccountConnection>
    │                     │                        │
    │                     │              ImapFlow client per account
    │                     │              + backoff reconnect loop
    │
    └── Poller (src/polling/poller.ts)
            │  polls every N seconds
            │  calls searchMessages() per account
            └─ Map<accountId, MultiAccountMessageHeader[]>  (in-memory cache)
```

**Key structural facts:**
- `AccountConnection` already has a 4-state enum: `connecting | connected | reconnecting | failed`
- The reconnect loop in `AccountConnection.runReconnectLoop()` caps at `BACKOFF_MAX_ATTEMPTS = 10` — after 10 failures it transitions to `failed` permanently (terminal)
- `ConnectionManager.getClient()` returns `ImapFlow | { error: string }` — no typed error category
- `Poller` holds its own cache `Map<string, MultiAccountMessageHeader[]>` separately from `ConnectionManager`
- `flag_message` and `unflag_message` call `poller.updateKeyword()` / `poller.removeKeyword()` directly — the only write path into the cache besides `pollAccount()`
- `list_accounts` already surfaces `{ status, attempt?, detail? }` per account — health skeleton is present
- IDLE mode is supported by imapflow (`client.idle()` → `exists`/`expunge`/`flags` events) but not used anywhere in the codebase

---

## Connection State Machine

### Recommended State Set

The existing 4-state machine is almost right. One addition is needed:

```
CONNECTING
    │  connect() succeeds
    ▼
CONNECTED ◄─────────────────────────────────────────────┐
    │  'close' event (unexpected)                        │
    ▼                                                    │
RECONNECTING  ──[attempt 1..N, exponential backoff]──►  │
    │  attempt N+1 fails AND err is AuthenticationFailure │
    │  or TLSFAIL or NOCONNECT (server rejects at auth)   │
    ▼                                                    │
SUSPENDED  ──[human fixes creds, tool call resets]──────┘
    │  BACKOFF_MAX_ATTEMPTS exhausted on network error
    ▼
FAILED
    │  (terminal: restart required, or future "reset" API)
```

**States:**

| State | Meaning | Retries? | getClient() returns |
|-------|---------|----------|---------------------|
| `connecting` | First connect in progress | n/a | `{ error: "connecting" }` |
| `connected` | Live ImapFlow client | n/a | `ImapFlow` |
| `reconnecting` | Transient failure, backoff loop | yes | `{ error: "reconnecting, attempt N" }` |
| `suspended` | Fatal credentials/TLS — no point retrying | no | `{ error: "suspended: auth failed" }` |
| `failed` | Exhausted all reconnect attempts (network) | no | `{ error: "failed permanently" }` |

**Why add `SUSPENDED` vs keeping `FAILED` for both:**  
Auth failures and cert errors are operator errors — they need human attention but the account should be surfaceable as "suspended, fix credentials" not "failed". Merging them into `FAILED` loses that signal. `SUSPENDED` is also resettable (future: a `reset_account` tool could attempt re-auth without full server restart).

The distinction between `SUSPENDED` (fatal-credentials) and `FAILED` (exhausted-retries) also makes health surfacing unambiguous to agents.

### Transient vs Fatal Classification

**Where it lives:** A new `src/connections/error-classifier.ts` module — a pure function, no class, no state.

```typescript
// src/connections/error-classifier.ts

import { AuthenticationFailure } from "imapflow";

export type ErrorClass = "transient" | "fatal";

export function classifyConnectionError(err: unknown): ErrorClass {
  if (err instanceof AuthenticationFailure) return "fatal";
  if (err instanceof Error) {
    // TLS handshake failure
    if ((err as any).tlsFailed === true) return "fatal";
    // Server explicitly rejected connection (e.g. IMAP disabled on account)
    if ((err as any).serverResponseCode === "LOGIN-DISABLED") return "fatal";
    // Network-layer errors — all transient
    if (["ETIMEOUT", "ECONNREFUSED", "ECONNRESET", "ENETUNREACH",
         "EConnectionClosed", "NoConnection"].includes((err as any).code ?? "")) {
      return "transient";
    }
  }
  // Unknown errors default to transient (keeps retrying — safer than permanent death)
  return "transient";
}
```

**Confidence:** HIGH — imapflow documents `AuthenticationFailure` (instanceof check), `tlsFailed` property, and error codes `ETIMEOUT`/`EConnectionClosed`/`NoConnection` in official docs (verified via Context7).

**Where it's consumed:** `AccountConnection.runReconnectLoop()` calls it after each failed connect attempt. If `classifyConnectionError` returns `"fatal"`, the loop exits immediately and transitions to `SUSPENDED` rather than continuing to retry or waiting for `BACKOFF_MAX_ATTEMPTS`.

**How tools consume it:** No change needed. `getClient()` already returns a structured `{ error: string }`. The string content will change to reflect `SUSPENDED` vs `reconnecting` but the calling pattern stays identical.

### State Ownership

**`AccountConnection` owns per-account state.** No new `ConnectionManager`-level state manager is needed. The `AccountConnectionStatus` union type in `src/connections/account-connection.ts` gains a `suspended` variant:

```typescript
export type AccountConnectionStatus =
  | { kind: "connecting" }
  | { kind: "connected"; client: ImapFlow }
  | { kind: "reconnecting"; attempt: number; nextRetryAt: Date }
  | { kind: "suspended"; reason: string; since: Date }  // NEW — fatal credentials
  | { kind: "failed"; reason: string; since: Date };    // MODIFIED — add since: Date
```

Adding `since: Date` to `failed` and `suspended` is a one-field addition. This feeds `last_connected` / `suspended_at` into the health API without extra tracking.

**Race condition between tools and state transitions:**  
Node.js is single-threaded — there is no true race. `AccountConnection.getStatus()` returns the current status object synchronously. The only concern is a tool calling `getClient()` at the same instant `runReconnectLoop` sets `status = { kind: "connected" }`. Since both happen in the same event loop tick resolution order, the worst case is: tool gets `{ error: "reconnecting" }` one call before the reconnect completes. This is acceptable — the tool returns an error, the agent retries. No mutex needed.

---

## Health Surfacing

### Pull vs Push

**Pull (tool query) is correct for MCP.** MCP has no push/notification channel for tools — the agent drives all interaction. Push would require a persistent agent subscription loop that doesn't fit the MCP execution model. Pull via `list_accounts` or a dedicated tool is the right pattern.

### API Shape: Extend `list_accounts`, Not a New Tool

**Recommendation: add health fields to `list_accounts` response, not a new `account_health` tool.**

Rationale:
- `list_accounts` is already the "tell me what accounts exist" call — health is part of that answer
- A separate `account_health` tool forces agents to call two tools to understand what they're working with
- Adding optional fields to `list_accounts` is backwards-compatible (additive)
- Agents that don't need health fields can ignore the new fields

Current `list_accounts` entry shape (from `src/tools/list-accounts.ts`):
```json
{ "account": "work", "email": "...", "status": "connected" }
{ "account": "personal", "email": "...", "status": "reconnecting", "attempt": 3 }
{ "account": "old", "email": "...", "status": "failed", "detail": "..." }
```

**v0.3 target shape (additive only):**
```json
{
  "account": "work",
  "email": "user@example.com",
  "status": "connected",
  "last_connected": "2026-06-08T14:30:00Z",
  "last_poll": "2026-06-08T14:35:00Z",
  "cache_age_seconds": 42
}
```
```json
{
  "account": "personal",
  "email": "user@icloud.com",
  "status": "reconnecting",
  "attempt": 3,
  "next_retry_at": "2026-06-08T14:36:20Z",
  "last_connected": "2026-06-08T14:29:55Z",
  "last_error": "ECONNRESET: read ECONNRESET"
}
```
```json
{
  "account": "old",
  "email": "user@old.com",
  "status": "suspended",
  "detail": "Authentication failed — fix credentials",
  "since": "2026-06-08T13:00:00Z"
}
```

**What each field requires:**
- `last_connected` — add `connectedAt: Date | null` to `AccountConnection`; set it when status transitions to `connected`
- `last_error` — add `lastError: string | null` to `AccountConnection`; set it on any failed connect attempt
- `next_retry_at` — already in `status.nextRetryAt` for `reconnecting` state; just expose it
- `last_poll` / `cache_age_seconds` — `Poller` already has `lastPollTime`; add per-account `lastPollTime: Map<string, Date>` to track per-account freshness (currently it's a single global timestamp)

**Backwards compatibility:** All new fields are additive. Existing consumers checking `status === "connected"` are unaffected. The `attempt` field on `reconnecting` is unchanged. `detail` on `failed` is unchanged.

---

## Cache Architecture Options — Ranked

This is the central v0.3 decision. All five options evaluated against the codebase reality.

### Option A: Keep + Improve (RECOMMENDED)

**What changes:**
- Add per-account `lastPollTime: Map<string, Date>` to `Poller` (currently a single shared `this.lastPollTime`)
- Expose `cache_age_seconds` per-account in `list_accounts` response
- Add `include_keywords` support to `poller.query()` (currently only `exclude_keywords` is supported)
- Increase cache window: currently no eviction — oldest messages never leave cache. Add a 30-day sliding window eviction on each poll cycle.

**What the codebase looks like after:**
- `src/polling/poller.ts` gains per-account poll timestamps and eviction logic (~30 lines)
- `src/tools/list-accounts.ts` reads per-account timestamps from poller
- `src/tools/get-new-mail.ts` unchanged (query API is the same)
- `src/connections/account-connection.ts` gains `connectedAt` and `lastError` tracking

**Integration points:**
- `Poller` needs a `getLastPollTime(accountId: string): Date | null` method
- `index.ts` needs to pass `poller` to `handleListAccounts` (currently only `manager` is passed)

**Latency:** `get_new_mail` stays at ~0ms (cache-only). All other tools already hit IMAP live — no change there.

**Downside:** Cache is 3-min stale max. An email that arrives 2 minutes after the last poll won't appear in `get_new_mail` results until the next poll. This is the existing behavior and the known tradeoff.

**Complexity:** Low. Incremental changes to existing files.

---

### Option B: IDLE-Push Primary

**What it is:** Replace polling with a persistent IMAP IDLE connection per account. When `exists` fires, fetch the new message immediately and insert into cache. Cache is now ~seconds stale instead of 3 minutes stale.

**What the codebase looks like after:**  
A new `src/polling/idle-watcher.ts` class replaces the timer-based `Poller.runLoop()`. Each account needs **two** connections — one for IDLE (kept in INBOX), one for tool operations (fetch, search, flag). `AccountConnection` currently manages one `ImapFlow` instance per account. This becomes two, which requires either:
- Two `AccountConnection` instances per account (one marked `idle`, one marked `command`)
- Or a redesign where `AccountConnection` owns two clients

**Critical imapflow constraint:** IDLE holds a mailbox lock. While IDLE is active, `getMailboxLock('INBOX')` from tool operations will block or timeout until the IDLE client releases it. This means IDLE and tool operations **cannot share the same `ImapFlow` instance**. The dual-connection model is mandatory.

**Integration complexity:**
- `ConnectionManager` needs to manage `Map<accountId, { command: AccountConnection, idle: AccountConnection }>`
- `getClient(accountId)` returns the command connection (unchanged API)
- New `getIdleClient(accountId)` used only by the idle watcher
- Double the IMAP connections (most providers allow this; Gmail limits to ~15 concurrent)
- IDLE requires `mailboxOpen` before `idle()` — idle client must stay locked to INBOX
- Reconnect logic must restart IDLE after reconnect completes

**Downside:**  
Significantly higher complexity. Dual connections per account. IDLE client can't be used for tool calls. If IDLE connection drops, the watcher must restart IDLE cleanly. Provider compatibility: all RFC 2177-compliant servers support IDLE (Gmail, Fastmail, Dovecot do; very old Exchange may not, but current Exchange/365 does). Only monitors INBOX — emails in other folders are still not pushed.

**When it makes sense:** If agents are latency-sensitive on `get_new_mail` (need second-level freshness, not 3-minute). For personal assistant use cases polling every 3 minutes is generally acceptable.

**Confidence on IDLE behavior:** HIGH — imapflow documents `client.idle()`, `exists` event, and auto-restart behavior directly in official docs.

---

### Option C: Hybrid Cache

**What it is:** Keep poller cache only for `get_new_mail` fast-path. All other tools (`list_messages`, `search_messages`) already hit IMAP live — no change needed there. The "hybrid" label is somewhat misleading — this is essentially what already exists. The genuine hybrid addition would be: on `get_new_mail`, if cache is stale beyond a threshold (e.g. > 10 minutes), fall back to a live IMAP fetch instead of serving stale data.

**What changes:**
- `get_new_mail` gains a `max_cache_age_seconds` param (default: 300)
- If `cache_age > max_cache_age_seconds`, fall through to live `searchMessages()` call
- The tool description updates to reflect "usually cached, falls back to live"

**Downside:** `get_new_mail`'s defining value proposition is "no IMAP round-trip." Adding a live fallback path conflates it with `search_messages`. If the goal is freshness, agents should call `search_messages(unread: true, since: ...)` directly. The hybrid adds complexity without a clear gain over either A (accept staleness) or B (eliminate staleness).

**Verdict:** Not recommended as a primary direction. The live-fallback concept could be added as a param to Option A later if needed.

---

### Option D: Remove Cache Entirely

**What it is:** Delete `Poller` and the cache. `get_new_mail` becomes a thin wrapper over `search_messages(unread: true, since: ...)`.

**What the codebase looks like after:**
- `src/polling/poller.ts` deleted
- `src/tools/get-new-mail.ts` calls `searchMessages` directly (or delegates to `search-service.ts`)
- `flag_message` / `unflag_message` no longer call `poller.updateKeyword()`
- `index.ts` no longer constructs or starts `Poller`
- `get_new_mail` tool description loses the "cache" language

**Downside:**  
Every `get_new_mail` call hits IMAP. For agents doing "check for new mail every N seconds in a loop," this generates constant IMAP traffic and increases latency per call. Also, `get_new_mail`'s `exclude_keywords` feature becomes dependent on `search_messages`'s keyword filtering — which already works, so this is not a blocker. The poller also serves as a background consistency mechanism; removing it means the MCP server becomes purely reactive (no background state, only on-demand fetches).

**When it makes sense:** If the polling/cache approach has proven to cause more bugs than it solves, or if the agent usage pattern is "infrequent, on-demand" rather than "periodic polling loop." Given the v0.2 investment in keyword-aware cache maintenance (`updateKeyword`/`removeKeyword`), removing it now loses that work.

**Verdict:** Reasonable for a clean-slate design but a regression for the current feature set. Not recommended.

---

### Option E: Persistent Cache (SQLite/JSON)

**What it is:** Write cache to disk (SQLite via `better-sqlite3`, or JSON file) so it survives restarts and keyword state is durable without depending on the IMAP server.

**What the codebase looks like after:**
- New `src/cache/cache-store.ts` wrapping SQLite or JSON
- `Poller` writes to disk on every update; reads from disk on startup
- Startup time improves (no cold-cache wait) but adds disk I/O on every poll
- `updateKeyword`/`removeKeyword` write through to disk

**Downside:**  
High complexity for uncertain gain. Custom IMAP keywords already persist on the IMAP server — `flag_message` writes to IMAP, not just the local cache. The only cache data that doesn't survive restarts is the envelope metadata (uid, from, subject, date, unread). On restart, the cold-cache window is currently "wait for first poll" (~seconds). That's a minor inconvenience, not a product problem. SQLite introduces a new dependency and file-location concerns (where does the DB live? What about multi-instance? Corruption recovery?).

**When it makes sense:** If the project grows to include persistent agent state (e.g., "which emails have I processed across sessions"), or if the restart cold-cache window becomes a real user complaint. Not justified for v0.3.

**Verdict:** Defer to a future milestone if demand materializes.

---

### Ranked Summary

| Option | Complexity | Latency Win | Correctness Risk | Recommendation |
|--------|------------|-------------|-----------------|----------------|
| A: Keep + improve | Low | None (status quo) | Low | **Do this in v0.3** |
| B: IDLE-push | High | High (seconds vs minutes) | Medium (dual-conn, lock contention) | Future milestone if latency matters |
| C: Hybrid | Medium | Minimal | Low | Skip — conflates two tools |
| D: Remove cache | Low | Negative (IMAP on every call) | Low | Only if cache is net-negative |
| E: Persistent | High | Startup win only | Medium (disk I/O, corruption) | Defer |

**Decision: Option A.** The polling cache works and is tested. The improvements needed for v0.3 (per-account timestamps, cache age in health output, keyword filter completeness) are incremental. The 3-minute staleness is a documented behavior, not a bug. IDLE (Option B) is the right future direction if agents demand sub-minute freshness — but that requires a dual-connection redesign that is its own milestone, not a v0.3 tweak.

---

## System Overview: After v0.3 Changes

```
MCP Agent
    │  JSON-RPC / stdio
    ▼
src/index.ts  ──  Server (MCP SDK)
    │                     │
    │            12 tool handlers (src/tools/)
    │                     │  manager + poller passed to relevant handlers
    │                     │
    │            ConnectionManager
    │                     │
    │              Map<accountId, AccountConnection>
    │                     │
    │              AccountConnectionStatus (5 states)
    │                     │  connecting | connected | reconnecting
    │                     │  | suspended (NEW) | failed
    │                     │
    │              error-classifier.ts (NEW) ←─ classifyConnectionError()
    │                     │
    │                  ImapFlow (one per account)
    │
    └── Poller (src/polling/poller.ts — enhanced)
            │  polls every N seconds (unchanged)
            │  Map<accountId, Date> lastPollTime (PER-ACCOUNT, was single Date)
            └─ Map<accountId, MultiAccountMessageHeader[]>  (unchanged)
```

---

## Component Boundaries

| Component | File | Responsibility | Changes in v0.3 |
|-----------|------|---------------|-----------------|
| `AccountConnection` | `src/connections/account-connection.ts` | Per-account IMAP lifecycle, state machine | Add `suspended` state; add `connectedAt`, `lastError` fields; call `classifyConnectionError` in reconnect loop |
| `ConnectionManager` | `src/connections/connection-manager.ts` | Registry of all accounts; `getClient()` / `getStatus()` | Minor: `getStatus()` return type gains `suspended` variant |
| `error-classifier` | `src/connections/error-classifier.ts` (NEW) | Pure function: `(err: unknown) => "transient" | "fatal"` | New file |
| `Poller` | `src/polling/poller.ts` | Cache population, per-account timestamps, keyword sync | Change `lastPollTime` from `Date | null` to `Map<string, Date | null>`; add `getLastPollTime(accountId)` method; add cache eviction |
| `list-accounts` tool | `src/tools/list-accounts.ts` | Enumerate accounts with status + health | Accept `poller` param; add `last_poll`, `cache_age_seconds`, `last_connected`, `last_error` to output |
| `get-new-mail` tool | `src/tools/get-new-mail.ts` | Cache query fast-path | No change to API or logic |
| `index.ts` | `src/index.ts` | Wire-up | Pass `poller` to `handleListAccounts` call |
| `types.ts` | `src/types.ts` | Shared types | No change needed (health fields are in tool output, not shared types) |

---

## Integration Points: File-Level Changes

### New Files
- `src/connections/error-classifier.ts` — pure classification function, ~30 lines, easily unit-tested

### Modified Files

**`src/connections/account-connection.ts`**
- Add `connectedAt: Date | null = null` field; set when transitioning to `connected`
- Add `lastError: string | null = null` field; set on every failed connect/reconnect attempt
- Add `suspended` variant to `AccountConnectionStatus` union
- In `runReconnectLoop()`: call `classifyConnectionError(err)` after each failed attempt; if `"fatal"`, set `status = { kind: "suspended", reason: ..., since: new Date() }` and return
- In `runReconnectLoop()`: on exhausting attempts, add `since: new Date()` to `failed` status
- Export `getConnectedAt()` and `getLastError()` accessors

**`src/connections/connection-manager.ts`**
- `getStatus()` return type: `AccountConnectionStatus | { error: string }` — union already covers new variants via the type change above; no logic change needed
- Add `getConnectionMeta(accountId)` helper that returns `{ connectedAt, lastError }` — used by `list-accounts`

**`src/polling/poller.ts`**
- Change `private lastPollTime: Date | null` → `private lastPollTimes = new Map<string, Date | null>()`
- Update `isCacheReady()` to check if any account has a poll time (or: check all accounts)
- Add `getLastPollTime(accountId: string): Date | null` — used by `list-accounts`
- In `poll()`: update `this.lastPollTimes.set(accountId, new Date())` after each successful `pollAccount()`
- Add cache eviction in `mergeIntoCache()`: filter out entries older than 30 days

**`src/tools/list-accounts.ts`**
- Signature: `handleListAccounts(manager: ConnectionManager, poller: Poller): ToolResult`
- Add health fields to each account entry using `poller.getLastPollTime(id)` and `manager.getConnectionMeta(id)`

**`src/index.ts`**
- `handleListAccounts(manager)` → `handleListAccounts(manager, poller)`

---

## Data Flow: Tool Call with Reconnecting Account

```
Agent calls get_new_mail(since: "...", account: "work")
    │
    ▼
handleGetNewMail(params, poller)
    │  poller.isCacheReady() → checks lastPollTimes.get("work") !== null
    │
    ▼
poller.query(since, "work", excludeKeywords)
    │  reads from cache Map — no IMAP, no connection state check needed
    │  (cache is stale if "work" is reconnecting, but it's populated from last good poll)
    ▼
returns cached results with possible staleness
```

```
Agent calls list_messages(account: "work")  [while work is RECONNECTING]
    │
    ▼
handleListMessages(params, manager)
    │
    ▼
manager.getClient("work")
    │  AccountConnection.getStatus().kind === "reconnecting"
    │  returns { error: "account 'work' is unavailable (reconnecting, attempt 3)" }
    ▼
returns isError: true with message
    (agent sees meaningful error, can retry or ask about health)
```

```
Agent calls list_accounts()
    │
    ▼
handleListAccounts(manager, poller)
    │  for each account:
    │    status = manager.getStatus(id)         → connected | reconnecting | suspended | failed
    │    meta = manager.getConnectionMeta(id)   → { connectedAt, lastError }
    │    lastPoll = poller.getLastPollTime(id)  → Date | null
    ▼
returns: [
  { account: "work", status: "reconnecting", attempt: 3,
    next_retry_at: "...", last_connected: "...", last_error: "ECONNRESET" },
  { account: "personal", status: "connected",
    last_connected: "...", last_poll: "...", cache_age_seconds: 42 }
]
```

---

## Build Order

The dependencies are:
- `error-classifier` has no dependencies — build first
- `AccountConnection` state machine depends on `error-classifier`
- `Poller` per-account timestamps are independent of state machine changes
- `list_accounts` health fields depend on both `ConnectionManager` (meta) and `Poller` (timestamps)
- Tests for state machine must come before tests for health surfacing

**Recommended phase sequence:**

**Phase 12: Resilience Foundation**
- New `src/connections/error-classifier.ts` with `classifyConnectionError()`
- Modify `AccountConnection`: add `suspended` state, `connectedAt`, `lastError`; use classifier in reconnect loop
- Modify `ConnectionManager`: expose `getConnectionMeta()`
- Tests: classifier unit tests (each error code), reconnect-to-suspended path, reconnect-to-failed path
- Backwards compat: `getClient()` return contract unchanged; `list_accounts` shape unchanged (yet)

This phase can ship before cache work is finalized. The cache direction (Option A confirmed) does not change what resilience needs to do.

**Phase 13: Health Surfacing**
- Poller per-account `lastPollTimes` + `getLastPollTime()` method
- Cache eviction (30-day sliding window)
- `list_accounts` tool extended with health fields
- `index.ts` updated to pass `poller` to `handleListAccounts`
- Tests: health fields present, cache_age_seconds calculation, per-account poll time

Phase 13 depends on Phase 12 completing (needs `suspended` state + `connectedAt`/`lastError`). Cache changes in Phase 13 are low-risk — only additive (eviction + timestamps).

**Can resilience ship before cache decision?** Yes. The state machine and error classifier are independent of whether the cache uses polling or IDLE. Phase 12 can merge first. If the cache decision had gone to Option B (IDLE), Phase 13 would be replaced by a larger IDLE-migration phase, but Phase 12 would be identical.

---

## Backwards Compatibility

**`get_new_mail` — STABLE.** API shape unchanged. Behavior unchanged. Callers that check `poller.isCacheReady()` still work; cold-cache error message may be tuned but `isError: true` contract is preserved.

**`list_accounts` — ADDITIVE BREAK acceptable.** New fields (`last_connected`, `last_error`, `last_poll`, `cache_age_seconds`) are additive. Existing consumers checking `status === "connected"` are unaffected. The `status` field gains two new values (`"suspended"` was not present before) — agents that do exhaustive `switch` on `status` need to handle the new variant, but agents that only check `status === "connected"` are fine. This is a pre-1.0 project; the break is acceptable and should be documented in the release notes.

**`flag_message` / `unflag_message` — STABLE.** Both call `poller.updateKeyword()` / `poller.removeKeyword()`. Those methods are unchanged. The poller cache structure (`Map<string, MultiAccountMessageHeader[]>`) is unchanged.

**`AccountConnectionStatus` type — SOURCE BREAK.** Adding `suspended` to the union is a TypeScript source break for any external consumers that wrote exhaustive switches. Since this is a server binary (not a library), there are no external consumers. Internal tool handlers that switch on `status.kind` will need updates (just `list-accounts.ts` does this today).

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Merging `SUSPENDED` into `FAILED`

**What:** Using a single terminal state for both auth failures and exhausted-retry failures.

**Why bad:** An agent sees `status: "failed"` and has no signal about whether retrying (or human intervention) would help. Auth failures need human action; exhausted-retry failures might self-resolve if the network comes back and the server restarts.

**Do this instead:** Keep `suspended` (operator-action needed) and `failed` (exhausted retries — likely transient network but gave up) as distinct states.

### Anti-Pattern 2: Classifying Unknown Errors as Fatal

**What:** Defaulting `classifyConnectionError` to `"fatal"` for unrecognized error types.

**Why bad:** Any new imapflow version or server quirk that emits an unexpected error code permanently kills the account. Agents lose access silently.

**Do this instead:** Unknown errors default to `"transient"`. Let the retry loop exhaust attempts before declaring `failed`. The `suspended` state is reserved for errors that are provably permanent (auth failure, TLS failure).

### Anti-Pattern 3: Sharing One ImapFlow Client Between IDLE and Tool Operations

**What:** Calling `client.idle()` on the same `ImapFlow` instance that tool handlers use for `getMailboxLock()`.

**Why bad:** `idle()` holds an INBOX lock internally. Any subsequent `getMailboxLock('INBOX')` from a tool handler will block until IDLE releases — either on timeout or on `DONE` command. This causes all INBOX operations to serialize against the IDLE heartbeat.

**Do this instead:** If IDLE is implemented (Option B in future), create a dedicated second `ImapFlow` instance per account solely for IDLE monitoring. Never use it for command operations.

### Anti-Pattern 4: Global `lastPollTime` in Poller

**What:** The current single `this.lastPollTime: Date | null` marks the cache as ready after the first full sweep, even if some accounts failed that sweep.

**Why bad:** If account A fails its first poll and account B succeeds, `isCacheReady()` returns `true`, but `get_new_mail(account: "A")` returns empty results (not an error). The agent can't distinguish "no mail" from "never polled successfully."

**Do this instead:** Per-account `lastPollTimes: Map<string, Date | null>`. `isCacheReady(accountId)` checks the specific account's entry, not a global flag. `get_new_mail` returns a cold-cache error if that specific account hasn't been polled yet.

---

## Sources

- `src/connections/account-connection.ts` — direct read, existing state machine
- `src/polling/poller.ts` — direct read, cache structure and poll logic
- `src/tools/list-accounts.ts` — direct read, current health surfacing shape
- `src/tools/get-new-mail.ts` — direct read, cache API surface
- `src/connections/connection-manager.ts` — direct read, `getClient()` contract
- imapflow `AuthenticationFailure`, `idle()`, error codes: Context7 `/postalsys/imapflow` — HIGH confidence
- imapflow IDLE `exists`/`expunge`/`flags` events: Context7 `/postalsys/imapflow` — HIGH confidence
- imapflow `getMailboxLock` and lock serialization behavior: Context7 `/postalsys/imapflow` — HIGH confidence

---
*Architecture research for: IMAP MCP Server v0.3 Reliability & Cache Rethink*
*Researched: 2026-06-08*
