// Wave 0 scaffold — tests will go GREEN in plan 03-03 when handler is created.
// The import below fails until src/tools/download-attachment.ts exists (intentional RED state).
import { describe, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { handleDownloadAttachment } from "../../src/tools/download-attachment.js";

describe("download_attachment", () => {
  it.todo("READ-05: returns base64-encoded content string");
  it.todo("returns filename and mime_type from attachment metadata");
  it.todo("returns error ToolResult when account unavailable");
  it.todo("returns error ToolResult when part_id not found");
});
