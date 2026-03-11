/**
 * Stderr-only logger.
 * NEVER use console.log — stdout is the MCP JSON-RPC channel.
 * All log output goes to stderr via process.stderr.write.
 */

type Level = "debug" | "info" | "warn" | "error";

function log(level: Level, msg: string): void {
  const tag = level.toUpperCase().padEnd(5);
  process.stderr.write(`[${tag}] ${msg}\n`);
}

export const logger = {
  debug: (msg: string): void => log("debug", msg),
  info: (msg: string): void => log("info", msg),
  warn: (msg: string): void => log("warn", msg),
  error: (msg: string): void => log("error", msg),
};
