import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STUB_TOOLS, handleStubToolCall } from "../src/tools/stubs.js";

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
