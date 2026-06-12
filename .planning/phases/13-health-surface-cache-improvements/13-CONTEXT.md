# Phase 13: Health Surface + Cache Improvements - Context

**Gathered:** 2026-06-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Surface per-account health on `list_accounts` (the Phase 12 internal fields `connectedAt` and `lastError` plus the suspended `reason` / reconnecting `lastError` become agent-observable), and surface per-account cache freshness on `get_new_mail` (`last_polled_at` + `cache_age_seconds`). The Poller's single global `lastPollTime` is replaced by a per-account `Map<accountId, Date | null>`, and the global cold-cache gate (`isCacheReady()`) is replaced by a per-account check that distinguishes "no cache yet" from "account disconnected" via a structured `errors:{}` map in the response.

**Out of scope:**
- New states or state-machine changes (Phase 12 sealed the 4-state union)
- `reconnect_account` MCP tool (Phase 14)
- IDLE-based freshness (CACHE-IDLE — v0.4+)
- Cache persistence (CACHE-DISK — v0.4+)
- **30-day cache eviction (CACHE-03 — deferred to v0.4+ in this discussion; pair with CACHE-DISK when persistence lands)**

</domain>

<decisions>
## Implementation Decisions

### Scope reduction (carried into REQUIREMENTS.md / ROADMAP.md)

- **D-01:** CACHE-03 (30-day eviction) is **deferred to v0.4+**. Rationale: cache is in-memory and dies with the process, so unbounded growth is bounded in practice by restart frequency. Even pathological 60-day uptime on a busy account is ~tens of MB — not catastrophic. The one-line `filter` implementation is cheap, but adding it now would couple eviction policy to the current cache shape; the deferral pairs CACHE-03 with CACHE-DISK so eviction is designed once persistence forces it.
  - Consequence: REQUIREMENTS.md CACHE-03 line moved to "Cache Evolution (likely v0.4+)" with a deferred-from-v0.3 note; Traceability row marked Deferred 2026-06-12. ROADMAP.md Phase 13 requirements list drops CACHE-03; Success Criterion 3 (60-day memory) removed and former Criterion 4 (cold-cache vs disconnected) renumbered.
  - Phase 13 final requirement list: **HEALTH-01, HEALTH-02, HEALTH-03, CACHE-01, CACHE-02**.

### `list_accounts` response shape (HEALTH-02 / HEALTH-03)

- **D-02:** Health fields land **flat** on each account entry (alongside existing `account` / `email` / `display_name` / `status`). No nested `health:{}` object.
  - Fields added: `last_error`, `last_error_at`, `last_connected_at` (snake_case — matches REQUIREMENTS.md HEALTH-02 wording).
  - Pattern matches the existing flat style (`status`, `attempt`, `detail` are all top-level today).

- **D-03:** **Drop the existing `detail` field.** Its current content (suspended reason / reconnecting context) migrates into `last_error`. This is a breaking change for any Phase 12 caller reading `detail` — acceptable because v0.3 is mid-milestone and no external consumers have shipped against the Phase 12 shape yet.

- **D-04:** When `status === "connected"`: `last_error = null` and `last_error_at = null`. Explicit nulls (not omitted keys) — agent reads "no error currently" rather than "field missing." Aligns with `AccountConnection` line 229 which clears `this.lastError = null` on successful reconnect.

- **D-05:** When `status === "reconnecting"`: include `next_retry_at` (already on the state object at `account-connection.ts:202` — `nextRetryAt: Date`). Also expose `attempt` (already exposed today) and `last_error` (from `status.lastError` which exists per Phase 12 D-03). `last_error_at` is null for `reconnecting` UNLESS the connection has a meaningful "last error wallclock" — to keep this phase narrow, set `last_error_at = null` when reconnecting and rely on `next_retry_at` + `attempt` for temporal context.

- **D-06:** When `status === "suspended"`: `last_error_at = status.since` (the `Date` already on the suspended state at `account-connection.ts:20`). `last_error = status.reason` (the stock string from `humanReason()` — NEVER raw `err.message`, V5 ASVS / T-12-09 contract from Phase 12).

- **D-07:** Internal `AccountConnection` exposes `lastErrorAt: Date | null` alongside the existing `lastError: string | null` and `connectedAt: Date | null` (Phase 12 groundwork). The new field is stamped wherever `lastError` is currently stamped (inside the reconnect loop catch + initial-connect catch) and cleared to `null` on successful connect alongside `lastError`.

### `get_new_mail` freshness shape (CACHE-02)

- **D-08:** Add a top-level `freshness:{}` map keyed by account_id, alongside `results` and `errors`. Each entry is `{ last_polled_at: string | null, cache_age_seconds: number | null }`.
  - Shape preview:
    ```
    {
      results: [...],
      errors?: { fastmail: 'account reconnecting (attempt 7)' },
      freshness: {
        gmail:    { last_polled_at: '2026-06-12T08:51:33Z', cache_age_seconds: 142 },
        fastmail: { last_polled_at: null, cache_age_seconds: null }
      }
    }
    ```

- **D-09:** When an account has never been polled (server-just-started, or account-in-reconnect-throughout-server-lifetime): `last_polled_at: null` and `cache_age_seconds: null`. Both fields explicit, not omitted — agent reads "never polled" directly without disambiguating missing keys.

- **D-10:** `cache_age_seconds` is **server-computed** at response-build time: `Math.floor((Date.now() - lastPolledAt.getTime()) / 1000)`. Agent gets a ready-to-use number consistent with `last_polled_at` in the same response. Avoids clock-skew between server and agent lying about freshness.

### Per-account poll tracking (CACHE-01)

- **D-11:** Replace the single global `private lastPollTime: Date | null` on `Poller` with `private lastPolledAt: Map<accountId, Date | null>`. Entry is `null` for an account that has been registered but never successfully polled (e.g. account in reconnect from server start). Entry is set to `new Date()` inside `pollAccount` **after** `mergeIntoCache` succeeds — NOT on skip (skipped accounts retain their previous `lastPolledAt`, which is the correct semantics: "last time we got fresh data for this account").

- **D-12:** New accessor on `Poller`: `getLastPolledAt(accountId: string): Date | null`. Used by `handleGetNewMail` to build the `freshness:{}` block.

- **D-13:** Seed-fetch logic (currently `lastPollTime === null` branch) becomes per-account: `lastPolledAt.get(accountId) ?? null` drives the 30-day seed vs incremental 24h decision per account. Logic is otherwise unchanged.

### Cold-cache vs disconnected distinction (Success Criterion 3, formerly 4)

- **D-14:** Remove the global `poller.isCacheReady()` gate in `handleGetNewMail`. Replace with a **per-account check** inside `poller.query()` (or in a new helper) that distinguishes three failure modes:
  - **`no cache yet — polling has not completed`** — account is `connected` AND `lastPolledAt.get(id) === null`. Initial poll hasn't run yet for this account; result is empty but it's transient.
  - **`account reconnecting (attempt N)`** — account status is `reconnecting`. Uses `attempt` from the state object. (Even if `lastPolledAt` is non-null from a prior successful poll, the agent gets a clearer signal that data is now stale.)
  - **`account suspended: <reason>`** — account status is `suspended`. `<reason>` is `status.reason` (the Phase 12 stock string from `humanReason()` — NEVER raw `err.message`).

- **D-15:** **Partial-results policy.** Connected accounts with non-null `lastPolledAt` return their cached results normally even when other accounts are unhealthy. Unhealthy accounts populate `errors:{}` with the stock string from D-14. `isError: false` overall — the tool succeeded; per-account problems are surfaced in the response payload, not as a global failure.

- **D-16:** **Single-account requests share the multi-account shape.** When the user passes `account: "fastmail"` and that account is unhealthy: `results: []`, `errors: { fastmail: "..." }`, `freshness: { fastmail: { null, null } }`, `isError: false`. Agent treats single- and multi-account identically — no branching on whether `account` was specified.

- **D-17:** Errors map keeps the existing `Record<string, string>` shape (consistent with `search-service` and the current `poller.query()` return). Not a structured object — agents parse the stock strings for branching if needed; the strings are stable enough to match-on.

### Backward compatibility

- **D-18:** `detail` field removal in `list_accounts` (D-03) is the only breaking change. The `isCacheReady` global gate removal in `get_new_mail` (D-14) changes behavior — calls that previously returned `isError: true` during server boot now return `isError: false` with an `errors:{}` entry per account — but the response shape stays additive (results/errors already existed; freshness is new). README + CHANGELOG note required at milestone ship.

### Folded Todos

None.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap

- `.planning/REQUIREMENTS.md` §"Account Health Surface" — HEALTH-01, HEALTH-02, HEALTH-03 (the agent-observability contract)
- `.planning/REQUIREMENTS.md` §"Cache Improvements" — CACHE-01, CACHE-02 (CACHE-03 explicitly out of this phase per D-01)
- `.planning/REQUIREMENTS.md` §"Cache Evolution (likely v0.4+)" — CACHE-03 deferred entry + rationale
- `.planning/ROADMAP.md` §"Phase 13" — Success Criteria 1–3 (HEALTH surface, freshness fields, cold-cache vs disconnected distinction)

### Phase 12 — locked decisions Phase 13 builds on

- `.planning/phases/12-connection-resilience-foundation/12-CONTEXT.md` §"State machine" — 4-state union locked; `suspended.reason` is a stock string (never raw `err.message`); `reconnecting.lastError` carries the error string
- `.planning/STATE.md` §"Decisions (v0.3)" — V5 ASVS / T-12-09 credentials-safety contract: `humanReason(err)` is the contract surface; raw error message text is never echoed to agents

### Research (HIGH confidence, 2026-06-08)

- `.planning/research/SUMMARY.md` §"Phase 13: Health Surfacing + Cache Improvements" — canonical scope statement; rules out IDLE redesign in v0.3
- `.planning/research/ARCHITECTURE.md` §"Phase 13" — `list-accounts` field list, per-account `lastPollTimes` Map shape, integration with `handleListAccounts` signature change

### Existing code (must read before modifying)

- `src/tools/list-accounts.ts` — Phase 12 shape: `{ account, email, display_name?, status, detail?, attempt? }`. The `switch (status.kind)` on lines 28-43 is where new health fields wire in (with `detail` removal per D-03)
- `src/tools/get-new-mail.ts` — Phase 12 shape with global cold-cache gate at lines 51-60. Gate removal + `freshness:{}` block addition per D-08/D-14
- `src/polling/poller.ts` — `lastPollTime` global at line 15 → per-account Map per D-11. `isCacheReady` at lines 48-50 deleted per D-14. `query()` at lines 58-91 extends to return freshness data alongside results/errors. `pollAccount` at lines 117-170 stamps per-account `lastPolledAt` after `mergeIntoCache`
- `src/connections/account-connection.ts` — internal `connectedAt: Date | null` at line 99 and `lastError: string | null` at line 100 already exist (Phase 12 groundwork). Add `lastErrorAt: Date | null` per D-07; expose all three via new accessors on `AccountConnection` / `ConnectionManager`
- `src/connections/connection-manager.ts` — `getStatus()` at lines 76-82 stays; add accessors for `lastConnectedAt`, `lastError`, `lastErrorAt` (delegate to `AccountConnection`)

### IMAP / V5 ASVS contracts (carried forward — DO NOT echo raw errors)

- `.planning/phases/12-connection-resilience-foundation/12-CONTEXT.md` §"D-05/D-06" — fatal/transient classification table (stock strings come from `humanReason`)
- `src/connections/error-classifier.ts` — `humanReason(err): string` is the ONLY source of `suspended.reason`; Phase 13 must never substitute `err.message`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable assets

- **`AccountConnection.connectedAt` / `lastError`** — already added in Phase 12 (`account-connection.ts:99-100`) as internal fields specifically so Phase 13 has something to expose. Stamped in the reconnect loop catch + initial-connect catch.
- **`AccountConnectionStatus` union** — `reconnecting.lastError`, `reconnecting.nextRetryAt`, `suspended.reason`, `suspended.since` are all on the state object already. Phase 13 reads them; no shape changes.
- **`MultiAccountResult<T>` type** (`src/types.ts`) — `{ results, errors? }` shape is reused by `search-service` and `poller.query`. Phase 13 extends it (or adds a `freshness` field) for `get_new_mail`.
- **`humanReason(err)`** (`src/connections/error-classifier.ts`) — stock string source for suspended reasons. Phase 13 read-only consumer; no new error semantics.
- **`getStatus(accountId)` on `ConnectionManager`** — already returns the discriminated union. Phase 13 adds health-field accessors as siblings.

### Established patterns

- **snake_case in MCP responses** — `account`, `display_name`, `last_error_at` etc. The REQUIREMENTS.md HEALTH-02 names are already snake_case; this matches.
- **stock-string errors only** (V5 ASVS / T-12-09) — Phase 12 contract. Phase 13's three new error strings (`no cache yet — polling has not completed`, `account reconnecting (attempt N)`, `account suspended: <reason>`) are all stock-templated. `<reason>` is itself a stock string from `humanReason()`.
- **Structured `errors:{}` map** — `poller.query()` and `search-service` already key errors by account_id with string values. Phase 13's `get_new_mail` errors block follows the same pattern.
- **`isError: false` for partial-success multi-account responses** — established pattern (search-service returns isError:false with errors map). Phase 13 D-15/D-16 keep this consistent.

### Integration points

- `handleListAccounts(manager)` (`src/tools/list-accounts.ts`) — switch-statement extension; per D-02..D-07. No new parameters needed (everything reads from `manager` / `ConnectionManager`).
- `handleGetNewMail(params, poller)` — signature stays; internal logic per D-08/D-14/D-15. May need to accept `manager` too to consult `getStatus()` for the reconnecting/suspended branch — OR `poller.query()` can hold a reference to `manager` (Poller already takes manager in constructor per `poller.ts:24-26`, so the accessor is internal).
- `Poller` — `lastPollTime` → `lastPolledAt: Map`; `query()` return-shape extension; new `getLastPolledAt` accessor; `isCacheReady` deletion. All in one file.
- `AccountConnection` — `lastErrorAt: Date | null` field; setter alongside `lastError` writes; cleared alongside `lastError` clears.
- `ConnectionManager` — new accessors: `getLastConnectedAt(id)`, `getLastError(id)`, `getLastErrorAt(id)`. Delegate to `AccountConnection`.

### Constraints worth knowing

- **No raw `err.message` echo** — Phase 12 V5 ASVS contract. Every error string surfaced to the agent (in `list_accounts.last_error` AND in `get_new_mail.errors{}`) must come from a stock-string source.
- **Phase 12's `reconnecting.lastError` is already a sanitized string** stamped from `humanReason()` in the reconnect loop — safe to surface directly. Verify in plan-phase that the surface point doesn't re-introduce raw error text.
- **`Date | null` everywhere** — never `undefined`. The response converts to ISO string (`Date.toISOString()`) or literal `null`. Consistency with existing message `date` fields.
- **MultiAccountResult shape** in `src/types.ts` — check whether to extend the generic type or add a Phase-13-specific response type for `get_new_mail` (which now carries freshness). Planner decides; CONTEXT just notes both options exist.

</code_context>

<specifics>
## Specific Ideas

- The three stock error strings in D-14 should be stable enough that an agent can match-on prefix for branching: `"no cache yet"` / `"account reconnecting"` / `"account suspended"`. The full string carries the human-readable detail (attempt count, reason).
- `last_polled_at` in the response is the per-account `Date.toISOString()` of the last **successful** poll cycle (not the last attempt). A skipped account retains its prior `last_polled_at` so `cache_age_seconds` keeps climbing — the agent learns "data is stale" directly from the number.
- Health field rendering in `list_accounts` for a connected account that has never had a problem: `{ account, email, status: "connected", last_error: null, last_error_at: null, last_connected_at: "2026-06-12T08:30:00Z" }`. Clean and minimal.

</specifics>

<deferred>
## Deferred Ideas

- **CACHE-03 (30-day eviction)** — deferred to v0.4+ per D-01. Pair with CACHE-DISK when persistence lands (eviction policy is meaningful once cache outlives the process).
- **`reconnect_account` MCP tool** — Phase 14 (this milestone, next phase).
- **IDLE-based cache freshness (CACHE-IDLE)** — v0.4+; requires dual-`ImapFlow` redesign.
- **Cache persistence to disk (CACHE-DISK)** — v0.4+.
- **Structured error-object shape for `errors:{}`** — explored in Area 3, rejected for v0.3 (breaks the existing `Record<string,string>` pattern used across tools). Revisit if a future phase needs programmatic reason codes (e.g., agent retry policy).
- **`next_retry_at` for non-reconnecting states in `list_accounts`** — out of scope; only meaningful when reconnecting.

### Reviewed Todos (not folded)

- **`2026-03-19-prevent-flag-tools-from-modifying-reserved-imap-keywords.md`** — Score 0.4 (borderline). Adds validation in `flag_message` / `unflag_message` to reject RFC 3501 system flags. Unrelated to health surfacing or cache freshness; belongs in a future tools-hardening phase or as a standalone micro-fix. Already deferred from Phase 12 for the same reason.

</deferred>

---

*Phase: 13-health-surface-cache-improvements*
*Context gathered: 2026-06-12*
