// Wave 0 scaffold — all tests are .todo stubs. Implement as src/polling/poller.ts is built.
import { describe, it } from "vitest";

describe("Poller — constructor", () => {
  it.todo("uses provided intervalSeconds for the polling timer delay");
  it.todo("defaults to 300 seconds when intervalSeconds is not provided");
});

describe("Poller — start / stop", () => {
  it.todo("calls pollAccount for each account returned by getAccountIds() on first tick");
  it.todo("schedules next poll with globalThis.setTimeout after poll() resolves");
  it.todo("does NOT schedule next tick after stop() is called");
});

describe("Poller — isCacheReady()", () => {
  it.todo("returns false before any poll has completed");
  it.todo("returns true after the first poll completes");
});

describe("Poller — cache population", () => {
  it.todo("merges new messages into the cache after each poll");
  it.todo("deduplicates messages by uid — no duplicate entries after repeated polls");
  it.todo("continues polling other accounts when one account poll throws");
});

describe("Poller — query()", () => {
  it.todo("throws or signals error when cache is not ready");
  it.todo("returns only messages with date > since timestamp");
  it.todo("returns messages from all accounts when account param is omitted");
  it.todo("returns messages from one account when account param is provided");
  it.todo("results are sorted newest-first by date");
});
