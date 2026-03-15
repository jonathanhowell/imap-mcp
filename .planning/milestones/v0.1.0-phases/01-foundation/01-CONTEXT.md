# Phase 1: Foundation - Context

**Gathered:** 2026-03-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Set up the MCP server shell, multi-account config loading and validation, credential hygiene infrastructure, and the `{account_id, uid}` data model. No IMAP connections in this phase — connection management is Phase 2. Delivers a running server that validates config and registers stub tools.

</domain>

<decisions>
## Implementation Decisions

### Language & Stack
- TypeScript with strict mode enabled
- Node.js 22 LTS runtime
- `@modelcontextprotocol/sdk` for MCP server framework
- `zod` for config schema validation (runtime + TypeScript type inference)
- `imapflow` and `mailparser` selected for Phase 2+ (IMAP not used in Phase 1)

### Config File Format
- YAML format (human-written, supports comments, readable for multi-account setups)
- Default location: `~/.config/imap-mcp/config.yaml`
- Location overridable via environment variable (e.g. `IMAP_MCP_CONFIG`)
- Required fields per account: `name`, `host`, `port`, `username`, `password`
- Optional fields per account: `display_name` (human-friendly label)
- TLS always enforced — no option to disable (port 993)

### Credential Handling
- Passwords stored as `$ENV_VAR_NAME` references in the YAML config — actual secrets live in env vars, not the file
- This pattern prevents credentials appearing in the config file (safe to commit the config structure, not the secrets)
- Example: `password: $PERSONAL_IMAP_PASSWORD`

### Startup Behavior
- Validate config schema at startup (zod); exit immediately with clear error if invalid
- Do NOT attempt IMAP connections at startup — lazy-connect on first tool call (Phase 2)
- Config errors: field-level messages with hints (e.g. `account[1].password: required — use $ENV_VAR`)
- Successful startup: silent (nothing to stderr)
- Config file missing: exit immediately with clear error pointing to expected location

### Data Model Constraint
- All message identifiers use `{account_id, uid}` tuples — never bare UIDs
- This constraint must be in the type definitions from Phase 1 even before IMAP is connected
- `account_id` matches the `name` field in config

### Logging
- All logging goes to stderr only — stdout is the JSON-RPC channel for MCP stdio transport
- `console.log` is banned via ESLint rule — enforced from first commit
- Logger utility (`src/logger.ts`) wraps `console.error` with level tagging

### Code Quality Tools (from day 1)
- ESLint with `no-console` rule (prevents JSON-RPC stream corruption)
- Prettier for consistent formatting (important for open-source contributions)
- vitest for unit tests (especially config validation and data model)
- Husky pre-commit hooks (run lint + tests before every commit)

### Project Structure
- Layered `src/` from day 1:
  - `src/config/` — config loading, validation, types
  - `src/connections/` — IMAP connection management (Phase 2)
  - `src/services/` — business logic (Phase 3+)
  - `src/tools/` — MCP tool handlers
  - `src/logger.ts` — stderr-only logger utility

### Claude's Discretion
- Exact ESLint rule configuration beyond `no-console`
- Prettier configuration details
- Husky hook specifics
- vitest configuration and coverage settings
- Exact zod error message formatting (within the "field-level with hints" direction)

</decisions>

<specifics>
## Specific Ideas

- Config file uses `$ENV_VAR_NAME` syntax for password references — similar to how Docker Compose handles secrets
- The YAML config should be self-documenting via comments in the template/example file included in the repo

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield project

### Established Patterns
- None yet — this phase establishes the patterns

### Integration Points
- `src/config/` types and validated config object will be consumed by Phase 2's `ConnectionManager`
- `src/logger.ts` will be used by all subsequent phases
- `{account_id, uid}` type definitions established here are used throughout all phases

</code_context>

<deferred>
## Deferred Ideas

- Provider presets (auto-detect host/port for Gmail, iCloud, Fastmail) — could be added to config layer in a future iteration; not blocking Phase 1
- OAuth2 token support as a credential type — noted for v1.x; Phase 1 handles app passwords only

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-03-11*
