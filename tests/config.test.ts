import { describe, it, expect } from "vitest";
import { AppConfigSchema } from "../src/config/schema.js";

const validAccount = {
  name: "personal",
  host: "imap.example.com",
  port: 993,
  username: "user@example.com",
  password: "secret", // literal password for schema unit tests
  display_name: "Personal",
};

describe("multi-account config", () => {
  it("validates a config with two named accounts", () => {
    const result = AppConfigSchema.safeParse({
      accounts: [validAccount, { ...validAccount, name: "work", username: "work@example.com" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.accounts).toHaveLength(2);
      expect(result.data.accounts[0].name).toBe("personal");
      expect(result.data.accounts[1].name).toBe("work");
    }
  });
});

describe("single account config", () => {
  it("validates a config with one account", () => {
    const result = AppConfigSchema.safeParse({ accounts: [validAccount] });
    expect(result.success).toBe(true);
  });

  it("rejects a config with zero accounts", () => {
    const result = AppConfigSchema.safeParse({ accounts: [] });
    expect(result.success).toBe(false);
  });
});

describe("missing field errors", () => {
  it("rejects config missing host field", () => {
    const noHost = {
      name: validAccount.name,
      port: validAccount.port,
      username: validAccount.username,
      password: validAccount.password,
    };
    const result = AppConfigSchema.safeParse({ accounts: [noHost] });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((e) => e.path.join("."));
      expect(paths.some((p) => p.includes("host"))).toBe(true);
    }
  });

  it("rejects config missing name field", () => {
    const noName = {
      host: validAccount.host,
      port: validAccount.port,
      username: validAccount.username,
      password: validAccount.password,
    };
    const result = AppConfigSchema.safeParse({ accounts: [noName] });
    expect(result.success).toBe(false);
  });
});

describe("env var resolution", () => {
  it("resolves $ENV_VAR references to process.env values", () => {
    process.env["TEST_IMAP_PASS"] = "resolved-secret";
    const result = AppConfigSchema.safeParse({
      accounts: [{ ...validAccount, password: "$TEST_IMAP_PASS" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.accounts[0].password).toBe("resolved-secret");
    }
    delete process.env["TEST_IMAP_PASS"];
  });

  it("passes through literal passwords without $ prefix", () => {
    const result = AppConfigSchema.safeParse({
      accounts: [{ ...validAccount, password: "literal-password" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.accounts[0].password).toBe("literal-password");
    }
  });
});

describe("missing env var", () => {
  it("fails with clear error when referenced env var is not set", () => {
    delete process.env["MISSING_IMAP_VAR"];
    const result = AppConfigSchema.safeParse({
      accounts: [{ ...validAccount, password: "$MISSING_IMAP_VAR" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((e) => e.message).join(" ");
      expect(messages).toContain("MISSING_IMAP_VAR");
    }
  });
});

describe("port 993 enforced", () => {
  it("accepts port 993", () => {
    const result = AppConfigSchema.safeParse({ accounts: [validAccount] });
    expect(result.success).toBe(true);
  });

  it("port 143 rejected — plain-text IMAP not allowed", () => {
    const result = AppConfigSchema.safeParse({
      accounts: [{ ...validAccount, port: 143 }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((e) => e.message).join(" ");
      expect(messages).toContain("993");
    }
  });

  it("port 587 rejected — SMTP submission port not allowed", () => {
    const result = AppConfigSchema.safeParse({
      accounts: [{ ...validAccount, port: 587 }],
    });
    expect(result.success).toBe(false);
  });
});
