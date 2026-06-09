import { describe, it, expect } from "vitest";
import { classifyConnectionError, humanReason } from "../../src/connections/error-classifier.js";
import { AuthenticationFailure } from "imapflow";

// Phase 12 Wave 0 scaffolds for CONN-01.
// These tests are intentionally red — `src/connections/error-classifier.ts` does not yet
// exist. Plan 02 creates the module and drives every assertion below green.

describe("classifyConnectionError", () => {
  describe("classifies fatal sources: AuthenticationFailure instance", () => {
    it("returns 'fatal' for an AuthenticationFailure instance", () => {
      // imapflow 1.2.13 declares AuthenticationFailure in its .d.ts but does NOT
      // export it from JS — Plan 04 will bump to ^1.3.7 which fixes the runtime
      // export. Until then we construct a stand-in via Object.setPrototypeOf or
      // — when even that fails — fall back to the marker property the classifier
      // also checks (`authenticationFailed: true`).
      let err: unknown;
      if (typeof AuthenticationFailure === "function") {
        try {
          err = new AuthenticationFailure("auth failed");
        } catch {
          const base = new Error("auth failed");
          if (AuthenticationFailure.prototype) {
            Object.setPrototypeOf(base, AuthenticationFailure.prototype);
          }
          err = base;
        }
      } else {
        // Wave 0 / pre-Plan-04 fallback: imapflow class not yet exported at runtime.
        // Use the marker property `authenticationFailed: true` (matches the .d.ts shape).
        err = Object.assign(new Error("auth failed"), { authenticationFailed: true });
      }
      expect(classifyConnectionError(err)).toBe("fatal");
    });
  });

  describe("classifies fatal sources: tlsFailed flag", () => {
    it("returns 'fatal' when err.tlsFailed === true", () => {
      const err = Object.assign(new Error("tls handshake failed"), { tlsFailed: true });
      expect(classifyConnectionError(err)).toBe("fatal");
    });
  });

  describe("classifies fatal sources: RFC 5530 response codes", () => {
    // D-05 fatal RFC 5530 codes — each must classify as "fatal"
    const RFC_5530_FATAL_CODES = [
      "AUTHENTICATIONFAILED",
      "LOGINDISABLED",
      "PRIVACYREQUIRED",
      "OVERQUOTA",
      "UNAVAILABLE",
      "EXPIRED",
      "ALERT",
      "CONTACTADMIN",
    ] as const;

    it.each(RFC_5530_FATAL_CODES)(
      "returns 'fatal' for RFC 5530 serverResponseCode = %s",
      (code) => {
        const err = Object.assign(new Error("rfc5530"), { serverResponseCode: code });
        expect(classifyConnectionError(err)).toBe("fatal");
      }
    );
  });

  describe("classifies transient sources", () => {
    // D-06 transient codes — each must classify as "transient"
    const TRANSIENT_CODES = [
      "ECONNRESET",
      "ETIMEDOUT",
      "ENOTFOUND",
      "ECONNREFUSED",
      "ENETUNREACH",
      "EConnectionClosed",
      "NoConnection",
    ] as const;

    it.each(TRANSIENT_CODES)("returns 'transient' for err.code = %s", (code) => {
      const err = Object.assign(new Error("net"), { code });
      expect(classifyConnectionError(err)).toBe("transient");
    });
  });

  describe("defaults unknown to transient", () => {
    it("returns 'transient' for unknown / malformed errors", () => {
      expect(classifyConnectionError({ weirdShape: true })).toBe("transient");
      expect(classifyConnectionError(null)).toBe("transient");
      expect(classifyConnectionError(undefined)).toBe("transient");
      expect(classifyConnectionError(new Error("totally unknown thing"))).toBe("transient");
    });
  });
});

describe("humanReason", () => {
  it("returns a non-empty string for known fatal sources", () => {
    const auth = Object.assign(new Error("ignore me"), {
      serverResponseCode: "AUTHENTICATIONFAILED",
    });
    expect(humanReason(auth)).toMatch(/authentication/i);
  });
});
