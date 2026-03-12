// Wave 0 scaffold — tests will go GREEN in plan 03-03 when service is created.
// The import below fails until src/services/body-service.ts exists (intentional RED state).
import { describe, it } from "vitest";
// Service not yet created (RED state)
/* eslint-disable @typescript-eslint/no-unused-vars */
import { extractBody, parseBodyStructure } from "../../src/services/body-service.js";
/* eslint-enable @typescript-eslint/no-unused-vars */

describe("body-service", () => {
  it.todo("READ-03: getVisibleText strips quoted reply chains from clean format");
  it.todo("READ-03: HTML body converted to plain text");
  it.todo(
    "READ-04: parseBodyStructure extracts attachment entries with part_id, filename, size, mime_type"
  );
  it.todo("READ-04: parseBodyStructure handles single-part message (root node, no childNodes)");
  it.todo("READ-04: parseBodyStructure handles multipart/mixed with text and attachment");
  it.todo("non-attachment text/plain and text/html parts are not included in attachments array");
});
