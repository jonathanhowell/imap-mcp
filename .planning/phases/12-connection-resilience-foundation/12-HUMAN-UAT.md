---
status: partial
phase: 12-connection-resilience-foundation
source: [12-VERIFICATION.md]
started: 2026-06-11T21:20:29Z
updated: 2026-06-11T21:20:29Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. TCP half-open recovery via laptop sleep/wake (CONN-04 / SC1)
expected: Within ~95s of wake (socketTimeout + 5s grace), the affected account transitions `connected → reconnecting → connected`. Verify via `list_accounts`.
steps:
  1. Start the IMAP MCP server with ≥1 real account connected.
  2. Sleep the laptop for ≥5 minutes.
  3. Wake the laptop.
  4. Call `list_accounts` and watch the status field.
why_human: Vitest cannot simulate a half-open TCP connection — kernel-level socket state and real network disruption are required. Code substrate (keepalive options + 90s socketTimeout) is verified programmatically; end-to-end behavior requires manual repro.
result: [pending]

### 2. Fatal auth fast-suspend against a real IMAP server (CONN-03 / SC2)
expected: Within seconds of startup, `list_accounts` shows `status: "suspended"` with `detail: "Authentication failed — fix credentials"`. After waiting 60s, server stderr contains zero retry attempts for that account.
steps:
  1. Configure an account with a deliberately wrong password.
  2. Start the server.
  3. Call `list_accounts` and confirm the suspended status + stock detail string.
  4. Wait 60s, then `grep` server stderr for retry attempts — must be 0.
why_human: Requires a real IMAP server rejecting credentials with `AUTHENTICATIONFAILED`. Automated tests use mocked imapflow constructors; classifier + state-machine paths are unit-tested, but the real-server round trip is not.
result: [pending]

### 3. Multi-account staggered drop — no `MaxListenersExceededWarning` (CONN-06 / SC5)
expected: Zero `MaxListenersExceededWarning` matches in server stderr after multiple Wi-Fi toggle cycles across 3+ accounts.
steps:
  1. Configure 3+ real accounts.
  2. Toggle Wi-Fi off/on 5 times with ~30s intervals.
  3. Wait for all accounts to recover.
  4. `grep MaxListenersExceededWarning <server-stderr>` — must return no matches.
why_human: Requires ≥3 real connections plus inducing repeated transient drops. Unit tests assert `removeAllListeners` call counts; cumulative EventEmitter pressure across multiple accounts over many cycles needs manual repro.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
