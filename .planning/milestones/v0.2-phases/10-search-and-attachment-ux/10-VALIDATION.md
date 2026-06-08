---
phase: 10
slug: search-and-attachment-ux
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-16
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.0.18 |
| **Config file** | `vitest.config.ts` (root) |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | SRCH-05 | unit | `npm test -- --reporter=verbose tests/tools/search-messages.test.ts` | ✅ | ⬜ pending |
| 10-01-02 | 01 | 1 | SRCH-05 | unit | `npm test -- --reporter=verbose tests/tools/search-messages.test.ts` | ✅ | ⬜ pending |
| 10-02-01 | 02 | 1 | ATCH-01 | unit | `npm test -- --reporter=verbose tests/tools/download-attachment.test.ts` | ✅ | ⬜ pending |
| 10-02-02 | 02 | 1 | ATCH-01 | unit | `npm test -- --reporter=verbose tests/tools/download-attachment.test.ts` | ✅ | ⬜ pending |
| 10-02-03 | 02 | 1 | ATCH-01 | unit | `npm test -- --reporter=verbose tests/tools/download-attachment.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

Both `tests/tools/search-messages.test.ts` and `tests/tools/download-attachment.test.ts` exist and import the correct modules. New test cases are added as describe blocks inside existing files; no new test files or framework config needed.

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
