---
phase: 7
slug: header-enrichment
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-15
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.0.18 |
| **Config file** | none — vitest auto-discovers `tests/**/*.test.ts` |
| **Quick run command** | `npx vitest run tests/tools/list-messages.test.ts tests/tools/search-messages.test.ts tests/tools/multi-account-types.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/tools/list-messages.test.ts tests/tools/search-messages.test.ts tests/tools/multi-account-types.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 7-01-01 | 01 | 1 | HDR-01, HDR-02 | unit | `npx vitest run tests/tools/list-messages.test.ts tests/tools/search-messages.test.ts tests/tools/multi-account-types.test.ts` | ✅ | ⬜ pending |
| 7-01-02 | 01 | 1 | HDR-01 | unit | `npx vitest run tests/tools/list-messages.test.ts` | ✅ | ⬜ pending |
| 7-01-03 | 01 | 1 | HDR-02 | unit | `npx vitest run tests/tools/search-messages.test.ts` | ✅ | ⬜ pending |
| 7-01-04 | 01 | 1 | HDR-01, HDR-02 | unit | `npx vitest run` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No new test files or framework installs needed.

*New test cases must be added inside the existing test files.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
