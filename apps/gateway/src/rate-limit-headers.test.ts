import { describe, it, expect } from "vitest";
import { collectRateLimitHeaders } from "./rate-limit-headers.js";
import type { RateLimitDecision } from "@airlock/governance";

function makeDecision(
  overrides: Partial<RateLimitDecision> = {}
): RateLimitDecision {
  return {
    allowed: true,
    limit: 100,
    remaining: 80,
    resetAt: "2026-01-01T00:00:00Z",
    retryAfterSeconds: 0,
    ...overrides
  };
}

describe("collectRateLimitHeaders", () => {
  it("returns empty object when no decisions", () => {
    expect(collectRateLimitHeaders()).toEqual({});
    expect(collectRateLimitHeaders(undefined, undefined)).toEqual({});
  });

  it("returns headers for a single decision", () => {
    const result = collectRateLimitHeaders(
      makeDecision({ limit: 100, remaining: 80 })
    );
    expect(result["x-ratelimit-limit"]).toBe("100");
    expect(result["x-ratelimit-remaining"]).toBe("80");
  });

  it("picks most restrictive values across decisions", () => {
    const result = collectRateLimitHeaders(
      makeDecision({
        limit: 100,
        remaining: 80,
        resetAt: "2026-01-01T10:00:00Z"
      }),
      makeDecision({
        limit: 50,
        remaining: 30,
        resetAt: "2026-01-01T05:00:00Z"
      }),
      makeDecision({
        limit: 200,
        remaining: 150,
        resetAt: "2026-01-01T08:00:00Z"
      })
    );
    expect(result["x-ratelimit-limit"]).toBe("50");
    expect(result["x-ratelimit-remaining"]).toBe("30");
  });

  it("skips undefined decisions", () => {
    const result = collectRateLimitHeaders(
      undefined,
      makeDecision({ limit: 10, remaining: 5 }),
      undefined
    );
    expect(result["x-ratelimit-limit"]).toBe("10");
    expect(result["x-ratelimit-remaining"]).toBe("5");
  });
});
