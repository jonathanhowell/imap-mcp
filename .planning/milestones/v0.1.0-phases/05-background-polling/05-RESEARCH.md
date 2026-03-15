# Phase 5: Background Polling - Research

**Researched:** 2026-03-14
**Domain:** TypeScript async polling loop, in-memory cache, MCP tool registration
**Confidence:** HIGH — all findings grounded in the existing codebase; no speculative library APIs required

## Summary

Phase 5 introduces a background polling loop that runs independently of the MCP request/response cycle. The loop iterates all configured accounts at a configurable interval, fetches INBOX headers from the last 1 month on startup (full seed), then incrementally fetches only messages newer than the last poll timestamp on subsequent cycles. Results are held in a module-level in-memory cache exposed by a new `Poller` class. A new `get_new_mail` tool queries this cache — never IMAP — and returns the `MultiAccountResult<MultiAccountMessageHeader>` shape established in Phase 4.

No new npm dependencies are required. The three key building blocks already exist: `ConnectionManager.getAccountIds()` + `getClient()` for account fan-out, `listMessages` (or an IMAP SEARCH SINCE variant) for the fetch, and the Phase 4 `MultiAccountResult` / `MultiAccountMessageHeader` types for the response shape.

The only genuinely new technical concern is the polling loop lifecycle: it must start after `connectAll()`, survive per-account IMAP failures without crashing, and shut down cleanly on SIGTERM/SIGINT. Using recursive `globalThis.setTimeout` (not `setInterval`, not `node:timers/promises`) matches the established pattern from Phase 2 reconnect logic and plays well with vitest fake timers.

**Primary recommendation:** Implement a `Poller` class in `src/polling/poller.ts` that owns the cache as a private `Map<string, MultiAccountMessageHeader[]>` keyed by account ID, exposes a `start()` / `stop()` method pair, and a `query(since: string, account?: string)` method. Register it in `src/index.ts` after `connectAll()` and before the SIGTERM handlers.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Cache scope**
- Poll INBOX only per account (consistent with Phase 4 unified inbox definition)
- Cache all messages (read + unread) received within the last 1 month per account
- Updates are incremental: each poll fetches only messages newer than the last poll timestamp and merges into the cache
- Full cache on startup (first poll is not incremental — seeds the 1-month window)

**get_new_mail tool interface**
- Tool name: `get_new_mail`
- Parameters: `since` (required, ISO 8601 timestamp) + `account` (optional — omit for all accounts, consistent with Phase 4 multi-account pattern)
- Response shape: `MultiAccountResult<MultiAccountMessageHeader>` — same `{ results, errors? }` wrapper as `list_messages` / `search_messages` multi-account
- Cache-only: results are served exclusively from the in-memory cache, no live IMAP fallback
- When cache is not yet populated (first poll hasn't completed): return `isError: true` with a descriptive, agent-actionable message, e.g. `"Polling has not completed yet — no cached results available. Retry in ~5 minutes."`

**Polling configuration**
- Location: config file only — add a top-level `polling` section to the Zod `AppConfigSchema`
- Key: `polling.interval_seconds` (optional, defaults to `300` / 5 minutes)
- Scope: global interval applied to all accounts (per-account intervals are FEAT-03, deferred to v2)
- Startup behavior: first poll runs immediately when the server starts (cache is populated within seconds); subsequent polls run at the configured interval

### Claude's Discretion
- Internal data structure for the cache (Map keyed by account, array or Map of message headers)
- How to handle incremental merge when a message appears in cache and arrives again (deduplication by UID)
- Polling loop implementation (setInterval vs. recursive setTimeout — recursive preferred to avoid overlap on slow polls)
- Error logging format for per-account poll failures

### Deferred Ideas (OUT OF SCOPE)
- Per-account polling intervals (FEAT-03) — already in v2 requirements backlog
- IMAP IDLE push notifications replacing polling (FEAT-04) — v2 backlog; reduces latency but adds reconnect complexity
- Caching read message bodies (not just headers) — not in scope; cache is header-only per POLL-02
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| POLL-01 | Server polls all configured accounts at a configurable interval (default: 5 min per CONTEXT.md) | `AppConfigSchema` extended with `polling.interval_seconds`; `Poller.start()` uses recursive `globalThis.setTimeout`; `getAccountIds()` drives account iteration |
| POLL-02 | Server pre-fetches unread message headers into in-memory cache so agent queries are served without an IMAP round-trip | `Poller` owns `Map<string, MultiAccountMessageHeader[]>` cache; startup seeds 1-month window; incremental fetches use IMAP SEARCH SINCE via existing `searchMessages` service |
| POLL-03 | Agent can query what new messages have arrived since a given timestamp | `get_new_mail` tool reads cache-only, filters by `since` param, returns `MultiAccountResult<MultiAccountMessageHeader>` |
</phase_requirements>

---

## Standard Stack

### Core (no new dependencies needed)

| Asset | Location | Purpose | Status |
|-------|----------|---------|--------|
| `ConnectionManager.getAccountIds()` | `src/connections/connection-manager.ts:82` | Returns `string[]` of all account names; polling loop iterates this | Ready |
| `ConnectionManager.getClient(id)` | `src/connections/connection-manager.ts:45` | Returns `ImapFlow \| { error: string }`; poller checks `'error' in result` before fetching | Ready |
| `searchMessages` service | `src/services/search-service.ts` | `since` param maps directly to IMAP SEARCH SINCE; used for incremental polling fetch | Ready |
| `listMessages` service | `src/services/message-service.ts` | Full-scan with no date filter; used only for startup seed (1-month window needs date filter — see below) | Ready with caveat |
| `MultiAccountMessageHeader` | `src/types.ts:97` | Cache entry type: `MessageHeader` + `account` field | Ready |
| `MultiAccountResult<T>` | `src/types.ts:121` | `get_new_mail` response wrapper | Ready |
| `ToolResult` | `src/types.ts:86` | Handler return type | Ready |
| `AppConfigSchema` | `src/config/schema.ts:33` | Extend with optional `polling` object | Ready |
| `logger` | `src/logger.ts` | stderr-only logging for poll failures | Ready |
| `globalThis.setTimeout` | Built-in | Polling loop sleep between cycles; vitest fake timers intercept it | Established pattern |

**Installation:** No new packages required.

### Startup Seed vs. Incremental Fetch

The startup seed (1-month window) can use `searchMessages` with a `since` date set to 30 days ago. This avoids the need to use `listMessages` with a manual date filter. The `searchMessages` service already accepts `since: string` and converts it to `new Date(since)` for the IMAP SEARCH SINCE criterion. This is the correct tool for both the initial seed and subsequent incremental polls — only the `since` date differs.

```typescript
// Startup seed: since = 30 days ago
// Incremental: since = last poll timestamp
const since = isStartup
  ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  : lastPollTime.toISOString();
await searchMessages(client, { since, folder: "INBOX", maxResults: 500 });
```

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── polling/
│   └── poller.ts          # NEW: Poller class — owns cache, polling loop, query method
├── tools/
│   └── get-new-mail.ts    # NEW: get_new_mail MCP tool handler
├── config/
│   └── schema.ts          # MODIFY: add polling.interval_seconds to AppConfigSchema
├── index.ts               # MODIFY: import Poller, start after connectAll(), stop in shutdown
tests/
└── polling/
    └── poller.test.ts     # NEW: unit tests for Poller
tests/
└── tools/
    └── get-new-mail.test.ts # NEW: unit tests for get_new_mail handler
```

### Pattern 1: Poller Class Structure

**What:** A class that encapsulates the cache and the polling loop. `start()` triggers the first poll immediately then schedules subsequent polls. `stop()` signals the loop to halt. `query()` is the synchronous read path.

**When to use:** Called from `src/index.ts` after `connectAll()`.

```typescript
// Source: pattern derived from Phase 2 AccountConnection reconnect loop
// src/connections/account-connection.ts uses same recursive setTimeout approach
export class Poller {
  private cache = new Map<string, MultiAccountMessageHeader[]>();
  private lastPollTime: Date | null = null;
  private stopped = false;
  private intervalSeconds: number;

  constructor(
    private readonly manager: ConnectionManager,
    intervalSeconds = 300
  ) {
    this.intervalSeconds = intervalSeconds;
  }

  start(): void {
    this.stopped = false;
    void this.runLoop();
  }

  stop(): void {
    this.stopped = true;
  }

  isCacheReady(): boolean {
    return this.lastPollTime !== null;
  }

  query(since: string, account?: string): MultiAccountResult<MultiAccountMessageHeader> {
    if (!this.isCacheReady()) {
      // Handled at handler layer — returns isError: true
      throw new Error("cache not ready");
    }
    const sinceTime = new Date(since).getTime();
    // ... filter and return
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
        logger.error(`Poller: account "${accountId}" poll failed: ${String(err)}`);
      }
    }
    this.lastPollTime = new Date();
  }
}
```

### Pattern 2: Incremental Merge with UID Deduplication

**What:** Each incremental poll fetches messages newer than `lastPollTime`. The fetch result is merged into the existing per-account cache array, deduplicating by UID.

**When to use:** All polls after the startup seed. UIDs are stable identifiers within an IMAP mailbox.

```typescript
// Source: deduplication pattern — derived from Map data structure; UIDs are numbers
private mergeIntoCache(accountId: string, incoming: MultiAccountMessageHeader[]): void {
  const existing = this.cache.get(accountId) ?? [];
  const uidSet = new Set(existing.map((m) => m.uid));
  for (const msg of incoming) {
    if (!uidSet.has(msg.uid)) {
      existing.push(msg);
      uidSet.add(msg.uid);
    }
  }
  this.cache.set(accountId, existing);
}
```

### Pattern 3: Config Schema Extension

**What:** Add an optional `polling` field to `AppConfigSchema`. Zod `.optional()` means the field can be absent; the poller reads `config.polling?.interval_seconds ?? 300`.

```typescript
// Source: src/config/schema.ts — extend AppConfigSchema
export const AppConfigSchema = z.object({
  accounts: z.array(AccountSchema).min(1, "at least one account is required"),
  polling: z
    .object({
      interval_seconds: z.number().int().positive().optional(),
    })
    .optional(),
});
```

### Pattern 4: get_new_mail Handler

**What:** Reads from the poller's cache. Returns `isError: true` when cache is cold. Filters by `since` timestamp. Returns `MultiAccountResult<MultiAccountMessageHeader>`.

```typescript
// Source: adapted from handleListMessages multi-account pattern
export async function handleGetNewMail(
  params: { since: string; account?: string },
  poller: Poller
): Promise<ToolResult> {
  if (!poller.isCacheReady()) {
    return {
      isError: true,
      content: [{
        type: "text",
        text: "Polling has not completed yet — no cached results available. Retry in ~5 minutes.",
      }],
    };
  }
  const result = poller.query(params.since, params.account);
  return {
    isError: false,
    content: [{ type: "text", text: JSON.stringify(result) }],
  };
}
```

### Pattern 5: index.ts Integration

**What:** Poller is instantiated after `loadConfig()` and started after `connectAll()`. It is stopped in the existing `shutdown` function alongside `manager.closeAll()`.

```typescript
// Derived from existing src/index.ts shutdown pattern
const poller = new Poller(manager, config.polling?.interval_seconds ?? 300);
await manager.connectAll();
poller.start();  // first poll fires immediately

const shutdown = (): void => {
  poller.stop();
  void manager.closeAll().then(() => process.exit(0));
};
```

### Anti-Patterns to Avoid

- **Using `setInterval` instead of recursive `setTimeout`:** `setInterval` fires even if the previous poll hasn't finished, causing overlapping IMAP operations under slow connections. Recursive `setTimeout` waits for poll completion before scheduling the next tick.
- **Using `node:timers/promises` for the sleep:** vitest fake timers do not intercept `node:timers/promises.setTimeout`. Use `globalThis.setTimeout` (established in Phase 2 reconnect logic).
- **IMAP fallback in `get_new_mail`:** The tool must be cache-only. A live IMAP fallback would defeat the purpose and re-introduce IMAP round-trip latency.
- **Starting the poller before `connectAll()`:** The first poll would immediately fail for all accounts since connections aren't established yet. Start order matters.
- **Storing poll failures in cache as error markers:** Per-account poll failures should be logged and silently skipped. The cache simply retains its last-known-good state for that account.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| IMAP date search | Custom UID range scan | `searchMessages` with `since` param | Already maps ISO string to IMAP SEARCH SINCE via `new Date(since)` |
| Account fan-out with error isolation | Custom loop with try/catch per account | Per-account try/catch inside sequential loop (not `fanOutAccounts` — see note) | Sequential is simpler for polling; `fanOutAccounts` is parallel but polling doesn't need parallel account fetches — they share one IMAP connection per account |
| Header deduplication | Hash-based comparison | UID numeric equality | UIDs are stable integers within a mailbox; UID uniqueness is guaranteed by IMAP spec |
| Config validation | Manual type checks | Zod `.optional()` + `?? 300` default at call site | Already using Zod for all config; AppConfigSchema extension is 5 lines |
| Polling lifecycle | Raw `setInterval` | Recursive `globalThis.setTimeout` | Prevents poll overlap; established pattern from Phase 2 |

**Key insight:** The cache is the only novel data structure this phase introduces. Everything else — account enumeration, IMAP date search, multi-account response shape, config validation — reuses existing codebase assets unchanged.

**Note on `fanOutAccounts`:** That helper fires all accounts in parallel via `Promise.allSettled`. For background polling, sequential per-account polling is preferred to avoid simultaneous IMAP lock contention across accounts. The poller should iterate accounts with a `for` loop and per-account try/catch, not `fanOutAccounts`.

---

## Common Pitfalls

### Pitfall 1: Poll overlap on slow IMAP connections
**What goes wrong:** `setInterval` fires the next poll tick while the previous one is still running. On a slow or congested IMAP connection, this causes multiple concurrent `getMailboxLock` calls on the same client, leading to lock errors or interleaved responses.
**Why it happens:** `setInterval` schedules on wall clock time regardless of previous execution duration.
**How to avoid:** Use recursive `globalThis.setTimeout` — schedule the next tick only after the current `poll()` promise resolves.
**Warning signs:** Log messages from multiple simultaneous polls for the same account; IMAP lock acquisition errors under load.

### Pitfall 2: Cache cold during startup — tool returns confusing error
**What goes wrong:** An agent calls `get_new_mail` in the seconds before the first poll completes. The handler returns a developer-jargon error or throws, causing the agent to fail its workflow.
**Why it happens:** Cache is empty before `lastPollTime` is set. The handler has no explicit check for this state.
**How to avoid:** `isCacheReady()` check at the top of the handler. Return the exact user-facing message specified in CONTEXT.md: `"Polling has not completed yet — no cached results available. Retry in ~5 minutes."` as `isError: true`.
**Warning signs:** Agents retry infinitely or surface an internal error message to the user.

### Pitfall 3: `since` filter applied to wrong timestamp
**What goes wrong:** The `get_new_mail` `since` param filters messages by their `date` field (envelope date), but `internalDate` (server receipt time) is what was fetched and stored. If a message has a spoofed or missing `date` header, the filter silently drops it.
**Why it happens:** `MessageHeader.date` in the codebase is already set to `internalDate.toISOString()` (from `message-service.ts:61-65`), so this pitfall is actually avoided — but it requires knowing that `date` in the cache stores `internalDate`, not the `Date:` header.
**How to avoid:** Confirm that all cache entries are built via `searchMessages` which uses the same `msg.internalDate` date field. The `since` filter in `query()` compares against this same field consistently.
**Warning signs:** Recent messages not appearing in `get_new_mail` results even though they exist in cache.

### Pitfall 4: Incremental fetch misses messages if poll timestamp is coarse
**What goes wrong:** `lastPollTime` is set to `new Date()` after the poll completes. If a message arrives within the same second as the poll timestamp, and IMAP SEARCH SINCE is date-granular (not time-granular), that message may not be captured in the next incremental fetch.
**Why it happens:** IMAP SEARCH SINCE operates at day granularity per RFC 3501 — it matches messages whose internal date is on or after the given date, not the given time.
**How to avoid:** For the incremental poll, use a `since` timestamp that is at least 1 day before `lastPollTime` (e.g., subtract 24 hours), accepting minor redundancy in favor of correctness. UID deduplication prevents duplicate cache entries.
**Warning signs:** Messages that arrive shortly before a poll cycle are not present in the cache after the following cycle.

### Pitfall 5: Poller not stopped on SIGTERM — process hangs
**What goes wrong:** `manager.closeAll()` resolves but `process.exit(0)` never fires because the poller's recursive `setTimeout` callback fires after closeAll completes, re-entering the loop.
**Why it happens:** `stopped` flag not set before `closeAll()`, so a scheduled tick fires during shutdown.
**How to avoid:** Call `poller.stop()` before `manager.closeAll()` in the shutdown handler. The `stopped` flag prevents any further `runLoop` recursion.
**Warning signs:** Server hangs indefinitely on Ctrl-C; process does not exit after SIGTERM.

### Pitfall 6: stdout contamination from polling error logs
**What goes wrong:** Poll failure logging uses `console.error` or `console.log`, contaminating the MCP JSON-RPC channel on stdout.
**Why it happens:** Developer adds a quick `console.error(...)` in the poller catch block.
**How to avoid:** All poller logging must use `logger.error(...)` / `logger.info(...)` from `src/logger.ts` (stderr-only). ESLint's `no-console:error` rule enforces this.
**Warning signs:** MCP client receives malformed JSON; protocol errors from the agent host.

---

## Code Examples

Verified patterns from the existing codebase:

### Recursive setTimeout Pattern (established in Phase 2)
```typescript
// Source: src/connections/account-connection.ts — backoff loop uses same pattern
// globalThis.setTimeout is used (not node:timers/promises) for vitest fake timer compatibility
globalThis.setTimeout(() => void this.runLoop(), this.intervalSeconds * 1000);
```

### IMAP SEARCH SINCE via searchMessages (existing service)
```typescript
// Source: src/services/search-service.ts:34
// since param is already supported: criteria.since = new Date(since)
const messages = await searchMessages(client, {
  since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  folder: "INBOX",
  maxResults: 500,
});
```

### Per-Account Error Isolation (polling loop)
```typescript
// Source: pattern derived from src/connections/connection-manager.ts connectAll/closeAll
// Sequential loop (not Promise.allSettled) for polling to avoid concurrent lock contention
for (const accountId of this.manager.getAccountIds()) {
  try {
    await this.pollAccount(accountId);
  } catch (err) {
    logger.error(`Poller: account "${accountId}" poll failed: ${String(err)}`);
    // Continue — other accounts are unaffected
  }
}
```

### Zod Config Extension
```typescript
// Source: src/config/schema.ts:33 — extend existing AppConfigSchema
export const AppConfigSchema = z.object({
  accounts: z.array(AccountSchema).min(1, "at least one account is required"),
  polling: z.object({
    interval_seconds: z.number().int().positive().optional(),
  }).optional(),
});
// Usage: config.polling?.interval_seconds ?? 300
```

### Cache Query with Since Filter
```typescript
// Source: pattern derived from Phase 4 multi-account merge pattern
query(since: string, account?: string): MultiAccountResult<MultiAccountMessageHeader> {
  const sinceTime = new Date(since).getTime() || 0;
  const accountIds = account ? [account] : this.manager.getAccountIds();
  const results: MultiAccountMessageHeader[] = [];
  const errors: Record<string, string> = {};

  for (const id of accountIds) {
    const entries = this.cache.get(id);
    if (!entries) {
      errors[id] = `account "${id}" has no cached data`;
      continue;
    }
    const filtered = entries.filter((m) => (new Date(m.date).getTime() || 0) > sinceTime);
    results.push(...filtered);
  }

  results.sort((a, b) => (new Date(b.date).getTime() || 0) - (new Date(a.date).getTime() || 0));
  const response: MultiAccountResult<MultiAccountMessageHeader> = { results };
  if (Object.keys(errors).length > 0) response.errors = errors;
  return response;
}
```

### get_new_mail Tool Schema
```typescript
// Source: pattern from src/tools/list-messages.ts tool schema structure
export const GET_NEW_MAIL_TOOL = {
  name: "get_new_mail",
  description: "Query messages that have arrived since a given timestamp (served from cache — no IMAP round-trip).",
  inputSchema: {
    type: "object",
    properties: {
      since: {
        type: "string",
        description: "ISO 8601 timestamp — return messages with internalDate after this time.",
      },
      account: {
        type: "string",
        description: "Account name. Omit to query all accounts.",
      },
    },
    required: ["since"],
  },
};
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| All tool calls trigger live IMAP round-trips | `get_new_mail` reads in-memory cache; no IMAP | Phase 5 introduces it | Sub-millisecond query latency for new-mail detection |
| No background activity between tool calls | Polling loop runs independently on configurable interval | Phase 5 introduces it | Server is proactive rather than purely reactive |
| `AppConfigSchema` has only `accounts` | `AppConfigSchema` gains optional `polling.interval_seconds` | Phase 5 extends it | Config is validated at startup; bad values caught before polling starts |

**Deprecated/outdated:**
- None — Phase 5 is purely additive.

---

## Open Questions

1. **IMAP SEARCH SINCE day-granularity and incremental correctness**
   - What we know: RFC 3501 SEARCH SINCE matches messages where internal date is on or after the given date (day-granular, not time-granular). The `searchMessages` service passes `new Date(since)` as the SINCE date.
   - What's unclear: Whether imapflow uses the full datetime or only the date portion for SEARCH SINCE. If only date is used, same-day incremental polls fetch already-cached messages, increasing noise.
   - Recommendation: Subtract 24 hours from `lastPollTime` when building the incremental `since` date. UID deduplication absorbs the redundancy at zero correctness cost. Document the 24h buffer in a code comment.

2. **Cache eviction strategy for 1-month window**
   - What we know: CONTEXT.md says "cache all messages received within the last 1 month." The startup seed uses `since = 30 days ago`. But old messages are never pruned.
   - What's unclear: Whether the cache should actively evict messages older than 30 days, or whether the startup-seed-only approach means old messages gradually accumulate.
   - Recommendation (Claude's discretion): Prune the cache after each poll cycle by filtering out entries where `date < 30 days ago`. This keeps memory bounded and is consistent with the stated 1-month window. Document the pruning step.

3. **`searchMessages` maxResults cap for high-volume inboxes**
   - What we know: `searchMessages` has a `maxResults` default of 50. The startup seed needs to fetch up to 30 days of mail which could exceed 50 messages on busy accounts.
   - What's unclear: What value to use for seed maxResults.
   - Recommendation (Claude's discretion): Pass `maxResults: 1000` for the startup seed. This covers all but the most extreme inboxes while preventing unbounded memory usage. For incremental polls (typically minutes of new mail), 100 is a safe cap.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.x |
| Config file | `vitest.config.ts` (project root) — `include: ["tests/**/*.test.ts"]` |
| Quick run command | `npm test -- tests/polling/poller.test.ts tests/tools/get-new-mail.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| POLL-01 | Poller calls `pollAccount` for each configured account on start | unit | `npm test -- tests/polling/poller.test.ts` | ❌ Wave 0 |
| POLL-01 | Poller schedules next poll with `globalThis.setTimeout` after each cycle | unit | `npm test -- tests/polling/poller.test.ts` | ❌ Wave 0 |
| POLL-01 | `interval_seconds` from config is used as timer delay | unit | `npm test -- tests/polling/poller.test.ts` | ❌ Wave 0 |
| POLL-01 | Default interval is 300 seconds when config omits `polling` | unit | `npm test -- tests/polling/poller.test.ts` | ❌ Wave 0 |
| POLL-02 | Cache is empty before first poll; `isCacheReady()` returns false | unit | `npm test -- tests/polling/poller.test.ts` | ❌ Wave 0 |
| POLL-02 | After first poll completes, `isCacheReady()` returns true | unit | `npm test -- tests/polling/poller.test.ts` | ❌ Wave 0 |
| POLL-02 | Incremental poll merges new messages into existing cache; no duplicates by UID | unit | `npm test -- tests/polling/poller.test.ts` | ❌ Wave 0 |
| POLL-02 | Per-account poll failure is caught and logged; other accounts continue | unit | `npm test -- tests/polling/poller.test.ts` | ❌ Wave 0 |
| POLL-03 | `get_new_mail` returns `isError: true` when cache is cold | unit | `npm test -- tests/tools/get-new-mail.test.ts` | ❌ Wave 0 |
| POLL-03 | `get_new_mail` with `since` returns only messages with `date > since` | unit | `npm test -- tests/tools/get-new-mail.test.ts` | ❌ Wave 0 |
| POLL-03 | `get_new_mail` without `account` returns results from all accounts | unit | `npm test -- tests/tools/get-new-mail.test.ts` | ❌ Wave 0 |
| POLL-03 | `get_new_mail` with `account` returns results for that account only | unit | `npm test -- tests/tools/get-new-mail.test.ts` | ❌ Wave 0 |
| POLL-03 | Results are sorted newest-first | unit | `npm test -- tests/tools/get-new-mail.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- tests/polling/poller.test.ts tests/tools/get-new-mail.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/polling/poller.test.ts` — covers POLL-01, POLL-02 (Poller class unit tests with vitest fake timers + mock ConnectionManager)
- [ ] `tests/tools/get-new-mail.test.ts` — covers POLL-03 (handler unit tests with mock Poller)
- [ ] `tests/polling/` directory — create alongside test file

*(No new framework install needed — vitest 4.x already installed)*

---

## Sources

### Primary (HIGH confidence)
- `src/connections/connection-manager.ts` — `getAccountIds()`, `getClient()` signatures read directly
- `src/services/search-service.ts` — `since` param and IMAP SEARCH SINCE mapping read directly
- `src/services/message-service.ts` — `internalDate` field usage and `listMessages` signature read directly
- `src/types.ts` — `MultiAccountResult`, `MultiAccountMessageHeader`, `ToolResult` interfaces read directly
- `src/config/schema.ts` — `AppConfigSchema` structure read directly; extension pattern is straightforward Zod
- `src/index.ts` — startup sequence, shutdown handlers, tool registration pattern read directly
- `src/tools/multi-account.ts` — `fanOutAccounts` signature read directly (not reused for polling but query pattern derived from it)
- `src/logger.ts` — stderr-only constraint confirmed directly
- `.planning/phases/05-background-polling/05-CONTEXT.md` — all locked decisions
- `vitest.config.ts` — test include glob confirmed; fake timers pattern confirmed via `tests/connections/account-connection.test.ts`

### Secondary (MEDIUM confidence)
- `package.json` — confirmed no new deps needed; vitest 4.x, imapflow 1.2.x, zod 4.x
- `.planning/STATE.md` — `globalThis.setTimeout` over `node:timers/promises` constraint confirmed as established decision

### Tertiary (LOW confidence)
- RFC 3501 SEARCH SINCE day-granularity claim — based on training knowledge; verified implicitly by the fact that `searchMessages` already works with date strings in Phase 3. Treat as MEDIUM given existing codebase evidence.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all assets read directly from codebase; no third-party library changes
- Architecture: HIGH — Poller class pattern is directly analogous to `AccountConnection`; no novel patterns
- Pitfalls: HIGH — poll overlap, cold cache, SIGTERM hang identified from reading actual code and shutdown patterns

**Research date:** 2026-03-14
**Valid until:** Until codebase changes to affected files (stable — no fast-moving dependencies)
