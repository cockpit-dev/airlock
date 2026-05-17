import { describe, it, expect } from "vitest";
import { AdminRateLimiter } from "./admin-rate-limit.js";

describe("AdminRateLimiter", () => {
  it("allows requests within the limit", () => {
    const limiter = new AdminRateLimiter(5, 10_000);
    for (let i = 0; i < 5; i++) {
      expect(limiter.check("1.2.3.4", 1000 + i)).toEqual({
        allowed: true,
        remaining: 4 - i
      });
    }
  });

  it("blocks requests exceeding the limit", () => {
    const limiter = new AdminRateLimiter(3, 10_000);
    limiter.check("1.2.3.4", 1000);
    limiter.check("1.2.3.4", 1001);
    limiter.check("1.2.3.4", 1002);

    const result = limiter.check("1.2.3.4", 1003);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("resets the window after expiry", () => {
    const limiter = new AdminRateLimiter(2, 10_000);
    limiter.check("1.2.3.4", 1000);
    limiter.check("1.2.3.4", 1001);

    // Still within window — blocked
    expect(limiter.check("1.2.3.4", 10_999).allowed).toBe(false);

    // Past window — allowed again
    expect(limiter.check("1.2.3.4", 11_000).allowed).toBe(true);
  });

  it("tracks IPs independently", () => {
    const limiter = new AdminRateLimiter(2, 10_000);
    expect(limiter.check("1.1.1.1", 1000).allowed).toBe(true);
    expect(limiter.check("1.1.1.1", 1001).allowed).toBe(true);
    expect(limiter.check("2.2.2.2", 1002).allowed).toBe(true);
    expect(limiter.check("1.1.1.1", 1003).allowed).toBe(false);
  });

  it("reset clears all state", () => {
    const limiter = new AdminRateLimiter(1, 10_000);
    limiter.check("1.2.3.4", 1000);
    limiter.reset();
    expect(limiter.check("1.2.3.4", 1001).allowed).toBe(true);
  });

  it("remaining never goes below zero", () => {
    const limiter = new AdminRateLimiter(1, 10_000);
    limiter.check("1.2.3.4", 1000);
    limiter.check("1.2.3.4", 1001);
    const result = limiter.check("1.2.3.4", 1002);
    expect(result.remaining).toBe(0);
  });
});
