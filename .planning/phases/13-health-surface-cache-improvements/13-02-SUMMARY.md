---
phase: 13-health-surface-cache-improvements
plan: 02
subsystem: tools
tags: [list-accounts, mcp-tool, health-fields, v5-asvs, t-12-09, tdd, vitest, snake-case-boundary]

# Dependency graph
requires:
  - phase: 13-health-surface-cache-improvements
    plan: 01
    provides: "ConnectionManager.getLastConnectedAt(id) — Date | null read consumed by every branch of the new switch"
  - phase: 12-connection-resilience-foundation
    provides: "Sealed 4-state AccountConnectionStatus union (connecting | connected | reconnecting | suspended); reconnecting carries {attempt, nextRetryAt, lastError}; suspended carries {reason: stock string from humanReason(), since: Date}; humanReason() V5 ASVS contract"
provides:
  - "list_accounts MCP response shape v0.3: flat snake_case health fields on every entry (last_connected_at, last_error, last_error_at)"
  - "Reconnecting branch additionally carries `attempt` + `next_retry_at` (ISO from status.nextRetryAt)"
  - "T-13-03 V5 ASVS regression guard: reconnecting branch hardcodes last_error: null, never reads status.lastError; enforced by a dedicated test plus a grep-of-source acceptance criterion"
  - "D-03 breaking change applied: the legacy free-form `detail` field is fully removed from every branch (no occurrence in source, including comments)"
affects: [14-reconnect-account-tool, future-list-accounts-consumers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Computed-once `lastConnectedAt` const at the top of the per-entry map callback, reused across every branch — keeps the ISO conversion (`.toISOString() ?? null`) in one place"
    - "Comment hygiene: literal strings used as grep acceptance signals (`detail`, `status.lastError`) must not appear in source comments either — phrased the security and breaking-change notes so the literal tokens do not appear (preserves the grep-zero acceptance criterion as a regression guard)"
    - "Mock-manager helper extends to test the V5 ASVS contract by exposing `lastErrorRaw` in the reconnecting status object and asserting the tool layer does NOT echo it"

key-files:
  created: []
  modified:
    - "src/tools/list-accounts.ts — rewrote handleListAccounts switch to emit Phase 13 flat health shape; `detail` removed everywhere; reconnecting branch hardcodes last_error: null per T-13-03"
    - "tests/tools/list-accounts.test.ts — migrated makeManager off legacy `failed` status (Pitfall 5 resolved); added HEALTH-02/HEALTH-03 describe block with 9 cases including the V5 ASVS regression guard and the cross-branch `detail` removal sweep"

key-decisions:
  - "Hardcoded comment-phrasing rule: when a grep over the source file is the acceptance criterion (grep -c 'detail' returning 0 and grep -c 'status\\.lastError' returning 0), the literal token must also be absent from comments. Phrased the security comment using 'reconnecting status object carries a raw err.message field' instead of 'status.lastError stores RAW err.message' — same information, no literal match."
  - "Did NOT change handleListAccounts signature (still takes `manager: ConnectionManager` only). Plan 13-02 reads ONLY from the manager (Plan 13-01's accessors); Poller integration lives in Plan 13-04 (get_new_mail)."
  - "Reconnecting `last_error_at` is null (D-05). Even though the raw lastErrorAt timestamp would be available via `manager.getLastErrorAt(id)`, surfacing it on the reconnecting branch was deemed redundant with `next_retry_at` (and the consistency invariant for that branch is 'no error fields, look at temporal context')."

patterns-established:
  - "Acceptance grep tokens are case-sensitive literals; comment text in the source must respect them as if they were source-code tokens. Future plans that gate on `grep -c '<token>' src/...` must check that comments do not accidentally satisfy the count."
  - "Per-branch field ordering at the response boundary: `status` first, then branch-specific extras (e.g. `attempt`, `next_retry_at`), then the three health fields in the order `last_error, last_error_at, last_connected_at`. Consistent ordering makes JSON-snapshot reviews easier across plans."

requirements-completed: [HEALTH-02, HEALTH-03]

# Metrics
duration: 3.3min
completed: 2026-06-13
---

# Phase 13 Plan 02: list_accounts health-surface migration Summary

**Rewrote handleListAccounts switch to emit flat snake_case `last_connected_at` / `last_error` / `last_error_at` on every branch; dropped the legacy `detail` field per D-03; hardcoded `last_error: null` on the reconnecting branch per T-13-03 / V5 ASVS — agent can now distinguish "retrying after 4-hour network drop" from "credentials need fixing" using only the response payload.**

## Performance

- **Duration:** ~3.3 min
- **Started:** 2026-06-13T08:52:42Z
- **Completed:** 2026-06-13T08:56:02Z
- **Tasks:** 2 (RED + GREEN)
- **Files modified:** 2

## Accomplishments

- Migrated `tests/tools/list-accounts.test.ts` `makeManager` helper off the Phase 12-removed `failed` status to the live 4-state union (Pitfall 5 resolved). Helper now also mocks the three new Plan 13-01 accessors (`getLastConnectedAt`, `getLastError`, `getLastErrorAt`).
- Added a `describe("HEALTH-02 / HEALTH-03: per-account health fields")` block with 9 `it` cases covering every status branch × {`last_connected_at`, `last_error`, `last_error_at`}, the T-13-03 V5 ASVS regression guard (asserts `last_error` for a reconnecting account does NOT contain `ECONNRESET` / `192.168.0.5`), and a cross-branch sweep asserting `"detail" in entry === false` for every variant.
- Rewrote `src/tools/list-accounts.ts` switch to emit the Phase 13 flat shape on every branch:
  - Connected / connecting: `last_error: null`, `last_error_at: null`, `last_connected_at: <ISO|null>`
  - Reconnecting: `attempt` + `next_retry_at: status.nextRetryAt.toISOString()` + `last_error: null` + `last_error_at: null` + `last_connected_at` (security comment in place pointing at T-13-03 / T-12-09 / V5 ASVS)
  - Suspended: `last_error: status.reason` + `last_error_at: status.since.toISOString()` + `last_connected_at`
  - Error (unknown account): `last_error: status.error` + `last_error_at: null` + `last_connected_at`
- Dropped the legacy `detail` field from every branch (D-03 breaking change acknowledged by D-18).
- Full suite: 272 / 272 passing (+9 new HEALTH-02/HEALTH-03 tests vs. the 263 baseline that ships with Plans 13-01 + 13-03 merged). `npx tsc --noEmit` clean.

## Task Commits

Each task was committed atomically with `--no-verify` per the parallel-executor protocol:

1. **Task 1: RED — Extend list-accounts test with HEALTH-02/HEALTH-03 assertions** — `93b9ac1` (test)
2. **Task 2: GREEN — Extend handleListAccounts switch with health fields, remove detail** — `84ae905` (feat)

## Files Created/Modified

- `src/tools/list-accounts.ts` — rewrote the switch over `status.kind` to emit the Phase 13 health shape; `lastConnectedAt` computed once at the top of the per-entry callback and reused across branches; security comment in the reconnecting branch documents the T-13-03 contract without using the literal `status.lastError` token (so the grep acceptance criterion stays as a regression guard).
- `tests/tools/list-accounts.test.ts` — `makeManager` helper signature extended with `since`, `lastErrorRaw`, `lastConnectedAt`, `lastErrorAt`; `failed` branch removed; `suspended` and live-shape `reconnecting` branches added; 3 new mock accessors on the returned manager; new `HEALTH-02 / HEALTH-03` describe block with 9 `it` cases.

## Decisions Made

- **Comment-phrasing hygiene around grep acceptance criteria.** The plan's acceptance criteria include `grep -c 'detail' src/tools/list-accounts.ts` returning 0 and `grep -c 'status\.lastError' src/tools/list-accounts.ts` returning 0 — both as regression guards. After the first GREEN run, the grep-detail count was 2 (both in comments) and the grep-status.lastError count was 1 (in the security comment). Resolved by reformulating the comments so the same security/breaking-change information is conveyed without the literal tokens. This keeps the grep guards usable for future audits — if anyone re-introduces a `detail` field or a `status.lastError` read, the grep will catch it.
- **No signature change to `handleListAccounts(manager: ConnectionManager)`.** Plan 13-02 is purely a switch-statement rewrite + extension; the Poller is not consulted for `list_accounts` (per CONTEXT.md D-08 / D-14 / Plan 13-04, freshness fields live on `get_new_mail`, not on `list_accounts`).
- **Reconnecting `last_error_at` is null.** Even though `manager.getLastErrorAt(id)` would return a meaningful Date for a reconnecting account, surfacing it would partially defeat the T-13-03 sanitization intent (an `last_error: null` paired with a `last_error_at: <date>` would imply "we have an error, just hiding it" — confusing the agent's branch logic). The reconnecting branch's "no error fields, look at `attempt` + `next_retry_at`" invariant is cleaner.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Source comments accidentally satisfied the grep regression guards**

- **Found during:** Task 2 verification — first grep pass after GREEN
- **Issue:** The acceptance criteria `grep -c 'detail' src/tools/list-accounts.ts == 0` and `grep -c 'status\.lastError' src/tools/list-accounts.ts == 0` failed (counts were 2 and 1 respectively) because my GREEN implementation included explanatory comments mentioning the literal tokens:
  - `// D-03: \`detail\` removed. last_error carries the same content via the new flat shape.`
  - `// status.lastError stores RAW err.message ...`
- **Root cause:** The acceptance criteria are intentionally `grep -c '<token>'` returning 0 as regression guards: they assume the literal token is forbidden everywhere in the file. Comments that helpfully name the removed token defeat the guard for future audits — if someone later adds a `detail` field, the grep would still report a non-zero count and not flag the regression as new.
- **Fix:** Reformulated both comments to convey the same information without the literal tokens. The D-03 note now reads "legacy free-form error key fully removed; last_error carries the same content via the flat shape." The reconnecting security comment now reads "the reconnecting status object carries a raw err.message field ... That raw text may include auth.user or transport metadata and MUST NOT be echoed."
- **Files modified:** `src/tools/list-accounts.ts` (two comment blocks)
- **Verification:** After the rewording, `grep -c 'detail' src/tools/list-accounts.ts == 0` and `grep -c 'status\.lastError' src/tools/list-accounts.ts == 0` both hold. All 18 tests still pass. Full suite still 272 / 272. `tsc --noEmit` still clean.
- **Committed in:** `84ae905` (Task 2 — bundled with the implementation so the file enters the repo in compliant shape).

---

**Total deviations:** 1 auto-fixed (Rule 1 — verification-driven comment hygiene). No Rule 2, 3, or 4 deviations.
**Impact on plan:** Zero behavioral change; pure comment hygiene. The regression-guard semantics of the grep acceptance criteria are preserved. Pattern documented in `patterns-established` so future plans that gate on grep tokens know to audit comment text too.

## Issues Encountered

- **Worktree branched off pre-Wave-1.** Same situation Plan 13-01 documented. The worktree HEAD was at `31d7d2b` (post-Phase-12) but Plans 13-01 + 13-03 had already merged to main at `6f6f33b`. Resolved by `git merge main --no-edit` (fast-forward; no conflicts). Documented for the orchestrator: parallel-wave worktrees created from a base before sibling-wave plans land on main need a fast-forward merge before Wave 2 can read the accessor surface (which is what Wave 2 *depends on*). Per the destructive-git prohibition, fast-forward is non-destructive (no commit rewriting, no force operations).

## Threat Flags

No new threat surface introduced. The plan's STRIDE register (T-13-03) anticipated the V5 ASVS pitfall and the implementation honors it: the reconnecting branch hardcodes `last_error: null`, the source file does not contain a `status.lastError` read (grep-verified), and a dedicated regression test (`reconnecting account: last_error MUST NOT contain the raw error message text`) gates the behavior.

The `last_error: status.reason` surface on the suspended branch consumes `humanReason()`'s stock-string output, classified `accept (mitigated by Phase 12 design)` in the threat register. The error (unknown account) branch surfaces `status.error` which originates inside `ConnectionManager.getStatus()` — a controlled "account is not configured" string, never user-controlled.

## Self-Check: PASSED

**Verified files exist (or were modified) by `[ -f path ]`:**

- FOUND: `src/tools/list-accounts.ts`
- FOUND: `tests/tools/list-accounts.test.ts`

**Verified commits exist by `git log --oneline | grep <hash>`:**

- FOUND: `93b9ac1` (Task 1 — RED test commit)
- FOUND: `84ae905` (Task 2 — GREEN feat commit)

**Verified plan-level invariants:**

- `grep -c 'detail' src/tools/list-accounts.ts` → 0 ✓
- `grep -c 'status\.lastError' src/tools/list-accounts.ts` → 0 ✓ (V5 ASVS regression guard)
- `grep -c 'last_connected_at' src/tools/list-accounts.ts` → 6 (≥1 required) ✓
- `grep -c 'last_error:' src/tools/list-accounts.ts` → 5 (one per branch: error, connected, connecting, reconnecting, suspended) ✓
- `grep -c 'last_error_at:' src/tools/list-accounts.ts` → 5 ✓
- `grep -c 'next_retry_at:' src/tools/list-accounts.ts` → 1 ✓
- `grep -c 'last_error: status.reason' src/tools/list-accounts.ts` → 1 ✓
- `grep -c 'last_error: null' src/tools/list-accounts.ts` → 3 (≥3 required: connected, connecting, reconnecting) ✓
- `grep -c 'manager\.getLastConnectedAt' src/tools/list-accounts.ts` → 1 ✓
- `grep -c 'HEALTH-02 / HEALTH-03: per-account health fields' tests/tools/list-accounts.test.ts` → 1 ✓
- `grep -cE '"failed"' tests/tools/list-accounts.test.ts` → 0 ✓ (legacy status removed)
- 9 `it` cases inside the HEALTH-02/HEALTH-03 describe block ✓
- `npm test -- tests/tools/list-accounts.test.ts` → 18 / 18 passing ✓
- `npm test` (full suite) → 272 / 272 passing ✓
- `npx tsc --noEmit` → clean ✓

## User Setup Required

None — pure code surface change with no external service configuration or secret rotation.

## Next Phase Readiness

- **Plan 13-04 (`handleGetNewMail` per-account cold-cache + freshness — CACHE-02 / Success Criterion 2 + 3):** unblocked. Plan 13-04 owns the get_new_mail freshness:{} block and the per-account cold-cache distinction; it consumes Plan 13-03's `poller.getLastPolledAt(id)` directly and does NOT need anything new from Plan 13-02.
- **Phase 13 sub-criterion 1 (list_accounts agent observability):** observably true after this plan. An agent calling list_accounts can distinguish:
  - "connected, last_connected_at: <recent>, last_error: null" → healthy
  - "connecting, last_connected_at: <recent>, last_error: null" → boot-time normal
  - "reconnecting, attempt: 7, next_retry_at: <ISO>, last_error: null" → transient network problem, server is retrying
  - "suspended, last_error: 'Authentication failed — fix credentials', last_error_at: <ISO>" → credentials need fixing
  - "error, last_error: 'account "x" is not configured', last_connected_at: null" → typo in account name
- **Phase 14 (`reconnect_account` tool):** consumes `manager.getStatus()` directly, not the list_accounts surface. No coupling introduced.
- **CHANGELOG follow-up (D-18):** add a v0.3 release-note bullet that the `detail` field in `list_accounts` responses is replaced by the flat `last_error` / `last_error_at` / `last_connected_at` fields, and that the reconnecting branch additionally carries `attempt` + `next_retry_at`. Capture before milestone ship; not blocking for the Wave 2 continuation.

---

*Phase: 13-health-surface-cache-improvements*
*Plan: 02*
*Completed: 2026-06-13*
