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
