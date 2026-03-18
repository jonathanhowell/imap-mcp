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
| **Framework** | pytest 7.x |
| **Config file** | `pytest.ini` / `pyproject.toml` |
| **Quick run command** | `pytest tests/ -x -q` |
| **Full suite command** | `pytest tests/ -v` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pytest tests/ -x -q`
- **After every plan wave:** Run `pytest tests/ -v`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 0 | KFLAG-01 | unit stub | `pytest tests/test_flag_message.py -x -q` | ❌ W0 | ⬜ pending |
| 11-01-02 | 01 | 1 | KFLAG-01 | unit | `pytest tests/test_flag_message.py -x -q` | ✅ | ⬜ pending |
| 11-01-03 | 01 | 1 | KFLAG-04 | unit | `pytest tests/test_flag_message.py::test_permanentflags_warning -x -q` | ✅ | ⬜ pending |
| 11-02-01 | 02 | 0 | KFLAG-02 | unit stub | `pytest tests/test_search_exclude_keyword.py -x -q` | ❌ W0 | ⬜ pending |
| 11-02-02 | 02 | 1 | KFLAG-02 | unit | `pytest tests/test_search_exclude_keyword.py -x -q` | ✅ | ⬜ pending |
| 11-02-03 | 02 | 1 | KFLAG-03 | unit | `pytest tests/test_get_new_mail_exclude.py -x -q` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/test_flag_message.py` — stubs for KFLAG-01 and KFLAG-04
- [ ] `tests/test_search_exclude_keyword.py` — stubs for KFLAG-02
- [ ] `tests/test_get_new_mail_exclude.py` — stubs for KFLAG-03

*Existing pytest infrastructure covers the framework; only new test files needed.*

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
