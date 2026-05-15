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
    expect(snapshot.isHalfOpen).toBe(false);
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
      isOpen: true,
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
          isOpen: true,
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
        isOpen: true,
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
