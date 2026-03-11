import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { AppConfigSchema } from "./schema.js";
import type { AppConfig } from "./types.js";

function formatZodPath(path: PropertyKey[]): string {
  return path
    .map((seg, i) =>
      typeof seg === "number" ? `[${seg}]` : i === 0 ? String(seg) : `.${String(seg)}`
    )
    .join("");
}

export async function loadConfig(): Promise<AppConfig> {
  const configPath =
    process.env["IMAP_MCP_CONFIG"] ?? join(homedir(), ".config", "imap-mcp", "config.yaml");

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch {
    process.stderr.write(
      `Error: config file not found at ${configPath}\n` +
        `Hint: create the file or set IMAP_MCP_CONFIG to override the default location.\n`
    );
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: config file is not valid YAML: ${msg}\n`);
    process.exit(1);
  }

  const result = AppConfigSchema.safeParse(parsed);

  if (!result.success) {
    const messages = result.error.issues
      .map((e) => `  ${formatZodPath(e.path)}: ${e.message}`)
      .join("\n");
    process.stderr.write(`Config validation failed:\n${messages}\n`);
    process.exit(1);
  }

  return result.data;
}
