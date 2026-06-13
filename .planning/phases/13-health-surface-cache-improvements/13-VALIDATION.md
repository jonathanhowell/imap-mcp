---
phase: 13
slug: health-surface-cache-improvements
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-13
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npm test -- tests/tools/list-accounts.test.ts tests/tools/get-new-mail.test.ts tests/polling/poller.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10-15 seconds (existing suite baseline) |

---

## Sampling Rate

- **After every task commit:** Run the focused file (e.g. `npm test -- src/polling/poller.test.ts`)
- **After every plan wave:** Run `npm test` (full suite)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

Every plan task maps to at least one automated verification command. Commands are the `<automated>` block from each task in the corresponding `13-0X-PLAN.md`.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 13-01-T1 | 01 | 1 | HEALTH-02 | unit (RED) | `npm test -- tests/connections/account-connection.test.ts` | ✅ | ⬜ pending |
| 13-01-T2 | 01 | 1 | HEALTH-02 | unit (GREEN) | `npm test -- tests/connections/account-connection.test.ts` + grep `lastErrorAt` stamp/clear assertions in `src/connections/account-connection.ts` | ✅ | ⬜ pending |
| 13-01-T3 | 01 | 1 | HEALTH-01, HEALTH-02, HEALTH-03 | unit (combined) | `npm test -- tests/connections/connection-manager.test.ts` + grep `getLastConnectedAt`/`getLastError`/`getLastErrorAt` signatures in `src/connections/connection-manager.ts` | ✅ | ⬜ pending |
| 13-02-T1 | 02 | 2 | HEALTH-02, HEALTH-03 | unit (RED) | `npm test -- tests/tools/list-accounts.test.ts` + remove `"failed"` status fixture (Pitfall 5) | ✅ | ⬜ pending |
| 13-02-T2 | 02 | 2 | HEALTH-02, HEALTH-03 | unit (GREEN) + ASVS guard | `npm test -- tests/tools/list-accounts.test.ts` + grep `detail` returns 0, grep `status.lastError` returns 0, grep `last_connected_at`/`last_error: null`/`last_error: status.reason` present | ✅ | ⬜ pending |
| 13-03-T1 | 03 | 1 | CACHE-01 | unit (RED) | `npm test -- tests/polling/poller.test.ts` + assert `["lastPollTime"]` seeds migrated to `["lastPolledAt"]` Map (4 sites — Pitfall 4) | ✅ | ⬜ pending |
| 13-03-T2 | 03 | 1 | CACHE-01 | unit (GREEN) | `npm test -- tests/polling/poller.test.ts` + `npx tsc --noEmit` + grep `lastPollTime` returns 0, grep `private lastPolledAt = new Map<string, Date \| null>()` present, grep `getLastPolledAt(accountId: string): Date \| null` present, grep `this.lastPolledAt.set(accountId, new Date())` present (Pitfall 2: stamp AFTER `mergeIntoCache`) | ✅ | ⬜ pending |
| 13-04-T1 | 04 | 2 | CACHE-02, HEALTH-01 | unit (RED) | `npm test` + grep `AccountFreshness`/`GetNewMailResult` in `src/types.ts` + D-14 + CACHE-02 describe blocks in `tests/polling/poller.test.ts` + old cold-cache test removed from `tests/tools/get-new-mail.test.ts` | ✅ | ⬜ pending |
| 13-04-T2 | 04 | 2 | CACHE-02, HEALTH-01 | unit (GREEN — poller) | `npm test -- tests/polling/poller.test.ts` + grep `isCacheReady` returns 0 in `src/polling/poller.ts`, grep three D-14 stock-string prefixes (`no cache yet — polling has not completed`, `account reconnecting (attempt`, `account suspended: ${status.reason}`), grep `freshness: Record<string, AccountFreshness>` present | ✅ | ⬜ pending |
| 13-04-T3 | 04 | 2 | CACHE-02, HEALTH-01 | integration (GREEN — handler) | `npm test` + `npx tsc --noEmit` + `grep -rc isCacheReady src/ tests/` summed = 0 (Pitfall 3: all 4 test callers + 2 production callers removed) + `isError: true` absent from `src/tools/get-new-mail.ts` (D-15 partial-results policy) | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Requirement Coverage

| Requirement | Tasks Covering | Count |
|-------------|----------------|-------|
| HEALTH-01 | 13-01-T3, 13-04-T1, 13-04-T2, 13-04-T3 | 4 |
| HEALTH-02 | 13-01-T1, 13-01-T2, 13-01-T3, 13-02-T1, 13-02-T2 | 5 |
| HEALTH-03 | 13-01-T3, 13-02-T1, 13-02-T2 | 3 |
| CACHE-01 | 13-03-T1, 13-03-T2 | 2 |
| CACHE-02 | 13-04-T1, 13-04-T2, 13-04-T3 | 3 |

---

## Wave 0 Requirements

Test files that exist today and will be EXTENDED (not created) — confirmed via research:

- [ ] `src/tools/list-accounts.test.ts` — extend with HEALTH-02/03 field-shape assertions, `detail` field-removal assertion, `last_error` ASVS-safety assertion for reconnecting branch
- [ ] `src/tools/get-new-mail.test.ts` — extend with CACHE-02 freshness-block assertions, D-14 three-error-string-prefix assertions (replaces existing cold-cache `isError: true` test)
- [ ] `src/polling/poller.test.ts` — extend with CACHE-01 per-account `lastPolledAt` Map semantics; migrate the 4 existing `["lastPollTime"]` seed locations to `["lastPolledAt"]`
- [ ] `src/connections/account-connection.test.ts` — extend with `lastErrorAt` stamp/clear assertions
- [ ] `src/connections/connection-manager.test.ts` — extend with new accessor pass-through assertions

*No new test files required — existing infrastructure covers all phase requirements via extension.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Agent can verbally distinguish "data is 8 minutes old" without extra tool calls | HEALTH-01 / CACHE-02 (Success Criterion 2) | Verifies agent UX, not server contract — requires a live MCP client session | Connect Claude Desktop to the server, call `get_new_mail`, ask "how old is this data?" — agent must answer using `cache_age_seconds` without re-querying |
| Agent can distinguish "retrying after 4-hour drop" from "credentials need fixing" | HEALTH-02 / HEALTH-03 (Success Criterion 1) | Same — agent-side phrasing test | Simulate a reconnecting account + a suspended account; call `list_accounts`; ask agent to explain each account's state — verify the language reflects `status` + `last_error_at` |
| Agent receives clear "no cache yet" vs "account disconnected" signal | Success Criterion 3 | Behavioral — confirms D-14 stock strings are agent-actionable | Boot server, immediately call `get_new_mail` (cold cache); suspend an account, call again — verify `errors:{}` strings produce distinct agent responses |

---

## Validation Sign-Off

- [ ] All plan tasks have `<automated>` verify entries OR Wave 0 dependencies pointing to an existing test file
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Every phase requirement (HEALTH-01, HEALTH-02, HEALTH-03, CACHE-01, CACHE-02) has at least one row in the Per-Task Verification Map
- [ ] No watch-mode flags in automated commands (CI-safe)
- [ ] Feedback latency < 15s
- [ ] Three D-14 error-string prefixes (`"no cache yet"`, `"account reconnecting"`, `"account suspended"`) each have a dedicated assertion
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
