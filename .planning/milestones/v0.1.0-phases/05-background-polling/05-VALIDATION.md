---
phase: 5
slug: background-polling
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | `vitest.config.ts` (project root) |
| **Quick run command** | `npm test -- tests/polling/poller.test.ts tests/tools/get-new-mail.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- tests/polling/poller.test.ts tests/tools/get-new-mail.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 5-01-01 | 01 | 0 | POLL-01, POLL-02, POLL-03 | unit stubs | `npm test -- tests/polling/poller.test.ts tests/tools/get-new-mail.test.ts` | ❌ W0 | ⬜ pending |
| 5-02-01 | 02 | 1 | POLL-01 | unit | `npm test -- tests/polling/poller.test.ts` | ❌ W0 | ⬜ pending |
| 5-02-02 | 02 | 1 | POLL-01 | unit | `npm test -- tests/polling/poller.test.ts` | ❌ W0 | ⬜ pending |
| 5-03-01 | 03 | 1 | POLL-02 | unit | `npm test -- tests/polling/poller.test.ts` | ❌ W0 | ⬜ pending |
| 5-03-02 | 03 | 1 | POLL-02 | unit | `npm test -- tests/polling/poller.test.ts` | ❌ W0 | ⬜ pending |
| 5-04-01 | 04 | 2 | POLL-03 | unit | `npm test -- tests/tools/get-new-mail.test.ts` | ❌ W0 | ⬜ pending |
| 5-04-02 | 04 | 2 | POLL-03 | unit | `npm test -- tests/tools/get-new-mail.test.ts` | ❌ W0 | ⬜ pending |
| 5-05-01 | 05 | 3 | POLL-01, POLL-02, POLL-03 | integration | `npm test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/polling/poller.test.ts` — stubs for POLL-01, POLL-02 (Poller class unit tests with vitest fake timers + mock ConnectionManager)
- [ ] `tests/tools/get-new-mail.test.ts` — stubs for POLL-03 (handler unit tests with mock Poller)
- [ ] `tests/polling/` directory — create alongside poller test file

*No new framework install needed — vitest 4.x already installed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Polling loop recovers after IMAP drop without crashing server | POLL-02 | Requires live IMAP disconnection simulation | Start server, kill IMAP connection, verify logs show recovery and polling resumes |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
