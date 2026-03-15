---
phase: 3
slug: core-read-operations
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-12
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.0.18 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm test -- --reporter=verbose` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --reporter=verbose`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 0 | MAIL-01, MAIL-02 | unit | `npm test -- tests/tools/list-folders.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 0 | MAIL-03, LIST-01–04 | unit | `npm test -- tests/tools/list-messages.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-03 | 01 | 0 | READ-01, READ-02 | unit | `npm test -- tests/tools/read-message.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-04 | 01 | 0 | READ-03, READ-04 | unit | `npm test -- tests/services/body-service.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-05 | 01 | 0 | READ-05 | unit | `npm test -- tests/tools/download-attachment.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-06 | 01 | 0 | SRCH-01–04 | unit | `npm test -- tests/tools/search-messages.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/tools/list-folders.test.ts` — covers MAIL-01, MAIL-02
- [ ] `tests/tools/list-messages.test.ts` — covers MAIL-03, LIST-01, LIST-02, LIST-03, LIST-04
- [ ] `tests/tools/read-message.test.ts` — covers READ-01, READ-02
- [ ] `tests/services/body-service.test.ts` — covers READ-03, READ-04
- [ ] `tests/tools/download-attachment.test.ts` — covers READ-05
- [ ] `tests/tools/search-messages.test.ts` — covers SRCH-01, SRCH-02, SRCH-03, SRCH-04
- [ ] Dependency install: `npm install html-to-text email-reply-parser && npm install --save-dev @types/html-to-text`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| LIST-STATUS extension fallback | MAIL-01 | Requires live IMAP server without RFC 5819 support | Connect to a server that lacks LIST-STATUS and verify folder counts still return |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
