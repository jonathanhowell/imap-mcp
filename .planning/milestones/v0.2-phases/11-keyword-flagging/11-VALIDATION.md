---
phase: 11
slug: keyword-flagging
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-18
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | `vitest.config.ts` / `package.json` |
| **Quick run command** | `npm test -- --run` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --run`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | KFLAG-01, KFLAG-04 | type-check | `npx tsc --noEmit src/types.ts src/tools/flag-message.ts` | ✅ after task | ⬜ pending |
| 11-01-02 | 01 | 1 | KFLAG-01, KFLAG-04 | unit | `npm test -- tests/tools/flag-message.test.ts` | ✅ after task | ⬜ pending |
| 11-02-01 | 02 | 2 | KFLAG-02 | unit | `npm test -- tests/tools/search-messages.test.ts` | ✅ after task | ⬜ pending |
| 11-02-02 | 02 | 2 | KFLAG-03 | unit | `npm test` | ✅ after task | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements — no Wave 0 needed. All tasks create their test files inline.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PERMANENTFLAGS warning on real IMAP server without `\*` | KFLAG-04 | Requires a live IMAP server that doesn't advertise `\*` | Connect to such a server, open a mailbox, verify warning appears in logs |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
