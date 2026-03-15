---
phase: 01-foundation
plan: "02"
subsystem: config
tags: [zod, yaml, typescript, types, logger, config, imap]

# Dependency graph
requires:
  - phase: 01-01
    provides: TypeScript/ESLint/Vitest project scaffold with Node16 module resolution
provides:
  - MessageRef and AccountRef interfaces locking in the {account_id, uid} data model
  - Stderr-only logger (debug/info/warn/error) preventing stdout contamination of MCP JSON-RPC
  - Zod schema with port-993 enforcement and $ENV_VAR password resolution
  - loadConfig() reading YAML from IMAP_MCP_CONFIG or ~/.config/imap-mcp/config.yaml
  - 17 unit tests covering all CONF-01/02/03 requirements
affects:
  - 02-imap-connection (uses AccountConfig, loadConfig, logger)
  - 03-mcp-tools (uses MessageRef, AppConfig)
  - all subsequent phases (logger and MessageRef are foundational contracts)

# Tech tracking
tech-stack:
  added: [zod v4 (schema validation), yaml (YAML parsing)]
  patterns: [zod-schema-inferred-types, env-var-reference-transform, stderr-only-logging]

key-files:
  created:
    - src/types.ts
    - src/logger.ts
    - src/config/schema.ts
    - src/config/types.ts
    - src/config/loader.ts
    - tests/config.test.ts
    - tests/types-logger.test.ts
  modified: []

key-decisions:
  - "Use zod v4 .issues (not .errors) — zod v4 renamed the property; plan was written for v3 API"
  - "loadConfig always requires a YAML file — no file-less env-only mode"
  - "Port 993 enforced at schema validation time, not connection time"
  - "Logger uses process.stderr.write directly, not console.error, to avoid Node's buffering"

patterns-established:
  - "MessageRef pattern: always carry account_id with uid — never pass bare UIDs"
  - "Env-var pattern: $VAR_NAME in YAML → resolved at parse time, error names the missing var"
  - "Logger pattern: all debug/info/warn/error go to stderr; stdout reserved for MCP JSON-RPC"
  - "Zod v4 compat: use .issues not .errors, PropertyKey[] for path type"

requirements-completed: [CONF-01, CONF-02, CONF-03]

# Metrics
duration: 5min
completed: 2026-03-11
---

# Phase 1 Plan 02: Core Types, Logger, and Config System Summary

**Zod v4 schema with port-993 enforcement, $ENV_VAR password resolution, and stderr-only logger establishing the {account_id, uid} message reference contract**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-11T21:14:33Z
- **Completed:** 2026-03-11T21:19:10Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- MessageRef/AccountRef interfaces lock in the {account_id, uid} data model — retrofitting this later would be a breaking API change
- Stderr-only logger enforces that stdout stays clean for MCP JSON-RPC transport
- Zod schema validates IMAP config: port 993 required, $ENV_VAR references resolved at parse time, field-level error paths (accounts[0].host)
- loadConfig() reads YAML from IMAP_MCP_CONFIG env var or default ~/.config/imap-mcp/config.yaml, exits process with code 1 on any error
- 17 unit tests pass covering all CONF-01 (multi-account, missing fields), CONF-02 (env-var resolution), and CONF-03 (port enforcement) requirements

## Task Commits

Each task was committed atomically:

1. **Task 1: Core types and logger** - `bc28888` (feat)
2. **Task 2: Config schema, types, loader, and tests** - `cd9652f` (feat)

_Note: TDD tasks — tests written first (RED), implementation second (GREEN)._

## Files Created/Modified

- `src/types.ts` — MessageRef {account_id, uid} and AccountRef {account_id} interfaces
- `src/logger.ts` — Stderr-only logger with debug/info/warn/error using process.stderr.write
- `src/config/schema.ts` — Zod AccountSchema and AppConfigSchema with env-var transform
- `src/config/types.ts` — AccountConfig and AppConfig TypeScript types inferred from zod schemas
- `src/config/loader.ts` — loadConfig() reading YAML, validating schema, exiting on error
- `tests/types-logger.test.ts` — 6 tests for MessageRef, AccountRef, and logger behavior
- `tests/config.test.ts` — 11 tests for all CONF-01/02/03 scenarios

## Decisions Made

- **Zod v4 .issues vs .errors:** Plan used v3 API (`result.error.errors`). Zod v4 renames this to `result.error.issues`. All code adapted to use `.issues`.
- **PropertyKey[] path type:** Zod v4 types `e.path` as `PropertyKey[]` (includes symbol). `formatZodPath()` uses `String(seg)` coercion and accepts `PropertyKey[]`.
- **Unused var lint fix:** ESLint rejected `LEVELS` const used only as type; replaced with inline union type `"debug" | "info" | "warn" | "error"`.
- **Test destructure lint fix:** `_host` / `_name` in destructure were flagged by `@typescript-eslint/no-unused-vars`; replaced with explicit object construction.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Adapted all zod v4 API calls from .errors to .issues**
- **Found during:** Task 2 (config schema and loader implementation)
- **Issue:** Plan code used `result.error.errors` (zod v3 API). Zod v4 uses `result.error.issues`. This would cause runtime TypeScript type errors and undefined access at runtime.
- **Fix:** Used `.issues` in `loader.ts` and `config.test.ts`. Updated `formatZodPath()` to accept `PropertyKey[]` parameter type.
- **Files modified:** src/config/loader.ts, tests/config.test.ts
- **Verification:** `npx tsc --noEmit` clean, all 17 tests pass
- **Committed in:** cd9652f (Task 2 commit)

**2. [Rule 1 - Bug] Fixed LEVELS const causing ESLint unused-vars error**
- **Found during:** Task 1 commit (pre-commit hook)
- **Issue:** `const LEVELS = [...] as const; type Level = (typeof LEVELS)[number]` — ESLint flagged LEVELS as assigned but only used as a type.
- **Fix:** Replaced with inline union type `type Level = "debug" | "info" | "warn" | "error"`.
- **Files modified:** src/logger.ts
- **Verification:** Lint clean, tests pass
- **Committed in:** bc28888 (Task 1 commit)

**3. [Rule 1 - Bug] Fixed test destructure unused-var lint errors**
- **Found during:** Task 2 commit (pre-commit hook lint)
- **Issue:** `const { host: _host, ...noHost } = validAccount` — ESLint flagged `_host` and `_name` as unused despite underscore prefix.
- **Fix:** Replaced destructure pattern with explicit object construction omitting the field.
- **Files modified:** tests/config.test.ts
- **Verification:** Lint clean, all 11 config tests pass
- **Committed in:** cd9652f (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (3 Rule 1 bugs — plan/zod v4 API mismatch and lint violations)
**Impact on plan:** All fixes required for correct zod v4 operation and passing lint gates. No scope creep.

## Issues Encountered

- Zod v4 installed but plan was written against zod v3 API surface. The import `from "zod"` works for both, but the returned error object structure changed from `.errors` to `.issues`. This was caught immediately at TypeScript compile time.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Types and config system ready for Phase 2 IMAP connection implementation
- AccountConfig type provides all fields needed by imapflow connection options
- logger available for all connection and service code
- loadConfig() signature stable — async function returning AppConfig

---
*Phase: 01-foundation*
*Completed: 2026-03-11*

## Self-Check: PASSED

- src/types.ts: FOUND
- src/logger.ts: FOUND
- src/config/schema.ts: FOUND
- src/config/types.ts: FOUND
- src/config/loader.ts: FOUND
- tests/config.test.ts: FOUND
- tests/types-logger.test.ts: FOUND
- commit bc28888: FOUND
- commit cd9652f: FOUND
