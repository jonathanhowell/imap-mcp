/**
 * A reference to a specific message in a specific account.
 * Always use this type — never pass bare UIDs.
 * account_id matches the `name` field in config.
 */
export interface MessageRef {
  account_id: string;
  uid: number;
}

/**
 * A reference to a named account.
 * account_id matches the `name` field in config.
 */
export interface AccountRef {
  account_id: string;
}

// --- Phase 3 response types ---

/**
 * A mailbox folder entry returned by list_folders.
 */
export interface FolderEntry {
  name: string;
  total: number;
  unread: number;
  special_use: "Inbox" | "Sent" | "Trash" | "Spam" | "Drafts" | null;
}

/**
 * A message header entry returned by list_messages (no body fields).
 */
export interface MessageHeader {
  uid: number;
  from: string;
  subject: string;
  date: string;
  unread: boolean;
  to: string[];
  cc: string[];
  keywords?: string[]; // Custom IMAP keywords set on the message
}

/**
 * A search result item — extends MessageHeader with folder context.
 */
export interface SearchResultItem extends MessageHeader {
  folder: string;
}

/**
 * Metadata about a single email attachment part.
 */
export interface AttachmentMeta {
  part_id: string;
  filename: string;
  size: number;
  mime_type: string;
}

/**
 * Full message body returned by read_message.
 */
export interface MessageBody {
  uid: number;
  from: string;
  subject: string;
  date: string;
  body: string;
  attachments: AttachmentMeta[];
  keywords: string[]; // Custom IMAP keywords set on the message (e.g. ClaudeProcessed)
}

/**
 * Downloaded attachment content returned by download_attachment.
 * content is base64-encoded binary data.
 */
export interface AttachmentDownload {
  filename: string;
  mime_type: string;
  size: number;
  content: string;
}

/**
 * Structured tool result matching the MCP SDK CallToolResult shape.
 * Used throughout Phase 2 and Phase 3 handlers.
 */
export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
}

// --- Phase 4 multi-account types ---

/**
 * A message header enriched with its source account.
 * Returned in multi-account list_messages results.
 */
export interface MultiAccountMessageHeader extends MessageHeader {
  account: string;
}

/**
 * A search result item enriched with its source account.
 * Returned in multi-account search_messages results.
 */
export interface MultiAccountSearchResultItem extends SearchResultItem {
  account: string;
}

/**
 * A folder entry enriched with its source account.
 * Returned in multi-account list_folders results.
 */
export interface MultiAccountFolderEntry extends FolderEntry {
  account: string;
}

/**
 * Wrapper returned by multi-account tool calls (when account param is omitted).
 * errors is omitted when empty — callers check `if (response.errors)`.
 */
export interface MultiAccountResult<T> {
  results: T[];
  errors?: Record<string, string>;
}

/**
 * Phase 13 (D-08 / D-09 / D-10): per-account cache freshness for get_new_mail.
 * `last_polled_at`: ISO 8601 string of the last successful poll for the account,
 *   or null when the account has never been polled.
 * `cache_age_seconds`: server-computed `Math.floor((Date.now() - lastPolledAt) / 1000)`,
 *   or null when last_polled_at is null. Avoids client/agent clock-skew.
 */
export interface AccountFreshness {
  last_polled_at: string | null;
  cache_age_seconds: number | null;
}

/**
 * Phase 13 (D-08): get_new_mail return shape. Extends MultiAccountResult with
 * a REQUIRED freshness map keyed by account_id. `freshness` is always present
 * (even when empty) so agents handle a single shape — never an absent key.
 */
export interface GetNewMailResult extends MultiAccountResult<MultiAccountMessageHeader> {
  freshness: Record<string, AccountFreshness>;
}
