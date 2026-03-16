# Phase 8: Account Context and Tool Ergonomics - Context

**Gathered:** 2026-03-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Two independent ergonomics improvements:
1. `list_accounts` — enrich each account entry with `display_name` (when configured) and `email` address
2. `list_messages` — make `folder` parameter optional, defaulting to `"INBOX"` when omitted

No new tools. No other response shape changes.

</domain>

<decisions>
## Implementation Decisions

### list_accounts response shape
- Flat shape: new fields added alongside existing `account` and `status` fields
- `email` is always present on every account entry, regardless of connection state (connected/error/connecting/reconnecting)
- `display_name` is omitted entirely when not set in config (do not return null — omit the key)
- Example when display_name configured: `{ account: "work", status: "connected", display_name: "Work Gmail", email: "me@work.com" }`
- Example when display_name absent: `{ account: "work", status: "connected", email: "me@work.com" }`

### Email address source
- Add an optional `email` field to `AccountSchema` in config
- When `email` is not set, fall back to `username` as the email address
- `username` is documented as "usually your email address" — the fallback is safe for all major providers
- Existing configs require no changes; new `email` field is opt-in

### list_messages folder default
- `folder` becomes optional in `ListMessagesParams`
- Default value: `"INBOX"` (hardcoded — not configurable per-account)
- `LIST_MESSAGES_TOOL` inputSchema: remove `"folder"` from the `required` array
- `LIST_MESSAGES_TOOL` description: update to mention INBOX default when folder is omitted
- Existing callers that pass `folder` explicitly are unaffected

### ConnectionManager config access
- Add `getConfig(accountId: string): AccountConfig | undefined` method to `ConnectionManager`
- `handleListAccounts` calls `getConfig(id)` alongside `getStatus(id)` to retrieve `display_name` and resolved `email`
- `ConnectionManager` already stores `AccountConfig` objects internally — expose via new method

### Claude's Discretion
- Exact TypeScript type for the new `email` field on `AccountConfig` (optional string, same pattern as `display_name`)
- How to handle the `getConfig` return when account is unknown (return `undefined`, caller handles)
- Order of fields in the JSON response object

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — ACTX-01, ACTX-02, SRCH-06 define the acceptance criteria for this phase

### Existing implementation
- `src/config/schema.ts` — `AccountSchema` and `AppConfigSchema`; add optional `email` field here
- `src/config/types.ts` — `AccountConfig` type (inferred from schema); will gain `email?: string`
- `src/tools/list-accounts.ts` — `handleListAccounts` and `LIST_ACCOUNTS_TOOL`; all changes here
- `src/connections/connection-manager.ts` — add `getConfig()` method
- `src/tools/list-messages.ts` — `LIST_MESSAGES_TOOL` inputSchema and `ListMessagesParams`; make `folder` optional

No external specs beyond requirements — requirements are fully captured in decisions above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `AccountSchema` in `src/config/schema.ts` already has `display_name: z.string().optional()` — same pattern for new `email` field
- `ConnectionManager` constructor receives `AppConfig` and stores `AccountConnection` per account — config data is available, just not exposed

### Established Patterns
- `handleListAccounts` already maps over `manager.getAccountIds()` and calls `manager.getStatus(id)` — same iteration point for `getConfig(id)`
- Field omission pattern: check optional field and spread conditionally (e.g. `...(cfg.display_name ? { display_name: cfg.display_name } : {})`)
- `ListMessagesParams` interface: `folder: string` → `folder?: string`; handler applies `?? "INBOX"` before passing to service

### Integration Points
- `src/config/schema.ts`: add `email: z.string().optional()` to `AccountSchema`
- `src/connections/connection-manager.ts`: add `getConfig(accountId)` returning stored `AccountConfig`
- `src/tools/list-accounts.ts`: call `getConfig(id)` and merge `email` + optional `display_name` into each account entry
- `src/tools/list-messages.ts`: change `required: ["folder"]` → `required: []`, update description, apply INBOX default in handler

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 08-account-context-and-tool-ergonomics*
*Context gathered: 2026-03-16*
