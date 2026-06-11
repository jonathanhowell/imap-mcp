/**
 * Process-level safety handlers for the long-running MCP server.
 *
 * Phase 12, Plan 04 / D-12. Lives in its own module (NOT src/index.ts) so
 * the handler can be unit-tested in isolation without dragging the `main()`
 * startup side effects into the test runner. STATE.md "Decisions (v0.3)"
 * pins the unhandledRejection handler home to this file — Plan 12-01
 * sealed the import path in `tests/startup.test.ts` (`from "../src/process-handlers.js"`).
 *
 * The handler logs at `error` and does NOT call `process.exit` — a single
 * misbehaving reconnect-loop bug must not bring down the MCP server.
 * Operators grep stderr for the `unhandledRejection` string when investigating.
 */
import { logger } from "./logger.js";

type Logger = typeof logger;

/**
 * Registers a `process.on("unhandledRejection", ...)` handler that logs the
 * rejection reason (and stack if available) at `error` level and continues.
 *
 * D-12: the handler is the last line of defense against a logger / classifier /
 * reconnect-loop bug crashing the MCP server. It does NOT call `process.exit` —
 * surfaces the bug in logs without taking the server down.
 *
 * Accepts the logger as an argument (rather than closing over the module-scope
 * import) so the test in `tests/startup.test.ts` can pass a spy and verify the
 * call shape. Default-binds to the module-scope `logger` when called from
 * `main()` at startup.
 */
export function installUnhandledRejectionHandler(log: Logger = logger): void {
  process.on("unhandledRejection", (reason: unknown) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error && reason.stack ? `\n${reason.stack}` : "";
    log.error(`unhandledRejection: ${msg}${stack}`);
    // D-12: intentionally do NOT call process.exit().
  });
}
