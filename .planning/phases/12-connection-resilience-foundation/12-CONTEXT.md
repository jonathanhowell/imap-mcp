# Phase 12: Connection Resilience Foundation - Context

**Gathered:** 2026-06-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Make `AccountConnection` self-heal from transient network failures (sleep/wake, Wi-Fi changes, server blips) and immediately quarantine fatal failures (bad credentials, expired certs) — so accounts no longer require a server restart after the old `BACKOFF_MAX_ATTEMPTS = 10` cap is hit.

Scope is the connection lifecycle itself: error classification, state machine, reconnect loop, TCP keepalive, race-safety, listener cleanup, and poller skip behavior for non-connected accounts. The agent-facing health surface (HEALTH-01..03) is Phase 13. The `reconnect_account` MCP tool is Phase 14.

</domain>

<decisions>
## Implementation Decisions

### State machine (overrides STATE.md)

- **D-01:** Reduce the `AccountConnectionStatus` union to **4 reachable states**: `connecting | connected | reconnecting | suspended`. The `failed` variant is **removed from the union entirely**, not kept as defined-but-unreachable.
  - Rationale: with unbounded transient retry, transient errors live in `reconnecting` forever; fatal errors go straight to `suspended`. `failed` has no organic trigger in v0.3, and the type system should mirror actual behavior.
  - Consequence: STATE.md's "5 named states" decision is **explicitly overridden by this phase**. STATE.md / PROJECT.md key-decisions entry must be updated when v0.3 ships. Any future need for a "failed" terminal (operator-stop, classifier safety net, etc.) re-adds the variant in its own phase.
  - Consumer impact: `ConnectionManager.getClient()` and `getStatus()` drop the `failed` case from their `switch`; Phase 13 `list_accounts` never needs to render `status: "failed"`.

- **D-02:** `suspended` carries `{ kind: "suspended", reason: string, since: Date }`. `reason` is a human-readable string the agent can show a user (matches HEALTH-03 intent — agent must be able to explain *why* the account is unavailable).

- **D-03:** `reconnecting` gains a `lastError: string` field alongside existing `attempt` and `nextRetryAt`. Required so an agent can distinguish "retrying for 3 seconds" from "retrying for 4 hours after ECONNRESET". Field is populated in Phase 12; surfaced in `list_accounts` in Phase 13.

### Error taxonomy (`src/connections/error-classifier.ts`)

- **D-04:** `classifyConnectionError(err: unknown): "transient" | "fatal"` is a **pure function** in a new module. No state, no class. First-built component of the phase (no upstream dependencies, easy to unit-test exhaustively).

- **D-05:** Fatal classifications:
  - `err instanceof AuthenticationFailure` (imapflow's exported class)
  - `err.tlsFailed === true` (imapflow's TLS-failure flag)
  - RFC 5530 server response codes (any of): `AUTHENTICATIONFAILED`, `LOGINDISABLED`, `PRIVACYREQUIRED`, `OVERQUOTA`, `UNAVAILABLE`, `EXPIRED`, `ALERT`, `CONTACTADMIN`
  - Rationale: all signal account-level conditions a user must fix. Retrying spams unresolvable conditions and risks server-side lockout.

- **D-06:** Transient classifications:
  - Network-layer error codes: `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `ECONNREFUSED`, `ENETUNREACH`, `EConnectionClosed`, `NoConnection`
  - TLS handshake transients (handshake timeout, mid-handshake `ECONNRESET`) — anything NOT flagged `tlsFailed: true`
  - Socket close events not accompanied by a fatal error
  - **Unknown / unrecognized errors default to transient** (per CONN-01, and per architecture anti-pattern #2 — unknowns must not silently kill accounts).

- **D-07:** TLS rule is strict: trust imapflow's own `tlsFailed` flag, period. Don't parse error messages or Node TLS error codes. If imapflow marks it as a TLS failure, it's fatal; otherwise treat it like any other transient network glitch.

### Reconnect loop

- **D-08:** **Unbounded retry** for transient errors. Delete the `BACKOFF_MAX_ATTEMPTS` cap entirely. The loop runs `while (true)` until either (a) connect succeeds → `connected`, (b) classifier returns `fatal` → `suspended`, or (c) `isShuttingDown` / abort signal.

- **D-09:** Backoff parameters (follow research defaults):
  - `BACKOFF_INITIAL_MS = 1_000` (unchanged)
  - `BACKOFF_MULTIPLIER = 2` (unchanged)
  - `BACKOFF_CAP_MS = 120_000` (raised from 60_000 — IMAP outages can run minutes-to-hours)
  - **Full jitter**: `delay = floor(Math.random() * capped)` — prevents synchronized retry storms across accounts (AWS exponential-backoff-with-jitter pattern)

- **D-10:** Race-safety: replace the existing `status.kind === "reconnecting"` guard with a synchronously-written boolean `reconnectInFlight`. Set true before `runReconnectLoop()` is invoked, clear in `.finally()`. Eliminates the double-reconnect race when `error` and `close` fire in the same microtask batch (CONN-05).

- **D-11:** Listener cleanup: call `currentClient.removeAllListeners()` on the old `ImapFlow` instance before constructing a new one in the reconnect loop. Prevents EventEmitter listener leak and `MaxListenersExceededWarning` across many reconnect cycles (CONN-06).

- **D-12:** Outer `try/catch` in `runReconnectLoop()` so an unexpected throw inside the loop body (e.g., a logger crash, classifier exception) doesn't kill the whole reconnect machinery silently. Add `process.on('unhandledRejection', …)` in `src/index.ts` — handler logs the rejection at `error` level and continues (does not exit the process). Goal: surface bugs in logs without taking the MCP server down.

### TCP keepalive & socket timeout

- **D-13:** In `buildClient()`, add to `ImapFlow` constructor:
  - `socketOptions: { keepAlive: true, keepAliveInitialDelay: 60_000 }`
  - `socketTimeout: 90_000` (reduced from 300_000)
  - Combined effect: dead/half-open sockets surface within ~2 minutes of laptop wake / Wi-Fi switch instead of potentially never. This is the root-cause fix for the original PROJECT.md bug (CONN-04).

### Logging cadence

- **D-14:** Throttled per-attempt logging during reconnect loop:
  - **Always log:**
    - First failure (attempt 1) at `warn` with full error message
    - Any attempt where `error.message` differs from the previously-logged error (resets the throttle, logs at `warn`)
    - Successful reconnect at `info`
    - Transition to `suspended` at `error` with reason
  - **Throttled:** attempts at indices `1, 2, 3, 5, 10, 20, 40, 80, 160, 320, …` (powers-of-two doubling after the first 3) log at `warn`. Other attempts log at `debug` only.
  - Rationale: a multi-hour outage on a 3-account server would emit thousands of identical lines under the current "log every attempt" pattern. Throttle keeps narrative without flooding stderr.

### Poller skip behavior

- **D-15:** Per CONN-07, `Poller` must skip accounts where `connection.getStatus().kind !== "connected"`. Implementation: in `pollAccount()` (or whichever method calls `manager.getClient()`), short-circuit before any IMAP call if status is `connecting`, `reconnecting`, or `suspended`. Emit one `debug`-level skip log per skipped account per poll cycle — not `warn` (skips are expected during outages and would flood logs alongside the reconnect throttle).

### Out of scope for Phase 12 (defer to Phase 13)

- `last_connected_at` / `last_error_at` exposure in `list_accounts` — Phase 13 (HEALTH-02)
- Per-account `lastPollTimes` map — Phase 13 (CACHE-01)
- 30-day cache eviction — Phase 13 (CACHE-03)
- `get_new_mail` cold-cache vs disconnected error distinction — Phase 13

(Phase 12 may add internal `connectedAt: Date | null` and `lastError: string | null` fields on `AccountConnection` purely so Phase 13 has something to expose — but no tool API surface changes ship in Phase 12.)

### Folded Todos

None. The one matched todo (`prevent-flag-tools-from-modifying-reserved-imap-keywords.md`) is about RFC 3501 system flags in `flag_message`/`unflag_message` — unrelated to connection resilience. See Deferred.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap

- `.planning/REQUIREMENTS.md` §"Connection Resilience" — CONN-01 through CONN-07 (the contract for this phase)
- `.planning/ROADMAP.md` §"Phase 12" — Success Criteria 1–5 (what must be TRUE on exit)
- `.planning/STATE.md` §"Decisions (v0.3)" — note: the "5 named states" decision is **overridden by D-01**

### Research (HIGH confidence, 2026-06-08)

- `.planning/research/SUMMARY.md` — executive summary; Phase 12 section is canonical for scope/avoids
- `.planning/research/STACK.md` §"imapflow Current State", §"Retry/Backoff", §"Network Connectivity Change Detection" — error classification source, AuthenticationFailure semantics, why no extra retry library, why no network-detection library
- `.planning/research/ARCHITECTURE.md` §"Connection State Machine", §"Component Boundaries", §"Integration Points: File-Level Changes" — concrete file-level plan and integration shape
- `.planning/research/PITFALLS.md` Pitfalls 1–4 (TCP half-open, double-reconnect race, retry storm, auth-failure infinite retry) — directly address Phase 12 scope

### imapflow protocol references

- `https://imapflow.com/docs/api/imapflow-client/` — event list, `socketOptions`, `connectionTimeout`, `socketTimeout` semantics
- `https://github.com/postalsys/imapflow/issues/27` — confirms TCP half-open hang ("commands do never return or throw")
- `https://github.com/postalsys/imapflow/issues/15` — confirms new ImapFlow instance required per reconnect
- `https://www.rfc-editor.org/rfc/rfc5530.html` — IMAP server response codes (D-05 fatal list)

### Existing code (must read before modifying)

- `src/connections/account-connection.ts` — current 4-state machine, bounded `runReconnectLoop`, `BACKOFF_MAX_ATTEMPTS=10`, no jitter, `socketTimeout: 300_000`, no listener cleanup, no error classification
- `src/connections/connection-manager.ts` — `getClient()` / `getStatus()` consumers of the union; will need `failed` case removed from their switches
- `src/polling/poller.ts` — needs CONN-07 skip behavior added (D-15)
- `src/index.ts` — needs `process.on('unhandledRejection', …)` handler added (D-12)

### Tech debt explicitly NOT in this phase

- `read_message[s]` `from`-field formatting (DEBT-01) — not touched here

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable assets

- **`AccountConnectionStatus` discriminated union** — already in place; just shrinks from 4 → 4 variants (drop `failed`, add `suspended`). TypeScript exhaustiveness will catch every consumer that needs updating.
- **`runReconnectLoop()` skeleton** — already abort-aware, already calls `buildClient()` fresh per attempt (which imapflow requires per issue #15). The work is surgical edits inside this loop, not replacing it.
- **`AbortController` + `sleep(ms, signal)`** — already wired for `gracefulClose()`. Reused as-is for unbounded loop interruption.
- **Vitest fake-timer-compatible `sleep`** — `globalThis.setTimeout` (not `node:timers/promises`) — keep this pattern; backoff tests will rely on `vi.advanceTimersByTimeAsync`.

### Established patterns

- **Stderr-only logging via `src/logger.ts`** — protects MCP JSON-RPC on stdout. D-14 throttling adds new helper logic but uses the same logger.
- **Per-account isolation** — `ConnectionManager` holds `Map<accountId, AccountConnection>`; each connection owns its own retry loop, abort controller, and (now) `reconnectInFlight` flag. Multi-account failures stay isolated.
- **Structured error return from `getClient()`** — pattern is `ImapFlow | { error: string }`. New `suspended` and `reconnecting` variants slot in without changing the call shape consumers use.

### Integration points

- `src/connections/error-classifier.ts` (NEW) — has no upstream deps; build and test first.
- `AccountConnection` — modified for state union, reconnect loop, listener cleanup, keepalive, throttled logging. All changes inside one file.
- `ConnectionManager` — minor: `switch` exhaustiveness updates only (no `failed` case; new `suspended` case).
- `Poller` — adds status guard before IMAP calls (D-15). One method, ~5 lines.
- `src/index.ts` — adds `process.on('unhandledRejection', …)` handler. One block at startup.

### Constraints worth knowing

- imapflow clients are **not reusable after `close`** — `client.connect()` on a closed instance throws `ERR_STREAM_WRITE_AFTER_END`. `buildClient()` must run inside the retry loop, which it already does.
- imapflow event order is `error` then `close` (synchronous). The `reconnectInFlight` flag must be set synchronously to win this race.
- Node.js `Math.random()` is fine for jitter — no cryptographic randomness needed.
- Test simulation of TCP half-open is **not possible in Vitest**. Document manual repro (laptop sleep / `iptables -j DROP`) as part of Phase 12 acceptance.

</code_context>

<specifics>
## Specific Ideas

- Thunderbird's TCP keepalive tuning (Bug 1535969 — `keepAliveInitialDelay` ~100s, probe every 5s × 4) is the reference point for "dead connections surface within ~120s." D-13's 60s initial delay + 90s socketTimeout lands in the same order of magnitude.
- AWS "Exponential Backoff And Jitter" article is the source for D-09's full-jitter formula (`Math.floor(Math.random() * capped)`).
- The error log message on transition to `suspended` should be self-explanatory ("Authentication failed — fix credentials" or "TLS certificate invalid — check cert chain") so an operator scanning stderr knows immediately what to do.

</specifics>

<deferred>
## Deferred Ideas

- **`failed` state with a real trigger** — explicit `stop()` API, classifier-loop safety net, or operator-controlled halt. Deferred until a v0.4+ phase has an organic need; re-add as part of that phase.
- **IDLE-based cache freshness** — requires dual `ImapFlow` per account; future milestone (CACHE-IDLE in REQUIREMENTS.md).
- **Cache persistence to disk** — defer to v0.4+ (CACHE-DISK).
- **`reconnect_account` MCP tool** — Phase 14 (this milestone).
- **Health fields on `list_accounts` / `get_new_mail`** — Phase 13 (this milestone). Phase 12 lays the groundwork (`connectedAt`, `lastError` fields exist internally) but doesn't surface them.

### Reviewed Todos (not folded)

- **`2026-03-19-prevent-flag-tools-from-modifying-reserved-imap-keywords.md`** — Adds validation in `flag_message` / `unflag_message` to reject RFC 3501 system flags (`\Seen`, `\Answered`, etc.). Out of Phase 12 scope (connection lifecycle, not tool input validation). Belongs in a future v0.3+ tools-hardening phase or as a standalone micro-fix.

</deferred>

---

*Phase: 12-connection-resilience-foundation*
*Context gathered: 2026-06-08*
