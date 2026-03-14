---
phase: 6
slug: hardening-and-release
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run` |
| **Full suite command** | `npx vitest run --coverage` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run`
- **After every plan wave:** Run `npx vitest run --coverage`
- **Before `/gsd:verify-work`:** Full suite must be green + `npm run lint` + `npm run build`
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Success Criterion | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------------|-----------|-------------------|-------------|--------|
| 6-01-01 | 01 | 1 | SC-1: 200-result cap list_messages | Unit | `npx vitest run tests/tools/list-messages.test.ts` | ✅ (extend) | ⬜ pending |
| 6-01-02 | 01 | 1 | SC-1: 200-result cap search_messages | Unit | `npx vitest run tests/tools/search-messages.test.ts` | ✅ (extend) | ⬜ pending |
| 6-02-01 | 02 | 2 | SC-2: No credentials in git history | Manual | `gitleaks git -v` | N/A (CLI) | ⬜ pending |
| 6-02-02 | 02 | 2 | SC-2: Gitleaks pre-commit hook | Manual | Hook fires on staged files | N/A | ⬜ pending |
| 6-03-01 | 03 | 3 | SC-3: no-console lint rule | Lint | `npm run lint` | ✅ | ⬜ pending |
| 6-03-02 | 03 | 3 | SC-5: README complete | Manual review | N/A | ❌ Wave 0 gap | ⬜ pending |
| 6-04-01 | 04 | 4 | SC-4: MCP Inspector validates schemas | Manual interactive | `npx @modelcontextprotocol/inspector node build/index.js` | N/A | ⬜ pending |
| 6-04-02 | 04 | 4 | Release: v0.1.0 tag exists | Manual | `git tag -l v0.1.0` | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/tools/list-messages.test.ts` — add cap-enforcement cases (clamps to 200, default 50)
- [ ] `tests/tools/search-messages.test.ts` — add cap-enforcement cases (clamps to 200, default 50)

*README and credential audit have no automated test equivalents — they are manual verification steps.*

---

## Manual-Only Verifications

| Behavior | Success Criterion | Why Manual | Test Instructions |
|----------|-------------------|------------|-------------------|
| No credentials in git history | SC-2 | Requires gitleaks CLI + full git log traversal | `brew install gitleaks && gitleaks git -v` — exit 0 = clean |
| MCP Inspector schema validation | SC-4 | Interactive browser UI; requires live server | `npm run build && npx @modelcontextprotocol/inspector node build/index.js` — verify Tools tab shows all 7 tools with green badges |
| Performance: 10k+ mailbox in 5s | SC-1 | Requires live IMAP credentials against large mailbox | Connect to a 10k+ mailbox; run list_messages; verify response < 5s and no message bodies in result |
| README content correctness | SC-5 | Human judgment required for prose quality and completeness | Review README sections: Quick Start, Configuration, Provider Compatibility (Outlook note), Claude Desktop setup, Tool Reference, Troubleshooting |
| v0.1.0 tag pushed | Release | Requires git push to remote | `git tag -l v0.1.0 && git log --oneline v0.1.0 -1` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
