import { describe, expect, it } from "vitest";
import { GatewayError } from "@airlock/shared";
import {
  computeIpRateLimitConsume,
  createIpRateLimitExceededError,
  createIpRateLimitHeaders,
  extractClientIp,
  parseIpRateLimitDecision,
  parseIpRateLimitPolicy
} from "./ip-rate-limit.js";

describe("ip-rate-limit", () => {
  describe("parseIpRateLimitPolicy", () => {
    it("parses a valid policy", () => {
      const policy = parseIpRateLimitPolicy({ limit: 60, windowSeconds: 60 });
      expect(policy).toEqual({ limit: 60, windowSeconds: 60 });
    });

    it("throws for non-object", () => {
      expect(() => parseIpRateLimitPolicy(null)).toThrow(
        "IP rate limit policy must be an object"
      );
    });

    it("throws for non-integer limit", () => {
      expect(() =>
        parseIpRateLimitPolicy({ limit: 1.5, windowSeconds: 60 })
      ).toThrow("IP rate limit policy limit must be a positive integer");
    });

    it("throws for zero limit", () => {
      expect(() =>
        parseIpRateLimitPolicy({ limit: 0, windowSeconds: 60 })
      ).toThrow("IP rate limit policy limit must be a positive integer");
    });

    it("throws for negative windowSeconds", () => {
      expect(() =>
        parseIpRateLimitPolicy({ limit: 10, windowSeconds: -1 })
      ).toThrow(
        "IP rate limit policy windowSeconds must be a positive integer"
      );
    });
  });

  describe("parseIpRateLimitDecision", () => {
    it("parses a valid decision", () => {
      const result = parseIpRateLimitDecision({
        allowed: true,
        limit: 60,
        remaining: 55,
        resetAt: "2026-01-01T00:01:00.000Z",
        retryAfterSeconds: 0
      });
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(60);
    });

    it("throws for non-object", () => {
      expect(() => parseIpRateLimitDecision(null)).toThrow(
        "IP rate limit decision must be an object"
      );
    });
  });

  describe("computeIpRateLimitConsume", () => {
    it("allows first request with no existing state", () => {
      const now = Date.now();
      const { decision, nextState } = computeIpRateLimitConsume(
        undefined,
        10,
        60,
        now
      );

      expect(decision.allowed).toBe(true);
      expect(decision.remaining).toBe(9);
      expect(nextState.count).toBe(1);
    });

    it("allows request when count is below limit", () => {
      const now = Date.now();
      const windowMs = 60_000;
      const windowStartedAt = now - (now % windowMs);

      const { decision } = computeIpRateLimitConsume(
        { windowStartedAt, count: 5 },
        10,
        60,
        now
      );

      expect(decision.allowed).toBe(true);
      expect(decision.remaining).toBe(4);
    });

    it("denies request when count equals limit", () => {
      const now = Date.now();
      const windowMs = 60_000;
      const windowStartedAt = now - (now % windowMs);

      const { decision } = computeIpRateLimitConsume(
        { windowStartedAt, count: 10 },
        10,
        60,
        now
      );

      expect(decision.allowed).toBe(false);
      expect(decision.remaining).toBe(0);
    });

    it("resets count when window has rolled over", () => {
      const now = Date.now();
      const windowMs = 60_000;
      const oldWindow = now - windowMs * 2;

      const { decision, nextState } = computeIpRateLimitConsume(
        { windowStartedAt: oldWindow, count: 100 },
        10,
        60,
        now
      );

      expect(decision.allowed).toBe(true);
      expect(nextState.count).toBe(1);
    });

    it("computes resetAt at window boundary", () => {
      const now = 5_000_000;
      const windowMs = 60_000;
      const windowStartedAt = now - (now % windowMs);
      const resetAtTimestamp = windowStartedAt + windowMs;

      const { decision } = computeIpRateLimitConsume(undefined, 10, 60, now);

      expect(decision.resetAt).toBe(new Date(resetAtTimestamp).toISOString());
    });

    it("computes positive retryAfterSeconds when denied", () => {
      const now = Date.now();
      const windowMs = 60_000;
      const windowStartedAt = now - (now % windowMs);

      const { decision } = computeIpRateLimitConsume(
        { windowStartedAt, count: 10 },
        10,
        60,
        now
      );

      expect(decision.retryAfterSeconds).toBeGreaterThan(0);
    });
  });

  describe("extractClientIp", () => {
    it("prefers CF-Connecting-IP", () => {
      const ip = extractClientIp({
        get: (name: string) => {
          if (name === "cf-connecting-ip") return "1.2.3.4";
          if (name === "x-forwarded-for") return "5.6.7.8, 9.10.11.12";
          return null;
        }
      });
      expect(ip).toBe("1.2.3.4");
    });

    it("falls back to first X-Forwarded-For entry", () => {
      const ip = extractClientIp({
        get: (name: string) => {
          if (name === "cf-connecting-ip") return null;
          if (name === "x-forwarded-for") return "  5.6.7.8 , 9.10.11.12 ";
          return null;
        }
      });
      expect(ip).toBe("5.6.7.8");
    });

    it("falls back to X-Real-IP", () => {
      const ip = extractClientIp({
        get: (name: string) => {
          if (name === "cf-connecting-ip") return null;
          if (name === "x-forwarded-for") return null;
          if (name === "x-real-ip") return "10.0.0.1";
          return null;
        }
      });
      expect(ip).toBe("10.0.0.1");
    });

    it("returns unknown when no headers present", () => {
      const ip = extractClientIp({
        get: () => null
      });
      expect(ip).toBe("unknown");
    });

    it("returns unknown when CF-Connecting-IP is empty", () => {
      const ip = extractClientIp({
        get: (name: string) => {
          if (name === "cf-connecting-ip") return "";
          return null;
        }
      });
      expect(ip).toBe("unknown");
    });

    it("handles IPv6 addresses", () => {
      const ip = extractClientIp({
        get: (name: string) => {
          if (name === "cf-connecting-ip")
            return "2001:0db8:85a3:0000:0000:8a2e:0370:7334";
          return null;
        }
      });
      expect(ip).toBe("2001:0db8:85a3:0000:0000:8a2e:0370:7334");
    });
  });

  describe("createIpRateLimitExceededError", () => {
    it("creates a 429 error with ip_rate_limit_exceeded code", () => {
      // Exhaust the quota
      const { decision: denied } = computeIpRateLimitConsume(
        {
          windowStartedAt: Date.now() - (Date.now() % 60_000),
          count: 1
        },
        1,
        60,
        Date.now()
      );

      const error = createIpRateLimitExceededError(denied, "req_ip1");

      expect(error).toBeInstanceOf(GatewayError);
      expect(error.httpStatus).toBe(429);
      expect(error.code).toBe("ip_rate_limit_exceeded");
      expect(error.message).toBe("IP rate limit exceeded");
      expect(error.requestId).toBe("req_ip1");
      expect(error.headers).toBeDefined();
    });
  });

  describe("createIpRateLimitHeaders", () => {
    it("creates standard rate limit headers", () => {
      const { decision } = computeIpRateLimitConsume(undefined, 100, 60, Date.now());
      const headers = createIpRateLimitHeaders(decision);

      expect(headers["x-ratelimit-limit"]).toBe("100");
      expect(headers).toHaveProperty("x-ratelimit-remaining");
      expect(headers).toHaveProperty("x-ratelimit-reset");
      // retryAfterSeconds depends on window position — just verify it exists
      expect(headers).toHaveProperty("retry-after");
    });
  });
});
