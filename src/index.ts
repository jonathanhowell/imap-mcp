import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config/loader.js";
import { ConnectionManager } from "./connections/index.js";
import { LIST_ACCOUNTS_TOOL, handleListAccounts } from "./tools/list-accounts.js";
import { LIST_FOLDERS_TOOL, handleListFolders } from "./tools/list-folders.js";
import { LIST_MESSAGES_TOOL, handleListMessages } from "./tools/list-messages.js";
import { READ_MESSAGE_TOOL, handleReadMessage } from "./tools/read-message.js";
import { SEARCH_MESSAGES_TOOL, handleSearchMessages } from "./tools/search-messages.js";
import { DOWNLOAD_ATTACHMENT_TOOL, handleDownloadAttachment } from "./tools/download-attachment.js";
import { Poller } from "./polling/poller.js";
import { GET_NEW_MAIL_TOOL, handleGetNewMail } from "./tools/get-new-mail.js";

const TOOLS = [
  LIST_ACCOUNTS_TOOL,
  LIST_FOLDERS_TOOL,
  LIST_MESSAGES_TOOL,
  READ_MESSAGE_TOOL,
  SEARCH_MESSAGES_TOOL,
  DOWNLOAD_ATTACHMENT_TOOL,
  GET_NEW_MAIL_TOOL,
];

async function main(): Promise<void> {
  // loadConfig() exits process with code 1 on any config error.
  // It never throws — no try/catch needed here.
  const config = await loadConfig();

  const manager = new ConnectionManager(config);
  await manager.connectAll();

  const poller = new Poller(manager, config.polling?.interval_seconds ?? 300);
  poller.start(); // first poll fires immediately; subsequent polls on interval

  const shutdown = (): void => {
    poller.stop(); // must stop BEFORE closeAll — prevents setTimeout re-entry during shutdown
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

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const params = (args ?? {}) as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type AnyToolResult = any;
    switch (name) {
      case "list_accounts":
        return handleListAccounts(manager) as AnyToolResult;
      case "list_folders":
        // account is intentionally not defaulted — absence signals multi-account mode
        return handleListFolders(
          params as unknown as { account: string },
          manager
        ) as AnyToolResult;
      case "list_messages":
        // account is intentionally not defaulted — absence signals multi-account mode
        return handleListMessages(
          params as unknown as Parameters<typeof handleListMessages>[0],
          manager
        ) as AnyToolResult;
      case "read_message":
        return handleReadMessage(
          params as unknown as Parameters<typeof handleReadMessage>[0],
          manager
        ) as AnyToolResult;
      case "search_messages":
        // account is intentionally not defaulted — absence signals multi-account mode
        return handleSearchMessages(
          params as unknown as Parameters<typeof handleSearchMessages>[0],
          manager
        ) as AnyToolResult;
      case "download_attachment":
        return handleDownloadAttachment(
          params as unknown as Parameters<typeof handleDownloadAttachment>[0],
          manager
        ) as AnyToolResult;
      case "get_new_mail":
        return handleGetNewMail(
          params as unknown as Parameters<typeof handleGetNewMail>[0],
          poller
        ) as AnyToolResult;
      default:
        return {
          isError: true,
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
        } as AnyToolResult;
    }
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
