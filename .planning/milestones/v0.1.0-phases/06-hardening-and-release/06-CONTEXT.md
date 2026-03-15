# Phase 6: Hardening and Release - Context

**Gathered:** 2026-03-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Verify the server is safe, stable, and clean enough to publish as v0.1.0. No new features — this phase validates, hardens, and documents what was built in Phases 1–5. Delivers: response size guardrails, credential audit, open-source documentation, MIT license, and a v0.1.0 git tag.

</domain>

<decisions>
## Implementation Decisions

### Response size guardrails
- Strategy: verify and enforce existing pagination limits — no new mechanisms needed
- Add a server-side hard cap of **200 results max** for `list_messages` and `search_messages`, overriding any client-supplied `limit` or `max_results` that exceeds it
- This cap applies regardless of what the agent requests — it cannot be bypassed
- Performance target (10k+ mailbox returns in 5s): verify via **documented manual test** — not automated in CI (requires live credentials). Document the test steps in README.

### README scope
- **Tone:** Practical reference — technical users get running in 5 minutes, no marketing copy
- **Required sections** (from success criteria): config options, provider compatibility (Outlook limitation note), Claude Desktop setup steps
- **Also include:** tool reference (all MCP tools with parameters + response shapes), troubleshooting section (common errors: wrong port, bad app password, Gmail IMAP disabled), example agent prompts (2-3 showing what agents can do), contributing guide (dev setup, running tests, PR flow)
- **Example config:** abbreviated 2-account YAML inline in README (showing `$ENV_VAR_NAME` pattern) + full `config.example.yaml` in repo root for copy-paste

### Release definition
- **Release artifact:** clean tagged commit only — tag `v0.1.0` on `main` and push. No GitHub Release UI, no npm publish for v0.1.0.
- **Version:** update `package.json` from `1.0.0` → `0.1.0` before tagging (honest about maturity)
- **License:** MIT — add `LICENSE` file before tagging

### Credential audit
- **Approach:** automated scan + ongoing protection
  - Run **gitleaks** over full git history to verify no credentials in any commit
  - Add a **pre-commit hook via Husky** that runs gitleaks on staged files going forward (Husky is already set up from Phase 1)
- **Remediation if found:** use `git filter-repo` to rewrite history before tagging v0.1.0
- **Note:** the `$ENV_VAR_NAME` credential pattern (Phase 1) means actual secrets should never appear in committed files — audit is a verification step, not expected to find anything

### Claude's Discretion
- Exact gitleaks configuration and which ruleset to use
- Tool reference formatting style in README (table vs. code blocks)
- Contributing guide level of detail
- Husky hook implementation for gitleaks (install steps, hook script)

</decisions>

<specifics>
## Specific Ideas

- First release is `v0.1.0` — user's explicit choice to signal early maturity
- README troubleshooting should cover the Outlook limitation prominently (Outlook deprecated Basic Auth for IMAP; users on Outlook/Hotmail should know before configuring)
- The `config.example.yaml` file should be self-documenting with inline comments (per Phase 1 CONTEXT.md note)

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `package.json`: version field needs update from `1.0.0` → `0.1.0`; scripts already include lint, test, build
- `src/tools/list-messages.ts`, `src/tools/search-messages.ts`: these are the primary files to add the 200-result cap to
- `src/tools/get-new-mail.ts`: `get_new_mail` also returns paged results — check if cap applies
- Husky already configured (from Phase 1 `prepare` script) — adding a gitleaks hook is a new `.husky/` script file

### Established Patterns
- `no-console` ESLint rule: already enforced from Phase 1 (success criterion #3 is pre-satisfied)
- All logging to stderr via `logger.ts` — no stdout contamination risk
- Credential hygiene via `$ENV_VAR_NAME` — established from Phase 1; audit is verification
- TypeScript strict mode throughout — README contributing guide should note this

### Integration Points
- `list_messages` and `search_messages` handlers: add cap enforcement before IMAP fetch
- `.husky/pre-commit`: add gitleaks scan alongside existing lint + test hooks
- `LICENSE`: new file in repo root
- `config.example.yaml`: new file in repo root
- `README.md`: new file in repo root

</code_context>

<deferred>
## Deferred Ideas

- npm publish — deferred; v0.1.0 is tagged-only. Can do npm publish for v0.2.0 or v1.0.0.
- GitHub Release with changelog — same deferral. Tag only for v0.1.0.
- Per-account polling intervals (FEAT-03) — already in v2 backlog
- IMAP IDLE push notifications (FEAT-04) — v2 backlog

</deferred>

---

*Phase: 06-hardening-and-release*
*Context gathered: 2026-03-14*
