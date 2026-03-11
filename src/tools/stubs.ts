import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const STUB_TOOLS: Tool[] = [
  {
    name: "list_accounts",
    description: "List all configured IMAP accounts",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_folders",
    description: "List all folders/mailboxes in a named account",
    inputSchema: {
      type: "object",
      properties: {
        account: { type: "string", description: "Account name from config" },
      },
      required: ["account"],
    },
  },
  {
    name: "list_messages",
    description: "List messages in a folder with pagination",
    inputSchema: {
      type: "object",
      properties: {
        account: { type: "string" },
        folder: { type: "string" },
        limit: { type: "number" },
        offset: { type: "number" },
      },
      required: ["account", "folder"],
    },
  },
  {
    name: "read_message",
    description: "Fetch a full email by account name and UID",
    inputSchema: {
      type: "object",
      properties: {
        account: { type: "string" },
        uid: { type: "number" },
      },
      required: ["account", "uid"],
    },
  },
  {
    name: "search_messages",
    description: "Search messages by sender, subject, date range, or read status",
    inputSchema: {
      type: "object",
      properties: {
        account: { type: "string" },
        from: { type: "string" },
        subject: { type: "string" },
        since: { type: "string", description: "ISO 8601 date" },
        before: { type: "string", description: "ISO 8601 date" },
        unread: { type: "boolean" },
      },
      required: ["account"],
    },
  },
];

export function handleStubToolCall(toolName: string): {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
} {
  return {
    content: [
      {
        type: "text",
        text: `Tool '${toolName}' is not yet implemented (Phase 3+).`,
      },
    ],
    isError: false,
  };
}
