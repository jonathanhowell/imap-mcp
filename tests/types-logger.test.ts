import { describe, it, expect } from "vitest";
import type { MessageRef, AccountRef } from "../src/types.js";
import { logger } from "../src/logger.js";

describe("MessageRef type", () => {
  it("has account_id and uid fields", () => {
    const ref: MessageRef = { account_id: "personal", uid: 42 };
    expect(ref.account_id).toBe("personal");
    expect(ref.uid).toBe(42);
  });

  it("uid is a number", () => {
    const ref: MessageRef = { account_id: "work", uid: 100 };
    expect(typeof ref.uid).toBe("number");
  });
});

describe("AccountRef type", () => {
  it("has account_id field", () => {
    const ref: AccountRef = { account_id: "personal" };
    expect(ref.account_id).toBe("personal");
  });
});

describe("logger", () => {
  it("has debug, info, warn, error methods", () => {
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("logger.info writes to stderr not stdout", () => {
    // Capture stderr
    const written: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: unknown): boolean => {
      written.push(String(chunk));
      return true;
    };

    logger.info("test message");

    process.stderr.write = originalWrite;

    expect(written.some((s) => s.includes("test message"))).toBe(true);
  });

  it("logger output format is [LEVEL] message", () => {
    const written: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: unknown): boolean => {
      written.push(String(chunk));
      return true;
    };

    logger.warn("something happened");

    process.stderr.write = originalWrite;

    expect(written.some((s) => s.includes("[WARN") && s.includes("something happened"))).toBe(true);
  });
});
