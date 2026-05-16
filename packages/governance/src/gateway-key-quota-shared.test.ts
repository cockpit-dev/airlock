import { describe, expect, it } from "vitest";
import {
  computeFixedWindowStart,
  createRateLimitExceededError,
  createRateLimitHeaders,
  isRecord,
  parseRateLimitDecisionFields
} from "./gateway-key-quota-shared.js";

describe("gateway-key-quota-shared", () => {
  describe("isRecord", () => {
    it("returns true for plain objects", () => {
      expect(isRecord({})).toBe(true);
      expect(isRecord({ key: "value" })).toBe(true);
    });

    it("returns false for null", () => {
      expect(isRecord(null)).toBe(false);
    });

    it("returns true for arrays (typeof [] is object)", () => {
      expect(isRecord([])).toBe(true);
    });

    it("returns false for primitives", () => {
      expect(isRecord("string")).toBe(false);
      expect(isRecord(42)).toBe(false);
      expect(isRecord(true)).toBe(false);
      expect(isRecord(undefined)).toBe(false);
    });
  });

  describe("parseRateLimitDecisionFields", () => {
    it("parses a valid decision object", () => {
      const result = parseRateLimitDecisionFields({
        allowed: true,
        limit: 100,
        remaining: 95,
        resetAt: "2026-01-01T00:05:00.000Z",
        retryAfterSeconds: 0
      });

      expect(result).toEqual({
        allowed: true,
        limit: 100,
        remaining: 95,
        resetAt: "2026-01-01T00:05:00.000Z",
        retryAfterSeconds: 0
      });
    });

    it("parses a denied decision with retryAfterSeconds > 0", () => {
      const result = parseRateLimitDecisionFields({
        allowed: false,
        limit: 10,
        remaining: 0,
        resetAt: "2026-01-01T00:01:00.000Z",
        retryAfterSeconds: 45
      });

      expect(result.allowed).toBe(false);
      expect(result.retryAfterSeconds).toBe(45);
    });

    it("throws for non-object input", () => {
      expect(() => parseRateLimitDecisionFields(null)).toThrow(
        "Rate limit decision must be an object"
      );
      expect(() => parseRateLimitDecisionFields("string")).toThrow(
        "Rate limit decision must be an object"
      );
    });

    it("throws for invalid allowed type", () => {
      expect(() =>
        parseRateLimitDecisionFields({
          allowed: "yes",
          limit: 10,
          remaining: 5,
          resetAt: "2026-01-01T00:05:00.000Z",
          retryAfterSeconds: 0
        })
      ).toThrow("Rate limit decision is invalid");
    });

    it("throws for non-integer limit", () => {
      expect(() =>
        parseRateLimitDecisionFields({
          allowed: true,
          limit: 10.5,
          remaining: 5,
          resetAt: "2026-01-01T00:05:00.000Z",
          retryAfterSeconds: 0
        })
      ).toThrow("Rate limit decision is invalid");
    });

    it("throws for zero limit", () => {
      expect(() =>
        parseRateLimitDecisionFields({
          allowed: true,
          limit: 0,
          remaining: 0,
          resetAt: "2026-01-01T00:05:00.000Z",
          retryAfterSeconds: 0
        })
      ).toThrow("Rate limit decision is invalid");
    });

    it("throws for negative remaining", () => {
      expect(() =>
        parseRateLimitDecisionFields({
          allowed: false,
          limit: 10,
          remaining: -1,
          resetAt: "2026-01-01T00:05:00.000Z",
          retryAfterSeconds: 0
        })
      ).toThrow("Rate limit decision is invalid");
    });

    it("throws for invalid resetAt date string", () => {
      expect(() =>
        parseRateLimitDecisionFields({
          allowed: true,
          limit: 10,
          remaining: 5,
          resetAt: "not-a-date",
          retryAfterSeconds: 0
        })
      ).toThrow("Rate limit decision is invalid");
    });

    it("throws for non-integer retryAfterSeconds", () => {
      expect(() =>
        parseRateLimitDecisionFields({
          allowed: true,
          limit: 10,
          remaining: 5,
          resetAt: "2026-01-01T00:05:00.000Z",
          retryAfterSeconds: 1.5
        })
      ).toThrow("Rate limit decision is invalid");
    });

    it("throws for negative retryAfterSeconds", () => {
      expect(() =>
        parseRateLimitDecisionFields({
          allowed: true,
          limit: 10,
          remaining: 5,
          resetAt: "2026-01-01T00:05:00.000Z",
          retryAfterSeconds: -1
        })
      ).toThrow("Rate limit decision is invalid");
    });
  });

  describe("createRateLimitHeaders", () => {
    it("creates standard rate limit headers from decision", () => {
      const decision = {
        allowed: false,
        limit: 100,
        remaining: 0,
        resetAt: "2026-01-01T00:05:00.000Z",
        retryAfterSeconds: 30
      };

      const headers = createRateLimitHeaders(decision);

      expect(headers).toEqual({
        "retry-after": "30",
        "x-ratelimit-limit": "100",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "2026-01-01T00:05:00.000Z"
      });
    });
  });

  describe("createRateLimitExceededError", () => {
    it("creates a 429 GatewayError with rate limit headers", () => {
      const decision = {
        allowed: false,
        limit: 50,
        remaining: 0,
        resetAt: "2026-01-01T00:01:00.000Z",
        retryAfterSeconds: 60
      };

      const error = createRateLimitExceededError(
        "Rate limit exceeded",
        "rate_limit_exceeded",
        decision,
        "req_123"
      );

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe("Rate limit exceeded");
      expect(error.httpStatus).toBe(429);
      expect(error.code).toBe("rate_limit_exceeded");
      expect(error.category).toBe("rate_limit");
      expect(error.retryable).toBe(false);
      expect(error.requestId).toBe("req_123");
      expect(error.headers).toEqual({
        "retry-after": "60",
        "x-ratelimit-limit": "50",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "2026-01-01T00:01:00.000Z"
      });
    });
  });

  describe("computeFixedWindowStart", () => {
    it("computes window start aligned to window size", () => {
      // 60_000ms = 1 minute window
      // For timestamp 90_000 (1m30s), window start should be 60_000 (1m)
      expect(computeFixedWindowStart(60_000, 90_000)).toBe(60_000);
    });

    it("returns same timestamp when already at window boundary", () => {
      expect(computeFixedWindowStart(60_000, 60_000)).toBe(60_000);
    });

    it("computes window start for timestamp at zero", () => {
      expect(computeFixedWindowStart(60_000, 0)).toBe(0);
    });

    it("computes window start for large timestamp", () => {
      const windowMs = 3_600_000; // 1 hour
      const ts = 5_400_000; // 1.5 hours
      expect(computeFixedWindowStart(windowMs, ts)).toBe(3_600_000);
    });
  });
});
