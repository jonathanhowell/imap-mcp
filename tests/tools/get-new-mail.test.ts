// Wave 0 scaffold — all tests are .todo stubs. Implement as src/tools/get-new-mail.ts is built.
import { describe, it } from "vitest";

describe("handleGetNewMail — cold cache", () => {
  it.todo("returns isError: true with agent-actionable message when cache is not ready");
  it.todo('returned message contains "Retry in ~5 minutes" text');
});

describe("handleGetNewMail — since filtering", () => {
  it.todo("returns only messages with date > since param");
  it.todo("since is required — invalid or missing since produces appropriate error");
});

describe("handleGetNewMail — account scoping", () => {
  it.todo("without account param returns results from all accounts");
  it.todo("with account param returns results for that account only");
  it.todo("unknown account appears in errors field of the response");
});

describe("handleGetNewMail — response shape", () => {
  it.todo("results are sorted newest-first");
  it.todo("response matches MultiAccountResult<MultiAccountMessageHeader> shape");
  it.todo("errors field is omitted when no account errors occurred");
});
