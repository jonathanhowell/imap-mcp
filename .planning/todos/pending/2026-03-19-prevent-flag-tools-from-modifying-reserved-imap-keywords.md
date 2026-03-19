---
created: 2026-03-19T14:25:17.319Z
title: Prevent flag tools from modifying reserved IMAP keywords
area: api
files:
  - src/tools/search-messages.ts
---

## Problem

The add-flag and remove-flag tools currently allow any keyword to be passed, including reserved IMAP system flags defined in RFC 3501 (e.g. `\Seen`, `\Answered`, `\Flagged`, `\Deleted`, `\Draft`, `\Recent`) and RFC 5788 system keywords like `\Sent`. These reserved keywords (prefixed with `\`) have special meaning in IMAP and should not be treated as user-managed custom keywords. Allowing the tools to set/unset them could lead to unintended mailbox state changes.

## Solution

Add a validation step in both add-flag and remove-flag tools that rejects reserved/system IMAP keywords (those prefixed with `\`). Only allow custom keywords (not prefixed with `\`) to be added or removed. Return a clear error message explaining that reserved keywords cannot be modified via these tools.

Reference: RFC 3501 §2.3.2 (system flags), RFC 5788 (keyword registry).
