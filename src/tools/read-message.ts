import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ConnectionManager } from "../connections/index.js";
import { parseBodyStructure, extractBody } from "../services/body-service.js";
import type { BodyFormat } from "../services/body-service.js";
import type { MessageBody, ToolResult } from "../types.js";

export const READ_MESSAGE_TOOL: Tool = {
  name: "read_message",
  description: "Fetch a full email message by account name and UID, with configurable body format",
  inputSchema: {
    type: "object",
    properties: {
      account: {
        type: "string",
        description: "Account name from config",
      },
      uid: {
        type: "number",
        description: "The IMAP UID of the message",
      },
      folder: {
        type: "string",
        description: "Mailbox folder name (default: INBOX)",
      },
      format: {
        type: "string",
        enum: ["full", "clean", "truncated"],
        description:
          "Body format: full (raw text), clean (reply-chain stripped), truncated (max_chars chars)",
      },
      max_chars: {
        type: "number",
        description: "Maximum body characters for truncated format (default: 2000)",
      },
    },
    required: ["account", "uid"],
  },
};

interface ReadMessageArgs {
  account: string;
  uid: number;
  folder?: string;
  format?: BodyFormat;
  max_chars?: number;
}

export async function handleReadMessage(
  args: ReadMessageArgs,
  manager: ConnectionManager
): Promise<ToolResult> {
  const { account, uid, folder = "INBOX", format = "clean", max_chars = 2000 } = args;

  const clientOrError = manager.getClient(account);
  if ("error" in clientOrError) {
    return {
      content: [{ type: "text", text: `Error: ${clientOrError.error}` }],
      isError: true,
    };
  }
  const client = clientOrError;

  const lock = await client.getMailboxLock(folder, { readOnly: true });
  try {
    // First fetch: get envelope, flags, and body structure
    const meta = await client.fetchOne(
      String(uid),
      { uid: true, envelope: true, flags: true, bodyStructure: true },
      { uid: true }
    );

    if (!meta) {
      return {
        content: [{ type: "text", text: `Error: message with UID ${uid} not found` }],
        isError: true,
      };
    }

    const { textPartId, htmlPartId, attachments } = parseBodyStructure(
      meta.bodyStructure ?? { type: "text", subtype: "plain" }
    );

    // Determine which parts to fetch
    const partsToFetch: string[] = [];
    if (textPartId !== null) partsToFetch.push(textPartId);
    if (htmlPartId !== null && textPartId === null) partsToFetch.push(htmlPartId);

    let bodyText = "";
    if (partsToFetch.length > 0) {
      // Second fetch: get body parts
      const bodyMsg = await client.fetchOne(
        String(uid),
        { bodyParts: partsToFetch },
        { uid: true }
      );

      if (bodyMsg && bodyMsg.bodyParts) {
        bodyText = extractBody(
          bodyMsg.bodyParts as Map<string, Buffer>,
          textPartId,
          htmlPartId,
          format,
          max_chars
        );
      }
    }

    const envelope = meta.envelope ?? {};
    const from =
      Array.isArray(envelope.from) && envelope.from.length > 0
        ? (envelope.from[0].address ?? envelope.from[0].name ?? "")
        : "";
    const subject = envelope.subject ?? "";
    const date = envelope.date ? new Date(envelope.date).toISOString() : "";

    const result: MessageBody = {
      uid,
      from,
      subject,
      date,
      body: bodyText,
      attachments,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      isError: false,
    };
  } finally {
    lock.release();
  }
}
