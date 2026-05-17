import { describe, expect, it } from "vitest";
import { GatewayError } from "@airlock/shared";
import {
  assertGatewayKeyTokenUsageAvailable,
  createGatewayKeyTokenQuotaExceededError,
  createTokenQuotaDecision,
  createTokenQuotaReservationId,
  createTokenQuotaWindowState,
  getReservedTokens,
  parseTokenQuotaDecision
} from "./gateway-key-token-quota.js";

describe("gateway-key-token-quota", () => {
  describe("parseTokenQuotaDecision", () => {
    it("parses a valid token quota decision", () => {
      const result = parseTokenQuotaDecision({
        allowed: true,
        limit: 10000,
        remaining: 7500,
        used: 2000,
        reserved: 500,
        resetAt: "2026-01-01T01:00:00.000Z",
        retryAfterSeconds: 0
      });

      expect(result).toEqual({
        allowed: true,
        limit: 10000,
        remaining: 7500,
        used: 2000,
        reserved: 500,
        resetAt: "2026-01-01T01:00:00.000Z",
        retryAfterSeconds: 0
      });
    });

    it("throws for non-object input", () => {
      expect(() => parseTokenQuotaDecision(null)).toThrow(
        "Token quota decision must be an object"
      );
    });

    it("throws for missing used field", () => {
      expect(() =>
        parseTokenQuotaDecision({
          allowed: true,
          limit: 10000,
          remaining: 7500,
          reserved: 500,
          resetAt: "2026-01-01T01:00:00.000Z",
          retryAfterSeconds: 0
        })
      ).toThrow("Token quota decision is invalid");
    });

    it("throws for negative used", () => {
      expect(() =>
        parseTokenQuotaDecision({
          allowed: true,
          limit: 10000,
          remaining: 7500,
          used: -1,
          reserved: 0,
          resetAt: "2026-01-01T01:00:00.000Z",
          retryAfterSeconds: 0
        })
      ).toThrow("Token quota decision is invalid");
    });

    it("throws for negative reserved", () => {
      expect(() =>
        parseTokenQuotaDecision({
          allowed: true,
          limit: 10000,
          remaining: 7500,
          used: 0,
          reserved: -1,
          resetAt: "2026-01-01T01:00:00.000Z",
          retryAfterSeconds: 0
        })
      ).toThrow("Token quota decision is invalid");
    });

    it("throws for non-integer reserved", () => {
      expect(() =>
        parseTokenQuotaDecision({
          allowed: true,
          limit: 10000,
          remaining: 7500,
          used: 0,
          reserved: 1.5,
          resetAt: "2026-01-01T01:00:00.000Z",
          retryAfterSeconds: 0
        })
      ).toThrow("Token quota decision is invalid");
    });
  });

  describe("createTokenQuotaWindowState", () => {
    it("creates fresh window when no existing storage", () => {
      const now = Date.now();
      const windowStartedAt = now - (now % 60_000);

      const state = createTokenQuotaWindowState(
        undefined,
        windowStartedAt,
        now
      );

      expect(state).toEqual({
        windowStartedAt,
        usedTokens: 0,
        reservations: []
      });
    });

    it("resets when window has rolled over", () => {
      const now = Date.now();
      const oldWindow = now - 120_000;
      const newWindow = now - (now % 60_000);

      const state = createTokenQuotaWindowState(
        { windowStartedAt: oldWindow, usedTokens: 5000, reservations: [] },
        newWindow,
        now
      );

      expect(state.usedTokens).toBe(0);
      expect(state.reservations).toEqual([]);
      expect(state.windowStartedAt).toBe(newWindow);
    });

    it("preserves usedTokens when within same window", () => {
      const now = Date.now();
      const windowStartedAt = now - (now % 60_000);

      const state = createTokenQuotaWindowState(
        { windowStartedAt, usedTokens: 3000, reservations: [] },
        windowStartedAt,
        now
      );

      expect(state.usedTokens).toBe(3000);
    });

    it("filters out expired reservations", () => {
      const now = Date.now();
      const windowStartedAt = now - (now % 60_000);

      const state = createTokenQuotaWindowState(
        {
          windowStartedAt,
          usedTokens: 100,
          reservations: [
            { reservationId: "r1", tokens: 500, expiresAt: now + 10_000 },
            { reservationId: "r2", tokens: 200, expiresAt: now - 1000 }
          ]
        },
        windowStartedAt,
        now
      );

      expect(state.reservations).toHaveLength(1);
      expect(state.reservations[0]?.reservationId).toBe("r1");
    });
  });

  describe("getReservedTokens", () => {
    it("returns 0 for empty reservations", () => {
      expect(getReservedTokens([])).toBe(0);
    });

    it("sums all reservation token counts", () => {
      const reservations = [
        { reservationId: "r1", tokens: 100, expiresAt: Date.now() + 5000 },
        { reservationId: "r2", tokens: 200, expiresAt: Date.now() + 5000 },
        { reservationId: "r3", tokens: 300, expiresAt: Date.now() + 5000 }
      ];

      expect(getReservedTokens(reservations)).toBe(600);
    });
  });

  describe("createTokenQuotaDecision", () => {
    const policy = { limit: 10000, windowSeconds: 3600 };

    it("allows when used + reserved < limit", () => {
      const now = Date.now();
      const decision = createTokenQuotaDecision(policy, 5000, 2000, now);

      expect(decision.allowed).toBe(true);
      expect(decision.limit).toBe(10000);
      expect(decision.remaining).toBe(3000);
      expect(decision.used).toBe(5000);
      expect(decision.reserved).toBe(2000);
    });

    it("denies when used + reserved >= limit", () => {
      const now = Date.now();
      const decision = createTokenQuotaDecision(policy, 8000, 2000, now);

      expect(decision.allowed).toBe(false);
      expect(decision.remaining).toBe(0);
    });

    it("denies at exact limit boundary", () => {
      const now = Date.now();
      const decision = createTokenQuotaDecision(policy, 10000, 0, now);

      expect(decision.allowed).toBe(false);
    });

    it("computes resetAt at window boundary", () => {
      const windowMs = policy.windowSeconds * 1000;
      const now = 5_000_000;
      const windowStart = now - (now % windowMs);
      const resetAtTimestamp = windowStart + windowMs;

      const decision = createTokenQuotaDecision(policy, 0, 0, now);

      expect(decision.resetAt).toBe(new Date(resetAtTimestamp).toISOString());
    });

    it("computes retryAfterSeconds from now to reset", () => {
      const windowMs = policy.windowSeconds * 1000;
      const now = 5_000_000;
      const windowStart = now - (now % windowMs);
      const resetAtTimestamp = windowStart + windowMs;
      const expectedRetry = Math.ceil((resetAtTimestamp - now) / 1000);

      const decision = createTokenQuotaDecision(policy, 10000, 0, now);

      expect(decision.retryAfterSeconds).toBe(expectedRetry);
    });
  });

  describe("createTokenQuotaReservationId", () => {
    it("prefixes request ID with tkq_", () => {
      expect(createTokenQuotaReservationId("req_abc")).toBe("tkq_req_abc");
    });
  });

  describe("assertGatewayKeyTokenUsageAvailable", () => {
    it("does nothing when no token quota policy configured", () => {
      expect(() =>
        assertGatewayKeyTokenUsageAvailable({}, undefined, "req_1")
      ).not.toThrow();
    });

    it("does nothing when usage is valid", () => {
      expect(() =>
        assertGatewayKeyTokenUsageAvailable(
          { policy: { tokenQuota: { limit: 10000, windowSeconds: 3600 } } },
          { totalTokens: 500 },
          "req_1"
        )
      ).not.toThrow();
    });

    it("throws when usage is undefined with token quota configured", () => {
      expect(() =>
        assertGatewayKeyTokenUsageAvailable(
          { policy: { tokenQuota: { limit: 10000, windowSeconds: 3600 } } },
          undefined,
          "req_1"
        )
      ).toThrow(GatewayError);
    });

    it("throws when usage totalTokens is negative", () => {
      expect(() =>
        assertGatewayKeyTokenUsageAvailable(
          { policy: { tokenQuota: { limit: 10000, windowSeconds: 3600 } } },
          { totalTokens: -1 },
          "req_1"
        )
      ).toThrow(GatewayError);
    });

    it("throws GatewayError with correct code and 503 status", () => {
      try {
        assertGatewayKeyTokenUsageAvailable(
          { policy: { tokenQuota: { limit: 10000, windowSeconds: 3600 } } },
          undefined,
          "req_test"
        );
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(GatewayError);
        const gw = e as GatewayError;
        expect(gw.httpStatus).toBe(503);
        expect(gw.code).toBe("gateway_key_token_quota_usage_unavailable");
        expect(gw.requestId).toBe("req_test");
      }
    });
  });

  describe("createGatewayKeyTokenQuotaExceededError", () => {
    it("creates a 429 error with token quota code", () => {
      const decision = createTokenQuotaDecision(
        { limit: 1000, windowSeconds: 60 },
        1000,
        0,
        Date.now()
      );

      const error = createGatewayKeyTokenQuotaExceededError(decision, "req_x");

      expect(error.httpStatus).toBe(429);
      expect(error.code).toBe("quota_tokens_exceeded");
      expect(error.message).toBe("Gateway API key token quota exceeded");
      expect(error.requestId).toBe("req_x");
      expect(error.headers).toBeDefined();
    });
  });
});
