import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from "vitest";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STUB_TOOLS, handleStubToolCall } from "../src/tools/stubs.js";
import { logger } from "../src/logger.js";

describe("stub tools", () => {
  it("registers at least two stub tools", () => {
    expect(STUB_TOOLS.length).toBeGreaterThanOrEqual(2);
  });

  it("each tool has name, description, and inputSchema", () => {
    for (const tool of STUB_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("handleStubToolCall returns not-implemented text", () => {
    const result = handleStubToolCall("list_folders");
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("list_folders");
    expect(result.isError).toBe(false);
  });
});

describe("config loading smoke test", () => {
  let tmpConfigPath: string;

  beforeAll(() => {
    // Write a temp config file with a literal password (smoke test only)
    tmpConfigPath = join(tmpdir(), "imap-mcp-test-config.yaml");
    writeFileSync(
      tmpConfigPath,
      `accounts:\n  - name: test\n    host: imap.example.com\n    port: 993\n    username: user@example.com\n    password: testpassword\n`
    );
    process.env["IMAP_MCP_CONFIG"] = tmpConfigPath;
  });

  afterAll(() => {
    delete process.env["IMAP_MCP_CONFIG"];
    try {
      unlinkSync(tmpConfigPath);
    } catch {
      /* ignore */
    }
  });

  it("loadConfig resolves without throwing given valid config file", async () => {
    const { loadConfig } = await import("../src/config/loader.js");
    // loadConfig calls process.exit on failure — a successful parse just resolves
    // We cannot easily test the exit path here without a subprocess; that is covered
    // by manual verification in VALIDATION.md
    const config = await loadConfig();
    expect(config.accounts).toHaveLength(1);
    expect(config.accounts[0].name).toBe("test");
  });
});

// ----------------------------------------------------------------------------
// Phase 12 Wave 0 — cross-cutting D-12 unhandledRejection handler scaffold.
// Red because src/process-handlers.ts (and installUnhandledRejectionHandler)
// does not exist yet. Plan 04 ships the handler; the test will then turn
// green automatically.
// ----------------------------------------------------------------------------

describe("unhandledRejection handler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Defensive: remove any handlers our test (or the SUT) registered so we
    // don't leak listeners across the suite.
    process.removeAllListeners("unhandledRejection");
  });

  it("unhandledRejection logs and continues", async () => {
    // The handler module is created by Plan 04 — until then this import fails
    // and the test stays red. That is the desired Wave 0 state.
    const handlerModule = await import(
      // @ts-expect-error — module created by Plan 12-04
      "../src/process-handlers.js"
    );
    const installUnhandledRejectionHandler = handlerModule.installUnhandledRejectionHandler as (
      log: typeof logger
    ) => void;

    expect(typeof installUnhandledRejectionHandler).toBe("function");

    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((_code?: number) => undefined) as never);

    installUnhandledRejectionHandler(logger);

    // Synthesize an unhandled rejection. Using process.emit directly is the
    // canonical way to drive the handler under test without producing a real
    // unhandled promise (which would otherwise crash the test runner).
    const rejected = Promise.reject(new Error("test rejection"));
    // Suppress the actual unhandled-rejection event from the synthetic promise.
    rejected.catch(() => undefined);
    process.emit("unhandledRejection", new Error("test rejection"), rejected);

    // Allow any microtask-scheduled logger work to flush.
    await Promise.resolve();

    // Handler must log at error level and reference the unhandledRejection
    // phrase so operators grepping stderr can find it (D-12).
    const matchedCalls = errorSpy.mock.calls.filter((args) =>
      String(args[0] ?? "")
        .toLowerCase()
        .includes("unhandledrejection")
    );
    expect(matchedCalls.length).toBeGreaterThanOrEqual(1);

    // The process MUST NOT exit on an unhandled rejection — surface bugs
    // without taking the MCP server down (D-12).
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
