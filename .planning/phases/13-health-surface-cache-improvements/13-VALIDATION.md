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
| **Quick run command** | `npm test -- src/tools/list-accounts.test.ts src/tools/get-new-mail.test.ts src/polling/poller.test.ts` |
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

> Populated by the planner. Every plan task must map to at least one row here OR a Wave 0 row.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 13-XX-XX | XX | X | HEALTH-01 / HEALTH-02 / HEALTH-03 / CACHE-01 / CACHE-02 | unit / integration / UAT | `npm test -- <path>` | ⬜ TBD | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

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
