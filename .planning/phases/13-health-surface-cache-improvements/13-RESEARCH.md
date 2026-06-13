# Phase 13: Health Surface + Cache Improvements — Research

**Researched:** 2026-06-13
**Domain:** TypeScript / Vitest — IMAP MCP server tool-layer extension
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** CACHE-03 deferred to v0.4+. Phase 13 requirement list: HEALTH-01, HEALTH-02, HEALTH-03, CACHE-01, CACHE-02.
- **D-02:** Health fields land **flat** on each account entry in `list_accounts`. No nested `health:{}`.
  - Fields added: `last_error`, `last_error_at`, `last_connected_at`.
- **D-03:** Drop the existing `detail` field. Its content migrates into `last_error`.
- **D-04:** When `status === "connected"`: `last_error = null` and `last_error_at = null` (explicit nulls, not omitted keys).
- **D-05:** When `status === "reconnecting"`: expose `next_retry_at`, `attempt`, `last_error` (from `status.lastError`). `last_error_at = null`.
- **D-06:** When `status === "suspended"`: `last_error_at = status.since`, `last_error = status.reason` (stock string from `humanReason()` — NEVER raw `err.message`).
- **D-07:** `AccountConnection` exposes `lastErrorAt: Date | null` alongside `lastError` and `connectedAt`. Stamped wherever `lastError` is currently stamped; cleared alongside `lastError`.
- **D-08:** `get_new_mail` adds top-level `freshness:{}` map keyed by account_id alongside `results` and `errors`. Each entry: `{ last_polled_at: string | null, cache_age_seconds: number | null }`.
- **D-09:** Account never polled: `last_polled_at: null`, `cache_age_seconds: null` (explicit nulls).
- **D-10:** `cache_age_seconds` is server-computed at response-build time: `Math.floor((Date.now() - lastPolledAt.getTime()) / 1000)`.
- **D-11:** Replace `private lastPollTime: Date | null` on `Poller` with `private lastPolledAt: Map<accountId, Date | null>`. Stamped **after** `mergeIntoCache` succeeds. Skipped accounts retain previous value.
- **D-12:** New accessor `getLastPolledAt(accountId: string): Date | null` on `Poller`.
- **D-13:** Per-account seed-fetch logic: `lastPolledAt.get(accountId) ?? null` drives 30-day seed vs incremental 24h decision.
- **D-14:** Remove global `poller.isCacheReady()` gate. Replace with per-account check in `poller.query()` distinguishing three failure modes:
  - `"no cache yet — polling has not completed"` — account `connected` AND `lastPolledAt.get(id) === null`
  - `"account reconnecting (attempt N)"` — account `reconnecting`
  - `"account suspended: <reason>"` — account `suspended` (reason via `humanReason()`)
- **D-15:** Partial-results policy. Connected accounts with non-null `lastPolledAt` return cached results even when other accounts are unhealthy. `isError: false` overall.
- **D-16:** Single-account requests share the multi-account shape.
- **D-17:** Errors map keeps `Record<string, string>` shape.
- **D-18:** `detail` field removal is the only breaking change. `isCacheReady` gate removal changes behavior (was `isError: true`; now `isError: false` with `errors:{}`).

### Claude's Discretion

- Whether to extend the generic `MultiAccountResult<T>` type in `src/types.ts` or add a Phase-13-specific response type for `get_new_mail` (which now carries `freshness`). Both options are valid.
- Whether `poller.query()` directly consults `manager.getStatus()` internally, or `handleGetNewMail` passes status information in — `Poller` already holds a `manager` reference in constructor, so internal consult is cleaner.

### Deferred Ideas (OUT OF SCOPE)

- CACHE-03 (30-day eviction) — v0.4+
- `reconnect_account` MCP tool — Phase 14
- IDLE-based cache freshness (CACHE-IDLE) — v0.4+
- Cache persistence (CACHE-DISK) — v0.4+
- Structured error-object shape for `errors:{}` — rejected for v0.3
- `next_retry_at` for non-reconnecting states — out of scope

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HEALTH-01 | Account status type adds a `suspended` variant distinct from existing states — **already done in Phase 12** (4-state union: `connecting | connected | reconnecting | suspended`). Phase 13 inherits this. | `src/connections/account-connection.ts` line 16–20 — `suspended` variant present. |
| HEALTH-02 | `list_accounts` response includes per-account health fields: `status`, `last_error`, `last_error_at`, `last_connected_at`. | `handleListAccounts` switch at lines 28–43 is the extension point. `AccountConnection.connectedAt` (line 99) already exists. `lastErrorAt` field needs adding (D-07). |
| HEALTH-03 | Health metadata detailed enough for agent to explain *why* an account is unavailable. | D-05/D-06 field mappings; `suspended.reason` via `humanReason()` from `error-classifier.ts`; `reconnecting.attempt` + `next_retry_at` already on state object. |
| CACHE-01 | Poller cache tracks `last_polled_at` per account (replacing current global timestamp). | `poller.ts` line 15 `private lastPollTime: Date | null` → `private lastPolledAt: Map<string, Date | null>`. Lines 114, 148–154 are the update and read sites. |
| CACHE-02 | `get_new_mail` response exposes `last_polled_at` and `cache_age_seconds` per account. | `handleGetNewMail` in `get-new-mail.ts`; `query()` return-type extension; new `freshness:{}` map per D-08. |

</phase_requirements>

---

## Summary

Phase 13 is a focused tool-layer extension with no new modules needed. Five source files change (`account-connection.ts`, `connection-manager.ts`, `poller.ts`, `list-accounts.ts`, `get-new-mail.ts`) and `types.ts` gains a response type. All the underlying data already exists from Phase 12 (`connectedAt`, `lastError`, `suspended.reason`, `reconnecting.nextRetryAt`, `reconnecting.lastError`) — Phase 13 reads it and surfaces it via MCP tool responses.

The critical pattern constraint is V5 ASVS / T-12-09: **raw `err.message` must never reach agent output**. Phase 12 correctly protects `suspended.reason` via `humanReason()`. However, `reconnecting.lastError` on the `AccountConnectionStatus` union is stamped with raw `err.message` (confirmed at `account-connection.ts` lines 234, 301). Phase 13's implementation of D-05 must apply `humanReason()` at the surfacing point in `handleListAccounts`, or introduce a sanitized variant of the field in the status union. This is the most significant implementation risk in the phase.

The test infrastructure is mature: Vitest fake timers are already proven working (poller.test.ts uses `vi.advanceTimersByTimeAsync` and the `globalThis.setTimeout` pattern). Private field injection via `(poller as unknown as Record<string, unknown>)["fieldName"]` is the established codebase pattern for seeding poller state in tests.

**Primary recommendation:** Build in four logical changes — (1) `AccountConnection` adds `lastErrorAt`, (2) `ConnectionManager` adds health accessors, (3) `Poller` replaces global timestamp with per-account Map, (4) `list-accounts` and `get-new-mail` extend their response shapes — with Wave 0 RED scaffolds written first per TDD discipline.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `lastErrorAt` field + accessor | Domain layer (`AccountConnection`) | `ConnectionManager` (delegation) | Per-account state belongs on the connection object; manager delegates |
| `connectedAt` / `lastError` accessors | Domain layer (`AccountConnection`) | `ConnectionManager` (delegation) | Same pattern as `getStatus()` — manager proxies to AccountConnection |
| Per-account `lastPolledAt` Map | Service layer (`Poller`) | — | Poller owns all cache state; poll timestamps are cache metadata |
| `getLastPolledAt` accessor | Service layer (`Poller`) | — | Tool handlers read via accessor; Poller owns the Map |
| Cold-cache vs disconnected distinction | Service layer (`Poller.query()`) | — | Poller already holds `manager` reference; query() can consult status internally |
| `list_accounts` health field rendering | Tool layer (`list-accounts.ts`) | — | Tool layer transforms domain state into MCP response shape |
| `get_new_mail` freshness block | Tool layer (`get-new-mail.ts`) | — | Tool layer reads `getLastPolledAt()` and computes `cache_age_seconds` at response time |
| `freshness:{}` response type | `src/types.ts` or inline | — | Planner decides: extend `MultiAccountResult<T>` generically or add a specific type |

---

## Existing Code Surface Inventory

### `src/tools/list-accounts.ts` — Switch Statement (lines 28–43)

Current state as of Phase 12 (`[VERIFIED: direct read]`):

```typescript
if ("error" in status) {
  return { ...baseEntry, status: "error", detail: status.error };  // line 25-27
}
switch (status.kind) {
  case "connected":
    return { ...baseEntry, status: "connected" };                 // line 29-30
  case "connecting":
    return { ...baseEntry, status: "connecting" };                // line 31-32
  case "reconnecting":
    return { ...baseEntry, status: "reconnecting", attempt: status.attempt }; // line 33-34
  case "suspended":
    return { ...baseEntry, status: "suspended", detail: status.reason }; // line 42-43
}
```

**What Phase 13 changes per D-02..D-07:**
- `handleListAccounts` signature gains a `poller: Poller` parameter
- `connected` branch adds: `last_connected_at: manager.getLastConnectedAt(id)?.toISOString() ?? null`, `last_error: null`, `last_error_at: null`
- `reconnecting` branch adds: `next_retry_at: status.nextRetryAt.toISOString()`, `last_error: <sanitized string>`, `last_error_at: null`
- `suspended` branch: removes `detail`; adds `last_error: status.reason` (already a stock string), `last_error_at: status.since.toISOString()`, `last_connected_at: manager.getLastConnectedAt(id)?.toISOString() ?? null`
- `"error" in status` branch: drops `detail`, keeps `status: "error"` with `last_error: status.error`

**Note on `detail` removal:** The current test file `tests/tools/list-accounts.test.ts` does NOT assert on the `detail` field at all (grep confirmed zero matches). No test migration needed for D-03. `[VERIFIED: direct read of test file]`

### `src/tools/get-new-mail.ts` — Cold-Cache Gate (lines 51–60)

Current state (`[VERIFIED: direct read]`):

```typescript
if (!poller.isCacheReady()) {              // line 51
  return {
    isError: true,
    content: [{ type: "text", text: "Polling has not completed yet — no cached results available. Retry in ~5 minutes." }],
  };
}
const result = poller.query(params.since, params.account, params.exclude_keywords);
return {
  isError: false,
  content: [{ type: "text", text: JSON.stringify(result) }],
};
```

**What Phase 13 changes per D-08/D-14/D-15:**
- The `isCacheReady()` guard block is **deleted entirely**
- `poller.query()` now returns a richer shape that includes `freshness:{}`
- `handleGetNewMail` JSON-stringifies the richer result (no other change to the handler)

**The cold-cache test in `tests/tools/get-new-mail.test.ts` line 26–36 must be rewritten** (it asserts `isError: true` behavior that D-14 explicitly changes to `isError: false` with a per-account errors entry).

### `src/polling/poller.ts` — Key Lines

| Line(s) | Current State | Phase 13 Change |
|---------|---------------|-----------------|
| 15 | `private lastPollTime: Date | null = null` | Replace with `private lastPolledAt = new Map<string, Date | null>()` |
| 48–50 | `isCacheReady(): boolean { return this.lastPollTime !== null; }` | Delete method entirely (D-14) |
| 58–91 | `query()` returns `MultiAccountResult<MultiAccountMessageHeader>` | Return type gains `freshness` field; adds per-account D-14 checks; Poller calls `this.manager.getStatus(id)` internally |
| 114 | `this.lastPollTime = new Date()` (after poll loop) | Delete this line; per-account stamp moves inside `pollAccount()` after `mergeIntoCache()` |
| 148 | `if (this.lastPollTime === null)` — seed vs incremental branch | Replace with `if ((this.lastPolledAt.get(accountId) ?? null) === null)` |
| 154 | `since = new Date(this.lastPollTime.getTime() - 24h).toISOString()` | Replace with `since = new Date(this.lastPolledAt.get(accountId)!.getTime() - 24h).toISOString()` |
| 169 | `this.mergeIntoCache(accountId, headers)` — last line of successful poll path | Add `this.lastPolledAt.set(accountId, new Date())` AFTER this line |

**`pollAccount()` success path count:** There is exactly **one** success path through `pollAccount()` — the call to `mergeIntoCache()` at line 169 is the only normal exit point before the function returns. The `return` at line 132 (non-connected skip) and line 140 (getClient race) are early exits that retain the prior `lastPolledAt` value, which is correct semantics per D-11.

### `src/connections/account-connection.ts` — Health Fields

| Line | Current State | Phase 13 Change |
|------|---------------|-----------------|
| 99 | `private connectedAt: Date | null = null` | Already exists (Phase 12 groundwork). Add `getConnectedAt(): Date | null` accessor. |
| 100 | `private lastError: string | null = null` | Already exists. **Critical: stores raw `err.message` — see Pitfalls.** Add `getLastError(): string | null` accessor (but Phase 13 must NOT surface this to agents without sanitization). |
| (new) | — | Add `private lastErrorAt: Date | null = null` per D-07 |
| 229 | `this.lastError = null` (on successful reconnect) | Add `this.lastErrorAt = null` alongside |
| 234 | `this.lastError = message` (on transient failure) | Add `this.lastErrorAt = new Date()` alongside |
| 297 | `this.lastError = null` (on successful initial connect) | Add `this.lastErrorAt = null` alongside |
| 301 | `this.lastError = message` (on initial connect failure) | Add `this.lastErrorAt = new Date()` alongside |

**No accessors exist yet.** `AccountConnection` currently has no public `getConnectedAt()`, `getLastError()`, or `getLastErrorAt()` methods. Phase 13 adds all three.

### `src/connections/connection-manager.ts` — Accessor Pattern

`getStatus()` at lines 76–82 is the pattern to follow:

```typescript
getStatus(accountId: string): AccountConnectionStatus | { error: string } {
  const connection = this.connections.get(accountId);
  if (!connection) {
    return { error: `account "${accountId}" is not configured` };
  }
  return connection.getStatus();
}
```

Phase 13 adds three analogous accessors using this same null-guard pattern:
- `getLastConnectedAt(accountId: string): Date | null`
- `getLastError(accountId: string): string | null`
- `getLastErrorAt(accountId: string): Date | null`

Each returns `null` when the account is not configured (rather than throwing or returning a structured error) — the health fields default to null gracefully.

### `src/types.ts` — `MultiAccountResult<T>` Decision

Current definition (lines 124–128) `[VERIFIED: direct read]`:

```typescript
export interface MultiAccountResult<T> {
  results: T[];
  errors?: Record<string, string>;
}
```

`get_new_mail` currently returns `MultiAccountResult<MultiAccountMessageHeader>`. Phase 13 adds a `freshness:{}` field. Two options:

**Option A (Recommended):** Add a `GetNewMailResult` type in `src/types.ts` that extends `MultiAccountResult<MultiAccountMessageHeader>` with the `freshness` field:
```typescript
export interface AccountFreshness {
  last_polled_at: string | null;
  cache_age_seconds: number | null;
}
export interface GetNewMailResult extends MultiAccountResult<MultiAccountMessageHeader> {
  freshness: Record<string, AccountFreshness>;
}
```
This keeps `MultiAccountResult<T>` generic and clean; `search-service` and other callers are unaffected.

**Option B:** Extend `MultiAccountResult<T>` with an optional `freshness?` field. Pollutes the generic type with a cache-specific field. Not recommended.

The planner should prefer Option A — it follows TypeScript interface extension conventions and the `errors?` field shows the existing pattern for partial enrichment.

### `src/connections/error-classifier.ts`

Phase 13 is a **read-only consumer** of `humanReason()`. No changes needed to this file. The function is correctly exported from `src/connections/index.ts` (line 4). `[VERIFIED: direct read]`

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sanitizing IMAP error messages for agents | Custom sanitizer / string filter | `humanReason(err)` from `error-classifier.ts` | Already handles all fatal codes with stock strings; unknown errors get `GENERIC_FALLBACK_REASON` |
| Computing `cache_age_seconds` | Float arithmetic with division | `Math.floor((Date.now() - lastPolledAt.getTime()) / 1000)` — one-liner | Already established by D-10; don't drift from the spec |
| ISO string conversion | `.toString()` or custom format | `date.toISOString()` | Consistent with all existing `date` fields in message headers |

---

## Critical Pitfalls

### Pitfall 1: `reconnecting.lastError` is Raw `err.message` — V5 ASVS Violation Risk

**What goes wrong:** CONTEXT.md D-05 says to surface `last_error` for reconnecting accounts from `status.lastError`. The code at `account-connection.ts:234` shows `this.lastError = message` where `message = err instanceof Error ? err.message : String(err)`. The `AccountConnectionStatus.reconnecting.lastError` field (line 19) is therefore populated with the **raw error message**, which may include `auth.user` (username) in some imapflow code paths — exactly the credential-leak vector T-12-09 protects against.

**Confirmed by:** Direct code read of `account-connection.ts` lines 232–234 and 299–301. This is **not** filtered through `humanReason()`.

**Why it happens:** `humanReason()` is only called for the `suspended.reason` path (lines 241, 309). The `reconnecting.lastError` field was added in Phase 12 D-03 to let agents distinguish "retrying for 3 seconds" from "retrying for 4 hours." The stock-string table in `humanReason()` does not produce a useful string for transient errors (it returns `GENERIC_FALLBACK_REASON` for non-fatal errors), so the design tradeoff was: transient errors carry the raw message, fatal errors carry a stock string.

**How to handle in Phase 13:**
- Option A (Recommended): Do NOT surface `reconnecting.lastError` directly. Instead, surface the `reconnect` error string as a stock-template string built entirely from structured state: `"account reconnecting (attempt N)"` — which is already the D-14 pattern for `get_new_mail.errors`. The `last_error` field in `list_accounts` for `reconnecting` should follow the same stock-template pattern (e.g., `"Transient connection failure (retrying)"`) rather than surfacing `status.lastError`.
- Option B: At the `AccountConnection` level, add a parallel `lastErrorSanitized: string | null` field that stores `humanReason(err)` — but `humanReason` returns `GENERIC_FALLBACK_REASON` for transient errors, making it less informative.
- Option C: In `handleListAccounts`, apply a stock-template when `status.kind === "reconnecting"` (e.g., `"network error (attempt ${status.attempt})"`) and never read `status.lastError` at all for the `last_error` field.

**The planner must make an explicit decision here.** Option A or C is the safest path and avoids adding any new non-sanitized surface. The CONTEXT.md says "from `status.lastError` which exists per Phase 12 D-03" but does not acknowledge the raw-message content of that field.

**Warning signs:** If a test asserts that `last_error` for a reconnecting account contains `ECONNRESET` or any IMAP error message text, that test is confirming a V5 ASVS violation.

### Pitfall 2: `lastPolledAt` Must Stamp After `mergeIntoCache`, Not Before

**What goes wrong:** Stamping `lastPolledAt.set(accountId, new Date())` before `mergeIntoCache()` means that if `mergeIntoCache()` or `searchMessages()` throws, `lastPolledAt` is non-null and the account appears polled when it wasn't.

**Prevention:** The stamp must be the last statement of the success path in `pollAccount()`. Current code has `mergeIntoCache(accountId, headers)` at line 169 as the last statement. The new `lastPolledAt.set(...)` goes **after** line 169.

**Outer try/catch:** The `pollAccount()` call is wrapped in `try/catch` at `poll()` line 108–112. If `pollAccount()` throws, `lastPolledAt` is never updated — correct behavior.

### Pitfall 3: `isCacheReady()` Usages — Must All Be Removed

**Callers of `poller.isCacheReady()` in the entire codebase:**

```
src/tools/get-new-mail.ts:51  — handleGetNewMail gate
src/polling/poller.ts:48      — the method definition itself
tests/tools/get-new-mail.test.ts:17,21,27  — mock + test
tests/polling/poller.test.ts:113,115,118,122  — tests for isCacheReady()
```

`[VERIFIED: grep of src/ and tests/]`

**There are exactly 2 production callers** (the method definition and `handleGetNewMail`). Both must be removed in Phase 13. The poller tests at lines 113–122 (`Test 1: isCacheReady() returns false before any poll` and `Test 2: isCacheReady() returns true after first poll completes`) must be deleted or replaced with per-account `getLastPolledAt()` tests.

The `get-new-mail.test.ts` cold-cache test at line 26 (`returns isError true when cache is not ready`) must be rewritten — it tests the old `isError: true` global gate behavior that D-14 replaces with `isError: false, errors: { accountId: "no cache yet..." }`.

### Pitfall 4: Existing Poller Tests Access `lastPollTime` Directly by Field Name

**What goes wrong:** Several poller tests inject private state via `(poller as unknown as Record<string, unknown>)["lastPollTime"] = new Date()` (lines 342, 370, 405, 450 in `poller.test.ts`). After renaming to `lastPolledAt` (a Map), these tests break silently — the old key is ignored and the new Map is never seeded.

**Prevention:** All private-field injection sites must be updated to the new Map shape:
```typescript
// Old:
(poller as unknown as Record<string, unknown>)["lastPollTime"] = new Date();

// New (per-account seeding):
const map = new Map<string, Date | null>();
map.set("acct1", new Date());
(poller as unknown as Record<string, unknown>)["lastPolledAt"] = map;
```

**Affected tests:** The `excludeKeywords` and `removeKeyword` test groups that seed `lastPollTime` to bypass `isCacheReady()` in older architectures — those tests don't call `isCacheReady()` but do seed the field to make `query()` work. After Phase 13 removes `isCacheReady()` from the query gate entirely, these seeds may become irrelevant (or may need updating if `query()` internally checks `lastPolledAt`).

### Pitfall 5: `list-accounts.test.ts` Uses `"failed"` Status

`tests/tools/list-accounts.test.ts` line 10 includes `"failed"` as a valid status in the mock factory and line 27–28 constructs `{ kind: "failed" }` status objects. But Phase 12 removed `failed` from the union entirely — the mock currently returns a status shape that doesn't match the live `AccountConnectionStatus` type. This was harmless in Phase 12 because the test only exercised `connected`/`connecting`/`reconnecting` behavior. Phase 13 extends the switch; the test file needs the `failed` status removed from the helper and replaced with `suspended` mock tests.

### Pitfall 6: Single-Account Request Shape (D-16)

When `account: "fastmail"` is passed but only `"gmail"` is registered, the current `poller.query()` at line 64 does:
```typescript
const accountIds = account ? [account] : this.manager.getAccountIds();
```
The `[account]` path creates an array with an unknown account ID. Line 71 does `this.cache.get(id)` which returns `undefined` → `errors[id] = "account not found in cache"`. This existing behavior aligns with D-16 (single-account requests share multi-account shape). **No code change needed** — the existing error path already produces the right shape. Just verify the Phase 13 test covers this case.

---

## Patterns the Planner Must Replicate

### Date.toISOString() at Response Boundary

All `Date` objects from the domain layer must be converted to ISO strings at the tool-response build site. Never pass a `Date` object into the JSON serialized content:

```typescript
// CORRECT
last_connected_at: connectedAt?.toISOString() ?? null,
last_error_at:     lastErrorAt?.toISOString() ?? null,
last_polled_at:    lastPolledAt?.toISOString() ?? null,

// WRONG — Date.toString() produces non-ISO locale string
last_connected_at: connectedAt?.toString() ?? null,
```

`[ASSUMED: pattern inferred from existing MessageHeader.date field which is always ISO string]`

### `isError: false` for Partial-Success Responses

D-15 mandates `isError: false` when any account returns results, even if other accounts have errors. The existing `search-service` and `poller.query()` already follow this pattern. The current `handleGetNewMail` return at line 66–68 serializes the query result directly:

```typescript
return {
  isError: false,
  content: [{ type: "text", text: JSON.stringify(result) }],
};
```

This pattern is unchanged in Phase 13 — just the `result` object now has a `freshness` field.

### `Record<string, string>` for the `errors` Map

Both `poller.query()` (line 67) and `search-service.ts` use `const errors: Record<string, string> = {}`. Phase 13 does not change this shape for the `errors` field. The three D-14 error strings are the string values in this map:

```typescript
errors[id] = "no cache yet — polling has not completed";
errors[id] = `account reconnecting (attempt ${status.attempt})`;
errors[id] = `account suspended: ${status.reason}`;
```

Note: `status.reason` in the last template is already a stock string from `humanReason()` — safe per V5 ASVS.

### Explicit `null` vs Omitted Keys

D-04, D-09 require explicit `null` values (not omitted keys). TypeScript enforces this if the response type declares the field as `string | null` rather than `string | null | undefined`. The planner should define `AccountFreshness` with `| null` not `?:`:

```typescript
// CORRECT
interface AccountFreshness {
  last_polled_at: string | null;   // explicit null allowed, undefined is not
  cache_age_seconds: number | null;
}

// WRONG — `undefined` omits the key in JSON.stringify
interface AccountFreshness {
  last_polled_at?: string | null;
}
```

---

## Validation Architecture

`nyquist_validation: true` — this section is required.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (no version config — resolved from `package.json` devDependencies) |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npm test -- --reporter=dot` |
| Full suite command | `npm test` |
| Current suite | 246 passed, 0 failed (baseline) |

### Requirement → Test Map

| Req ID | Behavior Under Test | Test Type | File | Automated Command | File Exists? |
|--------|--------------------|-----------|----|-------------------|--------------|
| HEALTH-01 | `suspended` variant in 4-state union | Unit (inherited) | `tests/connections/account-connection.test.ts` | `npm test -- --reporter=dot` | Yes (Phase 12) |
| HEALTH-02a | `last_connected_at` present + ISO string for `connected` account | Unit | `tests/tools/list-accounts.test.ts` | `npm test -- --reporter=dot` | Yes (extend existing) |
| HEALTH-02b | `last_error: null`, `last_error_at: null` for `connected` account | Unit | `tests/tools/list-accounts.test.ts` | `npm test -- --reporter=dot` | Yes (extend existing) |
| HEALTH-02c | `last_error` populated with stock string for `suspended` account | Unit | `tests/tools/list-accounts.test.ts` | `npm test -- --reporter=dot` | Yes (extend existing) |
| HEALTH-02d | `last_error_at` equals `status.since.toISOString()` for `suspended` | Unit | `tests/tools/list-accounts.test.ts` | `npm test -- --reporter=dot` | Yes (extend existing) |
| HEALTH-02e | `attempt` + `next_retry_at` present for `reconnecting` account | Unit | `tests/tools/list-accounts.test.ts` | `npm test -- --reporter=dot` | Yes (extend existing) |
| HEALTH-02f | `detail` field absent from all responses (D-03) | Unit | `tests/tools/list-accounts.test.ts` | `npm test -- --reporter=dot` | Yes (extend existing) |
| HEALTH-03 | `last_error` for `suspended` is a stock string, not raw `err.message` | Unit | `tests/tools/list-accounts.test.ts` | `npm test -- --reporter=dot` | Yes (extend existing) |
| HEALTH-03 | `last_error` for `reconnecting` does NOT contain raw IMAP error text | Unit | `tests/tools/list-accounts.test.ts` | `npm test — --reporter=dot` | Yes (extend existing) |
| CACHE-01a | `getLastPolledAt(id)` returns `null` before first successful poll | Unit | `tests/polling/poller.test.ts` | `npm test -- --reporter=dot` | Yes (replace Test 1) |
| CACHE-01b | `getLastPolledAt(id)` returns a `Date` after successful `pollAccount()` | Unit | `tests/polling/poller.test.ts` | `npm test -- --reporter=dot` | Yes (replace Test 2) |
| CACHE-01c | Skipped account (reconnecting) retains prior `lastPolledAt` | Unit | `tests/polling/poller.test.ts` | `npm test -- --reporter=dot` | Yes (new test) |
| CACHE-01d | Per-account seed: `lastPolledAt.get(id) === null` triggers 30-day window | Unit | `tests/polling/poller.test.ts` | `npm test -- --reporter=dot` | Yes (update Test 11) |
| CACHE-01e | Incremental poll uses per-account `lastPolledAt - 24h` as since | Unit | `tests/polling/poller.test.ts` | `npm test -- --reporter=dot` | Yes (update Test 11) |
| CACHE-02a | `get_new_mail` response contains `freshness` key at top level | Integration | `tests/tools/get-new-mail.test.ts` | `npm test -- --reporter=dot` | Yes (rewrite cold-cache test) |
| CACHE-02b | `freshness[accountId].last_polled_at` is ISO string for polled account | Integration | `tests/tools/get-new-mail.test.ts` | `npm test -- --reporter=dot` | Yes (new test) |
| CACHE-02c | `freshness[accountId].last_polled_at: null` for never-polled account | Integration | `tests/tools/get-new-mail.test.ts` | `npm test -- --reporter=dot` | Yes (new test) |
| CACHE-02d | `cache_age_seconds` is a non-negative integer for polled account | Integration | `tests/tools/get-new-mail.test.ts` | `npm test -- --reporter=dot` | Yes (new test) |
| CACHE-02e | `isError: false` even when account has `errors:{}` entry (partial success) | Integration | `tests/tools/get-new-mail.test.ts` | `npm test -- --reporter=dot` | Yes (update existing) |
| D-14a | `errors[id] === "no cache yet — polling has not completed"` for connected, never-polled | Unit | `tests/polling/poller.test.ts` | `npm test -- --reporter=dot` | Yes (new test) |
| D-14b | `errors[id]` matches `"account reconnecting (attempt N)"` for reconnecting | Unit | `tests/polling/poller.test.ts` | `npm test -- --reporter=dot` | Yes (new test) |
| D-14c | `errors[id]` matches `"account suspended: <stock-string>"` for suspended | Unit | `tests/polling/poller.test.ts` | `npm test -- --reporter=dot` | Yes (new test) |
| D-16 | Single-account request on unknown account produces `errors: { id: "..." }`, `isError: false` | Unit | `tests/polling/poller.test.ts` | `npm test -- --reporter=dot` | Yes (verify existing Test 10 shape) |
| HEALTH-02 / SC-1 | UAT: agent can distinguish `reconnecting` vs `suspended` from `list_accounts` output | UAT / Manual | `tests/tools/list-accounts.test.ts` snapshot test | manual read | Yes (new scenario) |
| SC-3 | UAT: `get_new_mail` for reconnecting account has `errors` entry NOT `isError: true` | UAT / Manual | `tests/tools/get-new-mail.test.ts` | `npm test -- --reporter=dot` | Yes (rewrite) |

### Nyquist Sampling Thresholds

| Requirement | Min Test Points | Rationale |
|-------------|----------------|-----------|
| HEALTH-02 field shape | 4 status variants × 4 fields = 16 assertions | Every field × every status branch; switch exhaustiveness must be tested |
| HEALTH-03 stock strings | 3 assertions | One per fatal RFC 5530 code surface point + reconnecting stock string |
| CACHE-01 `lastPolledAt` semantics | 4 assertions | null before poll, Date after, skipped retains, seed vs incremental |
| CACHE-02 freshness block | 5 assertions | Top-level key, ISO string, null-null, computed int, partial-success shape |
| D-14 error strings | 3 assertions | One per failure mode string, exact prefix match |

**Fake timer usage for `cache_age_seconds`:** Vitest fake timers are already proven in `poller.test.ts`. To test `cache_age_seconds` deterministically, seed `lastPolledAt` with a known timestamp, then assert `cache_age_seconds === Math.floor((fakeNow - knownTimestamp) / 1000)`. Use `vi.setSystemTime()` to control `Date.now()` at response-build time. Pattern:

```typescript
vi.useFakeTimers();
const knownPollTime = new Date("2026-06-13T09:00:00Z");
const knownQueryTime = new Date("2026-06-13T09:05:00Z"); // 300s later
// Seed poller private field
(poller as unknown as Record<string, unknown>)["lastPolledAt"].set("acct1", knownPollTime);
vi.setSystemTime(knownQueryTime);
const result = poller.query("...", "acct1");
expect(result.freshness["acct1"].cache_age_seconds).toBe(300);
vi.useRealTimers();
```

### Wave 0 Gaps (Tests to Write Before Implementation)

The following RED tests do NOT exist yet and must be written in Wave 0:

- [ ] `tests/tools/list-accounts.test.ts` — Phase 13 `describe` block: health fields for all 4 status variants (HEALTH-02), stock-string verification (HEALTH-03), `detail` absent (D-03), `last_error` for reconnecting is stock-templated not raw (V5 ASVS)
- [ ] `tests/polling/poller.test.ts` — per-account `getLastPolledAt` semantics (CACHE-01), D-14 error string tests (all 3 modes), fake-timer `cache_age_seconds` test
- [ ] `tests/tools/get-new-mail.test.ts` — rewrite cold-cache test (changes from `isError: true` to `isError: false` + `errors`), freshness block shape (CACHE-02)
- [ ] `tests/connections/account-connection.test.ts` — `lastErrorAt` field stamped/cleared alongside `lastError` (D-07)
- [ ] `tests/connections/connection-manager.test.ts` — `getLastConnectedAt`, `getLastError`, `getLastErrorAt` accessor delegation tests

**Tests to update (not Wave 0 RED, but must migrate):**
- `tests/polling/poller.test.ts` Test 1 (`isCacheReady() returns false`) — replace with `getLastPolledAt(id) returns null` test
- `tests/polling/poller.test.ts` Test 2 (`isCacheReady() returns true`) — replace with `getLastPolledAt(id) returns Date` test
- `tests/polling/poller.test.ts` Test 11 (incremental poll `since`) — update private-field access from `["lastPollTime"]` to `["lastPolledAt"].get(id)`
- `tests/polling/poller.test.ts` `excludeKeywords` + `removeKeyword` groups — update `["lastPollTime"]` seeds to `["lastPolledAt"]` Map seeds
- `tests/tools/list-accounts.test.ts` `makeManager` helper — remove `"failed"` status from type union; add `suspended` status with `reason` + `since`

---

## Architecture Patterns

### System Architecture Diagram

```
Agent → MCP tool call
  │
  ▼
handleListAccounts(manager, poller)
  │  manager.getStatus(id)          → AccountConnectionStatus (4-state union)
  │  manager.getLastConnectedAt(id) → Date | null
  │  manager.getLastErrorAt(id)     → Date | null
  │  ↳ delegates to AccountConnection.getConnectedAt() / .getLastErrorAt()
  │
  ▼
switch (status.kind) {
  connected:    flat fields including last_connected_at, last_error: null, last_error_at: null
  reconnecting: flat fields including attempt, next_retry_at, last_error: "<stock-template>"
  suspended:    flat fields including last_error: status.reason, last_error_at: status.since.toISOString()
  connecting:   minimal fields
}

handleGetNewMail(params, poller)
  │
  ▼
poller.query(since, account, excludeKeywords)
  │  for each accountId:
  │    manager.getStatus(id) → status.kind
  │    lastPolledAt.get(id)  → Date | null
  │    if status.kind !== "connected" OR lastPolledAt === null → errors[id] = stock string
  │    else → filter cache entries, push to results
  │    freshness[id] = { last_polled_at: date?.toISOString(), cache_age_seconds: computed }
  │
  ▼
{ results, errors?, freshness }  →  isError: false, JSON content

poller.pollAccount(accountId)  [background loop]
  │  manager.getStatus(accountId) !== "connected" → skip, retain lastPolledAt
  │  searchMessages() → headers
  │  mergeIntoCache()
  │  lastPolledAt.set(accountId, new Date())  ← stamp AFTER mergeIntoCache
```

### Recommended Project Structure (Phase 13 deltas only)

```
src/
├── connections/
│   ├── account-connection.ts     # Add lastErrorAt field + 3 accessors
│   └── connection-manager.ts     # Add 3 delegation accessors
├── polling/
│   └── poller.ts                 # lastPollTime→Map, isCacheReady delete, query() extension
├── tools/
│   ├── list-accounts.ts          # Switch extension + poller param
│   └── get-new-mail.ts           # Remove isCacheReady gate, serialize richer result
└── types.ts                      # Add AccountFreshness + GetNewMailResult interfaces
```

### Anti-Patterns to Avoid

- **Raw error text in `last_error` for reconnecting accounts:** Do not read `status.lastError` directly into the MCP response. Use a stock template like `"Transient connection failure (retrying)"` or derive the string from structured state fields only.
- **Stamping `lastPolledAt` before `mergeIntoCache`:** Causes stale freshness metadata on search failure.
- **Optional `freshness` field:** D-08 requires `freshness:{}` always present (even if all values are `{null, null}`). An absent `freshness` key forces agents to handle two shapes.
- **Leaving `isCacheReady()` on the Poller class:** Any vestige confuses future callers. Delete the method entirely.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Global `lastPollTime: Date | null` in Poller | Per-account `lastPolledAt: Map<string, Date | null>` | Phase 13 | Enables per-account freshness reporting; fixes anti-pattern #4 from ARCHITECTURE.md |
| Global `isCacheReady()` gate returning `isError: true` | Per-account check inside `query()` returning `isError: false` + `errors:{}` | Phase 13 | Partial success for multi-account; cold-cache signal is per-account not global |
| `detail` field on list_accounts response | `last_error` (flat) | Phase 13 | Breaking change but no external consumers; more informative |
| No freshness metadata on `get_new_mail` | `freshness: Record<string, AccountFreshness>` | Phase 13 | Agents can compute staleness without extra tool calls |

---

## Environment Availability

Step 2.6: All dependencies are existing in-process TypeScript. No external tools, services, databases, or CLI utilities are required for this phase. The test suite runs with `npm test` and Vitest. **SKIPPED (no external dependencies).**

---

## Runtime State Inventory

Step 2.5: This is a greenfield-extension phase, not a rename/refactor. The field `detail` is removed from the `list_accounts` response, but `detail` is not a stored key in any datastore — it is computed at response time. **SKIPPED (not a rename/refactor/migration phase).**

---

## Security Domain

`security_enforcement` is absent from `.planning/config.json` — treating as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Not modifying auth flows |
| V3 Session Management | No | MCP is stateless per-call |
| V4 Access Control | No | No authorization logic |
| V5 Input Validation | Yes (output) | `humanReason()` is the only source for `last_error` on suspended; stock templates only for reconnecting |
| V6 Cryptography | No | No crypto operations |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Credential leak via `err.message` in agent output | Information Disclosure | `humanReason()` for `suspended.reason`; stock template for `reconnecting.last_error`; NEVER `status.lastError` directly |
| Agent branching on unstable error strings | Tampering (agent behavior) | D-14 error string prefixes are stable by design (`"no cache yet"`, `"account reconnecting"`, `"account suspended:"`); document in CHANGELOG |

---

## Package Legitimacy Audit

**This phase installs zero new packages.** No package legitimacy audit required. All changes are within the existing TypeScript codebase with no new `npm install` operations.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `Date.toISOString()` is the ISO 8601 format used for all date fields in existing message headers | Patterns section | Low — this is universal in the codebase, but if a discrepancy exists a test would catch it |
| A2 | No external consumer has shipped against the Phase 12 `list_accounts` shape with `detail` field — D-18 claim | Pitfalls / D-18 | Medium — if an external integration reads `detail`, removing it breaks silently |
| A3 | `AccountConnection` does NOT currently have any public accessor methods for `connectedAt`/`lastError`/`lastErrorAt` | Code Surface Inventory | Low — confirmed by grep; adding accessors is purely additive |

**Verified claims:** All code line numbers, field values, method signatures, test file contents, and grep results were confirmed by direct tool reads of the source files.

---

## Open Questions

1. **`reconnecting.last_error` stock-string strategy (V5 ASVS risk)**
   - What we know: `status.lastError` contains raw `err.message` (confirmed at account-connection.ts:234). Surfacing it directly to agents violates T-12-09.
   - What's unclear: Does the planner want `last_error: "Transient connection failure (retrying)"` (a static stock string, loses context) or `last_error: null` for reconnecting accounts (simplest safe option)?
   - Recommendation: Use `null` for `last_error` when `status.kind === "reconnecting"` since `next_retry_at` and `attempt` already provide temporal context; or use a stock template that contains no error text. Do NOT use `status.lastError`.

2. **`query()` return type extension — inline or `types.ts`?**
   - What we know: `MultiAccountResult<T>` is used by both `search-service` and `poller.query()`. Adding `freshness` to the generic type pollutes it.
   - Recommendation: Add `GetNewMailResult` in `types.ts` as documented in Option A above.

3. **`ConnectionManager` health accessors — return `null` or structured error for unknown account?**
   - What we know: `getStatus()` returns `{ error: string }` for unknown account. Health accessors would return `null` for unknown accounts.
   - Recommendation: Return `null` for health fields when account is unknown — health fields are `| null` by design, and the tool handler already guards on unknown accounts via the `"error" in status` check.

---

## Sources

### Primary (HIGH confidence)
- `src/connections/account-connection.ts` — direct read; all line numbers confirmed
- `src/connections/connection-manager.ts` — direct read; accessor pattern confirmed
- `src/polling/poller.ts` — direct read; all line numbers confirmed
- `src/tools/list-accounts.ts` — direct read; switch statement confirmed
- `src/tools/get-new-mail.ts` — direct read; cold-cache gate confirmed
- `src/connections/error-classifier.ts` — direct read; `humanReason()` stock-string behavior confirmed
- `src/types.ts` — direct read; `MultiAccountResult<T>` definition confirmed
- `tests/polling/poller.test.ts` — direct read; fake-timer pattern and private-field injection pattern confirmed
- `tests/tools/list-accounts.test.ts` — direct read; `detail` field absence in tests confirmed
- `tests/tools/get-new-mail.test.ts` — direct read; `isCacheReady` test that must be rewritten confirmed
- `.planning/phases/13-health-surface-cache-improvements/13-CONTEXT.md` — user decisions D-01..D-18
- `.planning/REQUIREMENTS.md` — HEALTH-01..03, CACHE-01..02 wording
- `.planning/ROADMAP.md` — Phase 13 success criteria
- `.planning/phases/12-connection-resilience-foundation/12-CONTEXT.md` — Phase 12 locked decisions, humanReason contract

### Secondary (MEDIUM confidence)
- `.planning/research/ARCHITECTURE.md` — Phase 13 field list and integration shape (verified against current code)
- `.planning/research/SUMMARY.md` — scope statement cross-check

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all changes are within the existing TypeScript codebase
- Architecture: HIGH — all integration points verified by direct source reads with line numbers
- Pitfalls: HIGH — Pitfall 1 (raw `lastError`) confirmed by code read; Pitfall 3 (caller count) confirmed by grep; Pitfall 4 (private field injection) confirmed by test read
- Validation architecture: HIGH — existing test infrastructure fully surveyed; fake-timer patterns verified

**Research date:** 2026-06-13
**Valid until:** 2026-07-13 (stable TypeScript codebase; no external API churn risk)
