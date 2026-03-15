---
phase: 1
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-11
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.x |
| **Config file** | `vitest.config.ts` — Wave 0 gap (does not yet exist) |
| **Quick run command** | `npx vitest run` |
| **Full suite command** | `npx vitest run --coverage` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run`
- **After every plan wave:** Run `npx vitest run --coverage`
- **Before `/gsd:verify-work`:** Full suite green + `npx tsc --noEmit` passes
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 0 | CONF-01 | unit | `npx vitest run tests/config.test.ts -t "multi-account"` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 0 | CONF-01 | unit | `npx vitest run tests/config.test.ts -t "single account"` | ❌ W0 | ⬜ pending |
| 1-01-03 | 01 | 0 | CONF-01 | unit | `npx vitest run tests/config.test.ts -t "missing field"` | ❌ W0 | ⬜ pending |
| 1-01-04 | 01 | 0 | CONF-02 | unit | `npx vitest run tests/config.test.ts -t "env var resolution"` | ❌ W0 | ⬜ pending |
| 1-01-05 | 01 | 0 | CONF-02 | unit | `npx vitest run tests/config.test.ts -t "missing env var"` | ❌ W0 | ⬜ pending |
| 1-01-06 | 01 | 0 | CONF-03 | unit | `npx vitest run tests/config.test.ts -t "port 993"` | ❌ W0 | ⬜ pending |
| 1-01-07 | 01 | 0 | CONF-03 | unit | `npx vitest run tests/config.test.ts -t "port 143 rejected"` | ❌ W0 | ⬜ pending |
| 1-01-08 | 01 | 0 | (structural) | type-level | `npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 1-01-09 | 01 | 0 | (startup) | smoke | `npx vitest run tests/startup.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/config.test.ts` — stubs for CONF-01, CONF-02, CONF-03
- [ ] `tests/startup.test.ts` — smoke-tests server init without crashing
- [ ] `vitest.config.ts` — framework config
- [ ] `npm install -D vitest` — if not yet in package.json

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Credentials never appear in stdout | CONF-02 | Requires runtime inspection of process output | Start server with valid config; verify stdout contains only JSON-RPC; check no password or env var value appears |
| Server silent on successful startup | CONF-01 | Requires process observation | Start with valid config; verify stderr has no output; verify stdout has only MCP handshake |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
