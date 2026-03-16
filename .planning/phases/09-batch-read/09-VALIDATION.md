---
phase: 9
slug: batch-read
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-16
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.0.18 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm test -- --reporter=verbose tests/tools/read-messages.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --reporter=verbose tests/tools/read-messages.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 9-01-01 | 01 | 0 | BATCH-01, BATCH-02 | unit | `npm test -- tests/tools/read-messages.test.ts` | ❌ W0 | ⬜ pending |
| 9-02-01 | 02 | 1 | BATCH-01 | unit | `npm test -- tests/tools/read-messages.test.ts` | ❌ W0 | ⬜ pending |
| 9-02-02 | 02 | 1 | BATCH-01 | unit | `npm test -- tests/tools/read-messages.test.ts` | ❌ W0 | ⬜ pending |
| 9-02-03 | 02 | 1 | BATCH-01 | unit | `npm test -- tests/tools/read-messages.test.ts` | ❌ W0 | ⬜ pending |
| 9-02-04 | 02 | 1 | BATCH-02 | unit | `npm test -- tests/tools/read-messages.test.ts` | ❌ W0 | ⬜ pending |
| 9-03-01 | 03 | 2 | BATCH-01 | unit | `npm test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/tools/read-messages.test.ts` — stubs for BATCH-01 and BATCH-02

*No framework or fixture gaps — vitest is installed, existing test helpers in `read-message.test.ts` serve as models.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `read_message` (singular) still works end-to-end after registration change | BATCH-01 | Regression guard against index.ts changes | Run `npm test -- tests/tools/read-message.test.ts` and confirm all existing tests pass |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
