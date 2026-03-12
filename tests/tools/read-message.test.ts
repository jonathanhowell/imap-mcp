// Wave 0 scaffold — tests will go GREEN in plan 03-03 when handler is created.
// The import below fails until src/tools/read-message.ts exists (intentional RED state).
import { describe, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { handleReadMessage } from "../../src/tools/read-message.js";

describe("read_message", () => {
  it.todo("READ-01: format=full returns plain text body");
  it.todo("READ-01: format=full falls back to HTML-stripped body when no text/plain part");
  it.todo("READ-02: format=truncated returns at most max_chars characters");
  it.todo("READ-02: format=truncated defaults to 2000 chars when max_chars omitted");
  it.todo("default format is clean when format parameter omitted");
  it.todo("response always includes attachments array");
  it.todo("returns error ToolResult when message not found");
  it.todo("returns error ToolResult when account unavailable");
});
