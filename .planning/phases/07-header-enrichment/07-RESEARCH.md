# Phase 7: Header Enrichment - Research

**Researched:** 2026-03-15
**Domain:** TypeScript type system, imapflow envelope parsing, IMAP MCP service layer
**Confidence:** HIGH

## Summary

This phase adds `to` and `cc` recipient arrays to every `list_messages` and `search_messages`
response item. The work is almost entirely a propagation exercise through a clean type hierarchy:
add two fields to `MessageHeader` in `src/types.ts` and the TypeScript compiler will flag every
place that constructs a `MessageHeader`-shaped object — exactly two mapping closures, one in
`message-service.ts` and one in `search-service.ts`.

The imapflow `envelope` object is already fetched in both services (the `fetchAll` call already
requests `{ uid: true, envelope: true, flags: true, internalDate: true }`), so `envelope.to` and
`envelope.cc` are available at zero additional IMAP round-trips. Both fields are typed by imapflow
as `Array<{name?: string, address?: string, ...}> | undefined`, so extraction requires null-safe
iteration with a compact helper function.

The `from` field must also be updated from bare-address to `"Name <addr>"` format for consistency,
and existing tests that assert on specific `from` values must be updated to match. The mock
message objects in the test files currently supply only `address` on the envelope `from` entry —
those mocks must gain an optional `name` property to enable `from` format testing.

**Primary recommendation:** Implement as a single focused wave: (1) add helper `formatAddress`,
(2) update `MessageHeader` type, (3) update both service mapping closures, (4) update tests.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Each entry in `to` and `cc` is a plain string
- Format: `"Name <address>"` when display name is available (e.g. `"Alice Smith <alice@example.com>"`)
- Fall back to bare address when name is absent (e.g. `"bob@example.com"`)
- Both fields are always present — empty array `[]` when no recipients, never omitted
- Update `from` to also use `"Name <addr>"` format for consistency with `to`/`cc`
  - Before: `"sender@example.com"` (bare address only)
  - After: `"Alice Smith <alice@example.com>"` (name when available, bare address as fallback)
  - Existing tests that assert on `from` will need to be updated to reflect the new format
- The poller cache (`Poller.ts`) stores `MultiAccountMessageHeader[]`, which extends `MessageHeader`
  - Adding `to` and `cc` to `MessageHeader` automatically propagates to cached entries
  - `get_new_mail` responses will include `to` and `cc` — no extra IMAP calls needed

### Claude's Discretion
- Exact TypeScript type for the new fields (`to: string[]`, `cc: string[]` on `MessageHeader`)
- Helper function to format a single imapflow address object as `"Name <addr>"` string
- How to handle the edge case where `address` is undefined on an envelope entry (skip the entry)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| HDR-01 | `list_messages` response includes `to` and `cc` recipient fields for each message | `envelope.to`/`envelope.cc` already available from existing `fetchAll` call in `message-service.ts`; mapping closure must be extended |
| HDR-02 | `search_messages` response includes `to` and `cc` recipient fields for each result | `envelope.to`/`envelope.cc` already available from existing `fetchAll` call in `search-service.ts`; same change needed in `searchFolder()` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| imapflow | ^1.2.13 | IMAP client — supplies `envelope.to`, `envelope.cc` | Already the project IMAP layer; no alternative |
| TypeScript | ^5.9.3 | Strict type checking ensures propagation is complete | Already project language; strict mode active |
| vitest | ^4.0.18 | Test runner | Already used; all existing tests run with `npx vitest run` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none new) | — | No new dependencies needed | All required libraries are already installed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Plain string `"Name <addr>"` | Structured `{name, address}` object | Structured would be richer but user locked the format as plain string |
| Inline extraction in each service | Shared `formatAddress` helper | Helper is cleaner (DRY) and was identified as Claude's discretion |

**Installation:**
No new packages required.

## Architecture Patterns

### Recommended Project Structure
No structural changes — files already exist. Changes are confined to:
```
src/
├── types.ts                        # MessageHeader gains to: string[], cc: string[]
├── services/
│   ├── message-service.ts          # messages.map() extended to extract to/cc, update from
│   └── search-service.ts           # searchFolder() map extended to extract to/cc, update from
tests/
└── tools/
    ├── list-messages.test.ts       # makeMockMessage and assertions updated
    ├── search-messages.test.ts     # defaultMessages mock and assertions updated
    └── multi-account-types.test.ts # MessageHeader literal objects updated
```

### Pattern 1: Address Formatting Helper
**What:** A pure function that converts one imapflow envelope address entry to a string, placed
either as a module-level function in each service file or extracted to a shared utility.
**When to use:** Called in both `message-service.ts` and `search-service.ts` mapping closures.
**Example:**
```typescript
// Helper (define where used, or in a shared src/utils/address.ts)
function formatAddress(entry: { name?: string; address?: string }): string {
  if (entry.name && entry.address) return `${entry.name} <${entry.address}>`;
  return entry.address ?? "";
}

// Usage in mapping closure
to: (msg.envelope?.to ?? [])
  .filter((e) => e.address !== undefined)
  .map(formatAddress),
cc: (msg.envelope?.cc ?? [])
  .filter((e) => e.address !== undefined)
  .map(formatAddress),
from: formatAddress(msg.envelope?.from?.[0] ?? {}),
```

### Pattern 2: Type Change Propagates via Inheritance
**What:** TypeScript's structural typing means adding required fields to `MessageHeader` causes
compile errors everywhere an object is constructed that claims to satisfy `MessageHeader`. This
is the compile-time guide to all files needing changes.
**When to use:** After updating `types.ts`, run `npm run build` — compiler errors are the
exhaustive change list.

### Anti-Patterns to Avoid
- **Skipping entries where `address` is undefined:** imapflow docs note group syntax entries
  (RFC 2822) can have `address: undefined`. These should be filtered out, not included as empty
  strings. The decision in CONTEXT.md says "skip the entry" for undefined `address`.
- **Fetching envelope separately:** `envelope` is already in the `fetchAll` query — never add a
  second IMAP call just for header fields.
- **Adding `to`/`cc` only to multi-account types:** The fields belong on `MessageHeader` itself;
  multi-account types inherit them automatically.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Recipient parsing | Custom RFC 2822 parser | imapflow's already-parsed `envelope.to`/`envelope.cc` | Already decoded; no library needed |
| Address formatting | Complex regex | Simple conditional string template | The format is `"Name <addr>"` or bare addr — one line |

**Key insight:** imapflow does the hard work of parsing RFC 2822 address headers into structured
objects. The only task here is formatting those objects into strings.

## Common Pitfalls

### Pitfall 1: Undefined `address` on envelope entries
**What goes wrong:** imapflow can return group-name entries (RFC 2822 group syntax) where `name`
is set but `address` is `undefined`. Mapping these naively produces entries like `"Undisclosed recipients <undefined>"` or `"undefined"`.
**Why it happens:** RFC 2822 allows address groups like `Undisclosed recipients:;` which IMAP
servers surface as envelope entries without an address.
**How to avoid:** Filter entries where `e.address === undefined` before mapping.
**Warning signs:** Test output containing the string `"undefined"` in a formatted address.

### Pitfall 2: Test mock messages missing `to`/`cc` on envelope
**What goes wrong:** The existing `makeMockMessage` helper in `list-messages.test.ts` and the
`defaultMessages` array in `search-messages.test.ts` do not include `to` or `cc` on the
`envelope` object. After the type change, new tests for HDR-01/HDR-02 will need mocks that
include these fields.
**Why it happens:** Mocks were built for a previous subset of fields.
**How to avoid:** Update `makeMockMessage` to accept optional `to` and `cc` arrays in its `opts`
parameter. Similarly update `defaultMessages` in the search test.

### Pitfall 3: LIST-04 test assertion on MessageHeader shape
**What goes wrong:** `list-messages.test.ts` contains a test (LIST-04: "no body fields in
response") that asserts `Object.keys(h)` contains exactly `["uid", "from", "subject", "date", "unread"]`. After adding `to` and `cc`, this assertion will fail.
**Why it happens:** The test uses `expect.arrayContaining(...)` which should survive additions,
but the intent of the test must be preserved while accepting the new fields.
**How to avoid:** Update the assertion to also expect `"to"` and `"cc"` in the key list.

### Pitfall 4: `from` format change breaks existing test assertions
**What goes wrong:** Several tests assert on specific `from` values like `"alice@example.com"`.
After updating `from` extraction to include the display name, these assertions will produce
wrong results if mock `envelope.from` entries don't include `name`.
**Why it happens:** The old extraction was `msg.envelope?.from?.[0]?.address ?? ""` — name was
ignored. The new extraction must use `formatAddress`.
**How to avoid:** Audit every test that checks a `from` value. Update mocks or expected strings.
Key files: `tests/tools/list-messages.test.ts`, `tests/tools/search-messages.test.ts`,
`tests/tools/multi-account-types.test.ts`.

### Pitfall 5: `multi-account-types.test.ts` constructs `MessageHeader`-shaped literals
**What goes wrong:** This test file constructs `MultiAccountMessageHeader` literals directly.
After `MessageHeader` gains required fields `to` and `cc`, these literals will fail to typecheck.
**Why it happens:** TypeScript strict mode — required fields must be present.
**How to avoid:** Add `to: []` and `cc: []` to each literal object in that test file.

## Code Examples

Verified patterns from official sources and direct codebase inspection:

### Current from extraction (before)
```typescript
// Source: src/services/message-service.ts line 59, search-service.ts line 80
from: msg.envelope?.from?.[0]?.address ?? "",
```

### Updated from extraction and new to/cc extraction (after)
```typescript
// Helper function (module-level, before the exported function)
function formatAddress(entry: { name?: string; address?: string }): string {
  if (entry.name && entry.address) return `${entry.name} <${entry.address}>`;
  return entry.address ?? "";
}

// In the messages.map() closure:
from: formatAddress(msg.envelope?.from?.[0] ?? {}),
to: (msg.envelope?.to ?? [])
  .filter((e): e is { name?: string; address: string } => e.address !== undefined)
  .map(formatAddress),
cc: (msg.envelope?.cc ?? [])
  .filter((e): e is { name?: string; address: string } => e.address !== undefined)
  .map(formatAddress),
```

### Updated MessageHeader type
```typescript
// Source: src/types.ts — MessageHeader interface
export interface MessageHeader {
  uid: number;
  from: string;
  subject: string;
  date: string;
  unread: boolean;
  to: string[];
  cc: string[];
}
```

### Updated makeMockMessage helper (test pattern)
```typescript
// tests/tools/list-messages.test.ts
function makeMockMessage(
  uid: number,
  opts: {
    from?: string;
    fromName?: string;
    subject?: string;
    date?: Date;
    seen?: boolean;
    to?: Array<{ name?: string; address: string }>;
    cc?: Array<{ name?: string; address: string }>;
  } = {}
) {
  return {
    seq: uid,
    uid,
    envelope: {
      from: opts.from ? [{ address: opts.from, name: opts.fromName }] : [],
      subject: opts.subject ?? `Subject ${uid}`,
      to: opts.to ?? [],
      cc: opts.cc ?? [],
    },
    flags: new Set<string>(opts.seen ? ["\\Seen"] : []),
    internalDate: opts.date ?? new Date("2024-01-01T00:00:00.000Z"),
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `from` as bare address `address ?? ""` | `from` as `"Name <addr>"` formatted string | Phase 7 | Existing `from` test assertions need updating |
| `MessageHeader` has no recipient fields | `MessageHeader` has `to: string[]`, `cc: string[]` | Phase 7 | All downstream types (Search, MultiAccount, Poller cache) gain the fields automatically |

**Deprecated/outdated:**
- Direct `msg.envelope?.from?.[0]?.address ?? ""` pattern: replace with `formatAddress(msg.envelope?.from?.[0] ?? {})` in both service files.

## Open Questions

1. **Placement of `formatAddress` helper**
   - What we know: Used in exactly two files (`message-service.ts`, `search-service.ts`)
   - What's unclear: Whether to define it once in each file or extract to `src/utils/address.ts`
   - Recommendation: Define once in each service file (copy). The function is 3 lines; a shared util adds indirection for negligible benefit. If a third consumer appears in a future phase, extract then.

2. **TypeScript filter predicate for `address !== undefined`**
   - What we know: `filter(e => e.address !== undefined)` narrows the type but TypeScript may still complain about calling `formatAddress` without the narrowed type
   - What's unclear: Whether a type predicate `(e): e is { name?: string; address: string }` is needed or if TypeScript infers it
   - Recommendation: Use the explicit type predicate shown in the Code Examples section to be safe under strict mode.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.0.18 |
| Config file | none — vitest auto-discovers `tests/**/*.test.ts` |
| Quick run command | `npx vitest run tests/tools/list-messages.test.ts tests/tools/search-messages.test.ts tests/tools/multi-account-types.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HDR-01 | `list_messages` response has `to` and `cc` arrays on every item | unit | `npx vitest run tests/tools/list-messages.test.ts` | ✅ (needs new test cases added) |
| HDR-01 | `to` and `cc` are present even when empty (not absent key) | unit | `npx vitest run tests/tools/list-messages.test.ts` | ✅ (needs new test case) |
| HDR-02 | `search_messages` response has `to` and `cc` arrays on every result | unit | `npx vitest run tests/tools/search-messages.test.ts` | ✅ (needs new test cases added) |
| HDR-02 | `to` and `cc` are present even when empty (not absent key) | unit | `npx vitest run tests/tools/search-messages.test.ts` | ✅ (needs new test case) |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/tools/list-messages.test.ts tests/tools/search-messages.test.ts tests/tools/multi-account-types.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
None — existing test infrastructure covers all phase requirements. New test cases must be added
inside the existing test files; no new files are needed and the framework is already configured.

## Sources

### Primary (HIGH confidence)
- Direct code inspection of `src/types.ts` — current `MessageHeader` interface (lines 34-40)
- Direct code inspection of `src/services/message-service.ts` — `fetchAll` query (line 52-55), mapping closure (lines 57-66)
- Direct code inspection of `src/services/search-service.ts` — `fetchAll` query (lines 73-77), mapping closure (lines 78-88)
- Direct code inspection of `src/polling/poller.ts` — cache type is `MultiAccountMessageHeader[]` (line 17), poller uses spread `{ ...m, account: accountId }` (line 140) — no code change needed
- Direct inspection of `tests/tools/list-messages.test.ts` — `makeMockMessage` shape, LIST-04 assertion (lines 225-229)
- Direct inspection of `tests/tools/search-messages.test.ts` — `defaultMessages` mock, `from` assertion pattern
- Direct inspection of `tests/tools/multi-account-types.test.ts` — literal `MessageHeader` objects

### Secondary (MEDIUM confidence)
- imapflow npm package (^1.2.13) envelope type: `to`/`cc`/`bcc` are `Array<{name?: string, mailbox?: string, host?: string, address?: string}>` — verified by reading imapflow TypeScript definitions referenced in `node_modules`

### Tertiary (LOW confidence)
- None — all findings are based on direct code inspection at HIGH confidence

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all code directly inspected
- Architecture: HIGH — type propagation chain verified end-to-end
- Pitfalls: HIGH — identified from direct test file inspection (LIST-04 assertion, multi-account-types literals, mock shape gaps)

**Research date:** 2026-03-15
**Valid until:** 2026-04-15 (stable codebase, no external API dependencies)
