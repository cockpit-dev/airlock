import { describe, expect, it } from "vitest";

import type { ProviderCircuitState } from "./provider-circuit-breaker.js";
import {
  deriveProviderTargetHealthSnapshot,
  getFreshRetryableFailureCount,
  getFreshSmoothedLatency,
  getSlidingWindowErrorRate,
  getRecoveryScore,
  getFreshObservedTokenCostMultiplier,
  adjustWeightForFailures,
  computeHierarchicalHealthScore,
  compareHierarchicalHealthScores,
  type ProviderTargetHealthSnapshot
} from "./provider-target-health.js";

const now = 1_000_000;

describe("deriveProviderTargetHealthSnapshot", () => {
  it("derives isOpen from openedAt", () => {
    const state: ProviderCircuitState = {
      consecutiveRetryableFailures: 0,
      openedAt: 999_000
    };

    const snapshot = deriveProviderTargetHealthSnapshot(state);
    expect(snapshot.isOpen).toBe(true);
    expect(snapshot.isHalfOpen).toBeUndefined();
  });

  it("is not open when openedAt is undefined", () => {
    const state: ProviderCircuitState = {
      consecutiveRetryableFailures: 0
    };

    const snapshot = deriveProviderTargetHealthSnapshot(state);
    expect(snapshot.isOpen).toBe(false);
    expect(snapshot.isHalfOpen).toBeUndefined();
  });

  it("is not open when openedAt is 0", () => {
    const state: ProviderCircuitState = {
      consecutiveRetryableFailures: 0,
      openedAt: 0
    };

    const snapshot = deriveProviderTargetHealthSnapshot(state);
    expect(snapshot.isOpen).toBe(false);
  });

  it("copies numeric fields from circuit state", () => {
    const state: ProviderCircuitState = {
      consecutiveRetryableFailures: 3,
      openedAt: 999_000,
      halfOpen: true,
      lastSuccessLatencyMs: 150,
      smoothedSuccessLatencyMs: 140,
      lastSuccessTotalTokens: 500,
      smoothedSuccessTotalTokens: 450,
      lastSuccessAt: 998_000,
      lastUsageObservedAt: 997_000,
      lastFailureAt: 996_000,
      recoverySuccessCount: 1,
      windowedTotalAttempts: 10,
      windowedFailures: 3
    };

    const snapshot = deriveProviderTargetHealthSnapshot(state);
    expect(snapshot).toEqual({
      isOpen: false,
      isHalfOpen: true,
      consecutiveRetryableFailures: 3,
      lastSuccessLatencyMs: 150,
      smoothedSuccessLatencyMs: 140,
      lastSuccessTotalTokens: 500,
      smoothedSuccessTotalTokens: 450,
      lastSuccessAt: 998_000,
      lastUsageObservedAt: 997_000,
      lastFailureAt: 996_000,
      recoverySuccessCount: 1,
      windowedTotalAttempts: 10,
      windowedFailures: 3
    });
  });
});

describe("getFreshRetryableFailureCount", () => {
  const healthy: ProviderTargetHealthSnapshot = {
    isOpen: false,
    consecutiveRetryableFailures: 2,
    lastFailureAt: now - 1000
  };

  it("returns 0 when failure count is 0", () => {
    expect(
      getFreshRetryableFailureCount(
        { isOpen: false, consecutiveRetryableFailures: 0 },
        now,
        30_000
      )
    ).toBe(0);
  });

  it("returns raw count when circuit is open regardless of freshness", () => {
    expect(
      getFreshRetryableFailureCount(
        { isOpen: true, consecutiveRetryableFailures: 5 },
        now,
        30_000
      )
    ).toBe(5);
  });

  it("returns raw count when circuit is half-open", () => {
    expect(
      getFreshRetryableFailureCount(
        {
          isOpen: false,
          isHalfOpen: true,
          consecutiveRetryableFailures: 3
        },
        now,
        30_000
      )
    ).toBe(3);
  });

  it("returns count when failure is within freshness window", () => {
    expect(getFreshRetryableFailureCount(healthy, now, 30_000)).toBe(2);
  });

  it("returns 0 when failure is outside freshness window", () => {
    expect(getFreshRetryableFailureCount(healthy, now, 500)).toBe(0);
  });
});

describe("getFreshSmoothedLatency", () => {
  it("returns Infinity when no latency data", () => {
    expect(
      getFreshSmoothedLatency(
        { isOpen: false, consecutiveRetryableFailures: 0 },
        now,
        30_000
      )
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it("returns smoothed latency when available and fresh", () => {
    expect(
      getFreshSmoothedLatency(
        {
          isOpen: false,
          consecutiveRetryableFailures: 0,
          smoothedSuccessLatencyMs: 120,
          lastSuccessAt: now - 1000
        },
        now,
        30_000
      )
    ).toBe(120);
  });

  it("falls back to last latency when smoothed is not available", () => {
    expect(
      getFreshSmoothedLatency(
        {
          isOpen: false,
          consecutiveRetryableFailures: 0,
          lastSuccessLatencyMs: 200,
          lastSuccessAt: now - 1000
        },
        now,
        30_000
      )
    ).toBe(200);
  });

  it("returns Infinity when data is stale", () => {
    expect(
      getFreshSmoothedLatency(
        {
          isOpen: false,
          consecutiveRetryableFailures: 0,
          smoothedSuccessLatencyMs: 100,
          lastSuccessAt: now - 60_000
        },
        now,
        30_000
      )
    ).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("getSlidingWindowErrorRate", () => {
  it("returns 0 when no attempts recorded", () => {
    expect(
      getSlidingWindowErrorRate({
        isOpen: false,
        consecutiveRetryableFailures: 0
      })
    ).toBe(0);
  });

  it("computes error rate from windowed data", () => {
    expect(
      getSlidingWindowErrorRate({
        isOpen: false,
        consecutiveRetryableFailures: 0,
        windowedTotalAttempts: 20,
        windowedFailures: 5
      })
    ).toBe(0.25);
  });

  it("returns 1 for 100% error rate", () => {
    expect(
      getSlidingWindowErrorRate({
        isOpen: false,
        consecutiveRetryableFailures: 0,
        windowedTotalAttempts: 10,
        windowedFailures: 10
      })
    ).toBe(1);
  });
});

describe("getRecoveryScore", () => {
  it("returns 2 for fully healthy target", () => {
    expect(
      getRecoveryScore({
        isOpen: false,
        consecutiveRetryableFailures: 0
      })
    ).toBe(2);
  });

  it("returns 0 for half-open target", () => {
    expect(
      getRecoveryScore({
        isOpen: false,
        isHalfOpen: true,
        consecutiveRetryableFailures: 1
      })
    ).toBe(0);
  });

  it("returns 1 for target with 1 recovery success", () => {
    expect(
      getRecoveryScore({
        isOpen: false,
        consecutiveRetryableFailures: 0,
        recoverySuccessCount: 1
      })
    ).toBe(1);
  });

  it("returns 2 for target with 2+ recovery successes", () => {
    expect(
      getRecoveryScore({
        isOpen: false,
        consecutiveRetryableFailures: 0,
        recoverySuccessCount: 3
      })
    ).toBe(2);
  });
});

describe("getFreshObservedTokenCostMultiplier", () => {
  const healthMap = new Map<string, ProviderTargetHealthSnapshot>([
    [
      "target_a",
      {
        isOpen: false,
        consecutiveRetryableFailures: 0,
        smoothedSuccessTotalTokens: 500,
        lastUsageObservedAt: now - 1000
      }
    ]
  ]);

  it("returns undefined for unknown target", () => {
    expect(
      getFreshObservedTokenCostMultiplier("unknown", now, healthMap, 30_000)
    ).toBeUndefined();
  });

  it("returns multiplier for fresh data", () => {
    expect(
      getFreshObservedTokenCostMultiplier("target_a", now, healthMap, 30_000)
    ).toBe(500);
  });

  it("returns undefined for stale data", () => {
    expect(
      getFreshObservedTokenCostMultiplier("target_a", now, healthMap, 500)
    ).toBeUndefined();
  });
});

describe("adjustWeightForFailures", () => {
  it("returns 0 for open circuit", () => {
    expect(
      adjustWeightForFailures(
        10,
        { isOpen: true, consecutiveRetryableFailures: 2 },
        now,
        30_000
      )
    ).toBe(0);
  });

  it("reduces weight by fresh failure count", () => {
    expect(
      adjustWeightForFailures(
        10,
        {
          isOpen: false,
          consecutiveRetryableFailures: 3,
          lastFailureAt: now - 1000
        },
        now,
        30_000
      )
    ).toBe(7);
  });

  it("returns 0 when failures exceed weight", () => {
    expect(
      adjustWeightForFailures(
        2,
        {
          isOpen: false,
          consecutiveRetryableFailures: 5,
          lastFailureAt: now - 1000
        },
        now,
        30_000
      )
    ).toBe(0);
  });
});

const defaultWindows = {
  latencyFreshnessMs: 30_000,
  costFreshnessMs: 30_000,
  failureFreshnessMs: 30_000,
  recoveryWindowMs: 30_000
};

describe("computeHierarchicalHealthScore", () => {
  it("returns tier 0 for open circuit", () => {
    const score = computeHierarchicalHealthScore(
      { isOpen: true, consecutiveRetryableFailures: 5 },
      now,
      defaultWindows
    );
    expect(score.tier).toBe(0);
    expect(score.subScore).toBe(0);
  });

  it("returns tier 1 for half-open circuit", () => {
    const score = computeHierarchicalHealthScore(
      { isOpen: false, isHalfOpen: true, consecutiveRetryableFailures: 3 },
      now,
      defaultWindows
    );
    expect(score.tier).toBe(1);
    expect(score.subScore).toBe(0.5);
  });

  it("returns tier 2 for degraded target with fresh failures", () => {
    const score = computeHierarchicalHealthScore(
      {
        isOpen: false,
        consecutiveRetryableFailures: 2,
        lastFailureAt: now - 1000
      },
      now,
      defaultWindows
    );
    expect(score.tier).toBe(2);
    expect(score.subScore).toBeCloseTo(1 / 3);
  });

  it("returns tier 2 subScore approaching 1 for single failure", () => {
    const score = computeHierarchicalHealthScore(
      {
        isOpen: false,
        consecutiveRetryableFailures: 1,
        lastFailureAt: now - 1000
      },
      now,
      defaultWindows
    );
    expect(score.tier).toBe(2);
    expect(score.subScore).toBeCloseTo(0.5);
  });

  it("returns tier 3 for recovering target with 0 successes", () => {
    const score = computeHierarchicalHealthScore(
      {
        isOpen: false,
        consecutiveRetryableFailures: 0,
        recoverySuccessCount: 0
      },
      now,
      defaultWindows
    );
    expect(score.tier).toBe(3);
    expect(score.subScore).toBe(0);
  });

  it("returns tier 3 for recovering target with 1 success", () => {
    const score = computeHierarchicalHealthScore(
      {
        isOpen: false,
        consecutiveRetryableFailures: 0,
        recoverySuccessCount: 1
      },
      now,
      defaultWindows
    );
    expect(score.tier).toBe(3);
    expect(score.subScore).toBe(0.5);
  });

  it("returns tier 4 for fully healthy target", () => {
    const score = computeHierarchicalHealthScore(
      {
        isOpen: false,
        consecutiveRetryableFailures: 0,
        smoothedSuccessLatencyMs: 100,
        lastSuccessAt: now - 1000
      },
      now,
      defaultWindows
    );
    expect(score.tier).toBe(4);
    expect(score.subScore).toBe(1); // fresh latency, no error rate, no SLO
  });

  it("penalizes healthy tier with stale latency data", () => {
    const score = computeHierarchicalHealthScore(
      {
        isOpen: false,
        consecutiveRetryableFailures: 0,
        smoothedSuccessLatencyMs: 100,
        lastSuccessAt: now - 60_000
      },
      now,
      defaultWindows
    );
    expect(score.tier).toBe(4);
    // errorRateFactor=1 (no data), latencyFactor=0.5 (stale)
    expect(score.subScore).toBeCloseTo(1 * 0.4 + 0.5 * 0.6);
  });

  it("penalizes healthy tier with high error rate", () => {
    const score = computeHierarchicalHealthScore(
      {
        isOpen: false,
        consecutiveRetryableFailures: 0,
        smoothedSuccessLatencyMs: 100,
        lastSuccessAt: now - 1000,
        windowedTotalAttempts: 10,
        windowedFailures: 5
      },
      now,
      defaultWindows
    );
    expect(score.tier).toBe(4);
    // errorRateFactor=0.5, latencyFactor=1 (fresh, no SLO)
    expect(score.subScore).toBeCloseTo(0.5 * 0.4 + 1 * 0.6);
  });

  it("penalizes healthy tier for exceeding latency SLO", () => {
    const score = computeHierarchicalHealthScore(
      {
        isOpen: false,
        consecutiveRetryableFailures: 0,
        smoothedSuccessLatencyMs: 300,
        lastSuccessAt: now - 1000
      },
      now,
      defaultWindows,
      200 // SLO = 200ms
    );
    expect(score.tier).toBe(4);
    // errorRateFactor=1, latencyFactor=max(0, 1-(300-200)/200) = max(0, 0.5) = 0.5
    expect(score.subScore).toBeCloseTo(1 * 0.4 + 0.5 * 0.6);
  });

  it("rewards healthy tier for being within latency SLO", () => {
    const score = computeHierarchicalHealthScore(
      {
        isOpen: false,
        consecutiveRetryableFailures: 0,
        smoothedSuccessLatencyMs: 100,
        lastSuccessAt: now - 1000
      },
      now,
      defaultWindows,
      200 // SLO = 200ms
    );
    expect(score.tier).toBe(4);
    // errorRateFactor=1, latencyFactor=max(0, 1-(100-200)/200) = max(0, 1.5) capped by Math.min(1,...)
    expect(score.subScore).toBe(1);
  });

  it("skips degraded tier when failures are stale", () => {
    const score = computeHierarchicalHealthScore(
      {
        isOpen: false,
        consecutiveRetryableFailures: 3,
        lastFailureAt: now - 60_000
      },
      now,
      defaultWindows
    );
    // Failures outside freshness window → treated as no failures → healthy tier
    expect(score.tier).toBe(4);
  });
});

describe("compareHierarchicalHealthScores", () => {
  it("higher tier wins", () => {
    const left = { tier: 3, subScore: 0 };
    const right = { tier: 4, subScore: 0.9 };
    expect(compareHierarchicalHealthScores(left, right)).toBeGreaterThan(0);
  });

  it("lower tier loses", () => {
    const left = { tier: 1, subScore: 0.5 };
    const right = { tier: 2, subScore: 0.1 };
    expect(compareHierarchicalHealthScores(left, right)).toBeGreaterThan(0);
  });

  it("same tier: higher subScore wins", () => {
    const left = { tier: 4, subScore: 0.3 };
    const right = { tier: 4, subScore: 0.8 };
    expect(compareHierarchicalHealthScores(left, right)).toBeGreaterThan(0);
  });

  it("identical scores return 0", () => {
    const left = { tier: 3, subScore: 0.5 };
    const right = { tier: 3, subScore: 0.5 };
    expect(compareHierarchicalHealthScores(left, right)).toBe(0);
  });
});
