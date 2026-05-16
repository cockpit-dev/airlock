import { describe, it, expect } from "vitest";
import {
  compareTargetsByHealthPriority,
  compareTargetsByLowestCost,
  compareTargetsByPriority,
  compareByOriginalRouteOrder,
  compareTargetsByAffinity,
  computeAffinityByTarget,
  computeAdjustedWeight,
  getDefaultHealthSnapshot,
  getHealthForTarget,
  getPriorityLatencyStatus,
  getPriorityLatencyDeltaRatio,
  getPriorityEffectiveCost,
  getPriorityRecoveryPenalty,
  getTargetHealthScore,
  compareTargetsByHealthScore,
  type RoutingScoringContext
} from "./routing-strategy-comparators.js";
import type { ProviderTargetHealthSnapshot } from "./provider-target-health.js";

const defaultWindows = {
  latencyFreshnessMs: 30_000,
  costFreshnessMs: 30_000,
  failureFreshnessMs: 30_000,
  recoveryWindowMs: 30_000
};

function makeCtx(
  overrides: Partial<RoutingScoringContext> = {}
): RoutingScoringContext {
  return {
    now: 10_000,
    healthByTarget: new Map(),
    windows: defaultWindows,
    originalOrder: new Map([
      ["a", 0],
      ["b", 1],
      ["c", 2]
    ]),
    ...overrides
  };
}

function makeHealth(
  overrides: Partial<ProviderTargetHealthSnapshot> = {}
): ProviderTargetHealthSnapshot {
  return {
    isOpen: false,
    consecutiveRetryableFailures: 0,
    ...overrides
  };
}

// ── getDefaultHealthSnapshot ───────────────────────────────────────────

describe("getDefaultHealthSnapshot", () => {
  it("returns a closed snapshot with zero failures", () => {
    const snap = getDefaultHealthSnapshot();
    expect(snap.isOpen).toBe(false);
    expect(snap.consecutiveRetryableFailures).toBe(0);
    expect(snap.isHalfOpen).toBeUndefined();
  });
});

// ── getHealthForTarget ─────────────────────────────────────────────────

describe("getHealthForTarget", () => {
  it("returns recorded health for a known target", () => {
    const health = makeHealth({ isOpen: true });
    const ctx = makeCtx({
      healthByTarget: new Map([["a", health]])
    });
    expect(getHealthForTarget("a", ctx.healthByTarget)).toBe(health);
  });

  it("returns default snapshot for unknown target", () => {
    const ctx = makeCtx();
    const snap = getHealthForTarget("unknown", ctx.healthByTarget);
    expect(snap.isOpen).toBe(false);
    expect(snap.consecutiveRetryableFailures).toBe(0);
  });
});

// ── compareByOriginalRouteOrder ────────────────────────────────────────

describe("compareByOriginalRouteOrder", () => {
  const order = new Map([
    ["a", 0],
    ["b", 1],
    ["c", 2]
  ]);

  it("orders by configured index", () => {
    expect(compareByOriginalRouteOrder("a", "b", order)).toBeLessThan(0);
    expect(compareByOriginalRouteOrder("c", "a", order)).toBeGreaterThan(0);
    expect(compareByOriginalRouteOrder("a", "a", order)).toBe(0);
  });

  it("falls back to lexical when one key is absent", () => {
    const partial = new Map([["a", 0]]);
    expect(compareByOriginalRouteOrder("a", "z", partial)).toBeLessThan(0);
  });
});

// ── compareTargetsByHealthPriority ─────────────────────────────────────

describe("compareTargetsByHealthPriority", () => {
  it("prefers non-open over open", () => {
    const ctx = makeCtx({
      healthByTarget: new Map([
        ["a", makeHealth({ isOpen: true })],
        ["b", makeHealth({ isOpen: false })]
      ])
    });
    expect(compareTargetsByHealthPriority("a", "b", ctx)).toBeGreaterThan(0);
  });

  it("prefers non-half-open over half-open", () => {
    const ctx = makeCtx({
      healthByTarget: new Map([
        ["a", makeHealth({ isHalfOpen: true })],
        ["b", makeHealth({ isOpen: false })]
      ])
    });
    expect(compareTargetsByHealthPriority("a", "b", ctx)).toBeGreaterThan(0);
  });

  it("prefers fewer fresh failures", () => {
    const ctx = makeCtx({
      healthByTarget: new Map([
        [
          "a",
          makeHealth({ consecutiveRetryableFailures: 5, lastFailureAt: 9000 })
        ],
        [
          "b",
          makeHealth({ consecutiveRetryableFailures: 1, lastFailureAt: 9000 })
        ]
      ])
    });
    expect(compareTargetsByHealthPriority("a", "b", ctx)).toBeGreaterThan(0);
  });

  it("prefers lower latency", () => {
    const ctx = makeCtx({
      healthByTarget: new Map([
        [
          "a",
          makeHealth({ smoothedSuccessLatencyMs: 200, lastSuccessAt: 9000 })
        ],
        [
          "b",
          makeHealth({ smoothedSuccessLatencyMs: 100, lastSuccessAt: 9000 })
        ]
      ])
    });
    expect(compareTargetsByHealthPriority("a", "b", ctx)).toBeGreaterThan(0);
  });

  it("falls back to original route order", () => {
    const ctx = makeCtx({
      healthByTarget: new Map([
        ["a", makeHealth()],
        ["b", makeHealth()]
      ])
    });
    expect(compareTargetsByHealthPriority("a", "b", ctx)).toBeLessThan(0);
  });
});

// ── compareTargetsByLowestCost ─────────────────────────────────────────

describe("compareTargetsByLowestCost", () => {
  const costs = { a: 2, b: 1 };

  it("prefers non-half-open over half-open", () => {
    const ctx = makeCtx({
      healthByTarget: new Map([
        ["a", makeHealth({ isHalfOpen: true })],
        ["b", makeHealth({ isOpen: false })]
      ])
    });
    expect(compareTargetsByLowestCost("a", "b", ctx, costs)).toBeGreaterThan(0);
  });

  it("prefers fewer fresh failures", () => {
    const ctx = makeCtx({
      healthByTarget: new Map([
        [
          "a",
          makeHealth({ consecutiveRetryableFailures: 3, lastFailureAt: 9000 })
        ],
        [
          "b",
          makeHealth({ consecutiveRetryableFailures: 0, lastFailureAt: 9000 })
        ]
      ])
    });
    expect(compareTargetsByLowestCost("a", "b", ctx, costs)).toBeGreaterThan(0);
  });

  it("prefers lower configured cost", () => {
    const ctx = makeCtx({
      healthByTarget: new Map([
        ["a", makeHealth()],
        ["b", makeHealth()]
      ])
    });
    expect(compareTargetsByLowestCost("a", "b", ctx, costs)).toBeGreaterThan(0);
  });

  it("factors in observed token cost multiplier", () => {
    const ctx = makeCtx({
      healthByTarget: new Map([
        [
          "a",
          makeHealth({
            smoothedSuccessTotalTokens: 100,
            lastUsageObservedAt: 9000
          })
        ],
        [
          "b",
          makeHealth({
            smoothedSuccessTotalTokens: 50,
            lastUsageObservedAt: 9000
          })
        ]
      ])
    });
    // a: configured 2 × observed 100 = 200, b: configured 1 × observed 50 = 50
    expect(compareTargetsByLowestCost("a", "b", ctx, costs)).toBeGreaterThan(0);
  });

  it("falls back to original route order when cost is equal", () => {
    const equalCosts = { a: 1, b: 1 };
    const ctx = makeCtx({
      healthByTarget: new Map([
        ["a", makeHealth()],
        ["b", makeHealth()]
      ])
    });
    expect(compareTargetsByLowestCost("a", "b", ctx, equalCosts)).toBeLessThan(
      0
    );
  });
});

// ── getPriorityLatencyStatus ───────────────────────────────────────────

describe("getPriorityLatencyStatus", () => {
  it("returns 1 when no SLO is defined", () => {
    expect(
      getPriorityLatencyStatus("a", undefined, 10_000, new Map(), 30_000)
    ).toBe(1);
  });

  it("returns 1 when no latency data is available", () => {
    expect(
      getPriorityLatencyStatus("a", { a: 200 }, 10_000, new Map(), 30_000)
    ).toBe(1);
  });

  it("returns 0 when within SLO", () => {
    const health = makeHealth({
      smoothedSuccessLatencyMs: 150,
      lastSuccessAt: 9000
    });
    expect(
      getPriorityLatencyStatus(
        "a",
        { a: 200 },
        10_000,
        new Map([["a", health]]),
        30_000
      )
    ).toBe(0);
  });

  it("returns 2 when exceeding SLO", () => {
    const health = makeHealth({
      smoothedSuccessLatencyMs: 300,
      lastSuccessAt: 9000
    });
    expect(
      getPriorityLatencyStatus(
        "a",
        { a: 200 },
        10_000,
        new Map([["a", health]]),
        30_000
      )
    ).toBe(2);
  });

  it("returns 1 when latency data is stale", () => {
    const health = makeHealth({
      smoothedSuccessLatencyMs: 150,
      lastSuccessAt: 1000 // stale
    });
    expect(
      getPriorityLatencyStatus(
        "a",
        { a: 200 },
        10_000,
        new Map([["a", health]]),
        5000
      )
    ).toBe(1);
  });
});

// ── getPriorityLatencyDeltaRatio ───────────────────────────────────────

describe("getPriorityLatencyDeltaRatio", () => {
  it("returns undefined when no SLO is defined", () => {
    expect(
      getPriorityLatencyDeltaRatio("a", undefined, 10_000, new Map(), 30_000)
    ).toBeUndefined();
  });

  it("returns positive ratio when over SLO", () => {
    const health = makeHealth({
      smoothedSuccessLatencyMs: 250,
      lastSuccessAt: 9000
    });
    expect(
      getPriorityLatencyDeltaRatio(
        "a",
        { a: 200 },
        10_000,
        new Map([["a", health]]),
        30_000
      )
    ).toBeCloseTo(0.25);
  });

  it("returns negative ratio when under SLO", () => {
    const health = makeHealth({
      smoothedSuccessLatencyMs: 100,
      lastSuccessAt: 9000
    });
    expect(
      getPriorityLatencyDeltaRatio(
        "a",
        { a: 200 },
        10_000,
        new Map([["a", health]]),
        30_000
      )
    ).toBeCloseTo(-0.5);
  });
});

// ── getPriorityEffectiveCost ───────────────────────────────────────────

describe("getPriorityEffectiveCost", () => {
  it("returns undefined when no configured cost", () => {
    expect(
      getPriorityEffectiveCost("a", undefined, 10_000, new Map(), 30_000)
    ).toBeUndefined();
  });

  it("returns configured cost without observed data", () => {
    expect(
      getPriorityEffectiveCost("a", { a: 5 }, 10_000, new Map(), 30_000)
    ).toBe(5);
  });

  it("combines configured cost with observed multiplier", () => {
    const health = makeHealth({
      smoothedSuccessTotalTokens: 3,
      lastUsageObservedAt: 9000
    });
    expect(
      getPriorityEffectiveCost(
        "a",
        { a: 2 },
        10_000,
        new Map([["a", health]]),
        30_000
      )
    ).toBe(6);
  });
});

// ── getPriorityRecoveryPenalty ──────────────────────────────────────────

describe("getPriorityRecoveryPenalty", () => {
  it("returns 0 when no failure recorded", () => {
    expect(getPriorityRecoveryPenalty({}, 10_000, 30_000)).toBe(0);
  });

  it("returns 2 for recent failure without success", () => {
    expect(
      getPriorityRecoveryPenalty({ lastFailureAt: 8000 }, 10_000, 30_000)
    ).toBe(2);
  });

  it("returns 0 for old failure without success", () => {
    expect(
      getPriorityRecoveryPenalty({ lastFailureAt: 1000 }, 50_000, 30_000)
    ).toBe(0);
  });

  it("returns 1 for recent recovery", () => {
    expect(
      getPriorityRecoveryPenalty(
        { lastFailureAt: 8000, lastSuccessAt: 8500 },
        10_000,
        30_000
      )
    ).toBe(1);
  });

  it("returns 0 when recovery is old", () => {
    expect(
      getPriorityRecoveryPenalty(
        { lastFailureAt: 1000, lastSuccessAt: 2000 },
        50_000,
        30_000
      )
    ).toBe(0);
  });
});

// ── compareTargetsByPriority ───────────────────────────────────────────

describe("compareTargetsByPriority", () => {
  it("prefers non-open over open", () => {
    const ctx = makeCtx({
      healthByTarget: new Map([
        ["a", makeHealth({ isOpen: true })],
        ["b", makeHealth({ isOpen: false })]
      ])
    });
    expect(compareTargetsByPriority("a", "b", ctx, {})).toBeGreaterThan(0);
  });

  it("prefers higher recovery score", () => {
    const ctx = makeCtx({
      healthByTarget: new Map([
        ["a", makeHealth({ recoverySuccessCount: 0, isHalfOpen: true })],
        ["b", makeHealth({ recoverySuccessCount: 2 })]
      ])
    });
    expect(compareTargetsByPriority("a", "b", ctx, {})).toBeGreaterThan(0);
  });

  it("prefers lower error rate", () => {
    const ctx = makeCtx({
      healthByTarget: new Map([
        ["a", makeHealth({ windowedTotalAttempts: 10, windowedFailures: 5 })],
        ["b", makeHealth({ windowedTotalAttempts: 10, windowedFailures: 1 })]
      ])
    });
    expect(compareTargetsByPriority("a", "b", ctx, {})).toBeGreaterThan(0);
  });

  it("prefers better latency SLO status", () => {
    const ctx = makeCtx({
      healthByTarget: new Map([
        [
          "a",
          makeHealth({ smoothedSuccessLatencyMs: 300, lastSuccessAt: 9000 })
        ],
        [
          "b",
          makeHealth({ smoothedSuccessLatencyMs: 100, lastSuccessAt: 9000 })
        ]
      ])
    });
    expect(
      compareTargetsByPriority("a", "b", ctx, {
        latencySloMs: { a: 200, b: 200 }
      })
    ).toBeGreaterThan(0);
  });

  it("prefers lower effective cost", () => {
    const ctx = makeCtx({
      healthByTarget: new Map([
        ["a", makeHealth()],
        ["b", makeHealth()]
      ])
    });
    expect(
      compareTargetsByPriority("a", "b", ctx, { costs: { a: 5, b: 1 } })
    ).toBeGreaterThan(0);
  });

  it("falls back to original route order when all signals equal", () => {
    const ctx = makeCtx({
      healthByTarget: new Map([
        ["a", makeHealth()],
        ["b", makeHealth()]
      ])
    });
    expect(compareTargetsByPriority("a", "b", ctx, {})).toBeLessThan(0);
  });
});

// ── computeAdjustedWeight ──────────────────────────────────────────────

describe("computeAdjustedWeight", () => {
  it("returns 0 for open targets", () => {
    const ctx = makeCtx({
      healthByTarget: new Map([["a", makeHealth({ isOpen: true })]])
    });
    expect(computeAdjustedWeight(10, "a", ctx)).toBe(0);
  });

  it("reduces weight by fresh failure count", () => {
    const ctx = makeCtx({
      healthByTarget: new Map([
        [
          "a",
          makeHealth({ consecutiveRetryableFailures: 3, lastFailureAt: 9000 })
        ]
      ])
    });
    expect(computeAdjustedWeight(10, "a", ctx)).toBe(7);
  });

  it("does not reduce below 0", () => {
    const ctx = makeCtx({
      healthByTarget: new Map([
        [
          "a",
          makeHealth({ consecutiveRetryableFailures: 20, lastFailureAt: 9000 })
        ]
      ])
    });
    expect(computeAdjustedWeight(5, "a", ctx)).toBe(0);
  });

  it("returns raw weight for healthy target", () => {
    const ctx = makeCtx({
      healthByTarget: new Map([["a", makeHealth()]])
    });
    expect(computeAdjustedWeight(10, "a", ctx)).toBe(10);
  });
});

// ── getTargetHealthScore ────────────────────────────────────────────────

describe("getTargetHealthScore", () => {
  it("returns tier 0 for open target", () => {
    const ctx = makeCtx({
      healthByTarget: new Map([["a", makeHealth({ isOpen: true })]])
    });
    const score = getTargetHealthScore("a", ctx);
    expect(score.tier).toBe(0);
  });

  it("returns tier 4 for healthy target with default health", () => {
    const ctx = makeCtx({
      healthByTarget: new Map([["a", makeHealth()]])
    });
    const score = getTargetHealthScore("a", ctx);
    expect(score.tier).toBe(4);
  });

  it("uses latency SLO from provided map", () => {
    const ctx = makeCtx({
      healthByTarget: new Map([
        [
          "a",
          makeHealth({
            smoothedSuccessLatencyMs: 300,
            lastSuccessAt: 9000
          })
        ]
      ])
    });
    const score = getTargetHealthScore("a", ctx, { a: 200 });
    expect(score.tier).toBe(4);
    // Exceeding SLO → subScore < 1
    expect(score.subScore).toBeLessThan(1);
  });

  it("returns tier 4 for unknown target (default health)", () => {
    const ctx = makeCtx();
    const score = getTargetHealthScore("unknown", ctx);
    expect(score.tier).toBe(4);
  });
});

// ── compareTargetsByHealthScore ─────────────────────────────────────────

describe("compareTargetsByHealthScore", () => {
  it("prefers healthy over open", () => {
    const ctx = makeCtx({
      healthByTarget: new Map([
        ["a", makeHealth({ isOpen: true })],
        ["b", makeHealth()]
      ])
    });
    expect(compareTargetsByHealthScore("a", "b", ctx)).toBeGreaterThan(0);
  });

  it("prefers healthy over degraded", () => {
    const ctx = makeCtx({
      healthByTarget: new Map([
        [
          "a",
          makeHealth({ consecutiveRetryableFailures: 3, lastFailureAt: 9000 })
        ],
        ["b", makeHealth()]
      ])
    });
    expect(compareTargetsByHealthScore("a", "b", ctx)).toBeGreaterThan(0);
  });

  it("prefers degraded over half-open", () => {
    const ctx = makeCtx({
      healthByTarget: new Map([
        [
          "a",
          makeHealth({ isHalfOpen: true, consecutiveRetryableFailures: 1 })
        ],
        [
          "b",
          makeHealth({ consecutiveRetryableFailures: 1, lastFailureAt: 9000 })
        ]
      ])
    });
    expect(compareTargetsByHealthScore("a", "b", ctx)).toBeGreaterThan(0);
  });

  it("prefers fewer failures within degraded tier", () => {
    const ctx = makeCtx({
      healthByTarget: new Map([
        [
          "a",
          makeHealth({ consecutiveRetryableFailures: 5, lastFailureAt: 9000 })
        ],
        [
          "b",
          makeHealth({ consecutiveRetryableFailures: 1, lastFailureAt: 9000 })
        ]
      ])
    });
    // Both tier 2, but b has fewer failures → higher subScore
    expect(compareTargetsByHealthScore("a", "b", ctx)).toBeGreaterThan(0);
  });

  it("prefers lower latency within healthy tier", () => {
    const ctx = makeCtx({
      healthByTarget: new Map([
        [
          "a",
          makeHealth({ smoothedSuccessLatencyMs: 300, lastSuccessAt: 9000 })
        ],
        [
          "b",
          makeHealth({ smoothedSuccessLatencyMs: 100, lastSuccessAt: 9000 })
        ]
      ])
    });
    expect(
      compareTargetsByHealthScore("a", "b", ctx, { a: 200, b: 200 })
    ).toBeGreaterThan(0);
  });

  it("falls back to route order when scores are equal", () => {
    const ctx = makeCtx({
      healthByTarget: new Map([
        ["a", makeHealth()],
        ["b", makeHealth()]
      ])
    });
    expect(compareTargetsByHealthScore("a", "b", ctx)).toBeLessThan(0);
  });
});

// ── computeAffinityByTarget ──────────────────────────────────────────

describe("computeAffinityByTarget", () => {
  it("returns undefined when no affinity config is provided", () => {
    const result = computeAffinityByTarget(
      {
        streaming: true,
        toolUse: false,
        structuredOutput: false,
        reasoning: false,
        multiTurn: false
      },
      undefined,
      ["a", "b"]
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined when no request class flags match config", () => {
    const result = computeAffinityByTarget(
      {
        streaming: false,
        toolUse: false,
        structuredOutput: false,
        reasoning: false,
        multiTurn: false
      },
      { streaming: { preferredTargets: ["a"] } },
      ["a", "b"]
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined when config has empty preferred/avoided lists", () => {
    const result = computeAffinityByTarget(
      {
        streaming: true,
        toolUse: false,
        structuredOutput: false,
        reasoning: false,
        multiTurn: false
      },
      { streaming: { preferredTargets: [], avoidedTargets: [] } },
      ["a", "b"]
    );
    expect(result).toBeUndefined();
  });

  it("applies -1 for preferred targets on active class", () => {
    const result = computeAffinityByTarget(
      {
        streaming: true,
        toolUse: false,
        structuredOutput: false,
        reasoning: false,
        multiTurn: false
      },
      { streaming: { preferredTargets: ["a"] } },
      ["a", "b"]
    );
    expect(result).not.toBeUndefined();
    expect(result!.get("a")).toBe(-1);
    expect(result!.has("b")).toBe(false);
  });

  it("applies +1 for avoided targets on active class", () => {
    const result = computeAffinityByTarget(
      {
        streaming: true,
        toolUse: false,
        structuredOutput: false,
        reasoning: false,
        multiTurn: false
      },
      { streaming: { avoidedTargets: ["b"] } },
      ["a", "b"]
    );
    expect(result).not.toBeUndefined();
    expect(result!.get("b")).toBe(1);
    expect(result!.has("a")).toBe(false);
  });

  it("accumulates adjustments across multiple active classes", () => {
    const result = computeAffinityByTarget(
      {
        streaming: true,
        toolUse: true,
        structuredOutput: false,
        reasoning: false,
        multiTurn: false
      },
      {
        streaming: { preferredTargets: ["a"] },
        toolUse: { preferredTargets: ["a"], avoidedTargets: ["b"] }
      },
      ["a", "b"]
    );
    expect(result).not.toBeUndefined();
    expect(result!.get("a")).toBe(-2);
    expect(result!.get("b")).toBe(1);
  });

  it("ignores affinity config for inactive request classes", () => {
    const result = computeAffinityByTarget(
      {
        streaming: false,
        toolUse: true,
        structuredOutput: false,
        reasoning: false,
        multiTurn: false
      },
      {
        streaming: { preferredTargets: ["a"] },
        toolUse: { preferredTargets: ["b"] }
      },
      ["a", "b"]
    );
    expect(result).not.toBeUndefined();
    expect(result!.has("a")).toBe(false);
    expect(result!.get("b")).toBe(-1);
  });
});

// ── compareTargetsByAffinity ──────────────────────────────────────────

describe("compareTargetsByAffinity", () => {
  it("returns 0 when no affinity map is present", () => {
    const ctx = makeCtx();
    expect(compareTargetsByAffinity("a", "b", ctx)).toBe(0);
  });

  it("prefers target with lower affinity (negative = preferred)", () => {
    const ctx = makeCtx({
      affinityByTarget: new Map([
        ["a", -1],
        ["b", 0]
      ])
    });
    expect(compareTargetsByAffinity("a", "b", ctx)).toBeLessThan(0);
  });

  it("avoids target with higher affinity (positive = avoided)", () => {
    const ctx = makeCtx({
      affinityByTarget: new Map([
        ["a", 0],
        ["b", 1]
      ])
    });
    expect(compareTargetsByAffinity("a", "b", ctx)).toBeLessThan(0);
  });

  it("returns 0 for equal adjustments", () => {
    const ctx = makeCtx({
      affinityByTarget: new Map([
        ["a", -1],
        ["b", -1]
      ])
    });
    expect(compareTargetsByAffinity("a", "b", ctx)).toBe(0);
  });

  it("treats missing targets as 0", () => {
    const ctx = makeCtx({
      affinityByTarget: new Map([["a", -1]])
    });
    expect(compareTargetsByAffinity("a", "c", ctx)).toBeLessThan(0);
    expect(compareTargetsByAffinity("c", "a", ctx)).toBeGreaterThan(0);
  });
});
