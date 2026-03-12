// Wave 0 scaffold — tests will go GREEN in plan 03-04 when handler is created.
// The import below fails until src/tools/search-messages.ts exists (intentional RED state).
import { describe, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { handleSearchMessages } from "../../src/tools/search-messages.js";

describe("search_messages", () => {
  it.todo("SRCH-01: from param is passed to IMAP search");
  it.todo("SRCH-02: subject param is passed to IMAP search");
  it.todo("SRCH-03: since param is converted to Date object in search criteria");
  it.todo("SRCH-03: before param is converted to Date object in search criteria");
  it.todo("SRCH-04: unread=true maps to seen: false in search criteria");
  it.todo("SRCH-04: unread=false maps to seen: true in search criteria");
  it.todo("defaults folder to INBOX when folder param omitted");
  it.todo("caps results at max_results (default 50)");
  it.todo("each result includes folder field");
  it.todo("returns error ToolResult when account unavailable");
});
