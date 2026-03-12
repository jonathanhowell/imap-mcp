import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config/loader.js";
import { STUB_TOOLS, handleStubToolCall } from "./tools/stubs.js";
import { ConnectionManager } from "./connections/index.js";

async function main(): Promise<void> {
  // loadConfig() exits process with code 1 on any config error.
  // It never throws — no try/catch needed here.
  const config = await loadConfig();

  const manager = new ConnectionManager(config);
  await manager.connectAll();

  const shutdown = (): void => {
    void manager.closeAll().then(() => {
      process.exit(0);
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  const server = new Server(
    { name: "imap-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: STUB_TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    return handleStubToolCall(toolName, manager);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Successful startup is intentionally silent.
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Fatal: ${msg}\n`);
  process.exit(1);
});
