---
phase: 13-health-surface-cache-improvements
verified: 2026-06-13T09:08:56Z
status: passed
score: 12/12 must-haves verified
overrides_applied: 0
re_verification:
  is_re_verification: false
---

# Phase 13: Health Surface + Cache Improvements — Verification Report

**Phase Goal:** Agents can observe the freshness of cached mail data per account and understand account health in enough detail to explain failures to users
**Verified:** 2026-06-13T09:08:56Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | ROADMAP SC1 — `list_accounts` includes `last_connected_at`, `last_error`, `last_error_at`, `status` per account so an agent distinguishes "retrying after 4-hour network drop" from "credentials need fixing" | VERIFIED | `src/tools/list-accounts.ts:30-86` — every branch (error / connected / connecting / reconnecting / suspended) returns all four flat snake_case fields; reconnecting additionally carries `attempt` + `next_retry_at`; suspended carries stock `humanReason` reason; 18/18 list-accounts tests pass |
| 2  | ROADMAP SC2 — `get_new_mail` response includes `last_polled_at` and `cache_age_seconds` per account ("mail data is 8 minutes old") | VERIFIED | `src/polling/poller.ts:99-111` builds always-present `freshness: Record<string, AccountFreshness>`; `src/types.ts:137-149` defines `AccountFreshness { last_polled_at: string \| null; cache_age_seconds: number \| null }` and `GetNewMailResult`; `nowMs = Date.now()` at line 95 ensures D-10 server-side computation |
| 3  | ROADMAP SC3 — When `get_new_mail` is called on a reconnecting account, error distinguishes "no cache yet" from "account disconnected" | VERIFIED | `src/polling/poller.ts:114-140` dispatches three stable D-14 stock prefixes: `"no cache yet — polling has not completed"` (line 138), `"account reconnecting (attempt N)"` (lines 126, 133), `"account suspended: ${status.reason}"` (line 122) — each testable by exact-prefix match |
| 4  | HEALTH-01 — `suspended` variant from Phase 12 observably distinct in both surfaces | VERIFIED | list-accounts.ts:80-86 emits `status: "suspended"`; poller.ts:122 emits `"account suspended: <reason>"` distinct from reconnecting prefix |
| 5  | HEALTH-02 — `AccountConnection` exposes `connectedAt`, `lastError`, `lastErrorAt` via 3 public accessors + ConnectionManager delegates via 3 accessors returning null for unknown accounts | VERIFIED | `src/connections/account-connection.ts:102-104` declares 3 private fields; lines 125-135 expose 3 accessors; `src/connections/connection-manager.ts:92-102` defines 3 delegating accessors using `this.connections.get(id)?.getX() ?? null` |
| 6  | HEALTH-02 — `lastErrorAt` stamped at every `lastError` write site (D-07) and cleared at every clear site | VERIFIED | account-connection.ts: 4 lastError writes (lines 252, 258, 322, 327) all paired with lastErrorAt on adjacent lines (253, 259, 323, 328); `grep -c 'this\.lastError = ' = 4` and `grep -c 'this\.lastErrorAt = ' = 4` |
| 7  | HEALTH-03 — Reconnecting branch carries `attempt` + `next_retry_at`; suspended carries stock `humanReason` — sufficient detail to explain WHY unavailable | VERIFIED | list-accounts.ts:67-86 — reconnecting emits `attempt: status.attempt` + `next_retry_at: status.nextRetryAt.toISOString()`; suspended emits `last_error: status.reason` (stock) + `last_error_at: status.since.toISOString()` |
| 8  | CACHE-01 — Per-account `lastPolledAt: Map<string, Date \| null>` replaces global timestamp; stamp lands AFTER `mergeIntoCache` succeeds (Pitfall 2 guard) | VERIFIED | `src/polling/poller.ts:24` declares Map; line 59 exposes `getLastPolledAt`; line 248 `mergeIntoCache(...)` precedes line 253 `this.lastPolledAt.set(accountId, new Date())` — strict ordering preserves Pitfall 2 invariant |
| 9  | CACHE-02 — `freshness:{}` always present (D-08), explicit nulls for never-polled (D-09), server-computed `cache_age_seconds` (D-10) | VERIFIED | poller.ts:107-111 builds entry for every accountId before status dispatch; nulls flow when `lastPolled === null`; `nowMs` captured at line 95 from `Date.now()` then used in `Math.floor((nowMs - lastPolled.getTime()) / 1000)`; line 164-166 returns `freshness` in BOTH return branches |
| 10 | V5 ASVS / T-13-03 — `list_accounts` reconnecting branch does NOT echo raw `err.message` | VERIFIED | list-accounts.ts:67-75 hardcodes `last_error: null` for reconnecting; `grep -c 'status\.lastError' src/tools/list-accounts.ts == 0`; `grep -c 'manager\.getLastError' src/tools/list-accounts.ts == 0` — neither raw source is read for this branch |
| 11 | V5 ASVS — `get_new_mail` suspended branch does NOT consult `manager.getLastError(id)`; only `humanReason()` via `status.reason` | VERIFIED | poller.ts:122 reads `status.reason` (stock string from humanReason); `grep -c 'getLastError\|getLastErrorAt' src/polling/poller.ts src/tools/get-new-mail.ts == 0` — the raw-message accessor is never invoked by the get-new-mail data path |
| 12 | Pitfall 3 — `isCacheReady()` global gate removed from production code (and test code) | VERIFIED | `grep -rn 'isCacheReady' src/` returns 0; `grep -rn 'isCacheReady' tests/` returns 0; `src/tools/get-new-mail.ts:53-62` reduced to query + return with no early-failure gate |

**Score:** 12/12 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/connections/account-connection.ts` | `lastErrorAt: Date \| null` field + 3 accessors + paired stamp/clear writes | VERIFIED | Line 104 declares field; lines 125-135 expose `getConnectedAt`/`getLastError`/`getLastErrorAt`; paired writes at 4 sites |
| `src/connections/connection-manager.ts` | 3 delegating accessors returning null for unknown accounts | VERIFIED | Lines 92-102 — `getLastConnectedAt`/`getLastError`/`getLastErrorAt(accountId)` use `this.connections.get(id)?.getX() ?? null` pattern |
| `src/tools/list-accounts.ts` | Flat snake_case `last_connected_at`/`last_error`/`last_error_at` per branch; `detail` removed; V5 ASVS guard on reconnecting | VERIFIED | All 5 branches (error/connected/connecting/reconnecting/suspended) emit the three fields; `grep -c 'detail' = 0`; `grep -c 'status.lastError' = 0` |
| `src/polling/poller.ts` | Per-account `lastPolledAt` Map, `getLastPolledAt` accessor, query() returns `GetNewMailResult` with always-present freshness; D-14 dispatch; isCacheReady gone | VERIFIED | Line 24 Map; line 59 accessor; line 92 return type `GetNewMailResult`; lines 99-167 freshness + D-14 dispatch; no `isCacheReady` |
| `src/tools/get-new-mail.ts` | `isCacheReady` gate removed; handler always returns isError:false with JSON.stringify(result) | VERIFIED | Lines 53-62: 2-statement body (query + return); `grep -c 'isError: true' = 0`; `grep -c 'isCacheReady' = 0` |
| `src/types.ts` | `AccountFreshness` + `GetNewMailResult` interfaces | VERIFIED | Lines 137-149 declare both with JSDoc referencing D-08/D-09/D-10 |
| `tests/connections/account-connection.test.ts` | RED-then-GREEN HEALTH-02 tests for stamp/clear semantics | VERIFIED | Test file contains `describe("HEALTH-02: lastErrorAt stamp + clear"` with 6 it cases; full file passes |
| `tests/connections/connection-manager.test.ts` | RED-then-GREEN tests for delegating accessors | VERIFIED | Contains `describe("HEALTH-02: ConnectionManager health accessors"` with 6 it cases; 16/16 tests pass |
| `tests/tools/list-accounts.test.ts` | HEALTH-02/HEALTH-03 + V5 ASVS regression guard + `detail` removal sweep | VERIFIED | Contains `describe("HEALTH-02 / HEALTH-03: per-account health fields"` with 9 it cases including ECONNRESET assertion; 18/18 pass |
| `tests/polling/poller.test.ts` | CACHE-01 per-account tests + D-14 error-string tests + CACHE-02 freshness tests | VERIFIED | Contains `describe("CACHE-01: per-account lastPolledAt"`, `describe("D-14: query() per-account error strings"`, `describe("CACHE-02: freshness block"` |
| `tests/tools/get-new-mail.test.ts` | Cold-cache rewritten to isError:false + freshness pass-through | VERIFIED | Contains `describe("CACHE-02 / D-14: cold-cache returns errors not isError=true"`; old isError:true cold-cache test gone; 10/10 pass |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `list-accounts.ts` reconnecting | hardcoded `last_error: null` | Explicit literal null (NEVER `status.lastError`) | WIRED | Line 72: `last_error: null` in reconnecting branch; `grep -c 'status\.lastError' = 0` |
| `list-accounts.ts` suspended | `status.reason` from humanReason | `last_error: status.reason` | WIRED | Line 83: `last_error: status.reason` |
| `list-accounts.ts` all branches | `manager.getLastConnectedAt(id)?.toISOString() ?? null` | Plan 13-01 accessor | WIRED | Line 28: computed once and reused in every branch |
| `poller.ts` query success path | `this.lastPolledAt.set(accountId, new Date())` | Stamped AFTER `mergeIntoCache` | WIRED | poller.ts:248 mergeIntoCache → poller.ts:253 stamp; ordering enforced by physical layout |
| `poller.ts` seed-vs-incremental | `this.lastPolledAt.get(accountId) ?? null` | Per-account history check | WIRED | Lines 226-235 |
| `connection-manager.ts` delegates | `this.connections.get(id)?.getX() ?? null` | Delegation to AccountConnection accessors | WIRED | Lines 92-102 all three follow this pattern |
| `get-new-mail.ts` handler | `poller.query(...)` returning `GetNewMailResult` | Direct delegation, no isCacheReady gate | WIRED | Lines 57-60: query + return; no early-failure branch |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `handleListAccounts` | `accounts` array | `manager.getAccountIds()` + per-account `getStatus`/`getLastConnectedAt`/`getConfig` | Yes — derived from live ConnectionManager state populated by `connectAll()` and reconnect loop | FLOWING |
| `Poller.query` `freshness` map | `lastPolled` from `this.lastPolledAt.get(id)` | Stamped by `pollAccount` success path (line 253) after `mergeIntoCache` | Yes — written every successful poll | FLOWING |
| `Poller.query` `results` array | `this.cache.get(id)` filtered by since/excludeKeywords | Written by `mergeIntoCache` during `pollAccount` | Yes — populated from `searchMessages` | FLOWING |
| `Poller.query` `errors` map | Stock-string literals or `status.reason`/`status.error`/`status.attempt` | Derived from `manager.getStatus(id)` | Yes — runtime status-driven | FLOWING |
| `handleGetNewMail` content | `JSON.stringify(result)` | `poller.query(...)` | Yes — direct passthrough | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `handleListAccounts` exports function | `node -e "const m = require('./build/tools/list-accounts.js'); console.log(typeof m.handleListAccounts)"` | `function` | PASS |
| `LIST_ACCOUNTS_TOOL` exported | (same node probe) | `object` | PASS |
| Full Vitest suite green | `npm test` | `Test Files 20 passed (20); Tests 280 passed (280)` | PASS |
| TypeScript clean | `npx tsc --noEmit` | exit 0, no output | PASS |
| Stock-string prefixes in source | `grep -E "no cache yet\|account reconnecting\|account suspended" src/polling/poller.ts` | All three prefixes found at runtime-emission sites | PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|-------------|--------|----------|
| HEALTH-01 | 13-01, 13-04 | Suspended variant distinct from existing states (fatal/non-retryable) | SATISFIED | Phase 12 introduced variant; Plan 13-04 made it observable in `get_new_mail` via `"account suspended: <reason>"` stock-string (poller.ts:122); REQUIREMENTS.md marked Done (commit 9309811) |
| HEALTH-02 | 13-01, 13-02 | `list_accounts` includes `status`, `last_error`, `last_error_at`, `last_connected_at` per account | SATISFIED | All 5 branches in list-accounts.ts:30-86 emit the four flat fields; AccountConnection field + accessors + ConnectionManager delegation underpin it; REQUIREMENTS.md marked Done (commit 84ae905) |
| HEALTH-03 | 13-01, 13-02 | Health metadata detailed enough to explain WHY account unavailable | SATISFIED | Reconnecting branch carries `attempt` + `next_retry_at`; suspended carries stock `humanReason` reason + `last_error_at`; error branch carries `status.error`; REQUIREMENTS.md marked Done (commit 84ae905) |
| CACHE-01 | 13-03 | Poller tracks `last_polled_at` per account (replacing global timestamp) | SATISFIED | poller.ts:24 `Map<string, Date \| null>`; line 59 `getLastPolledAt(accountId)`; line 253 post-merge stamp; REQUIREMENTS.md marked Done (commit 0474625) |
| CACHE-02 | 13-04 | `get_new_mail` exposes `last_polled_at` + `cache_age_seconds` per account | SATISFIED | poller.ts:99-111 always-present freshness; src/types.ts:137-149 type contract; REQUIREMENTS.md marked Done (commit 9309811) |
| CACHE-03 | (deferred) | 30-day eviction on poll merge | DEFERRED | Explicitly deferred to v0.4+ on 2026-06-12 per phase brief and REQUIREMENTS.md note; not a Phase 13 obligation |

### Anti-Patterns Found

None. Scan of all 6 modified source files in Phase 13 found:
- Zero `TBD`/`FIXME`/`XXX`/`TODO`/`HACK` debt markers
- Zero stub return patterns (`return null` / `return {}` / `return []` as standalone returns) — note: legitimate ` ?? null` fallbacks for unknown-account accessors are intentional and documented
- Zero `console.log` placeholder bodies
- Zero `placeholder` / `coming soon` / `not implemented` text

### Probe Execution

No conventional `scripts/*/tests/probe-*.sh` paths exist in this repository. Phase 13's verification contract is gated entirely on `npm test` + `npx tsc --noEmit` + grep-based source acceptance criteria, which all pass.

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| (none declared) | n/a | n/a | SKIPPED — no probe scripts in repo |

### Critical Pattern Verification

**Pitfall 1 (V5 ASVS — `list_accounts` reconnecting branch must NOT echo raw `err.message`):**
- `grep -c 'status\.lastError' src/tools/list-accounts.ts` = 0
- `grep -c 'manager\.getLastError' src/tools/list-accounts.ts` = 0
- Reconnecting branch (lines 67-75) hardcodes `last_error: null`
- VERDICT: PASSED — V5 ASVS sealed at the list_accounts boundary

**Pitfall 1 sibling (V5 ASVS — `get_new_mail` suspended branch must NOT consult `manager.getLastError(id)`):**
- `grep -c 'getLastError\|getLastErrorAt' src/polling/poller.ts src/tools/get-new-mail.ts` = 0
- Suspended branch (poller.ts:120-123) uses only `status.reason` (stock string from humanReason)
- VERDICT: PASSED — V5 ASVS sealed at the get_new_mail boundary

**Pitfall 2 (Stamp AFTER mergeIntoCache):**
- poller.ts:248 `this.mergeIntoCache(accountId, headers)` precedes
- poller.ts:253 `this.lastPolledAt.set(accountId, new Date())`
- A thrown `searchMessages` call (caught by `poll()`'s outer try/catch at lines 184-188) leaves the timestamp unchanged
- VERDICT: PASSED — Pitfall 2 invariant enforced by physical statement ordering

**Pitfall 3 (`isCacheReady()` global gate must be GONE from production code):**
- `grep -rn 'isCacheReady' src/` = 0 matches
- `grep -rn 'isCacheReady' tests/` = 0 matches
- handleGetNewMail body reduced to 2 statements (query + return); no global gate
- VERDICT: PASSED — Pitfall 3 fully resolved across src/ AND tests/

### Human Verification Required

None. All Phase 13 must-haves are verifiable programmatically through:
- Source-code grep against snake_case field names, stock-string literals, and forbidden token absences
- TypeScript type checker against `AccountFreshness` / `GetNewMailResult` contracts
- Vitest assertions covering each status branch × each freshness field × V5 ASVS regression
- No UI / visual / real-time / external-service behavior is in scope for this phase — Phase 13 is purely a backend response-shape change

### Gaps Summary

No gaps. Phase 13 fully delivers its three ROADMAP success criteria. All five requirements (HEALTH-01, HEALTH-02, HEALTH-03, CACHE-01, CACHE-02) are observably satisfied in the production codebase. CACHE-03 was explicitly deferred to v0.4+ on 2026-06-12 with a documented rationale and is not part of this phase's obligation.

The three high-risk V5 ASVS / Pitfall patterns called out by the verification request all pass:
- list_accounts reconnecting branch does not echo `err.message` (Pitfall 1)
- get_new_mail suspended branch consults only `status.reason` (Pitfall 1 sibling)
- lastPolledAt stamping is post-merge (Pitfall 2)
- isCacheReady global gate is gone from production AND test code (Pitfall 3)

Test suite is at 280/280 passing. `npx tsc --noEmit` is clean. Both align with the inputs provided by the orchestrator.

---

*Verified: 2026-06-13T09:08:56Z*
*Verifier: Claude (gsd-verifier)*
