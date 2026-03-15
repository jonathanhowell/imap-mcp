# Phase 1: Foundation - Research

**Researched:** 2026-03-11
**Domain:** MCP server bootstrapping, TypeScript project setup, config validation, credential hygiene
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- TypeScript with strict mode enabled
- Node.js 22 LTS runtime
- `@modelcontextprotocol/sdk` for MCP server framework
- `zod` for config schema validation (runtime + TypeScript type inference)
- `imapflow` and `mailparser` selected for Phase 2+ (IMAP not used in Phase 1)
- YAML format for config file (human-written, supports comments, readable for multi-account setups)
- Default config location: `~/.config/imap-mcp/config.yaml`
- Location overridable via environment variable (`IMAP_MCP_CONFIG`)
- Required fields per account: `name`, `host`, `port`, `username`, `password`
- Optional fields per account: `display_name` (human-friendly label)
- TLS always enforced — no option to disable (port 993)
- Passwords stored as `$ENV_VAR_NAME` references in the YAML config — actual secrets live in env vars
- Validate config schema at startup (zod); exit immediately with clear error if invalid
- Do NOT attempt IMAP connections at startup — lazy-connect on first tool call (Phase 2)
- Config errors: field-level messages with hints (e.g. `account[1].password: required — use $ENV_VAR`)
- Successful startup: silent (nothing to stderr)
- Config file missing: exit immediately with clear error pointing to expected location
- All message identifiers use `{account_id, uid}` tuples — never bare UIDs
- `account_id` matches the `name` field in config
- All logging goes to stderr only — stdout is the JSON-RPC channel for MCP stdio transport
- `console.log` is banned via ESLint rule — enforced from first commit
- Logger utility (`src/logger.ts`) wraps `console.error` with level tagging
- ESLint with `no-console` rule (prevents JSON-RPC stream corruption)
- Prettier for consistent formatting
- vitest for unit tests (especially config validation and data model)
- Husky pre-commit hooks (run lint + tests before every commit)
- Layered `src/` from day 1: `src/config/`, `src/connections/`, `src/services/`, `src/tools/`, `src/logger.ts`

### Claude's Discretion
- Exact ESLint rule configuration beyond `no-console`
- Prettier configuration details
- Husky hook specifics
- vitest configuration and coverage settings
- Exact zod error message formatting (within the "field-level with hints" direction)

### Deferred Ideas (OUT OF SCOPE)
- Provider presets (auto-detect host/port for Gmail, iCloud, Fastmail)
- OAuth2 token support as a credential type (Phase 1 handles app passwords only)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CONF-01 | User can configure multiple named email accounts (e.g. "personal", "work") via a config file | YAML parsing with `yaml` package + zod multi-account schema |
| CONF-02 | IMAP credentials can be supplied via environment variables as an alternative to the config file | `$ENV_VAR_NAME` reference pattern in YAML + zod `transform` for resolution |
| CONF-03 | Server enforces TLS/SSL for all IMAP connections (port 993); plain-text connections are rejected at startup | zod `refine()` on port field at config validation time — no IMAP connection needed |
</phase_requirements>

---

## Summary

Phase 1 establishes the complete project scaffold for an MCP server: package setup, TypeScript configuration, config loading/validation, credential hygiene, the `{account_id, uid}` data model, and quality tooling. No IMAP connections occur — the server starts, loads and validates config, registers stub tools, and exits cleanly on error.

The MCP TypeScript SDK (`@modelcontextprotocol/sdk`) is well-established with ~32,000 npm dependents and version 1.27.1 as of March 2026. The v1.x line is the production-recommended track; v2 (pre-alpha) is on main but not production-stable. The SDK mandates that stdout is used exclusively for JSON-RPC, making the `no-console` ESLint rule a hard safety requirement — not just style. Zod has introduced v4 via a subpath (`import { z } from "zod/v4"`) while the SDK's peer dependency specifies `zod >= 3.25` with explicit v4 compatibility. Using the `zod` top-level import (v3 API surface) is the safe, compatible path for this phase.

YAML parsing is best served by the `yaml` npm package (no external dependencies, TypeScript typings included, actively maintained). Config structure uses a `$ENV_VAR_NAME` reference syntax resolved at startup via `process.env` lookup — this pattern prevents credentials from ever appearing in the parsed config object and is safe to commit the YAML structure (but not values).

**Primary recommendation:** Use `@modelcontextprotocol/sdk` 1.27.1 + low-level `Server` class (not `McpServer`) for maximum control, `yaml` v2 for YAML parsing, `zod` v3 API for config validation, ESLint 9 flat config with `typescript-eslint`, Prettier 3, Vitest 2, and Husky v9 + lint-staged.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | `^1.27.1` | MCP server framework, stdio transport, tool registration | Official Anthropic SDK; 32K+ dependents; v1.x is production-stable |
| `zod` | `^3.25` | Config schema validation + TypeScript type inference | SDK peer dep; dual v3/v4 export — v3 API surface is stable and well-supported |
| `yaml` | `^2.x` | YAML config file parsing | No external deps; includes TypeScript typings (min TS 5.9); actively maintained; preferred over `js-yaml` for modern projects |
| `typescript` | `^5.4` | Language | Strict mode, Node22 target available via `@tsconfig/node22` |

### Supporting (Dev)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | `^2.x` | Unit testing | Out-of-box ESM + TypeScript support; Jest-compatible API; no separate transform config needed |
| `eslint` | `^9.x` | Linting | v9 is current stable; flat config is now the default (legacy `.eslintrc` deprecated) |
| `typescript-eslint` | `^8.x` | TypeScript ESLint rules | Unified package for parser + rules; replaces `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin` |
| `prettier` | `^3.x` | Code formatting | v3 is stable; supports TypeScript config files (`.prettierrc.ts`) |
| `husky` | `^9.x` | Git pre-commit hooks | Installs via `prepare` script; `.husky/pre-commit` shell script |
| `lint-staged` | `^15.x` | Run linters on staged files only | Pairs with husky; faster than running on all files |
| `@types/node` | `^22` | Node.js type definitions | Match Node.js runtime version |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `yaml` package | `js-yaml` | `js-yaml` 4.1.1 has 159M weekly downloads but typings are maintained separately (`@types/js-yaml`); `yaml` package has built-in typings and is more actively developed |
| `Server` (low-level) | `McpServer` (high-level) | `McpServer` has `server.tool()` shorthand but offers less control; `Server` with `setRequestHandler` is more explicit and used in official examples |
| ESLint 9 flat config | ESLint 8 legacy config | ESLint 8 is EOL; flat config is now the only supported format in v9 |

**Installation:**
```bash
npm install @modelcontextprotocol/sdk zod yaml
npm install -D typescript @types/node@22 vitest eslint typescript-eslint prettier husky lint-staged
```

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── config/
│   ├── schema.ts        # zod schema definitions (AccountConfig, AppConfig)
│   ├── loader.ts        # YAML read + env-var resolution + schema parse
│   └── types.ts         # exported TypeScript types inferred from zod schema
├── connections/         # Phase 2 — empty directory or placeholder
├── services/            # Phase 3+ — empty directory or placeholder
├── tools/
│   └── stubs.ts         # stub tool registrations (returns "not implemented")
├── logger.ts            # stderr-only logger utility
└── index.ts             # entry point: load config, init server, register tools, connect transport

build/                   # compiled output (gitignored)
tests/
├── config.test.ts       # config validation, env-var resolution, error messages
└── types.test.ts        # AccountRef / MessageRef type shape tests
eslint.config.mjs        # ESLint 9 flat config
.prettierrc              # Prettier config
vitest.config.ts         # Vitest config
tsconfig.json            # TypeScript config (strict, Node22 target)
package.json             # type: "module", build/test/lint scripts
.husky/
└── pre-commit           # runs lint-staged
```

### Pattern 1: MCP Server Startup with Stdio Transport
**What:** Create a `Server` instance, register tool handlers, connect to `StdioServerTransport`.
**When to use:** All MCP servers using stdin/stdout as the JSON-RPC channel.
**Example:**
```typescript
// Source: https://github.com/modelcontextprotocol/typescript-sdk
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "imap-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_accounts",
      description: "List configured IMAP accounts (stub)",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => ({
  content: [{ type: "text", text: "not implemented" }],
  isError: false,
}));

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // No console.log here — stdout belongs to JSON-RPC
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
```

### Pattern 2: Zod Config Schema with Env-Var Resolution
**What:** Parse YAML into a plain object, resolve `$ENV_VAR_NAME` references, then validate with zod.
**When to use:** Any field that must reference an environment variable rather than a literal value.
**Example:**
```typescript
// Source: derived from zod.dev + project decision
import { z } from "zod";

// A string that starts with $ is an env-var reference; others are literals
const envVarRefOrLiteral = z.string().transform((val, ctx) => {
  if (val.startsWith("$")) {
    const envKey = val.slice(1);
    const resolved = process.env[envKey];
    if (!resolved) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `env var ${envKey} is not set (referenced as ${val})`,
      });
      return z.NEVER;
    }
    return resolved;
  }
  return val;
});

const AccountSchema = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().refine((p) => p === 993, {
    message: "port must be 993 (TLS/SSL enforced)",
  }),
  username: z.string().min(1),
  password: envVarRefOrLiteral,
  display_name: z.string().optional(),
});

const AppConfigSchema = z.object({
  accounts: z.array(AccountSchema).min(1),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
```

### Pattern 3: Stderr-Only Logger
**What:** Thin wrapper over `console.error` that writes structured log lines to stderr.
**When to use:** All runtime logging. Never import `console.log` anywhere.
**Example:**
```typescript
// src/logger.ts
const LEVELS = ["debug", "info", "warn", "error"] as const;
type Level = (typeof LEVELS)[number];

export const logger = {
  debug: (msg: string) => log("debug", msg),
  info:  (msg: string) => log("info",  msg),
  warn:  (msg: string) => log("warn",  msg),
  error: (msg: string) => log("error", msg),
};

function log(level: Level, msg: string) {
  // process.stderr.write avoids any buffering issues
  process.stderr.write(`[${level.toUpperCase()}] ${msg}\n`);
}
```

### Pattern 4: `{account_id, uid}` Message Reference Type
**What:** A branded tuple type that makes it impossible to use bare UIDs.
**When to use:** Every place a message is identified — established in Phase 1 so all later phases are constrained.
**Example:**
```typescript
// src/types.ts
export interface MessageRef {
  account_id: string;  // matches config account `name` field
  uid: number;         // IMAP UID (scoped to account + mailbox)
}

// Prevents accidental bare-UID usage at the type level:
// function getMessage(uid: number) {}  ← TypeScript will reject callers that pass a bare number
// function getMessage(ref: MessageRef) {}  ← correct
```

### Anti-Patterns to Avoid
- **`console.log` anywhere in `src/`:** Writes to stdout, corrupts the JSON-RPC stream. Use `logger.info()` instead.
- **`process.exit(0)` on startup success:** Startup should not terminate. Only call `process.exit(1)` on unrecoverable config errors.
- **Storing resolved passwords in the AppConfig type:** The zod `transform` resolves env-var references, but the resolved secret should not be logged even at debug level.
- **Using bare UIDs as function arguments or object keys:** Establishes bad patterns that are painful to refactor once Phase 3+ code exists.
- **Importing from `"zod/v4"` subpath:** The SDK peer dep supports `zod >= 3.25` and the Zod v4 migration changed `error.errors` to `error.issues` and dropped some object methods. Stick to top-level `import { z } from "zod"` (v3 API) for compatibility.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML parsing | Custom regex/split YAML parser | `yaml` package | YAML edge cases (anchors, multiline strings, type coercion) are numerous |
| Config schema validation + type inference | Manual type guards | `zod` | Zod gives compile-time types AND runtime validation from one definition; error formatting is built-in |
| Env-var resolution with error reporting | Ad-hoc `process.env[key] ?? throw` | Zod `transform` with `ctx.addIssue` | Collects ALL missing env vars in one pass rather than failing on the first one |
| Pre-commit enforcement | Custom shell scripts | Husky + lint-staged | Husky is the standard Node.js hook manager; lint-staged limits scope to staged files for speed |
| JSON-RPC transport | Custom stdin/stdout framing | `StdioServerTransport` from SDK | The MCP protocol has specific framing requirements; the SDK handles them |

**Key insight:** Config validation is deceptively complex when you factor in: multiple error accumulation, clear field paths in error messages, type inference flowing into the rest of the codebase, and env-var resolution with missing-key reporting. Zod handles all of this idiomatically.

---

## Common Pitfalls

### Pitfall 1: Writing to stdout from the MCP process
**What goes wrong:** Any `console.log()` call writes to stdout, which the MCP host interprets as a JSON-RPC message fragment. The host either receives malformed JSON or crashes the connection silently.
**Why it happens:** `console.log` is the default debugging instinct; Node.js does not distinguish between "application output" and "protocol output."
**How to avoid:** `no-console` ESLint rule set to `"error"` — this catches it at lint time, not at runtime. The rule should be set to warn on ALL `console.*` methods including `console.warn` and `console.info` (both write to stdout by default depending on Node.js version — only `console.error` is guaranteed stderr).
**Warning signs:** MCP host logs showing JSON parse errors or connection drops immediately after tool call.

### Pitfall 2: Zod v3 vs v4 incompatibility
**What goes wrong:** Zod 3.25+ ships Zod 4 as a subpath `"zod/v4"`. If code uses `ZodError.errors` (v3) but somewhere imports v4 accidentally, the property is renamed to `ZodError.issues` in v4 and error-handling code silently breaks.
**Why it happens:** The npm package ships both versions; a minor upgrade from 3.24 to 3.25 introduces the bundled v4 subpath.
**How to avoid:** Use only top-level `import { z } from "zod"` (v3 API surface). Never use `import { z } from "zod/v4"`. Pin zod to `^3.25` range (not `^4`) until the ecosystem fully migrates.
**Warning signs:** `zodError.errors` returning `undefined` where it previously worked.

### Pitfall 3: ESLint 9 flat config requires different setup than legacy
**What goes wrong:** Projects copy old `.eslintrc.js` examples for `typescript-eslint`. In ESLint 9, the legacy format is dropped — you must use `eslint.config.mjs` (flat config). Guides from 2023 and earlier use the wrong format.
**Why it happens:** ESLint 9 shipped with flat config as the ONLY supported format. Many blog posts and StackOverflow answers still show the legacy format.
**How to avoid:** Use `eslint.config.mjs` with the `defineConfig` helper from `typescript-eslint`. Do not create `.eslintrc.*` files.
**Warning signs:** ESLint silently ignoring config or printing "No eslintrc config found" warnings.

### Pitfall 4: ES module import paths require `.js` extension
**What goes wrong:** With `"module": "Node16"` or `"NodeNext"` in tsconfig, TypeScript requires relative imports to end in `.js` (the compiled extension), not `.ts`. Imports like `import { logger } from "./logger"` fail at runtime even if TypeScript accepts them.
**Why it happens:** Node.js ESM spec requires explicit file extensions; TypeScript's module resolution in `Node16` mode enforces this at compile time.
**How to avoid:** Always write `import { logger } from "./logger.js"` in TypeScript source files. The `.js` refers to the compiled output.
**Warning signs:** `ERR_MODULE_NOT_FOUND` at runtime for files that clearly exist.

### Pitfall 5: Credentials leaking into log output
**What goes wrong:** A zod validation error or a debug log prints the raw config object, which includes the resolved password string.
**Why it happens:** Zod's default error messages include the invalid value in the message. Debug logging an object literal exposes all fields.
**How to avoid:** (1) In the logger, never log the full config object after env-var resolution. (2) Provide a `sanitizeConfig()` function that replaces resolved password values with `"[REDACTED]"` before any logging. (3) Use `safeParse()` (not `parse()`) so zod errors can be caught and formatted without the raw value.
**Warning signs:** Seeing IMAP passwords in stderr output during startup or error handling.

---

## Code Examples

Verified patterns from official sources:

### Minimal MCP Server Entry Point (`src/index.ts`)
```typescript
// Source: https://github.com/modelcontextprotocol/typescript-sdk docs/server.md pattern
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config/loader.js";
import { logger } from "./logger.js";

async function main() {
  const config = await loadConfig();   // throws + exits on invalid config

  const server = new Server(
    { name: "imap-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [/* stub definitions registered here */],
  }));

  server.setRequestHandler(CallToolRequestSchema, async () => ({
    content: [{ type: "text", text: "not implemented" }],
  }));

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Successful startup is silent (per spec decision)
}

main().catch((err: Error) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
```

### Config Loader (`src/config/loader.ts`)
```typescript
// Source: pattern derived from yaml package docs + zod.dev
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { AppConfigSchema } from "./schema.js";

export async function loadConfig() {
  const configPath =
    process.env["IMAP_MCP_CONFIG"] ??
    join(homedir(), ".config", "imap-mcp", "config.yaml");

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch {
    process.stderr.write(
      `Error: config file not found at ${configPath}\n` +
      `Set IMAP_MCP_CONFIG to override the default location.\n`
    );
    process.exit(1);
  }

  const parsed = parseYaml(raw);   // throws YAMLException on malformed YAML
  const result = AppConfigSchema.safeParse(parsed);

  if (!result.success) {
    const messages = result.error.errors
      .map((e) => `  ${e.path.join(".")}: ${e.message}`)
      .join("\n");
    process.stderr.write(`Config validation failed:\n${messages}\n`);
    process.exit(1);
  }

  return result.data;
}
```

### ESLint 9 Flat Config (`eslint.config.mjs`)
```javascript
// Source: https://typescript-eslint.io/getting-started/
import tseslint from "typescript-eslint";

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-console": "error",           // Prevents stdout corruption
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-function-return-type": "off",
    },
  }
);
```

### Vitest Config (`vitest.config.ts`)
```typescript
// Source: https://vitest.dev/config/
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json"],
    },
  },
});
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./build",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "build"]
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ESLint legacy `.eslintrc.js` | ESLint 9 flat config `eslint.config.mjs` | ESLint 9 (2024) | Old guides/examples all show wrong format |
| `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin` | Unified `typescript-eslint` package | typescript-eslint v8 (2024) | Single package replaces two; simpler config |
| Zod v3 only | Zod 3.25+ ships v4 at subpath `"zod/v4"` | Zod 3.25 (2025) | v3 API still the default import; migration is opt-in |
| `Server` class with `setRequestHandler` | Both `Server` (low-level) and `McpServer` (high-level) available | SDK 1.x | `McpServer` has `server.tool()` shorthand; `Server` offers more control |
| `js-yaml` for YAML parsing | `yaml` package (no deps, built-in typings) | Ongoing community shift | `yaml` is the recommended choice for new TypeScript projects |

**Deprecated/outdated:**
- `.eslintrc.js` / `.eslintrc.json`: removed in ESLint 9; use `eslint.config.mjs`
- `@typescript-eslint/parser` as a standalone install: merged into `typescript-eslint` unified package
- `jest` for Node.js TypeScript projects: Vitest is now preferred (no transform config needed, native ESM)

---

## Open Questions

1. **Zod v3 error formatting for nested arrays**
   - What we know: `error.errors[].path` is an array of string/number segments; for `accounts[1].port` the path would be `["accounts", 1, "port"]`
   - What's unclear: Whether `.join(".")` produces `accounts.1.port` or `accounts[1].port` — the user's expectation was bracket notation for array indices
   - Recommendation: In the config loader, post-process the path to produce `accounts[1].port` by checking if a segment is a number

2. **`McpServer` vs `Server` class for Phase 1 stubs**
   - What we know: `McpServer` has a cleaner `server.tool()` API; `Server` uses `setRequestHandler` pattern
   - What's unclear: Whether the higher-level `McpServer` API is stable enough to recommend for v1.x given v2 is in pre-alpha
   - Recommendation: Use low-level `Server` class for Phase 1 stubs; it matches the official quickstart examples and is unambiguously stable

3. **Husky v9 initialization command**
   - What we know: Husky v9 uses `npx husky init` and the `prepare` npm script
   - What's unclear: Exact shell script content for `.husky/pre-commit` to run both `eslint` and `vitest` via `lint-staged`
   - Recommendation: Configure lint-staged to run `eslint --fix` and `prettier --write` on staged `.ts` files; run `vitest run` as a separate pre-commit step (not via lint-staged, since it's not file-scoped)

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2.x |
| Config file | `vitest.config.ts` — Wave 0 gap (does not yet exist) |
| Quick run command | `npx vitest run` |
| Full suite command | `npx vitest run --coverage` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONF-01 | Multi-account YAML config parses and validates correctly | unit | `npx vitest run tests/config.test.ts -t "multi-account"` | Wave 0 |
| CONF-01 | Single-account config validates correctly | unit | `npx vitest run tests/config.test.ts -t "single account"` | Wave 0 |
| CONF-01 | Missing required field (`host`) fails with clear error | unit | `npx vitest run tests/config.test.ts -t "missing field"` | Wave 0 |
| CONF-02 | `$ENV_VAR_NAME` references resolve to env var values | unit | `npx vitest run tests/config.test.ts -t "env var resolution"` | Wave 0 |
| CONF-02 | Missing env var referenced by `$NAME` fails with clear error | unit | `npx vitest run tests/config.test.ts -t "missing env var"` | Wave 0 |
| CONF-03 | Port 993 passes validation | unit | `npx vitest run tests/config.test.ts -t "port 993"` | Wave 0 |
| CONF-03 | Port 143 (plaintext) fails validation with clear error | unit | `npx vitest run tests/config.test.ts -t "port 143 rejected"` | Wave 0 |
| (structural) | `MessageRef` type shape satisfies `{account_id, uid}` contract | type-level | `npx tsc --noEmit` | Wave 0 |
| (startup) | Server starts without crashing given valid config | smoke | `npx vitest run tests/startup.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run`
- **Per wave merge:** `npx vitest run --coverage`
- **Phase gate:** Full suite green + `npx tsc --noEmit` passes before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/config.test.ts` — covers CONF-01, CONF-02, CONF-03
- [ ] `tests/startup.test.ts` — smoke-tests server init without crashing
- [ ] `vitest.config.ts` — framework config
- [ ] Framework install: `npm install -D vitest` — if not yet in package.json

---

## Sources

### Primary (HIGH confidence)
- [modelcontextprotocol/typescript-sdk GitHub](https://github.com/modelcontextprotocol/typescript-sdk) — server setup, StdioServerTransport, import paths
- [modelcontextprotocol.io build-server docs](https://modelcontextprotocol.io/docs/develop/build-server) — stdout/stderr separation requirement, official patterns
- [zod.dev](https://zod.dev/) — schema API, `safeParse`, `transform`, error format
- [zod.dev v4 migration guide](https://zod.dev/v4/changelog) — v3/v4 coexistence, breaking changes
- [typescript-eslint.io](https://typescript-eslint.io/getting-started/) — ESLint 9 flat config setup
- [vitest.dev](https://vitest.dev/guide/) — configuration, test patterns
- [eemeli/yaml GitHub](https://github.com/eemeli/yaml) — `yaml` package for YAML parsing

### Secondary (MEDIUM confidence)
- [npm @modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — current version 1.27.1 confirmed
- [hackteam.io MCP TypeScript tutorial](https://hackteam.io/blog/build-your-first-mcp-server-with-typescript-in-under-10-minutes/) — import path patterns, server initialization
- [DEV Community: ESLint 9 flat config tutorial](https://dev.to/aolyang/eslint-9-flat-config-tutorial-2bm5) — ESLint 9 flat config with TypeScript
- [DEV Community: Build production-ready MCP servers](https://dev.to/quantbit/building-production-ready-mcp-servers-with-typescript-a-complete-guide-2mg1) — tsconfig recommendations

### Tertiary (LOW confidence)
- Search result summaries for Husky v9 + lint-staged — setup is well-known but not directly verified against official husky.typicode.com docs in this session

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — npm versions and SDK patterns verified via official GitHub and npm
- Architecture: HIGH — project structure follows locked decisions from CONTEXT.md; patterns verified via official MCP docs
- Pitfalls: HIGH — stdout/stderr separation confirmed by official MCP docs; zod v3/v4 split confirmed via zod.dev changelog; ESLint 9 flat config confirmed via official ESLint blog

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (stable ecosystem; MCP SDK v2 may ship within this window — re-verify SDK version before planning)
