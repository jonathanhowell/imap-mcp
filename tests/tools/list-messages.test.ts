// Wave 0 scaffold — tests will go GREEN in plan 03-02 when handler is created.
// The import below fails until src/tools/list-messages.ts exists (intentional RED state).
import { describe, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { handleListMessages } from "../../src/tools/list-messages.js";

describe("list_messages", () => {
  it.todo("MAIL-03: accepts any folder path, not just INBOX");
  it.todo("LIST-01: respects limit parameter");
  it.todo("LIST-01: respects offset parameter");
  it.todo("LIST-02: returns only unread messages when filter applied");
  it.todo("LIST-03: sort=newest returns messages with newest date first");
  it.todo("LIST-03: sort=oldest returns messages with oldest date first");
  it.todo("LIST-04: response messages have no body fields");
  it.todo("returns error ToolResult when account is unavailable");
});
