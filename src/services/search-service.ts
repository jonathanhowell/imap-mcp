import type { ImapFlow } from "imapflow";
import type { SearchResultItem } from "../types.js";

export interface SearchParams {
  from?: string;
  subject?: string;
  since?: string;
  before?: string;
  unread?: boolean;
  body?: string;
  folder?: string;
  maxResults?: number;
}

/**
 * Searches messages in the specified folder using IMAP SEARCH criteria.
 *
 * When folder is "all", every mailbox in the account is searched sequentially.
 * WARNING: folder="all" may be slow on large mailboxes — it iterates every folder
 * and issues an IMAP SEARCH command in each one.
 *
 * @param client  Live ImapFlow client
 * @param params  Search parameters; folder defaults to "INBOX", maxResults defaults to 50
 */
export async function searchMessages(
  client: ImapFlow,
  params: SearchParams
): Promise<SearchResultItem[]> {
  const { from, subject, since, before, unread, body, folder = "INBOX", maxResults = 50 } = params;

  // Build IMAP SearchObject — only include fields that are defined
  const criteria: Record<string, unknown> = {};
  if (from !== undefined) criteria.from = from;
  if (subject !== undefined) criteria.subject = subject;
  if (since !== undefined) criteria.since = new Date(since);
  if (before !== undefined) criteria.before = new Date(before);
  if (unread === true) criteria.seen = false;
  else if (unread === false) criteria.seen = true;
  // unread=undefined → seen not included
  if (body !== undefined) criteria.body = body;

  if (folder !== "all") {
    return await searchFolder(client, folder, criteria, maxResults);
  }

  // Multi-folder mode: iterate all folders sequentially
  const folderList = await client.list();
  const results: SearchResultItem[] = [];

  for (const folderEntry of folderList) {
    if (results.length >= maxResults) break;
    const remaining = maxResults - results.length;
    try {
      const folderResults = await searchFolder(client, folderEntry.path, criteria, remaining);
      results.push(...folderResults);
    } catch {
      // Skip folders that cannot be searched (e.g. \Noselect folders)
    }
  }

  return results;
}

function formatAddress(entry: { name?: string; address?: string }): string {
  if (entry.name && entry.address) return `${entry.name} <${entry.address}>`;
  return entry.address ?? "";
}

async function searchFolder(
  client: ImapFlow,
  folder: string,
  criteria: Record<string, unknown>,
  maxResults: number
): Promise<SearchResultItem[]> {
  const lock = await client.getMailboxLock(folder, { readOnly: true });
  try {
    const uids = (await client.search(criteria, { uid: true })) || [];
    const pageUids = uids.slice(0, maxResults);
    if (pageUids.length === 0) return [];
    const messages = await client.fetchAll(
      pageUids,
      { uid: true, envelope: true, flags: true, internalDate: true },
      { uid: true }
    );
    return messages.map((msg) => ({
      uid: msg.uid,
      from: formatAddress(msg.envelope?.from?.[0] ?? {}),
      subject: msg.envelope?.subject ?? "",
      date:
        msg.internalDate instanceof Date
          ? msg.internalDate.toISOString()
          : String(msg.internalDate ?? ""),
      unread: !msg.flags?.has("\\Seen"),
      folder,
      to: (msg.envelope?.to ?? [])
        .filter((e): e is { name?: string; address: string } => e.address !== undefined)
        .map(formatAddress),
      cc: (msg.envelope?.cc ?? [])
        .filter((e): e is { name?: string; address: string } => e.address !== undefined)
        .map(formatAddress),
    }));
  } finally {
    lock.release();
  }
}
