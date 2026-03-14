# Phase 6: Hardening and Release - Research

**Researched:** 2026-03-14
**Domain:** Security audit, response guardrails, documentation, open-source release
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Response size guardrails**
- Strategy: verify and enforce existing pagination limits — no new mechanisms needed
- Add a server-side hard cap of 200 results max for `list_messages` and `search_messages`, overriding any client-supplied `limit` or `max_results` that exceeds it
- This cap applies regardless of what the agent requests — it cannot be bypassed
- Performance target (10k+ mailbox returns in 5s): verify via documented manual test — not automated in CI (requires live credentials). Document the test steps in README.

**README scope**
- Tone: Practical reference — technical users get running in 5 minutes, no marketing copy
- Required sections (from success criteria): config options, provider compatibility (Outlook limitation note), Claude Desktop setup steps
- Also include: tool reference (all MCP tools with parameters + response shapes), troubleshooting section (common errors: wrong port, bad app password, Gmail IMAP disabled), example agent prompts (2-3 showing what agents can do), contributing guide (dev setup, running tests, PR flow)
- Example config: abbreviated 2-account YAML inline in README (showing `$ENV_VAR_NAME` pattern) + full `config.example.yaml` in repo root for copy-paste

**Release definition**
- Release artifact: clean tagged commit only — tag `v0.1.0` on `main` and push. No GitHub Release UI, no npm publish for v0.1.0.
- Version: update `package.json` from `1.0.0` → `0.1.0` before tagging (honest about maturity)
- License: MIT — add `LICENSE` file before tagging

**Credential audit**
- Approach: automated scan + ongoing protection
  - Run gitleaks over full git history to verify no credentials in any commit
  - Add a pre-commit hook via Husky that runs gitleaks on staged files going forward (Husky is already set up from Phase 1)
- Remediation if found: use `git filter-repo` to rewrite history before tagging v0.1.0
- Note: the `$ENV_VAR_NAME` credential pattern (Phase 1) means actual secrets should never appear in committed files — audit is a verification step, not expected to find anything

### Claude's Discretion
- Exact gitleaks configuration and which ruleset to use
- Tool reference formatting style in README (table vs. code blocks)
- Contributing guide level of detail
- Husky hook implementation for gitleaks (install steps, hook script)

### Deferred Ideas (OUT OF SCOPE)
- npm publish — deferred; v0.1.0 is tagged-only. Can do npm publish for v0.2.0 or v1.0.0.
- GitHub Release with changelog — same deferral. Tag only for v0.1.0.
- Per-account polling intervals (FEAT-03) — already in v2 backlog
- IMAP IDLE push notifications (FEAT-04) — v2 backlog
</user_constraints>

---

## Summary

Phase 6 is a hardening and release phase with no new features. The work divides into five areas: (1) adding a 200-result hard cap to `list_messages` and `search_messages` handlers; (2) running gitleaks over git history and adding a Husky pre-commit hook for ongoing protection; (3) writing a full README with tool reference, troubleshooting, and contributing guide; (4) adding a MIT LICENSE file and `config.example.yaml`; and (5) bumping `package.json` to `0.1.0`, verifying MCP Inspector passes all tool schemas, and tagging `v0.1.0`.

The codebase is in good shape. ESLint `no-console: error` is already enforced (success criterion 3 is pre-satisfied). The `$ENV_VAR_NAME` credential pattern means the gitleaks scan should find nothing. The hard cap is a one-line guard at the handler entry point in each of two files. The README is the largest writing task in the phase.

**Primary recommendation:** Execute in sequence — cap first (minimal risk), then credential audit, then documentation, then release mechanics. Each task is independently verifiable.

---

## Standard Stack

### Core — Already In Project
| Tool/Library | Version | Purpose |
|---|---|---|
| gitleaks | v8.24.2+ (brew) | Scan git history and staged files for secrets |
| git filter-repo | current | Rewrite history if gitleaks finds credentials (remediation path) |
| @modelcontextprotocol/inspector | current (npx) | Validate all tool schemas interactively |

### Supporting
| Tool | How to Use | When |
|---|---|---|
| `npx @modelcontextprotocol/inspector` | Run against built server to validate tool schemas | Success criterion 4 |
| Husky `.husky/pre-commit` | Already configured; extend with gitleaks staged scan | Ongoing protection |

**Installation (new tools only):**
```bash
brew install gitleaks
# git-filter-repo: only needed if gitleaks finds something
pip install git-filter-repo   # or: brew install git-filter-repo
```

---

## Architecture Patterns

### Pattern 1: 200-Result Hard Cap (Handler Layer)

**What:** Each handler clamps the effective limit before calling the service, regardless of what the client supplied. Two locations: `handleListMessages` (single-account path) and `handleSearchMessages` (single-account path). Multi-account paths already derive `effectiveMax` from `max_results ?? 50` — apply the same cap there.

**Where in code:**
- `src/tools/list-messages.ts` — `handleListMessages`: single-account path calls `listMessages(clientResult, folder, { limit, offset, sort, unreadOnly: unread_only })` — cap `limit` here before the call
- `src/tools/search-messages.ts` — `handleSearchMessages`: single-account path calls `searchMessages(clientResult, { ..., maxResults: max_results })` — cap `max_results` here

**Pattern:**
```typescript
// Apply before service call — never trust client-supplied limit
const MAX_RESULTS = 200;
const effectiveLimit = Math.min(limit ?? 50, MAX_RESULTS);
```

Multi-account path in `list-messages.ts` uses `perAccountLimit = (limit ?? 50) + (offset ?? 0)` — the final `page` slice already respects `effectiveLimit`. Cap `effectiveLimit` to 200 before it feeds `perAccountLimit`.

**Key insight:** The cap goes in the handler layer (tool files), not in the service layer. Services remain pure/testable. The handler is the API boundary.

### Pattern 2: Gitleaks History Scan

**What:** Run gitleaks against the full git history once to verify no credentials were committed. Add a Husky hook for staged-file scanning going forward.

**Full history scan command:**
```bash
gitleaks git -v
# Exit code 0 = clean; non-zero = findings reported
```

**Husky hook — `.husky/pre-commit` extension:**
```sh
#!/usr/bin/env sh
npx lint-staged
npx vitest run --reporter=verbose
# Scan staged files for secrets
gitleaks protect --staged --redact
```

**Gitleaks ruleset:** Use default ruleset (no custom `.gitleaks.toml` needed). The default rules detect common patterns — API keys, tokens, passwords. Given the `$ENV_VAR_NAME` pattern throughout, findings are not expected.

**If findings are found (remediation):**
```bash
# Back up first
git clone --mirror . ../imap-mcp-backup.git
# Replace the secret text across all commits
echo "literal:actual-secret-value==>REDACTED" > replace.txt
git filter-repo --replace-text replace.txt
# Force-push after team coordination
```

### Pattern 3: MCP Inspector Schema Validation

**What:** Run MCP Inspector against the built server interactively. Inspect the Tools tab — all 7 tools should appear with schemas and no validation errors.

**Command (after `npm run build`):**
```bash
npx @modelcontextprotocol/inspector node build/index.js
# Opens browser UI at http://localhost:5173
# Navigate to Tools tab — verify all 7 tools listed with valid schemas
```

The inspector uses Ajv-based JSON Schema validation. A green badge per tool = schema valid. Any red badge = schema error to fix.

**Tools to verify (7):**
`list_accounts`, `list_folders`, `list_messages`, `read_message`, `search_messages`, `download_attachment`, `get_new_mail`

### Pattern 4: MIT LICENSE File

**Standard text** (fill in year and name):
```
MIT License

Copyright (c) 2026 Jonathan Howell

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Also update `package.json` `"license"` field from `"ISC"` to `"MIT"`.

### Pattern 5: Version Bump and Release Tag

```bash
# 1. Edit package.json: "version": "1.0.0" → "0.1.0"
# 2. Also update version string in src/index.ts Server constructor:
#    { name: "imap-mcp", version: "1.0.0" } → { name: "imap-mcp", version: "0.1.0" }
# 3. Commit everything
git add .
git commit -m "chore: release v0.1.0"
# 4. Tag
git tag -a v0.1.0 -m "v0.1.0 — initial release"
git push origin main --tags
```

### Anti-Patterns to Avoid

- **Capping in the service layer:** Services (`message-service.ts`, `search-service.ts`) are pure and don't know about API limits. The handler is the right place to enforce the cap.
- **Running `gitleaks git` on a dirty working tree:** Scan after all commits are clean; the command inspects git log, not working directory.
- **Tagging before the LICENSE file is committed:** Tag must include LICENSE or the repo is technically not open-source at the tagged ref.
- **Forgetting `src/index.ts` version string:** `package.json` and the Server constructor version should match.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Secret scanning | Custom regex grep on git history | gitleaks | Git history traversal is complex; gitleaks handles binary blobs, base64-encoded secrets, 100+ built-in detectors |
| History rewriting | Manual `git filter-branch` | `git filter-repo` | `filter-branch` is deprecated, slow, error-prone; `filter-repo` is Git's official replacement |
| Schema validation | Manual JSON Schema check | MCP Inspector | Inspector uses Ajv with MCP-specific schema rules; matches exactly what Claude Desktop validates |

---

## Common Pitfalls

### Pitfall 1: Cap Applied in Only One Code Path

**What goes wrong:** The 200-result cap is applied to single-account `list_messages` but not to multi-account, or vice versa. An agent can trigger the un-capped path by omitting or including `account`.

**Why it happens:** `handleListMessages` has two branches (lines 64 and 91 in current code). Each must independently enforce the cap.

**How to avoid:** Apply `Math.min(clientValue ?? default, MAX_RESULTS)` at the top of the handler before the branch fork, so both paths inherit the capped value.

### Pitfall 2: Gitleaks Hook Fails When gitleaks Not Installed

**What goes wrong:** Developer doesn't have gitleaks installed locally. The pre-commit hook runs `gitleaks protect --staged` which fails with "command not found", blocking all commits.

**Why it happens:** Husky hooks run in the developer's shell; gitleaks is not an npm package so it's not automatically available via npx.

**How to avoid:** Add a guard in the hook:
```sh
if ! command -v gitleaks &> /dev/null; then
  echo "WARNING: gitleaks not found — skipping secret scan. Install: brew install gitleaks"
  exit 0
fi
gitleaks protect --staged --redact
```
This makes the hook advisory rather than blocking when the tool is absent. Document the install step in CONTRIBUTING section of README.

### Pitfall 3: MCP Inspector Needs Built Server

**What goes wrong:** Running inspector against TypeScript source files directly (not `build/index.js`). Results in parse errors unrelated to schema validity.

**How to avoid:** Always `npm run build` before running inspector. Verify `build/index.js` exists.

### Pitfall 4: `config.example.yaml` Already Exists as `config.yaml.example`

**What goes wrong:** The existing file is `config.yaml.example` (CONTEXT.md says to add `config.example.yaml`). Two similar files with different names creates confusion.

**Resolution:** The CONTEXT.md calls for `config.example.yaml`. The existing `config.yaml.example` is already well-structured and self-documenting. The planner should decide: rename the existing file to `config.example.yaml`, or keep both. Renaming is cleaner; the existing file content is already suitable. Either way, README should reference one canonical path.

### Pitfall 5: `get_new_mail` Does Not Need the 200-Result Cap

**What goes wrong:** Applying the cap indiscriminately to all tools including `get_new_mail`.

**Why it doesn't apply:** `get_new_mail` reads from the in-memory cache (the Poller). It does not perform IMAP fetches. Its result set is bounded by what the poller cached, which is already header-only data. CONTEXT.md explicitly scopes the cap to `list_messages` and `search_messages` only (with a note to check `get_new_mail` — the answer is: cap does not apply).

---

## Code Examples

### 200-Result Cap — Insertion Point in `handleListMessages`

```typescript
// Source: existing src/tools/list-messages.ts — add near top of function
const MAX_RESULTS = 200;

// In multi-account branch:
const effectiveLimit = Math.min(limit ?? 50, MAX_RESULTS);
const perAccountLimit = effectiveLimit + (offset ?? 0);

// In single-account branch:
const cappedLimit = Math.min(limit ?? 50, MAX_RESULTS);
const headers = await listMessages(clientResult, folder, {
  limit: cappedLimit,
  offset,
  sort,
  unreadOnly: unread_only,
});
```

### 200-Result Cap — `handleSearchMessages`

```typescript
// Source: existing src/tools/search-messages.ts — add near top of function
const MAX_RESULTS = 200;

// In both multi-account and single-account branches:
const effectiveMax = Math.min(max_results ?? 50, MAX_RESULTS);
```

### Gitleaks Husky Hook — Complete `.husky/pre-commit`

```sh
#!/usr/bin/env sh
npx lint-staged
npx vitest run --reporter=verbose
if ! command -v gitleaks &> /dev/null; then
  echo "WARNING: gitleaks not found — skipping secret scan. Install: brew install gitleaks"
  exit 0
fi
gitleaks protect --staged --redact
```

### README Structure — Required Sections

Based on locked decisions, README must contain these sections in a practical order:

1. What it does (1 paragraph, no marketing)
2. Quick start (install, configure, run — 5-minute path)
3. Configuration reference (all config fields with types and defaults)
4. Claude Desktop setup (how to add to `claude_desktop_config.json`)
5. Provider compatibility (Gmail, generic IMAP; Outlook limitation prominently noted)
6. Tool reference (all 7 MCP tools — parameters and response shapes)
7. Example agent prompts (2-3 concrete examples)
8. Troubleshooting (wrong port, bad app password, Gmail IMAP disabled, Outlook Basic Auth)
9. Contributing (dev setup, running tests, TypeScript strict mode note, PR flow)

**Tool reference format:** Tables are scannable and work well in Markdown renderers. Use one table per tool: columns = Parameter, Type, Required, Description.

---

## Existing State Inventory

What the codebase already has (pre-conditions for this phase):

| Item | Status | Notes |
|------|--------|-------|
| ESLint `no-console: error` | Already enforced | `eslint.config.mjs` line 7; success criterion 3 pre-satisfied |
| Husky pre-commit hook | Exists at `.husky/pre-commit` | Runs lint-staged + vitest; extend with gitleaks |
| `config.yaml.example` | Exists in repo root | Well-structured; needs rename or symlink to `config.example.yaml` |
| `package.json` version | `"1.0.0"` — needs update | Update to `"0.1.0"` |
| `package.json` license | `"ISC"` — needs update | Update to `"MIT"` |
| Server version string in `src/index.ts` | `"1.0.0"` (line 47) | Must match `package.json` |
| LICENSE file | Does not exist | Must create before tagging |
| README.md | Does not exist | Must create before tagging |
| 200-result cap | Not yet enforced | `list-messages.ts` and `search-messages.ts` need guards |
| `get_new_mail` cap | Not needed | Cache-only; no IMAP fetch; not in scope |

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.x |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run` |
| Full suite command | `npx vitest run --coverage` |

### Phase Requirements → Test Map

This phase has no formal requirement IDs (it validates prior phases against production conditions). The success criteria map to test/verification types as follows:

| Success Criterion | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| SC-1: 10k+ mailbox returns in 5s, no bodies | Response size cap enforced | Unit (cap logic) + Manual (live mailbox) | `npx vitest run tests/tools/list-messages.test.ts` | ✅ (extend existing) |
| SC-2: No credentials in git history | Gitleaks scan clean | Manual scan (CI-external) | `gitleaks git -v` | N/A (CLI tool) |
| SC-3: `no-console` lint rule | ESLint blocks console.log | Lint (already passing) | `npm run lint` | ✅ |
| SC-4: MCP Inspector validates all schemas | All 7 tool schemas valid | Manual interactive | `npx @modelcontextprotocol/inspector node build/index.js` | N/A (interactive) |
| SC-5: README complete | Sections present and correct | Manual review | N/A | ❌ Wave 0 gap |

### Unit Tests for the 200-Result Cap

The existing `tests/tools/list-messages.test.ts` and `tests/tools/search-messages.test.ts` must be extended with cap-enforcement cases:

```typescript
// Example test stubs to add:
it('clamps limit to 200 when client passes 500', ...)
it('clamps max_results to 200 when client passes 300', ...)
it('uses default 50 when limit is undefined', ...)
```

### Sampling Rate
- **Per task commit:** `npx vitest run`
- **Per wave merge:** `npx vitest run --coverage`
- **Phase gate:** Full suite green + `npm run lint` + `npm run build` before tagging v0.1.0

### Wave 0 Gaps
- [ ] Add cap-enforcement test cases to `tests/tools/list-messages.test.ts` — covers SC-1 cap logic
- [ ] Add cap-enforcement test cases to `tests/tools/search-messages.test.ts` — covers SC-1 cap logic

*(README and credential audit have no automated test equivalents — they are manual verification steps)*

---

## State of the Art

| Old Approach | Current Approach | Impact |
|---|---|---|
| `git filter-branch` for history rewriting | `git filter-repo` | filter-branch deprecated in Git 2.36; filter-repo is 10-100x faster |
| Custom pre-commit scripts | Husky + lint-staged | Already in place; extend, don't replace |
| Manual README only | README + `config.example.yaml` | Dual artifact: reference docs + copy-paste starting point |

---

## Open Questions

1. **`config.yaml.example` vs `config.example.yaml` naming**
   - What we know: `config.yaml.example` already exists and is self-documenting
   - What's unclear: CONTEXT.md refers to `config.example.yaml` as the target; do we rename the existing file or create a new one?
   - Recommendation: Rename `config.yaml.example` to `config.example.yaml` in a single commit to avoid two competing files. Update any references.

2. **Gitleaks: strict vs. advisory hook**
   - What we know: If a developer lacks gitleaks, a strict hook blocks all commits
   - Recommendation: Use advisory mode (warn + exit 0 when gitleaks not found). The README CONTRIBUTING section should list `brew install gitleaks` as a dev setup step.

3. **`author` field in `package.json` is empty string**
   - What we know: `"author": ""` in package.json
   - Recommendation: Fill in before v0.1.0 tag. Add to release prep checklist.

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection of `src/tools/list-messages.ts`, `src/tools/search-messages.ts`, `src/tools/get-new-mail.ts`, `src/index.ts`, `eslint.config.mjs`, `.husky/pre-commit`, `package.json`, `config.yaml.example` — current state of codebase
- [MCP Inspector official docs](https://modelcontextprotocol.io/docs/tools/inspector) — installation via npx, tools tab schema validation
- [gitleaks GitHub README](https://github.com/gitleaks/gitleaks) — v8.24.2, `brew install gitleaks`, `gitleaks git -v`, `gitleaks protect --staged`
- [choosealicense.com MIT](https://choosealicense.com/licenses/mit/) — MIT license text template

### Secondary (MEDIUM confidence)
- [Gitleaks pre-commit hook patterns](https://dev.to/amedeov/gitleaks-pre-commit-hook-45m3) — guard pattern for missing binary
- [git-filter-repo for history rewriting](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository) — GitHub official docs on remediation approach

### Tertiary (LOW confidence — flagged for validation)
- None. All critical claims are verified from official sources or direct code inspection.

---

## Metadata

**Confidence breakdown:**
- Response size cap: HIGH — code locations identified, pattern is straightforward Math.min guard
- Credential audit (gitleaks): HIGH — official docs verified, install/scan/hook commands confirmed
- MCP Inspector validation: HIGH — official docs confirm `npx @modelcontextprotocol/inspector node build/index.js` command
- README structure: HIGH — locked in CONTEXT.md; no ambiguity on required sections
- Release mechanics: HIGH — git tag/push is standard; version strings identified in two places

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (gitleaks version may update; core mechanics are stable)
