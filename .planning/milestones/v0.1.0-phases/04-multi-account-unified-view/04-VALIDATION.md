---
phase: 4
slug: multi-account-unified-view
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | `vitest.config.ts` (project root) |
| **Quick run command** | `npm test -- tests/tools/list-messages.test.ts tests/tools/list-folders.test.ts tests/tools/search-messages.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- tests/tools/list-messages.test.ts tests/tools/list-folders.test.ts tests/tools/search-messages.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 4-01-01 | 01 | 1 | ACCT-01 | unit | `npm test -- tests/tools/list-messages.test.ts` | ✅ extend existing | ⬜ pending |
| 4-01-02 | 01 | 1 | ACCT-01 | unit | `npm test -- tests/tools/list-folders.test.ts` | ✅ extend existing | ⬜ pending |
| 4-01-03 | 01 | 1 | ACCT-01 | unit | `npm test -- tests/tools/search-messages.test.ts` | ✅ extend existing | ⬜ pending |
| 4-02-01 | 02 | 2 | ACCT-02 | unit | `npm test -- tests/tools/list-messages.test.ts` | ✅ extend existing | ⬜ pending |
| 4-02-02 | 02 | 2 | ACCT-02 | unit | `npm test -- tests/tools/list-messages.test.ts` | ✅ extend existing | ⬜ pending |
| 4-03-01 | 03 | 2 | ACCT-03 | unit | `npm test -- tests/tools/list-messages.test.ts` | ✅ extend existing | ⬜ pending |
| 4-03-02 | 03 | 2 | ACCT-03 | unit | `npm test -- tests/tools/list-messages.test.ts` | ✅ extend existing | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. The three affected test files already exist and follow established mocking patterns. New test cases are additions to existing `describe` blocks, not new files.

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
