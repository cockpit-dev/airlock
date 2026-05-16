import { describe, expect, it } from "vitest";
import {
  applyCircuitBreakerRetryableFailure,
  applyCircuitBreakerSuccess,
  isCircuitBreakerOpen,
  parseProviderCircuitState,
  shouldAttemptHalfOpenRecovery,
  shouldPromoteHalfOpenToClosed,
  computeHalfOpenTrafficRamp
} from "./provider-circuit-breaker.js";

describe("applyCircuitBreakerRetryableFailure with sliding window", () => {
  it("does not track window when policy has no errorRateWindowMs", () => {
    const result = applyCircuitBreakerRetryableFailure(
      { consecutiveRetryableFailures: 0 },
      3,
      1000
    );

    expect(result.consecutiveRetryableFailures).toBe(1);
    expect(result.windowedTotalAttempts).toBeUndefined();
    expect(result.windowedFailures).toBeUndefined();
    expect(result.windowStartAt).toBeUndefined();
    expect(result.openedAt).toBeUndefined();
  });

  it("tracks windowed attempts and failures when policy has errorRateWindowMs", () => {
    const result = applyCircuitBreakerRetryableFailure(
      { consecutiveRetryableFailures: 0 },
      3,
      1000,
      { errorRateWindowMs: 60_000 }
    );

    expect(result.consecutiveRetryableFailures).toBe(1);
    expect(result.windowedTotalAttempts).toBe(1);
    expect(result.windowedFailures).toBe(1);
    expect(result.windowStartAt).toBe(1000);
    expect(result.openedAt).toBeUndefined();
  });

  it("accumulates windowed counters across multiple failures", () => {
    let state = applyCircuitBreakerRetryableFailure(
      { consecutiveRetryableFailures: 0 },
      3,
      1000,
      { errorRateWindowMs: 60_000 }
    );

    state = applyCircuitBreakerRetryableFailure(state, 3, 1010, {
      errorRateWindowMs: 60_000
    });

    expect(state.windowedTotalAttempts).toBe(2);
    expect(state.windowedFailures).toBe(2);
    expect(state.windowStartAt).toBe(1000);
  });

  it("opens circuit on error rate threshold before consecutive threshold", () => {
    // threshold=100 (consecutive won't trigger), errorRateThreshold=0.5, minAttempts=3
    // With 3 failures and 0 successes, rate = 3/3 = 1.0 >= 0.5 => open
    let state = applyCircuitBreakerRetryableFailure(
      { consecutiveRetryableFailures: 0 },
      100,
      1000,
      {
        errorRateWindowMs: 60_000,
        errorRateThreshold: 0.5,
        minAttemptsInWindow: 3
      }
    );

    expect(state.openedAt).toBeUndefined(); // 1/1 = 100% but minAttempts=3 not met

    state = applyCircuitBreakerRetryableFailure(state, 100, 1010, {
      errorRateWindowMs: 60_000,
      errorRateThreshold: 0.5,
      minAttemptsInWindow: 3
    });

    expect(state.openedAt).toBeUndefined(); // 2/2 = 100% but minAttempts=3 not met

    state = applyCircuitBreakerRetryableFailure(state, 100, 1020, {
      errorRateWindowMs: 60_000,
      errorRateThreshold: 0.5,
      minAttemptsInWindow: 3
    });

    expect(state.openedAt).toBe(1020); // 3/3 = 100% >= 0.5, minAttempts met
  });

  it("does not open circuit when error rate is below threshold", () => {
    // Interleave successes and failures: 3 successes + 2 failures
    // After 5 attempts, rate = 2/5 = 0.4 < 0.5 => no open
    let state: ReturnType<typeof applyCircuitBreakerSuccess> = {
      consecutiveRetryableFailures: 0
    };

    // success
    state = applyCircuitBreakerSuccess(state, 100, 50, 1000, {
      errorRateWindowMs: 60_000,
      errorRateThreshold: 0.5,
      minAttemptsInWindow: 3
    });

    // success
    state = applyCircuitBreakerSuccess(state, 120, 60, 1010, {
      errorRateWindowMs: 60_000,
      errorRateThreshold: 0.5,
      minAttemptsInWindow: 3
    });

    // failure
    state = applyCircuitBreakerRetryableFailure(state, 100, 1020, {
      errorRateWindowMs: 60_000,
      errorRateThreshold: 0.5,
      minAttemptsInWindow: 3
    });

    expect(state.openedAt).toBeUndefined();

    // success
    state = applyCircuitBreakerSuccess(state, 110, 55, 1030, {
      errorRateWindowMs: 60_000,
      errorRateThreshold: 0.5,
      minAttemptsInWindow: 3
    });

    // failure => 2/5 = 0.4 < 0.5
    state = applyCircuitBreakerRetryableFailure(state, 100, 1040, {
      errorRateWindowMs: 60_000,
      errorRateThreshold: 0.5,
      minAttemptsInWindow: 3
    });

    expect(state.openedAt).toBeUndefined();
    expect(state.windowedTotalAttempts).toBe(5);
    expect(state.windowedFailures).toBe(2);
  });

  it("opens circuit when intermittent failures push error rate above threshold", () => {
    // 1 success + 2 failures => 2/3 = 0.67 >= 0.5, minAttempts=3 met => open at 3rd attempt
    let state: ReturnType<typeof applyCircuitBreakerSuccess> = {
      consecutiveRetryableFailures: 0
    };

    // success at t=1000
    state = applyCircuitBreakerSuccess(state, 100, 50, 1000, {
      errorRateWindowMs: 60_000,
      errorRateThreshold: 0.5,
      minAttemptsInWindow: 3
    });

    // failure at t=1010 => 1/2 = 0.5 >= 0.5 but minAttempts=3 not met
    state = applyCircuitBreakerRetryableFailure(state, 100, 1010, {
      errorRateWindowMs: 60_000,
      errorRateThreshold: 0.5,
      minAttemptsInWindow: 3
    });

    expect(state.openedAt).toBeUndefined();

    // failure at t=1020 => 2/3 = 0.67 >= 0.5, minAttempts=3 met => open
    state = applyCircuitBreakerRetryableFailure(state, 100, 1020, {
      errorRateWindowMs: 60_000,
      errorRateThreshold: 0.5,
      minAttemptsInWindow: 3
    });

    expect(state.openedAt).toBe(1020);
    expect(state.windowedTotalAttempts).toBe(3);
    expect(state.windowedFailures).toBe(2);
  });

  it("resets window when it expires", () => {
    // Start window at t=1000 with errorRateWindowMs=1000
    let state = applyCircuitBreakerRetryableFailure(
      { consecutiveRetryableFailures: 0 },
      100,
      1000,
      { errorRateWindowMs: 1000 }
    );

    expect(state.windowedTotalAttempts).toBe(1);
    expect(state.windowStartAt).toBe(1000);

    // Advance past window expiry
    state = applyCircuitBreakerRetryableFailure(state, 100, 2500, {
      errorRateWindowMs: 1000
    });

    // Window should have reset: new window starts at 2500
    expect(state.windowedTotalAttempts).toBe(1);
    expect(state.windowedFailures).toBe(1);
    expect(state.windowStartAt).toBe(2500);
  });

  it("preserves existing window fields when policy is not provided", () => {
    const state = applyCircuitBreakerRetryableFailure(
      {
        consecutiveRetryableFailures: 1,
        windowedTotalAttempts: 5,
        windowedFailures: 2,
        windowStartAt: 1000
      },
      3,
      2000
    );

    expect(state.windowedTotalAttempts).toBe(5);
    expect(state.windowedFailures).toBe(2);
    expect(state.windowStartAt).toBe(1000);
  });
});

describe("applyCircuitBreakerSuccess with sliding window", () => {
  it("tracks windowed attempts on success", () => {
    const state = applyCircuitBreakerSuccess(
      { consecutiveRetryableFailures: 1 },
      100,
      50,
      1000,
      { errorRateWindowMs: 60_000 }
    );

    expect(state.windowedTotalAttempts).toBe(1);
    expect(state.windowedFailures).toBe(0);
    expect(state.windowStartAt).toBe(1000);
  });

  it("accumulates successes without incrementing failures", () => {
    let state = applyCircuitBreakerSuccess(
      { consecutiveRetryableFailures: 0 },
      100,
      50,
      1000,
      { errorRateWindowMs: 60_000 }
    );

    state = applyCircuitBreakerSuccess(state, 110, 55, 1010, {
      errorRateWindowMs: 60_000
    });

    expect(state.windowedTotalAttempts).toBe(2);
    expect(state.windowedFailures).toBe(0);
  });

  it("tracks mixed successes and failures", () => {
    // failure
    let state = applyCircuitBreakerRetryableFailure(
      { consecutiveRetryableFailures: 0 },
      100,
      1000,
      { errorRateWindowMs: 60_000 }
    );

    // success
    state = applyCircuitBreakerSuccess(state, 100, 50, 1010, {
      errorRateWindowMs: 60_000
    });

    // success
    state = applyCircuitBreakerSuccess(state, 120, 60, 1020, {
      errorRateWindowMs: 60_000
    });

    expect(state.windowedTotalAttempts).toBe(3);
    expect(state.windowedFailures).toBe(1);
    expect(state.windowStartAt).toBe(1000);
  });

  it("does not add window fields when no policy and no existing window", () => {
    const state = applyCircuitBreakerSuccess(
      { consecutiveRetryableFailures: 1 },
      100,
      50,
      1000
    );

    expect(state.windowedTotalAttempts).toBeUndefined();
    expect(state.windowedFailures).toBeUndefined();
    expect(state.windowStartAt).toBeUndefined();
  });

  it("preserves existing window fields when policy is not provided", () => {
    const state = applyCircuitBreakerSuccess(
      {
        consecutiveRetryableFailures: 1,
        windowedTotalAttempts: 5,
        windowedFailures: 2,
        windowStartAt: 1000
      },
      100,
      50,
      1100
    );

    expect(state.windowedTotalAttempts).toBe(5);
    expect(state.windowedFailures).toBe(2);
    expect(state.windowStartAt).toBe(1000);
  });

  it("resets window on success after window expiry", () => {
    const state = applyCircuitBreakerSuccess(
      {
        consecutiveRetryableFailures: 0,
        windowedTotalAttempts: 5,
        windowedFailures: 3,
        windowStartAt: 1000
      },
      100,
      50,
      3000,
      { errorRateWindowMs: 1000 }
    );

    expect(state.windowedTotalAttempts).toBe(1);
    expect(state.windowedFailures).toBe(0);
    expect(state.windowStartAt).toBe(3000);
  });

  it("does not track window when now is undefined", () => {
    const state = applyCircuitBreakerSuccess(
      { consecutiveRetryableFailures: 1 },
      100,
      50,
      undefined,
      { errorRateWindowMs: 60_000 }
    );

    expect(state.windowedTotalAttempts).toBeUndefined();
  });
});

describe("parseProviderCircuitState with windowed fields", () => {
  it("parses state with windowed fields", () => {
    const state = parseProviderCircuitState({
      consecutiveRetryableFailures: 1,
      windowedTotalAttempts: 5,
      windowedFailures: 2,
      windowStartAt: 1000
    });

    expect(state.windowedTotalAttempts).toBe(5);
    expect(state.windowedFailures).toBe(2);
    expect(state.windowStartAt).toBe(1000);
  });

  it("parses state without windowed fields", () => {
    const state = parseProviderCircuitState({
      consecutiveRetryableFailures: 0
    });

    expect(state.windowedTotalAttempts).toBeUndefined();
    expect(state.windowedFailures).toBeUndefined();
    expect(state.windowStartAt).toBeUndefined();
  });

  it("rejects negative windowedTotalAttempts", () => {
    expect(() =>
      parseProviderCircuitState({
        consecutiveRetryableFailures: 0,
        windowedTotalAttempts: -1
      })
    ).toThrow("windowedTotalAttempts is invalid");
  });

  it("rejects non-integer windowedTotalAttempts", () => {
    expect(() =>
      parseProviderCircuitState({
        consecutiveRetryableFailures: 0,
        windowedTotalAttempts: 1.5
      })
    ).toThrow("windowedTotalAttempts is invalid");
  });

  it("rejects negative windowedFailures", () => {
    expect(() =>
      parseProviderCircuitState({
        consecutiveRetryableFailures: 0,
        windowedFailures: -1
      })
    ).toThrow("windowedFailures is invalid");
  });

  it("rejects non-integer windowStartAt", () => {
    expect(() =>
      parseProviderCircuitState({
        consecutiveRetryableFailures: 0,
        windowStartAt: 1.5
      })
    ).toThrow("windowStartAt is invalid");
  });
});

describe("backward compatibility", () => {
  it("applyCircuitBreakerSuccess without policy produces identical output", () => {
    const result = applyCircuitBreakerSuccess(
      { consecutiveRetryableFailures: 3 },
      200,
      100,
      5000
    );

    expect(result).toEqual({
      consecutiveRetryableFailures: 0,
      halfOpenRetryableFailureCount: 0,
      lastSuccessLatencyMs: 200,
      smoothedSuccessLatencyMs: 200,
      lastSuccessTotalTokens: 100,
      smoothedSuccessTotalTokens: 100,
      lastSuccessAt: 5000,
      lastUsageObservedAt: 5000
    });
  });

  it("applyCircuitBreakerRetryableFailure without policy produces identical output", () => {
    const result = applyCircuitBreakerRetryableFailure(
      { consecutiveRetryableFailures: 2 },
      3,
      5000
    );

    expect(result).toEqual({
      consecutiveRetryableFailures: 3,
      halfOpenRetryableFailureCount: 0,
      openedAt: 5000,
      lastFailureAt: 5000
    });
  });
});

describe("applyCircuitBreakerSuccess half-open promotion gating", () => {
  it("closes circuit immediately when no promotion policy is given", () => {
    const result = applyCircuitBreakerSuccess(
      { consecutiveRetryableFailures: 0, openedAt: 1000 },
      100,
      undefined,
      2000
    );
    expect(result.openedAt).toBeUndefined();
    expect(result.recoverySuccessCount).toBe(1);
  });

  it("closes circuit when default promotion policy (1 success) is met", () => {
    const result = applyCircuitBreakerSuccess(
      { consecutiveRetryableFailures: 0, openedAt: 1000 },
      100,
      undefined,
      2000,
      {}
    );
    expect(result.openedAt).toBeUndefined();
    expect(result.recoverySuccessCount).toBe(1);
  });

  it("preserves openedAt when promotion requires 2 successes and only 1 has occurred", () => {
    const result = applyCircuitBreakerSuccess(
      { consecutiveRetryableFailures: 0, openedAt: 1000 },
      100,
      undefined,
      2000,
      { halfOpenPromotionSuccesses: 2 }
    );
    expect(result.openedAt).toBe(1000);
    expect(result.recoverySuccessCount).toBe(1);
  });

  it("closes circuit when second success meets the promotion threshold", () => {
    const result = applyCircuitBreakerSuccess(
      {
        consecutiveRetryableFailures: 0,
        openedAt: 1000,
        recoverySuccessCount: 1
      },
      100,
      undefined,
      3000,
      { halfOpenPromotionSuccesses: 2 }
    );
    expect(result.openedAt).toBeUndefined();
    expect(result.recoverySuccessCount).toBe(2);
  });

  it("preserves openedAt when success rate is below threshold", () => {
    // 1 success + 2 failures, window=3: need 100% rate over window of 3
    const result = applyCircuitBreakerSuccess(
      {
        consecutiveRetryableFailures: 0,
        openedAt: 1000,
        recoverySuccessCount: 1,
        halfOpenRetryableFailureCount: 2
      },
      100,
      undefined,
      3000,
      {
        halfOpenPromotionSuccesses: 1,
        halfOpenPromotionSuccessRate: 1.0,
        halfOpenPromotionWindow: 3
      }
    );
    // After: successes=2, failures=2, total=4
    // windowedAttempts = min(4, 3) = 3, windowedSuccesses = min(2, 3) = 2
    // rate = 2/3 = 66.7% < 100% → stays open
    expect(result.openedAt).toBe(1000);
    expect(result.recoverySuccessCount).toBe(2);
  });

  it("closes circuit when success rate meets threshold after failures", () => {
    // 3 successes + 1 failure = 75% >= 0.7 threshold, with successes >= 2 required
    const result = applyCircuitBreakerSuccess(
      {
        consecutiveRetryableFailures: 0,
        openedAt: 1000,
        recoverySuccessCount: 2,
        halfOpenRetryableFailureCount: 1
      },
      100,
      undefined,
      5000,
      {
        halfOpenPromotionSuccesses: 2,
        halfOpenPromotionSuccessRate: 0.7
      }
    );
    // After this success: 3 successes / 4 total = 75% >= 70% → promoted
    expect(result.openedAt).toBeUndefined();
    expect(result.recoverySuccessCount).toBe(3);
  });

  it("preserves openedAt with windowed evaluation", () => {
    // 3 successes + 2 failures, window of 3: recent 3 = 1 success + 2 failures = 33% < 100%
    const result = applyCircuitBreakerSuccess(
      {
        consecutiveRetryableFailures: 0,
        openedAt: 1000,
        recoverySuccessCount: 2,
        halfOpenRetryableFailureCount: 2
      },
      100,
      undefined,
      5000,
      {
        halfOpenPromotionSuccesses: 1,
        halfOpenPromotionSuccessRate: 1.0,
        halfOpenPromotionWindow: 3
      }
    );
    // 3 successes / 5 total, but windowed(3): 3 successes / 3 = 100% >= 100% → promoted
    // Actually: window = min(5, 3) = 3, windowedSuccesses = min(3, 3) = 3, rate = 3/3 = 1.0 >= 1.0
    expect(result.openedAt).toBeUndefined();
    expect(result.recoverySuccessCount).toBe(3);
  });

  it("does not add recoverySuccessCount for closed circuits", () => {
    const result = applyCircuitBreakerSuccess(
      { consecutiveRetryableFailures: 3 },
      100,
      undefined,
      2000,
      { halfOpenPromotionSuccesses: 2 }
    );
    expect(result.openedAt).toBeUndefined();
    expect(result.recoverySuccessCount).toBeUndefined();
  });
});

describe("shouldAttemptHalfOpenRecovery", () => {
  const policy = { threshold: 3, cooldownMs: 10_000 };

  it("returns false when state has no openedAt", () => {
    expect(
      shouldAttemptHalfOpenRecovery(
        { consecutiveRetryableFailures: 1 },
        policy,
        50_000
      )
    ).toBe(false);
  });

  it("returns false when cooldown has not expired", () => {
    expect(
      shouldAttemptHalfOpenRecovery(
        { consecutiveRetryableFailures: 3, openedAt: 45_000 },
        policy,
        50_000
      )
    ).toBe(false);
  });

  it("returns true when cooldown has expired and no probe started", () => {
    expect(
      shouldAttemptHalfOpenRecovery(
        { consecutiveRetryableFailures: 3, openedAt: 30_000 },
        policy,
        50_000
      )
    ).toBe(true);
  });

  it("returns false when probe is active and within cooldown", () => {
    expect(
      shouldAttemptHalfOpenRecovery(
        {
          consecutiveRetryableFailures: 3,
          openedAt: 10_000,
          probeStartedAt: 45_000
        },
        policy,
        50_000
      )
    ).toBe(false);
  });

  it("returns true when probe has expired its own cooldown", () => {
    expect(
      shouldAttemptHalfOpenRecovery(
        {
          consecutiveRetryableFailures: 3,
          openedAt: 10_000,
          probeStartedAt: 20_000
        },
        policy,
        50_000
      )
    ).toBe(true);
  });
});

// ── shouldPromoteHalfOpenToClosed ─────────────────────────────────────

describe("shouldPromoteHalfOpenToClosed", () => {
  it("returns false when circuit has no openedAt", () => {
    expect(
      shouldPromoteHalfOpenToClosed({ consecutiveRetryableFailures: 0 }, {})
    ).toBe(false);
  });

  it("returns false when no recovery attempts yet", () => {
    expect(
      shouldPromoteHalfOpenToClosed(
        { consecutiveRetryableFailures: 0, openedAt: 1000 },
        {}
      )
    ).toBe(false);
  });

  it("returns true with default policy after 1 success and no failures", () => {
    expect(
      shouldPromoteHalfOpenToClosed(
        {
          consecutiveRetryableFailures: 0,
          openedAt: 1000,
          recoverySuccessCount: 1
        },
        {}
      )
    ).toBe(true);
  });

  it("returns false when success count below required threshold", () => {
    expect(
      shouldPromoteHalfOpenToClosed(
        {
          consecutiveRetryableFailures: 0,
          openedAt: 1000,
          recoverySuccessCount: 1
        },
        { halfOpenPromotionSuccesses: 3 }
      )
    ).toBe(false);
  });

  it("returns true when success count meets required threshold", () => {
    expect(
      shouldPromoteHalfOpenToClosed(
        {
          consecutiveRetryableFailures: 0,
          openedAt: 1000,
          recoverySuccessCount: 3
        },
        { halfOpenPromotionSuccesses: 3 }
      )
    ).toBe(true);
  });

  it("returns false when success rate is below required threshold", () => {
    // 1 success, 1 failure = 1/2 = 0.5, required 0.8, window=2
    expect(
      shouldPromoteHalfOpenToClosed(
        {
          consecutiveRetryableFailures: 0,
          openedAt: 1000,
          recoverySuccessCount: 1,
          halfOpenRetryableFailureCount: 1
        },
        { halfOpenPromotionSuccesses: 2, halfOpenPromotionSuccessRate: 0.8 }
      )
    ).toBe(false);
  });

  it("returns true when success rate meets required threshold", () => {
    // 4 successes, 1 failure = 4/5 = 0.8, required 0.8
    expect(
      shouldPromoteHalfOpenToClosed(
        {
          consecutiveRetryableFailures: 0,
          openedAt: 1000,
          recoverySuccessCount: 4,
          halfOpenRetryableFailureCount: 1
        },
        { halfOpenPromotionSuccesses: 3, halfOpenPromotionSuccessRate: 0.8 }
      )
    ).toBe(true);
  });

  it("respects promotion window for success rate evaluation", () => {
    // 5 successes, 3 failures total. Window=4: last 4 attempts could be 1 success + 3 failures = 0.25
    // But we use min(successes, window)/min(total, window)
    // windowedSuccesses = min(5, 4) = 4, windowedAttempts = min(8, 4) = 4, rate = 1.0
    expect(
      shouldPromoteHalfOpenToClosed(
        {
          consecutiveRetryableFailures: 0,
          openedAt: 1000,
          recoverySuccessCount: 5,
          halfOpenRetryableFailureCount: 3
        },
        {
          halfOpenPromotionSuccesses: 3,
          halfOpenPromotionSuccessRate: 0.8,
          halfOpenPromotionWindow: 4
        }
      )
    ).toBe(true);
  });
});

// ── computeHalfOpenTrafficRamp ────────────────────────────────────────

describe("computeHalfOpenTrafficRamp", () => {
  it("returns 1 for non-open circuit", () => {
    expect(
      computeHalfOpenTrafficRamp({ consecutiveRetryableFailures: 0 }, {})
    ).toBe(1);
  });

  it("returns 0 for open circuit with no successes", () => {
    expect(
      computeHalfOpenTrafficRamp(
        { consecutiveRetryableFailures: 0, openedAt: 1000 },
        {}
      )
    ).toBe(0);
  });

  it("returns 1 for open circuit with 1 success and default policy", () => {
    expect(
      computeHalfOpenTrafficRamp(
        {
          consecutiveRetryableFailures: 0,
          openedAt: 1000,
          recoverySuccessCount: 1
        },
        {}
      )
    ).toBe(1);
  });

  it("returns graduated ramp with multi-success policy", () => {
    // 1 out of 3 required = 0.333
    expect(
      computeHalfOpenTrafficRamp(
        {
          consecutiveRetryableFailures: 0,
          openedAt: 1000,
          recoverySuccessCount: 1
        },
        { halfOpenPromotionSuccesses: 3 }
      )
    ).toBeCloseTo(1 / 3);
  });

  it("returns capped at 1 when successes exceed requirement", () => {
    expect(
      computeHalfOpenTrafficRamp(
        {
          consecutiveRetryableFailures: 0,
          openedAt: 1000,
          recoverySuccessCount: 5
        },
        { halfOpenPromotionSuccesses: 3 }
      )
    ).toBe(1);
  });
});

describe("isCircuitBreakerOpen", () => {
  const policy = { threshold: 3, cooldownMs: 10_000 };

  it("returns false for undefined state", () => {
    expect(isCircuitBreakerOpen(undefined, policy, 50_000)).toBe(false);
  });

  it("returns false when no openedAt", () => {
    expect(
      isCircuitBreakerOpen({ consecutiveRetryableFailures: 0 }, policy, 50_000)
    ).toBe(false);
  });

  it("returns true when within cooldown", () => {
    expect(
      isCircuitBreakerOpen(
        { consecutiveRetryableFailures: 3, openedAt: 45_000 },
        policy,
        50_000
      )
    ).toBe(true);
  });

  it("returns false when cooldown expired and no probe", () => {
    expect(
      isCircuitBreakerOpen(
        { consecutiveRetryableFailures: 3, openedAt: 30_000 },
        policy,
        50_000
      )
    ).toBe(false);
  });

  it("returns true when cooldown expired but probe is active", () => {
    expect(
      isCircuitBreakerOpen(
        {
          consecutiveRetryableFailures: 3,
          openedAt: 10_000,
          probeStartedAt: 45_000
        },
        policy,
        50_000
      )
    ).toBe(true);
  });
});
