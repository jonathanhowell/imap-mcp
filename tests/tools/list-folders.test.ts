// Wave 0 scaffold — tests will go GREEN in plan 03-02 when handler is created.
// The import below fails until src/tools/list-folders.ts exists (intentional RED state).
import { describe, it } from "vitest";
// Handler not yet created — this import will fail (RED state)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { handleListFolders } from "../../src/tools/list-folders.js";

describe("list_folders", () => {
  it.todo("MAIL-01: returns flat array with all mailboxes");
  it.todo("MAIL-02: each folder entry includes total and unread counts");
  it.todo("returns special_use Inbox for \\\\Inbox specialUse flag");
  it.todo("returns special_use null for folders with no special-use flag");
  it.todo("returns error ToolResult when account is unavailable");
});
