import type { ImapFlow } from "imapflow";
import type { MessageHeader } from "../types.js";

export interface ListMessagesOptions {
  limit?: number;
  offset?: number;
  sort?: "newest" | "oldest";
  unreadOnly?: boolean;
}

/**
 * Fetches a paginated list of message headers from a given folder.
 *
 * - Acquires a read-only mailbox lock before any fetch operation.
 * - Searches all messages (or only unseen when unreadOnly=true).
 * - Handles imapflow's search() returning false by normalizing to [].
 * - Sorts descending (newest first) by default; ascending (oldest first) when sort='oldest'.
 * - Paginates via UID slicing: uids.slice(offset, offset + limit).
 * - Lock is ALWAYS released in a finally block.
 *
 * @param client  - Live ImapFlow client from ConnectionManager
 * @param folder  - Mailbox path (e.g. 'INBOX', 'Work/Projects')
 * @param opts    - Pagination and filter options
 */
export async function listMessages(
  client: ImapFlow,
  folder: string,
  opts: ListMessagesOptions = {}
): Promise<MessageHeader[]> {
  const { limit = 50, offset = 0, sort = "newest", unreadOnly = false } = opts;

  const lock = await client.getMailboxLock(folder, { readOnly: true });

  try {
    const searchCriteria = unreadOnly ? { seen: false } : { all: true };
    const allUids = (await client.search(searchCriteria, { uid: true })) || [];

    if (allUids.length === 0) {
      return [];
    }

    // Sort: newest = descending (highest UID first), oldest = ascending
    const sorted = sort === "oldest" ? allUids : [...allUids].sort((a, b) => b - a);

    const pageUids = sorted.slice(offset, offset + limit);

    if (pageUids.length === 0) {
      return [];
    }

    const messages = await client.fetchAll(
      pageUids,
      { uid: true, envelope: true, flags: true, internalDate: true },
      { uid: true }
    );

    return messages.map((msg) => ({
      uid: msg.uid,
      from: msg.envelope?.from?.[0]?.address ?? "",
      subject: msg.envelope?.subject ?? "",
      date:
        msg.internalDate instanceof Date
          ? msg.internalDate.toISOString()
          : String(msg.internalDate ?? ""),
      unread: !msg.flags?.has("\\Seen"),
    }));
  } finally {
    lock.release();
  }
}
