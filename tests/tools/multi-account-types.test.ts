import { describe, it, expect } from "vitest";
import type {
  MultiAccountMessageHeader,
  MultiAccountSearchResultItem,
  MultiAccountFolderEntry,
  MultiAccountResult,
} from "../../src/types.js";

describe("MultiAccountMessageHeader", () => {
  it("extends MessageHeader with account field", () => {
    const header: MultiAccountMessageHeader = {
      uid: 42,
      from: "alice@example.com",
      subject: "Hello",
      date: "2024-01-01T00:00:00.000Z",
      unread: true,
      to: [],
      cc: [],
      account: "personal",
    };
    expect(header.account).toBe("personal");
    expect(header.uid).toBe(42);
    expect(header.unread).toBe(true);
  });
});

describe("MultiAccountSearchResultItem", () => {
  it("extends SearchResultItem with account field", () => {
    const item: MultiAccountSearchResultItem = {
      uid: 10,
      from: "bob@example.com",
      subject: "Test",
      date: "2024-06-01T00:00:00.000Z",
      unread: false,
      to: [],
      cc: [],
      folder: "INBOX",
      account: "work",
    };
    expect(item.account).toBe("work");
    expect(item.folder).toBe("INBOX");
  });
});

describe("MultiAccountFolderEntry", () => {
  it("extends FolderEntry with account field", () => {
    const entry: MultiAccountFolderEntry = {
      name: "INBOX",
      total: 100,
      unread: 5,
      special_use: "Inbox",
      account: "personal",
    };
    expect(entry.account).toBe("personal");
    expect(entry.special_use).toBe("Inbox");
  });
});

describe("MultiAccountResult", () => {
  it("has results array and optional errors record", () => {
    const success: MultiAccountResult<MultiAccountMessageHeader> = {
      results: [
        {
          uid: 1,
          from: "a@example.com",
          subject: "Hi",
          date: "2024-01-01T00:00:00.000Z",
          unread: false,
          to: [],
          cc: [],
          account: "personal",
        },
      ],
    };
    expect(success.results).toHaveLength(1);
    expect(success.errors).toBeUndefined();

    const partial: MultiAccountResult<MultiAccountMessageHeader> = {
      results: [],
      errors: { work: "connection refused" },
    };
    expect(partial.results).toHaveLength(0);
    expect(partial.errors?.work).toBe("connection refused");
  });
});
