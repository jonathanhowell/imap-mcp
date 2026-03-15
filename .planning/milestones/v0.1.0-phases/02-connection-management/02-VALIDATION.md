---
phase: 2
slug: connection-management
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-11
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.0.18 |
| **Config file** | `vitest.config.ts` (exists) |
| **Quick run command** | `npx vitest run tests/connections/` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/connections/`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 0 | CONN-01, CONN-02, CONN-03 | stub | `npx vitest run tests/connections/` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | CONN-01 | unit | `npx vitest run tests/connections/account-connection.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 1 | CONN-02 | unit | `npx vitest run tests/connections/account-connection.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-04 | 01 | 1 | CONN-03 | unit | `npx vitest run tests/connections/connection-manager.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-05 | 01 | 2 | CONN-01, CONN-03 | unit | `npx vitest run tests/connections/connection-manager.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-06 | 01 | 2 | CONN-02, CONN-03 | unit | `npx vitest run tests/connections/account-connection.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/connections/account-connection.test.ts` — stubs for CONN-01, CONN-02 (state machine tests)
- [ ] `tests/connections/connection-manager.test.ts` — stubs for CONN-01, CONN-03 (isolation tests)
- [ ] `src/connections/account-connection.ts` — new implementation file
- [ ] `src/connections/connection-manager.ts` — new implementation file
- [ ] `src/connections/index.ts` — re-exports
- [ ] `npm install imapflow` — imapflow not yet in package.json

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Integration: connect to real IMAP server | CONN-01 | Requires live credentials | Set env vars, run integration test suite against real IMAP server |
| Graceful shutdown closes connections | CONN-01 | Process signal behavior | Start server, send SIGTERM, verify connections closed in logs |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
