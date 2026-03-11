---
phase: 01-foundation
plan: "03"
subsystem: mcp-server
tags: [mcp, typescript, vitest, stdio, tools, imap]

# Dependency graph
requires:
  - phase: 01-02
    provides: loadConfig() returning AppConfig, AccountConfig types, stderr-only logger
provides:
  - MCP Server entry point (src/index.ts) loading config, registering tools, connecting StdioServerTransport
  - 5 stub tool definitions (list_accounts, list_folders, list_messages, read_message, search_messages)
  - handleStubToolCall() returning correct MCP content shape with isError flag
  - Startup smoke test (4 tests) verifying tool registration and config loading
  - config.yaml.example documenting $ENV_VAR credential pattern and multi-account setup
affects:
  - 02-imap-connection (src/index.ts is the entry point that will wire in connection pooling)
  - 03-mcp-tools (STUB_TOOLS array will be replaced with real tool handlers)
  - all subsequent phases (tool surface is now established as the MCP contract)

# Tech tracking
tech-stack:
  added: []
  patterns: [mcp-stdio-transport, stub-tool-pattern, tdd-green-on-first-run]

key-files:
  created:
    - src/index.ts
    - src/tools/stubs.ts
    - tests/startup.test.ts
    - config.yaml.example
  modified: []

key-decisions:
  - "Stub tool names (list_accounts, list_folders, list_messages, read_message, search_messages) are the stable MCP contract — Phase 3 replaces handlers not names"
  - "void config in src/index.ts suppresses unused-variable lint while keeping the config load side-effect (process.exit on invalid config)"
  - "Tests pass GREEN immediately — stubs are the implementation, no RED phase needed"

patterns-established:
  - "Stub pattern: tool definitions live in stubs.ts, all return not-implemented; later phases override handlers not the tool list"
  - "Silent startup: no output to stdout on successful startup — MCP JSON-RPC channel must be clean"
  - "Entry point never catches errors from loadConfig() — it calls process.exit(1) internally"

requirements-completed: [CONF-01, CONF-02, CONF-03]

# Metrics
duration: 2min
completed: 2026-03-11
---

# Phase 1 Plan 03: MCP Server Entry Point and Stub Tools Summary

**MCP Server entry point wired with StdioServerTransport, 5 stub tool definitions registered, startup smoke test passing, and config.yaml.example documenting the $ENV_VAR credential pattern**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-11T21:22:31Z
- **Completed:** 2026-03-11T21:24:01Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- src/index.ts loads config via loadConfig() (exits on error), creates Server, registers ListTools and CallTool handlers, connects StdioServerTransport — stdout is clean on successful startup
- STUB_TOOLS exports 5 tool definitions establishing the Phase 3+ MCP tool surface: list_accounts, list_folders, list_messages, read_message, search_messages
- handleStubToolCall() returns the correct MCP content shape (content array with type/text, isError: false) for all tool calls
- 4 startup smoke tests pass: tool count check, tool shape validation, handleStubToolCall response, and loadConfig integration test with temp file
- config.yaml.example documents the $ENV_VAR password reference pattern, port 993 requirement, and Claude Desktop MCP env configuration

## Task Commits

Each task was committed atomically:

1. **Task 1: Stub tool definitions and MCP server entry point** - `b44105f` (feat)
2. **Task 2: Startup smoke test and example config** - `4d17a33` (feat)

_Note: Task 2 is TDD — tests written first. Implementation was complete from Task 1, so tests passed GREEN on first run._

## Files Created/Modified

- `src/index.ts` — Entry point: loads config, creates MCP Server, registers ListTools/CallTool handlers, connects StdioServerTransport
- `src/tools/stubs.ts` — STUB_TOOLS (5 tool definitions) and handleStubToolCall() returning not-implemented response
- `tests/startup.test.ts` — 4 smoke tests covering tool registration shape and config loading
- `config.yaml.example` — Self-documenting example with $ENV_VAR pattern, port 993 comment, multi-account setup, Claude Desktop env config snippet

## Decisions Made

- **void config pattern:** `void config` in src/index.ts eliminates the unused-variable lint error while retaining the side-effect of calling loadConfig() (which exits on invalid config). No real alternative without disabling lint rules.
- **Stub names are the MCP contract:** The 5 tool names in STUB_TOOLS are now the stable interface. Phase 3 will replace the handler functions — the names must not change without a breaking API revision.
- **TDD GREEN on first run:** Task 2 used `tdd="true"` but the implementation was already complete from Task 1. Tests passed immediately — this is correct behavior, not a deviation.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 1 complete: server entry point, config system, types, logger, and stub tools all in place
- Phase 2 (IMAP connection) can use AccountConfig from loadConfig() to establish imapflow connections
- The 5 stub tool names are the stable MCP contract for Phase 3 tool implementation
- All Phase 1 success criteria satisfied:
  1. Server registers stub tools without crashing (valid config)
  2. Server fails fast on missing/malformed config (loadConfig exits with code 1)
  3. Credentials never written to stdout (ESLint no-console enforced)
  4. Configurable via IMAP_MCP_CONFIG env var
  5. Port 143 rejected at config validation time

---
*Phase: 01-foundation*
*Completed: 2026-03-11*

## Self-Check: PASSED

- src/index.ts: FOUND
- src/tools/stubs.ts: FOUND
- tests/startup.test.ts: FOUND
- config.yaml.example: FOUND
- commit b44105f: FOUND
- commit 4d17a33: FOUND
