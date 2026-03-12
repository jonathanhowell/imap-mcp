import type { ImapFlow } from "imapflow";
import type { FolderEntry } from "../types.js";

const SPECIAL_USE_MAP: Record<string, FolderEntry["special_use"]> = {
  "\\Inbox": "Inbox",
  "\\Sent": "Sent",
  "\\Trash": "Trash",
  "\\Junk": "Spam",
  "\\Drafts": "Drafts",
};

export async function listFolders(client: ImapFlow): Promise<FolderEntry[]> {
  const folders = await client.list({ statusQuery: { messages: true, unseen: true } });
  return folders.map((f) => ({
    name: f.path,
    total: f.status?.messages ?? 0,
    unread: f.status?.unseen ?? 0,
    special_use: f.specialUse ? (SPECIAL_USE_MAP[f.specialUse] ?? null) : null,
  }));
}
