import { describe, expect, it } from "vitest";
import {
  computeRequestQuotaConsume,
  createGatewayKeyQuotaExceededError,
  parseQuotaDecision
} from "./gateway-key-request-quota.js";

describe("gateway-key-request-quota", () => {
  describe("parseQuotaDecision", () => {
    it("parses a valid quota decision", () => {
      const result = parseQuotaDecision({
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAt: "2026-01-01T00:05:00.000Z",
        retryAfterSeconds: 0
      });

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(100);
      expect(result.remaining).toBe(99);
    });

    it("throws for non-object input", () => {
      expect(() => parseQuotaDecision(null)).toThrow(
        "Quota decision must be an object"
      );
      expect(() => parseQuotaDecision(42)).toThrow(
        "Quota decision must be an object"
      );
    });

    it("throws for invalid fields", () => {
      expect(() =>
        parseQuotaDecision({
          allowed: 1,
          limit: 10,
          remaining: 5,
          resetAt: "2026-01-01T00:05:00.000Z",
          retryAfterSeconds: 0
        })
      ).toThrow("Rate limit decision is invalid");
    });
  });

  describe("computeRequestQuotaConsume", () => {
    it("allows first request with no existing state", () => {
      const now = Date.now();
      const { decision, nextState } = computeRequestQuotaConsume(
        undefined,
        10,
        60,
        now
      );

      expect(decision.allowed).toBe(true);
      expect(decision.limit).toBe(10);
      expect(decision.remaining).toBe(9);
      expect(nextState.count).toBe(1);
    });

    it("allows request when count is below limit", () => {
      const now = Date.now();
      const windowMs = 60_000;
      const windowStartedAt = now - (now % windowMs);

      const { decision, nextState } = computeRequestQuotaConsume(
        { windowStartedAt, count: 5 },
        10,
        60,
        now
      );

      expect(decision.allowed).toBe(true);
      expect(decision.remaining).toBe(4);
      expect(nextState.count).toBe(6);
    });

    it("denies request when count equals limit", () => {
      const now = Date.now();
      const windowMs = 60_000;
      const windowStartedAt = now - (now % windowMs);

      const { decision, nextState } = computeRequestQuotaConsume(
        { windowStartedAt, count: 10 },
        10,
        60,
        now
      );

      expect(decision.allowed).toBe(false);
      expect(decision.remaining).toBe(0);
      expect(nextState.count).toBe(10);
    });

    it("denies request when count exceeds limit", () => {
      const now = Date.now();
      const windowMs = 60_000;
      const windowStartedAt = now - (now % windowMs);

      const { decision } = computeRequestQuotaConsume(
        { windowStartedAt, count: 15 },
        10,
        60,
        now
      );

      expect(decision.allowed).toBe(false);
    });

    it("resets count when window has rolled over", () => {
      const now = Date.now();
      const windowMs = 60_000;
      const oldWindow = now - windowMs * 2;

      const { decision, nextState } = computeRequestQuotaConsume(
        { windowStartedAt: oldWindow, count: 100 },
        10,
        60,
        now
      );

      expect(decision.allowed).toBe(true);
      expect(nextState.count).toBe(1);
    });

    it("handles existing state with undefined count as zero", () => {
      const now = Date.now();
      const windowMs = 60_000;
      const windowStartedAt = now - (now % windowMs);

      const { nextState } = computeRequestQuotaConsume(
        { windowStartedAt },
        10,
        60,
        now
      );

      expect(nextState.count).toBe(1);
    });

    it("computes resetAt at window boundary", () => {
      const now = 5_000_000;
      const windowMs = 60_000;
      const windowStartedAt = now - (now % windowMs);
      const resetAtTimestamp = windowStartedAt + windowMs;

      const { decision } = computeRequestQuotaConsume(undefined, 10, 60, now);

      expect(decision.resetAt).toBe(new Date(resetAtTimestamp).toISOString());
    });

    it("computes positive retryAfterSeconds when denied", () => {
      const now = Date.now();
      const windowMs = 60_000;
      const windowStartedAt = now - (now % windowMs);
      const resetAtTimestamp = windowStartedAt + windowMs;
      const expectedRetry = Math.ceil((resetAtTimestamp - now) / 1000);

      const { decision } = computeRequestQuotaConsume(
        { windowStartedAt, count: 10 },
        10,
        60,
        now
      );

      expect(decision.retryAfterSeconds).toBe(expectedRetry);
    });
  });

  describe("createGatewayKeyQuotaExceededError", () => {
    it("creates a 429 error with requests code", () => {
      const { decision } = computeRequestQuotaConsume(
        undefined,
        1,
        60,
        Date.now()
      );
      // Exhaust the quota
      const { decision: denied } = computeRequestQuotaConsume(
        {
          windowStartedAt: decision.resetAt
            ? Date.now() - (Date.now() % 60_000)
            : Date.now(),
          count: 1
        },
        1,
        60,
        Date.now()
      );

      const error = createGatewayKeyQuotaExceededError(denied, "req_q");

      expect(error.httpStatus).toBe(429);
      expect(error.code).toBe("quota_requests_exceeded");
      expect(error.message).toBe("Gateway API key request quota exceeded");
      expect(error.requestId).toBe("req_q");
      expect(error.headers).toBeDefined();
    });
  });
});
