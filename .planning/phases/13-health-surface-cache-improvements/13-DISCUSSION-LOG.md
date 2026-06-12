# Phase 13: Health Surface + Cache Improvements - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in 13-CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-12
**Phase:** 13-health-surface-cache-improvements
**Areas discussed:** list_accounts shape, get_new_mail freshness, Cold-cache vs disconnected, Cache eviction policy

---

## Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| list_accounts shape | Field layout for health (flat vs nested); status-kind variations; null/missing handling | ✓ |
| get_new_mail freshness | Placement of last_polled_at + cache_age_seconds; server vs client age computation | ✓ |
| Cold-cache vs disconnected | Success Criterion 4 — distinguish "no cache yet" from "account disconnected" | ✓ |
| Cache eviction policy | CACHE-03 — 30-day sliding window; timestamp source, trigger, empty-acct handling | ✓ |

**User's choice:** All four selected.

---

## Area 1: list_accounts response shape

### Q1: How should the new health fields land in list_accounts?

| Option | Description | Selected |
|--------|-------------|----------|
| Flat — extend object | Add last_error, last_error_at, last_connected_at as flat fields alongside status/detail/attempt. Minimal disruption. (Recommended) | |
| Nested health:{} | Group all health metadata under a health:{} object. Cleaner taxonomy but breaks current consumers. | |
| Flat + drop detail | Flat fields + remove `detail` (its content becomes last_error). Cleaner final API, breaks Phase 12 callers. | ✓ |

**User's choice:** Flat + drop detail.
**Notes:** Mid-milestone; no external consumers shipped against Phase 12 `detail` shape — accept the breaking change for a cleaner API.

### Q2: What goes in last_error/last_error_at when status is `connected`?

| Option | Description | Selected |
|--------|-------------|----------|
| null | last_error=null, last_error_at=null on connected account. Explicit "no error currently." (Recommended) | ✓ |
| Omit fields | Don't include keys at all when connected. Smaller response, ambiguous semantics. | |
| Keep historical | Preserve last error after successful reconnect. Contradicts Phase 12 line 229 clearing. | |

**User's choice:** null.
**Notes:** Aligns with Phase 12's `this.lastError = null` clear on successful reconnect.

### Q3: Should `next_retry_at` be exposed in list_accounts?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, when reconnecting | Include next_retry_at only on `reconnecting` status. (Recommended) | ✓ |
| No — out of scope | Not in HEALTH-02; skip it. | |

**User's choice:** Yes, when reconnecting.

### Q4: Suspended `since` timestamp — surface it?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — as last_error_at | When suspended, last_error_at = status.since. Reuses existing field. (Recommended) | ✓ |
| Separate suspended_since | Add dedicated suspended_since:Date field; keep last_error_at for transient only. | |

**User's choice:** Yes — as last_error_at.

---

## Area 2: get_new_mail freshness surfacing

### Q1: Where should per-account freshness data live in the response?

| Option | Description | Selected |
|--------|-------------|----------|
| freshness:{} keyed map | Top-level freshness:{account_id:{...}} alongside results/errors. Discoverable, scales cleanly. (Recommended) | ✓ |
| meta:{} block | Group under meta: {...}. Room for future metadata, adds nesting. | |
| Per-result inline | Add timestamps to each message in results[]. Redundant, balloons response. | |

**User's choice:** freshness:{} keyed map.

### Q2: When account has never been polled, what shows in freshness?

| Option | Description | Selected |
|--------|-------------|----------|
| null both fields | last_polled_at: null, cache_age_seconds: null. Explicit "never polled." (Recommended) | ✓ |
| Omit account entry | Drop the account key entirely. Smaller but ambiguous. | |
| Sentinel cache_age_seconds: -1 | Numeric sentinel. Footgun if forgotten. | |

**User's choice:** null both fields.

### Q3: How should cache_age_seconds be computed?

| Option | Description | Selected |
|--------|-------------|----------|
| Server-computed at response | Math.floor((Date.now() - last_polled_at)/1000) at response time. (Recommended) | ✓ |
| Client derives from timestamp | Only return last_polled_at; agent computes. Clock-skew risk. | |

**User's choice:** Server-computed at response.

---

## Area 3: Cold-cache vs disconnected distinction

### Q1: How should get_new_mail handle a mix of healthy and unhealthy accounts?

| Option | Description | Selected |
|--------|-------------|----------|
| Partial results + errors | Per-account gate. Healthy accounts return cached results; unhealthy populate errors:{}. (Recommended) | ✓ |
| All-or-nothing per-account gate | If any requested account is unhealthy, isError:true and no results. Simpler but loses data. | |
| Drop the gate entirely | No special-case; always return whatever's in cache. Maximum transparency, loses hint. | |

**User's choice:** Partial results + errors.
**Notes:** User asked clarifying question about "what is the global cold cache gate?" — explained `isCacheReady()` at `get-new-mail.ts:51` returns true once any poll cycle completes for any account, gating ALL calls during server boot. Re-presented question with grounding.

### Q2: What error strings distinguish the failure modes in errors:{}?

| Option | Description | Selected |
|--------|-------------|----------|
| Three stock string variants | 'no cache yet — polling has not completed' / 'account reconnecting (attempt N)' / 'account suspended: <reason>'. Stable taxonomy. (Recommended) | ✓ |
| Structured error object | Each errors[account] is an object with reason_code/message/attempt. Programmatic but breaks Record<string,string> pattern. | |

**User's choice:** Three stock string variants.

### Q3: When the user passes account='fastmail' for a single unhealthy account, what's the response shape?

| Option | Description | Selected |
|--------|-------------|----------|
| errors entry + isError:false | Same shape as multi-account case. No branching on whether `account` was specified. (Recommended) | ✓ |
| isError:true with message | Singular account request fails fast. Forces agent branching. | |

**User's choice:** errors entry + isError:false.

---

## Area 4: Cache eviction policy

### Initial framing (3 questions): timestamp source, trigger, empty-acct handling

User clarification request: "this is an in memory cache that dies with the process. so we can probably skip cache eviction altogether for now"

Discussion: confirmed implementation cost is trivial (one filter line), so skipping is about scope discipline. Memory cost not catastrophic (~tens of MB even on 60-day uptime with busy account). Long-uptime scenario wants CACHE-DISK + IDLE anyway → deferring CACHE-03 to v0.4+ pairs it correctly.

### Q (re-framed): Confirm CACHE-03 (30-day eviction) handling for Phase 13?

| Option | Description | Selected |
|--------|-------------|----------|
| Defer to v0.4+ | Drop CACHE-03 from Phase 13. Move to "Cache Evolution" alongside CACHE-IDLE/CACHE-DISK. Update REQUIREMENTS.md + ROADMAP.md. (Recommended given rationale) | ✓ |
| Keep CACHE-03 | Implement now — trivial one-line filter, hedges long-uptime. | |

**User's choice:** Defer to v0.4+.
**Notes:** Scope reduction confirmed. REQUIREMENTS.md updated (CACHE-03 moved to "Cache Evolution (likely v0.4+)" with rationale; Traceability table marked Deferred 2026-06-12). ROADMAP.md updated (CACHE-03 dropped from Phase 13 requirements; Success Criterion 3 removed and former Criterion 4 renumbered).

---

## Wrap-up

### Q: Anything else to explore, or ready to write CONTEXT.md?

**User's choice:** Ready for context.

---

## Claude's Discretion

None — every gray area was decided explicitly.

## Deferred Ideas

- CACHE-03 (30-day cache eviction) → v0.4+, paired with CACHE-DISK
- `reconnect_account` MCP tool → Phase 14
- IDLE-based cache freshness (CACHE-IDLE) → v0.4+
- Cache persistence (CACHE-DISK) → v0.4+
- Structured error-object shape for `errors:{}` → revisit if future phase needs programmatic reason codes
- `next_retry_at` for non-reconnecting states → not meaningful; only on reconnecting

## Reviewed Todos (not folded)

- `2026-03-19-prevent-flag-tools-from-modifying-reserved-imap-keywords.md` — borderline score (0.4); unrelated to health/cache; defer to future tools-hardening phase
