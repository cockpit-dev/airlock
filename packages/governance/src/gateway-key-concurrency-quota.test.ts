import { describe, expect, it } from "vitest";
import {
  createConcurrencyDecision,
  createGatewayKeyConcurrencyExceededError,
  getConcurrencyLeaseTtlMs,
  isGatewayKeyConcurrencyLease,
  parseConcurrencyDecision
} from "./gateway-key-concurrency-quota.js";

describe("gateway-key-concurrency-quota", () => {
  describe("isGatewayKeyConcurrencyLease", () => {
    it("returns true for a valid lease", () => {
      expect(
        isGatewayKeyConcurrencyLease({
          leaseId: "lease_123",
          expiresAt: Date.now() + 5000
        })
      ).toBe(true);
    });

    it("returns false for null", () => {
      expect(isGatewayKeyConcurrencyLease(null)).toBe(false);
    });

    it("returns false for non-object", () => {
      expect(isGatewayKeyConcurrencyLease("string")).toBe(false);
    });

    it("returns false when leaseId is missing", () => {
      expect(
        isGatewayKeyConcurrencyLease({
          expiresAt: Date.now() + 5000
        })
      ).toBe(false);
    });

    it("returns false when expiresAt is not integer", () => {
      expect(
        isGatewayKeyConcurrencyLease({
          leaseId: "lease_123",
          expiresAt: 1.5
        })
      ).toBe(false);
    });

    it("returns false when leaseId is not a string", () => {
      expect(
        isGatewayKeyConcurrencyLease({
          leaseId: 123,
          expiresAt: Date.now() + 5000
        })
      ).toBe(false);
    });
  });

  describe("parseConcurrencyDecision", () => {
    it("parses a valid concurrency decision", () => {
      const result = parseConcurrencyDecision({
        allowed: true,
        limit: 5,
        remaining: 3,
        resetAt: "2026-01-01T00:05:00.000Z",
        retryAfterSeconds: 0
      });

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(5);
      expect(result.remaining).toBe(3);
    });

    it("throws for non-object input", () => {
      expect(() => parseConcurrencyDecision(null)).toThrow(
        "Concurrency decision must be an object"
      );
    });

    it("throws for invalid fields", () => {
      expect(() =>
        parseConcurrencyDecision({
          allowed: "yes",
          limit: 5,
          remaining: 3,
          resetAt: "2026-01-01T00:05:00.000Z",
          retryAfterSeconds: 0
        })
      ).toThrow("Rate limit decision is invalid");
    });
  });

  describe("getConcurrencyLeaseTtlMs", () => {
    it("returns provider timeout when above 1000ms", () => {
      expect(getConcurrencyLeaseTtlMs(5000)).toBe(5000);
    });

    it("returns minimum 1000ms when provider timeout is lower", () => {
      expect(getConcurrencyLeaseTtlMs(100)).toBe(1000);
      expect(getConcurrencyLeaseTtlMs(0)).toBe(1000);
      expect(getConcurrencyLeaseTtlMs(999)).toBe(1000);
    });

    it("returns exactly 1000ms when provider timeout is 1000ms", () => {
      expect(getConcurrencyLeaseTtlMs(1000)).toBe(1000);
    });
  });

  describe("createConcurrencyDecision", () => {
    it("allows when active leases are below limit", () => {
      const now = Date.now();
      const decision = createConcurrencyDecision(5, [], 10_000, now);

      expect(decision.allowed).toBe(true);
      expect(decision.limit).toBe(5);
      expect(decision.remaining).toBe(5);
    });

    it("allows when active leases equal limit minus one", () => {
      const now = Date.now();
      const leases = [
        { leaseId: "l1", expiresAt: now + 5000 },
        { leaseId: "l2", expiresAt: now + 5000 },
        { leaseId: "l3", expiresAt: now + 5000 },
        { leaseId: "l4", expiresAt: now + 5000 }
      ];

      const decision = createConcurrencyDecision(5, leases, 10_000, now);

      expect(decision.allowed).toBe(true);
      expect(decision.remaining).toBe(1);
    });

    it("denies when active leases equal limit", () => {
      const now = Date.now();
      const leases = [
        { leaseId: "l1", expiresAt: now + 5000 },
        { leaseId: "l2", expiresAt: now + 5000 },
        { leaseId: "l3", expiresAt: now + 5000 },
        { leaseId: "l4", expiresAt: now + 5000 },
        { leaseId: "l5", expiresAt: now + 5000 }
      ];

      const decision = createConcurrencyDecision(5, leases, 10_000, now);

      expect(decision.allowed).toBe(false);
      expect(decision.remaining).toBe(0);
    });

    it("computes resetAt from earliest lease expiry", () => {
      const now = Date.now();
      const leases = [
        { leaseId: "l1", expiresAt: now + 10_000 },
        { leaseId: "l2", expiresAt: now + 3000 },
        { leaseId: "l3", expiresAt: now + 7000 }
      ];

      const decision = createConcurrencyDecision(5, leases, 10_000, now);

      expect(decision.resetAt).toBe(new Date(now + 3000).toISOString());
      expect(decision.retryAfterSeconds).toBe(3);
    });

    it("computes resetAt from ttl when no active leases", () => {
      const now = Date.now();
      const decision = createConcurrencyDecision(5, [], 10_000, now);

      expect(decision.resetAt).toBe(new Date(now + 10_000).toISOString());
    });
  });

  describe("createGatewayKeyConcurrencyExceededError", () => {
    it("creates a 429 error with concurrency code", () => {
      const decision = createConcurrencyDecision(2, [
        { leaseId: "l1", expiresAt: Date.now() + 5000 },
        { leaseId: "l2", expiresAt: Date.now() + 5000 }
      ], 10_000);

      const error = createGatewayKeyConcurrencyExceededError(
        decision,
        "req_abc"
      );

      expect(error.httpStatus).toBe(429);
      expect(error.code).toBe("quota_concurrency_exceeded");
      expect(error.message).toBe(
        "Gateway API key concurrency quota exceeded"
      );
      expect(error.requestId).toBe("req_abc");
      expect(error.headers).toBeDefined();
    });
  });
});
