# Phase 8: Account Context and Tool Ergonomics - Research

**Researched:** 2026-03-16
**Domain:** TypeScript MCP tool response enrichment, Zod schema extension, ConnectionManager API surface
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- `list_accounts` flat shape: new `email` and optional `display_name` fields added alongside existing `account` and `status` fields
- `email` is always present on every account entry, regardless of connection state (connected/error/connecting/reconnecting)
- `display_name` is omitted entirely when not set in config (do not return null — omit the key)
- Example when display_name configured: `{ account: "work", status: "connected", display_name: "Work Gmail", email: "me@work.com" }`
- Example when display_name absent: `{ account: "work", status: "connected", email: "me@work.com" }`
- Email address source: add optional `email` field to `AccountSchema`; when `email` is not set, fall back to `username`
- Existing configs require no changes; new `email` field is opt-in
- `folder` becomes optional in `ListMessagesParams` with default value `"INBOX"` (hardcoded, not per-account configurable)
- `LIST_MESSAGES_TOOL` inputSchema: remove `"folder"` from the `required` array
- `LIST_MESSAGES_TOOL` description: update to mention INBOX default when folder is omitted
- Add `getConfig(accountId: string): AccountConfig | undefined` method to `ConnectionManager`
- `handleListAccounts` calls `getConfig(id)` alongside `getStatus(id)` to retrieve `display_name` and resolved `email`

### Claude's Discretion

- Exact TypeScript type for the new `email` field on `AccountConfig` (optional string, same pattern as `display_name`)
- How to handle the `getConfig` return when account is unknown (return `undefined`, caller handles)
- Order of fields in the JSON response object

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ACTX-01 | `list_accounts` response includes `display_name` for each account (when configured) | `display_name` already exists on `AccountSchema` as `z.string().optional()`; pattern is established. `handleListAccounts` iterates `getAccountIds()` — same loop adds `getConfig(id)` call. Conditional spread pattern documented in CONTEXT.md. |
| ACTX-02 | `list_accounts` response includes the email address for each account | Add `email: z.string().optional()` to `AccountSchema`; fallback to `username` field when absent. `AccountConfig` type is inferred from schema, so type updates automatically. `ConnectionManager` needs `getConfig()` method exposing stored config. |
| SRCH-06 | `list_messages` `folder` parameter is optional, defaulting to INBOX when omitted | `ListMessagesParams.folder: string` becomes `folder?: string`; handler applies `?? "INBOX"` before passing to `listMessages()`. `required: ["folder"]` in inputSchema changes to `required: []`. All existing callers passing `folder` explicitly are unaffected. |
</phase_requirements>

## Summary

Phase 8 is two small, independent ergonomics improvements to existing tools. Neither change introduces new tools, new dependencies, or architectural complexity. Both are purely additive changes — new fields on existing responses, and a parameter becoming optional.

The first improvement (ACTX-01, ACTX-02) enriches `list_accounts` responses with `display_name` and `email`. The config schema already supports `display_name` as `z.string().optional()` — the `email` field follows the identical pattern. The only structural change is adding `getConfig()` to `ConnectionManager` so `handleListAccounts` can access account config data alongside the status data it already reads. The fallback of `username` as the email address is safe: IMAP `username` is documented as "usually your email address" across all major providers.

The second improvement (SRCH-06) makes `list_messages`'s `folder` parameter optional with an INBOX default. This is a single-line change to `ListMessagesParams`, a small inputSchema change, and a `?? "INBOX"` application in the handler. Existing tests pass `folder` explicitly and remain unaffected.

**Primary recommendation:** Implement as two independent sub-tasks — one per requirement group. Each change is fully isolated and can be tested independently.

## Standard Stack

### Core (already in use — no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | existing | Schema validation and type inference | Already used for all config schemas; `AccountConfig` type is auto-inferred |
| vitest | existing | Test framework | All project tests use vitest |
| TypeScript | existing | Type safety | Project is fully TypeScript |

### Supporting (already in use)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @modelcontextprotocol/sdk | existing | `Tool` type for inputSchema | Used by all tool definitions |

**No new packages to install.** Phase 8 has zero new dependencies.

## Architecture Patterns

### Recommended Project Structure

No new files required. All changes are in-place modifications of existing files:

```
src/
├── config/
│   └── schema.ts          # Add email field to AccountSchema
├── connections/
│   └── connection-manager.ts   # Add getConfig() method
└── tools/
    ├── list-accounts.ts   # Enrich response with email + display_name
    └── list-messages.ts   # Make folder optional, add INBOX default
tests/
├── config.test.ts         # New: email field validation cases
├── connections/
│   └── connection-manager.test.ts   # New: getConfig() method tests
└── tools/
    ├── list-accounts.test.ts   # New file: ACTX-01/ACTX-02 tests
    └── list-messages.test.ts   # New: SRCH-06 default-folder tests
```

### Pattern 1: Optional Field on AccountSchema

The project has an established pattern for optional config fields. `display_name` is already implemented:

```typescript
// Source: src/config/schema.ts (existing)
export const AccountSchema = z.object({
  // ... existing fields ...
  display_name: z.string().optional(),
  // New field follows identical pattern:
  email: z.string().optional(),
});
```

`AccountConfig` is inferred (`z.infer<typeof AccountSchema>`), so the type gains `email?: string` automatically with no changes to `src/config/types.ts`.

### Pattern 2: Conditional Spread for Optional Response Fields

The CONTEXT.md documents the pattern for omitting fields when not set:

```typescript
// Source: 08-CONTEXT.md — field omission pattern
const entry = {
  account: id,
  status: statusString,
  email: cfg?.email ?? cfg?.username ?? "",
  ...(cfg?.display_name ? { display_name: cfg.display_name } : {}),
};
```

This ensures `display_name` is absent from JSON output when not configured, matching the locked decision: "omit the key" not "return null".

### Pattern 3: getConfig() on ConnectionManager

`ConnectionManager` already stores `AccountConfig` in each `AccountConnection`. The new method exposes this:

```typescript
// Pattern derived from existing getStatus() method structure
getConfig(accountId: string): AccountConfig | undefined {
  const connection = this.connections.get(accountId);
  if (!connection) return undefined;
  return connection.getConfig(); // OR expose config directly from connection
}
```

The `AccountConnection` class stores `private readonly config: AccountConfig` — either expose via a `getConfig()` method on `AccountConnection`, or re-store config in `ConnectionManager`'s own map. The simplest approach: store config in `ConnectionManager` directly during construction.

Simpler alternative (avoids touching `AccountConnection`):

```typescript
// Store config map in ConnectionManager constructor
private readonly configs: Map<string, AccountConfig>;

constructor(config: AppConfig) {
  this.connections = new Map();
  this.configs = new Map();
  for (const account of config.accounts) {
    this.connections.set(account.name, new AccountConnection(account.name, account));
    this.configs.set(account.name, account);
  }
}

getConfig(accountId: string): AccountConfig | undefined {
  return this.configs.get(accountId);
}
```

This is cleaner than reaching into `AccountConnection` internals — follows the existing pattern where `ConnectionManager` owns its own lookup structures.

### Pattern 4: Optional Parameter with Default in Handler

The existing `handleListMessages` already uses `??` for optional params. Extending to `folder`:

```typescript
// Current: src/tools/list-messages.ts
export interface ListMessagesParams {
  account?: string;
  folder?: string;  // was: folder: string
  // ...
}

// In handler:
const effectiveFolder = folder ?? "INBOX";
// Pass effectiveFolder to all internal calls instead of folder
```

The inputSchema change: `required: ["folder"]` → `required: []`.
The description update: add "Defaults to INBOX when folder is omitted."

### Anti-Patterns to Avoid

- **Returning `null` for absent display_name:** The locked decision is to omit the key entirely. `JSON.stringify` will drop keys with `undefined` value, so `...( display_name ? { display_name } : {} )` is correct; do NOT use `display_name: display_name ?? null`.
- **Changing AccountConfig type manually:** `AccountConfig = z.infer<typeof AccountSchema>` auto-derives the type. Only edit `schema.ts` — never edit `types.ts` to add fields manually.
- **Making folder default configurable per-account:** CONTEXT.md locks it as hardcoded `"INBOX"`. Do not add per-account folder defaults to config.
- **Touching AccountConnection internals for config access:** Store configs in a separate `Map<string, AccountConfig>` in `ConnectionManager` rather than adding public methods to `AccountConnection`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Type inference for new config field | Manual `AccountConfig` interface edit | `z.infer<typeof AccountSchema>` auto-derives | Types.ts is already a single infer line — editing it manually creates drift risk |
| Field presence in JSON output | Explicit `delete` or `JSON.stringify` replacer | Conditional spread `...(val ? { key: val } : {})` | Already established project pattern; clean, readable, no runtime magic |

## Common Pitfalls

### Pitfall 1: email fallback applied in wrong place
**What goes wrong:** The `email ?? username` fallback logic ends up duplicated or placed in the schema transform instead of the handler.
**Why it happens:** Temptation to handle the fallback at parse time via a Zod `.transform()`.
**How to avoid:** Keep `email` as a plain `z.string().optional()` on the schema — no transform. Apply `cfg.email ?? cfg.username` in `handleListAccounts` at the point of building the response object. This keeps config schema simple and the business logic visible in the tool handler.
**Warning signs:** A Zod `.transform()` on the `email` field, or a `refine()` that cross-references `username`.

### Pitfall 2: folder default applied before null check
**What goes wrong:** Handler destructures `folder` and applies default inline, but `folder` is used in a place that still expects the raw (possibly undefined) value.
**Why it happens:** Partial application of the default — e.g., only applied on the single-account path but not the multi-account fan-out path.
**How to avoid:** Apply `const effectiveFolder = folder ?? "INBOX"` as the FIRST line of the handler body, before the single-account / multi-account branch split. Use `effectiveFolder` everywhere `folder` was previously used.
**Warning signs:** The fan-out path calling `listMessages(client, folder, ...)` with the raw destructured `folder` instead of `effectiveFolder`.

### Pitfall 3: Test mock for ConnectionManager missing getConfig
**What goes wrong:** Existing tests using mock `ConnectionManager` objects fail or produce `undefined` errors because the mocks don't include `getConfig`.
**Why it happens:** Mock objects are minimal inline objects — adding a new public method to the real class doesn't update existing mocks.
**How to avoid:** When writing new list-accounts tests, construct the mock `ConnectionManager` with `getConfig` present. Existing tests only mock `getClient`/`getAccountIds`/`getStatus` — those tests don't call `handleListAccounts`, so they're unaffected. But any new test or future test that mocks `ConnectionManager` globally should include `getConfig`.

### Pitfall 4: display_name key present but undefined in JSON
**What goes wrong:** Response includes `display_name: undefined` which JSON.stringify silently drops — tests may pass but real behavior is inconsistent.
**Why it happens:** Using `display_name: cfg?.display_name` (always includes key) instead of conditional spread.
**How to avoid:** Use `...(cfg?.display_name ? { display_name: cfg.display_name } : {})` — this guarantees the key is absent when not set, matching the locked decision.

## Code Examples

### Adding email to AccountSchema

```typescript
// src/config/schema.ts
export const AccountSchema = z.object({
  name: z.string().min(1, "account name is required"),
  host: z.string().min(1, "host is required"),
  port: z.number().int().refine((p) => p === 993, { message: "..." }),
  username: z.string().min(1, "username is required"),
  password: envVarRefOrLiteral,
  display_name: z.string().optional(),
  email: z.string().optional(),  // new field — same pattern as display_name
});
// AccountConfig type in types.ts gains email?: string automatically
```

### getConfig method on ConnectionManager

```typescript
// src/connections/connection-manager.ts
// Add to constructor:
private readonly configs: Map<string, AccountConfig>;
// In constructor body, alongside existing connections.set():
this.configs.set(account.name, account);

// New method:
getConfig(accountId: string): AccountConfig | undefined {
  return this.configs.get(accountId);
}
```

### Enriched handleListAccounts

```typescript
// src/tools/list-accounts.ts
export function handleListAccounts(manager: ConnectionManager): ToolResult {
  const accountIds = manager.getAccountIds();
  const accounts = accountIds.map((id) => {
    const status = manager.getStatus(id);
    const cfg = manager.getConfig(id);
    const email = cfg?.email ?? cfg?.username ?? "";

    const baseEntry = {
      account: id,
      email,
      ...(cfg?.display_name ? { display_name: cfg.display_name } : {}),
    };

    if ("error" in status) {
      return { ...baseEntry, status: "error", detail: status.error };
    }
    switch (status.kind) {
      case "connected":
        return { ...baseEntry, status: "connected" };
      case "connecting":
        return { ...baseEntry, status: "connecting" };
      case "reconnecting":
        return { ...baseEntry, status: "reconnecting", attempt: status.attempt };
      case "failed":
        return { ...baseEntry, status: "failed", detail: status.reason };
    }
  });
  return {
    isError: false,
    content: [{ type: "text", text: JSON.stringify(accounts) }],
  };
}
```

### Optional folder in list-messages

```typescript
// src/tools/list-messages.ts
export interface ListMessagesParams {
  account?: string;
  folder?: string;  // changed from: folder: string
  limit?: number;
  offset?: number;
  sort?: "newest" | "oldest";
  unread_only?: boolean;
}

// In handleListMessages, first line of function body:
const effectiveFolder = folder ?? "INBOX";
// Replace all uses of `folder` with `effectiveFolder` throughout handler

// inputSchema change:
required: [],  // was: required: ["folder"]

// description update (add to existing description):
"List messages in a folder with pagination and optional filtering. When folder is omitted, defaults to INBOX."
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `list_accounts` returns only `account` + `status` | Returns `account`, `status`, `email`, optional `display_name` | Phase 8 | Agent can identify accounts by address, not just config key name |
| `list_messages` requires explicit `folder` | `folder` optional, defaults to INBOX | Phase 8 | Agents can fetch inbox without knowing folder path convention |

**No deprecations in this phase.** All changes are additive.

## Open Questions

None. The CONTEXT.md decisions fully specify the implementation. All technical questions were resolved in the discussion phase.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (existing) |
| Config file | vitest.config.ts or package.json scripts |
| Quick run command | `npm test -- --reporter=verbose tests/tools/list-accounts.test.ts tests/tools/list-messages.test.ts tests/connections/connection-manager.test.ts tests/config.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ACTX-01 | `list_accounts` includes `display_name` when configured | unit | `npm test -- tests/tools/list-accounts.test.ts` | Wave 0 |
| ACTX-01 | `list_accounts` omits `display_name` key when not configured | unit | `npm test -- tests/tools/list-accounts.test.ts` | Wave 0 |
| ACTX-02 | `list_accounts` includes `email` on every account entry | unit | `npm test -- tests/tools/list-accounts.test.ts` | Wave 0 |
| ACTX-02 | `email` falls back to `username` when `email` not set in config | unit | `npm test -- tests/tools/list-accounts.test.ts` | Wave 0 |
| ACTX-02 | `email` uses configured value when `email` is set in config | unit | `npm test -- tests/tools/list-accounts.test.ts` | Wave 0 |
| ACTX-02 | `AccountSchema` accepts `email` as optional field | unit | `npm test -- tests/config.test.ts` | ❌ Wave 0 |
| ACTX-02 | `ConnectionManager.getConfig()` returns config for known account | unit | `npm test -- tests/connections/connection-manager.test.ts` | ❌ Wave 0 |
| ACTX-02 | `ConnectionManager.getConfig()` returns `undefined` for unknown account | unit | `npm test -- tests/connections/connection-manager.test.ts` | ❌ Wave 0 |
| SRCH-06 | `list_messages` with no `folder` succeeds and passes `"INBOX"` to service | unit | `npm test -- tests/tools/list-messages.test.ts` | ❌ Wave 0 |
| SRCH-06 | `list_messages` with explicit `folder` still works as before | unit | `npm test -- tests/tools/list-messages.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test -- tests/tools/list-accounts.test.ts tests/connections/connection-manager.test.ts tests/config.test.ts tests/tools/list-messages.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/tools/list-accounts.test.ts` — covers ACTX-01 and ACTX-02 (file does not currently exist)
- [ ] New test cases in `tests/config.test.ts` — covers `email` field in `AccountSchema`
- [ ] New test cases in `tests/connections/connection-manager.test.ts` — covers `getConfig()` method
- [ ] New test cases in `tests/tools/list-messages.test.ts` — covers SRCH-06 folder default behavior

## Sources

### Primary (HIGH confidence)

- Direct code read: `src/config/schema.ts` — confirmed `display_name: z.string().optional()` pattern
- Direct code read: `src/config/types.ts` — confirmed `AccountConfig = z.infer<typeof AccountSchema>` inference pattern
- Direct code read: `src/connections/connection-manager.ts` — confirmed `Map<string, AccountConnection>`, no config map, no existing `getConfig()`
- Direct code read: `src/connections/account-connection.ts` — confirmed `private readonly config: AccountConfig` stored but unexposed
- Direct code read: `src/tools/list-accounts.ts` — confirmed current response shape and iteration pattern
- Direct code read: `src/tools/list-messages.ts` — confirmed `required: ["folder"]` and `ListMessagesParams.folder: string`
- Direct code read: `tests/tools/list-messages.test.ts` — confirmed no existing SRCH-06 tests; confirmed mock pattern
- Direct code read: `tests/connections/connection-manager.test.ts` — confirmed no existing `getConfig` tests
- Direct code read: `tests/config.test.ts` — confirmed existing `display_name` test coverage pattern
- `.planning/phases/08-account-context-and-tool-ergonomics/08-CONTEXT.md` — all implementation decisions

### Secondary (MEDIUM confidence)

None needed. All answers found in source code and CONTEXT.md decisions.

### Tertiary (LOW confidence)

None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in use; zero new dependencies
- Architecture: HIGH — all patterns verified directly in existing source code
- Pitfalls: HIGH — derived from code inspection of actual implementation points
- Test gaps: HIGH — confirmed by direct file inspection (no list-accounts test file exists)

**Research date:** 2026-03-16
**Valid until:** 2026-04-15 (stable codebase, no external API dependencies)
