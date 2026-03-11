import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config/loader.js";
import { STUB_TOOLS, handleStubToolCall } from "./tools/stubs.js";

async function main(): Promise<void> {
  // loadConfig() exits process with code 1 on any config error.
  // It never throws — no try/catch needed here.
  const config = await loadConfig();

  const server = new Server(
    { name: "imap-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: STUB_TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    return handleStubToolCall(toolName);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Successful startup is intentionally silent.
  // config is validated — Phase 2 will use it to open connections.
  void config;
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Fatal: ${msg}\n`);
  process.exit(1);
});
