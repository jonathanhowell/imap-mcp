---
phase: 8
slug: account-context-and-tool-ergonomics
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-16
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing) |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npm test -- tests/tools/list-accounts.test.ts tests/connections/connection-manager.test.ts tests/config.test.ts tests/tools/list-messages.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- tests/tools/list-accounts.test.ts tests/connections/connection-manager.test.ts tests/config.test.ts tests/tools/list-messages.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 8-01-01 | 01 | 0 | ACTX-02 | unit | `npm test -- tests/tools/list-accounts.test.ts` | ❌ W0 | ⬜ pending |
| 8-01-02 | 01 | 0 | ACTX-02 | unit | `npm test -- tests/connections/connection-manager.test.ts` | ❌ W0 | ⬜ pending |
| 8-01-03 | 01 | 0 | ACTX-02 | unit | `npm test -- tests/config.test.ts` | ❌ W0 | ⬜ pending |
| 8-01-04 | 01 | 1 | ACTX-02 | unit | `npm test -- tests/config.test.ts` | ✅ | ⬜ pending |
| 8-01-05 | 01 | 1 | ACTX-02 | unit | `npm test -- tests/connections/connection-manager.test.ts` | ✅ | ⬜ pending |
| 8-01-06 | 01 | 1 | ACTX-01, ACTX-02 | unit | `npm test -- tests/tools/list-accounts.test.ts` | ❌ W0 | ⬜ pending |
| 8-02-01 | 02 | 0 | SRCH-06 | unit | `npm test -- tests/tools/list-messages.test.ts` | ❌ W0 | ⬜ pending |
| 8-02-02 | 02 | 1 | SRCH-06 | unit | `npm test -- tests/tools/list-messages.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/tools/list-accounts.test.ts` — stubs covering ACTX-01 (display_name present/absent) and ACTX-02 (email present, fallback to username)
- [ ] New test cases in `tests/connections/connection-manager.test.ts` — stubs for `getConfig()` method (known account returns config, unknown returns undefined)
- [ ] New test cases in `tests/config.test.ts` — stubs for `email` field validation on `AccountSchema`
- [ ] New test cases in `tests/tools/list-messages.test.ts` — stubs for SRCH-06 (no folder → INBOX default, explicit folder → unchanged)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| MCP inspector shows `folder` not in required array | SRCH-06 | Schema inspection via MCP protocol | Run `npm run build && npx @modelcontextprotocol/inspector build/index.js`, inspect list_messages tool schema |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
