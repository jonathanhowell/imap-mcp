import { Readable } from "stream";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ConnectionManager } from "../connections/index.js";
import { parseBodyStructure, extractBody } from "../services/body-service.js";
import type { BodyFormat } from "../services/body-service.js";
import type { MessageBody, ToolResult } from "../types.js";

export const READ_MESSAGES_TOOL: Tool = {
  name: "read_messages",
  description:
    "Fetch full email message bodies for multiple UIDs in a single call. All UIDs must be from the same folder (IMAP UIDs are folder-scoped). Returns one entry per UID — a MessageBody on success or { uid, error } on failure. Partial success is normal; the array always contains one entry per requested UID.",
  inputSchema: {
    type: "object",
    properties: {
      account: { type: "string", description: "Account name from config" },
      uids: {
        type: "array",
        items: { type: "number" },
        description: "List of IMAP UIDs to fetch (max 50, all from the same folder)",
      },
      folder: { type: "string", description: "Mailbox folder name (default: INBOX)" },
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
    required: ["account", "uids"],
  },
};

interface ReadMessagesArgs {
  account: string;
  uids: number[];
  folder?: string;
  format?: BodyFormat;
  max_chars?: number;
}

type BatchEntry = MessageBody | { uid: number; error: string };

export async function handleReadMessages(
  args: ReadMessagesArgs,
  manager: ConnectionManager
): Promise<ToolResult> {
  const { account, uids, folder = "INBOX", format = "clean", max_chars = 2000 } = args;

  // Guard: empty array — return immediately, no IMAP interaction needed
  if (uids.length === 0) {
    return { content: [{ type: "text", text: "[]" }], isError: false };
  }

  // Guard: hard cap — validate BEFORE getClient or getMailboxLock
  if (uids.length > 50) {
    return {
      content: [
        {
          type: "text",
          text: `Error: Too many UIDs: max 50 per call, got ${uids.length}`,
        },
      ],
      isError: true,
    };
  }

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
    // Phase 1: Batch metadata fetch — one IMAP round-trip for all UIDs
    // uids.join(",") produces "42,43,44" — valid IMAP UID set syntax
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fetchedMeta = new Map<number, any>();
    for await (const msg of client.fetch(
      uids.join(","),
      { uid: true, envelope: true, flags: true, bodyStructure: true },
      { uid: true }
    )) {
      if (msg.uid !== undefined) {
        fetchedMeta.set(msg.uid, msg);
      }
    }

    // Phase 2: Build response array in requested UID order
    const results: BatchEntry[] = [];
    for (const uid of uids) {
      const meta = fetchedMeta.get(uid);
      if (!meta) {
        results.push({ uid, error: `message with UID ${uid} not found` });
        continue;
      }

      const { textPartId, htmlPartId, attachments } = parseBodyStructure(
        meta.bodyStructure ?? { type: "text/plain" }
      );

      const partId = textPartId ?? htmlPartId;
      const isHtml = textPartId === null && htmlPartId !== null;
      let bodyText = "";

      if (partId !== null) {
        try {
          const { content } = await client.download(String(uid), partId, { uid: true });
          const chunks: Buffer[] = [];
          for await (const chunk of content as Readable) {
            chunks.push(chunk as Buffer);
          }
          bodyText = extractBody(
            Buffer.concat(chunks).toString("utf-8"),
            isHtml,
            format,
            max_chars
          );
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          results.push({ uid, error: `download failed: ${errMsg}` });
          continue;
        }
      }

      const envelope = meta.envelope ?? {};
      const from =
        Array.isArray(envelope.from) && envelope.from.length > 0
          ? (envelope.from[0].address ?? envelope.from[0].name ?? "")
          : "";
      const subject = envelope.subject ?? "";
      const date = envelope.date ? new Date(envelope.date).toISOString() : "";

      results.push({
        uid,
        from,
        subject,
        date,
        body: bodyText,
        attachments,
        keywords: [...(meta.flags ?? new Set<string>())].filter((f) => !f.startsWith("\\")),
      });
    }

    return {
      content: [{ type: "text", text: JSON.stringify(results) }],
      isError: false,
    };
  } finally {
    lock.release();
  }
}
