import type {
  ProviderTargetHealthSnapshot,
  RoutingFreshnessWindows,
  HierarchicalHealthScore
} from "./provider-target-health.js";
import {
  getFreshRetryableFailureCount,
  getFreshSmoothedLatency,
  getSlidingWindowErrorRate,
  getRecoveryScore,
  getFreshObservedTokenCostMultiplier,
  adjustWeightForFailures,
  computeHierarchicalHealthScore,
  compareHierarchicalHealthScores
} from "./provider-target-health.js";

/**
 * Context passed to all routing strategy comparators, decoupling
 * scoring logic from gateway runtime concerns (target serialization,
 * route metadata, etc.).
 */
export interface RoutingScoringContext {
  now: number;
  healthByTarget: ReadonlyMap<string, ProviderTargetHealthSnapshot>;
  windows: RoutingFreshnessWindows;
  originalOrder: ReadonlyMap<string, number>;
  /**
   * Per-target affinity adjustment derived from request class.
   * Negative = preferred, positive = avoided, 0 = neutral.
   * When absent, no affinity signal is applied.
   */
  affinityByTarget?: ReadonlyMap<string, number>;
}

/**
 * Resolves the default health snapshot used when a target has no
 * recorded circuit state.
 */
export function getDefaultHealthSnapshot(): ProviderTargetHealthSnapshot {
  return { isOpen: false, consecutiveRetryableFailures: 0 };
}

/**
 * Retrieves a target's health snapshot, falling back to a default
 * when no state has been recorded.
 */
export function getHealthForTarget(
  targetKey: string,
  healthByTarget: ReadonlyMap<string, ProviderTargetHealthSnapshot>
): ProviderTargetHealthSnapshot {
  return healthByTarget.get(targetKey) ?? getDefaultHealthSnapshot();
}

/**
 * Compares two target keys by their original route ordering.
 * Falls back to lexical comparison when either key is absent.
 */
export function compareByOriginalRouteOrder(
  leftKey: string,
  rightKey: string,
  originalOrder: ReadonlyMap<string, number>
): number {
  const leftIndex = originalOrder.get(leftKey);
  const rightIndex = originalOrder.get(rightKey);

  if (
    leftIndex !== undefined &&
    rightIndex !== undefined &&
    leftIndex !== rightIndex
  ) {
    return leftIndex - rightIndex;
  }

  return leftKey.localeCompare(rightKey);
}

/**
 * Compares two targets by request-class affinity adjustment.
 * Returns <0 if left is preferred over right, >0 if right is preferred.
 * Returns 0 when no affinity signal is present or adjustments are equal.
 */
export function compareTargetsByAffinity(
  leftKey: string,
  rightKey: string,
  ctx: RoutingScoringContext
): number {
  if (!ctx.affinityByTarget) {
    return 0;
  }

  const leftAffinity = ctx.affinityByTarget.get(leftKey) ?? 0;
  const rightAffinity = ctx.affinityByTarget.get(rightKey) ?? 0;

  return leftAffinity - rightAffinity;
}

/**
 * Request-class flags used for affinity computation.
 * Mirrors the canonical RequestClass interface to avoid
 * a cross-package dependency on @airlock/canonical.
 */
export interface RequestClassFlags {
  streaming: boolean;
  toolUse: boolean;
  structuredOutput: boolean;
  reasoning: boolean;
  multiTurn: boolean;
}

/**
 * Per-request-class affinity configuration for a single class dimension.
 */
export interface RequestClassTargetAffinity {
  preferredTargets?: string[];
  avoidedTargets?: string[];
}

/**
 * Full request-class affinity configuration from route target selection.
 */
export interface RequestClassAffinityConfig {
  streaming?: RequestClassTargetAffinity;
  toolUse?: RequestClassTargetAffinity;
  structuredOutput?: RequestClassTargetAffinity;
  reasoning?: RequestClassTargetAffinity;
  multiTurn?: RequestClassTargetAffinity;
}

/**
 * Computes a per-target affinity adjustment map from request class flags
 * and route affinity configuration.
 *
 * For each active request-class flag that has affinity configuration:
 * - preferredTargets get -1 per active class that prefers them
 * - avoidedTargets get +1 per active class that avoids them
 *
 * The resulting map can be passed as `affinityByTarget` in the scoring context.
 */
export function computeAffinityByTarget(
  requestClass: RequestClassFlags,
  affinityConfig: RequestClassAffinityConfig | undefined,
  _targetKeys: string[]
): Map<string, number> | undefined {
  if (!affinityConfig) {
    return undefined;
  }

  const adjustments = new Map<string, number>();
  const ensureEntry = (key: string) => {
    if (!adjustments.has(key)) {
      adjustments.set(key, 0);
    }
  };

  const applyAffinity = (
    active: boolean,
    classAffinity: RequestClassTargetAffinity | undefined
  ) => {
    if (!active || !classAffinity) {
      return;
    }

    for (const targetKey of classAffinity.preferredTargets ?? []) {
      ensureEntry(targetKey);
      adjustments.set(targetKey, adjustments.get(targetKey)! - 1);
    }

    for (const targetKey of classAffinity.avoidedTargets ?? []) {
      ensureEntry(targetKey);
      adjustments.set(targetKey, adjustments.get(targetKey)! + 1);
    }
  };

  applyAffinity(requestClass.streaming, affinityConfig.streaming);
  applyAffinity(requestClass.toolUse, affinityConfig.toolUse);
  applyAffinity(requestClass.structuredOutput, affinityConfig.structuredOutput);
  applyAffinity(requestClass.reasoning, affinityConfig.reasoning);
  applyAffinity(requestClass.multiTurn, affinityConfig.multiTurn);

  if (adjustments.size === 0) {
    return undefined;
  }

  return adjustments;
}

/**
 * Health-priority strategy comparator.
 *
 * Ranking order:
 * 1. Request-class affinity (preferred before avoided)
 * 2. Non-open before open
 * 3. Non-half-open before half-open
 * 4. Fewer fresh failures first
 * 5. Lower fresh smoothed latency first
 * 6. Original route order tie-break
 */
export function compareTargetsByHealthPriority(
  leftKey: string,
  rightKey: string,
  ctx: RoutingScoringContext
): number {
  const affinityCmp = compareTargetsByAffinity(leftKey, rightKey, ctx);
  if (affinityCmp !== 0) {
    return affinityCmp;
  }

  const leftHealth = getHealthForTarget(leftKey, ctx.healthByTarget);
  const rightHealth = getHealthForTarget(rightKey, ctx.healthByTarget);

  if (leftHealth.isOpen !== rightHealth.isOpen) {
    return leftHealth.isOpen ? 1 : -1;
  }

  if ((leftHealth.isHalfOpen ?? false) !== (rightHealth.isHalfOpen ?? false)) {
    return leftHealth.isHalfOpen ? 1 : -1;
  }

  const leftFailures = getFreshRetryableFailureCount(
    leftHealth,
    ctx.now,
    ctx.windows.failureFreshnessMs
  );
  const rightFailures = getFreshRetryableFailureCount(
    rightHealth,
    ctx.now,
    ctx.windows.failureFreshnessMs
  );

  if (leftFailures !== rightFailures) {
    return leftFailures - rightFailures;
  }

  const leftLatency = getFreshSmoothedLatency(
    leftHealth,
    ctx.now,
    ctx.windows.latencyFreshnessMs
  );
  const rightLatency = getFreshSmoothedLatency(
    rightHealth,
    ctx.now,
    ctx.windows.latencyFreshnessMs
  );

  if (leftLatency !== rightLatency) {
    return leftLatency - rightLatency;
  }

  return compareByOriginalRouteOrder(leftKey, rightKey, ctx.originalOrder);
}

/**
 * Lowest-cost strategy comparator.
 *
 * Ranking order:
 * 1. Request-class affinity (preferred before avoided)
 * 2. Non-half-open before half-open
 * 3. Fewer fresh failures first
 * 4. Lower effective cost first (observed multiplier × configured cost)
 * 5. Original route order tie-break
 */
export function compareTargetsByLowestCost(
  leftKey: string,
  rightKey: string,
  ctx: RoutingScoringContext,
  costs: Readonly<Record<string, number>>
): number {
  const affinityCmp = compareTargetsByAffinity(leftKey, rightKey, ctx);
  if (affinityCmp !== 0) {
    return affinityCmp;
  }

  const leftHealth = getHealthForTarget(leftKey, ctx.healthByTarget);
  const rightHealth = getHealthForTarget(rightKey, ctx.healthByTarget);

  if ((leftHealth.isHalfOpen ?? false) !== (rightHealth.isHalfOpen ?? false)) {
    return leftHealth.isHalfOpen ? 1 : -1;
  }

  const leftFailures = getFreshRetryableFailureCount(
    leftHealth,
    ctx.now,
    ctx.windows.failureFreshnessMs
  );
  const rightFailures = getFreshRetryableFailureCount(
    rightHealth,
    ctx.now,
    ctx.windows.failureFreshnessMs
  );

  if (leftFailures !== rightFailures) {
    return leftFailures - rightFailures;
  }

  const leftConfiguredCost = costs[leftKey] ?? 1;
  const rightConfiguredCost = costs[rightKey] ?? 1;
  const leftObservedMultiplier = getFreshObservedTokenCostMultiplier(
    leftKey,
    ctx.now,
    ctx.healthByTarget,
    ctx.windows.costFreshnessMs
  );
  const rightObservedMultiplier = getFreshObservedTokenCostMultiplier(
    rightKey,
    ctx.now,
    ctx.healthByTarget,
    ctx.windows.costFreshnessMs
  );
  const leftCost =
    leftObservedMultiplier !== undefined
      ? leftConfiguredCost * leftObservedMultiplier
      : leftConfiguredCost;
  const rightCost =
    rightObservedMultiplier !== undefined
      ? rightConfiguredCost * rightObservedMultiplier
      : rightConfiguredCost;

  if (leftCost !== rightCost) {
    return leftCost - rightCost;
  }

  return compareByOriginalRouteOrder(leftKey, rightKey, ctx.originalOrder);
}

/**
 * Computes the latency status for a priority target:
 * - 0 = within SLO
 * - 1 = no SLO defined or stale/no data
 * - 2 = exceeds SLO
 */
export function getPriorityLatencyStatus(
  targetKey: string,
  latencySloMs: Readonly<Record<string, number>> | undefined,
  now: number,
  healthByTarget: ReadonlyMap<string, ProviderTargetHealthSnapshot>,
  latencyFreshnessMs: number
): number {
  const latencySlo = latencySloMs?.[targetKey];
  const health = healthByTarget.get(targetKey);
  const observedLatency =
    health?.smoothedSuccessLatencyMs ?? health?.lastSuccessLatencyMs;

  if (latencySlo === undefined) {
    return 1;
  }

  if (
    observedLatency === undefined ||
    health?.lastSuccessAt === undefined ||
    now - health.lastSuccessAt > latencyFreshnessMs
  ) {
    return 1;
  }

  return observedLatency <= latencySlo ? 0 : 2;
}

/**
 * Computes the latency delta ratio (observed - SLO) / SLO for fine-grained
 * priority tie-breaking within the same latency status bucket.
 */
export function getPriorityLatencyDeltaRatio(
  targetKey: string,
  latencySloMs: Readonly<Record<string, number>> | undefined,
  now: number,
  healthByTarget: ReadonlyMap<string, ProviderTargetHealthSnapshot>,
  latencyFreshnessMs: number
): number | undefined {
  const latencySlo = latencySloMs?.[targetKey];
  const health = healthByTarget.get(targetKey);
  const observedLatency =
    health?.smoothedSuccessLatencyMs ?? health?.lastSuccessLatencyMs;

  if (
    latencySlo === undefined ||
    observedLatency === undefined ||
    health?.lastSuccessAt === undefined ||
    now - health.lastSuccessAt > latencyFreshnessMs
  ) {
    return undefined;
  }

  return (observedLatency - latencySlo) / latencySlo;
}

/**
 * Computes the effective cost for a priority target, combining
 * configured cost with observed token-cost multiplier.
 */
export function getPriorityEffectiveCost(
  targetKey: string,
  costs: Readonly<Record<string, number>> | undefined,
  now: number,
  healthByTarget: ReadonlyMap<string, ProviderTargetHealthSnapshot>,
  costFreshnessMs: number
): number | undefined {
  const configuredCost = costs?.[targetKey];

  if (configuredCost === undefined) {
    return undefined;
  }

  const observedMultiplier = getFreshObservedTokenCostMultiplier(
    targetKey,
    now,
    healthByTarget,
    costFreshnessMs
  );

  if (observedMultiplier === undefined) {
    return configuredCost;
  }

  return configuredCost * observedMultiplier;
}

/**
 * Computes the recovery penalty for a priority target:
 * - 2 = recent failure without subsequent success
 * - 1 = recent failure with recent recovery
 * - 0 = no recent failure signal
 */
export function getPriorityRecoveryPenalty(
  health: { lastSuccessAt?: number; lastFailureAt?: number },
  now: number,
  recoveryWindowMs: number
): number {
  if (health.lastFailureAt === undefined) {
    return 0;
  }

  if (
    health.lastSuccessAt === undefined ||
    health.lastFailureAt > health.lastSuccessAt
  ) {
    return now - health.lastFailureAt <= recoveryWindowMs ? 2 : 0;
  }

  if (
    health.lastSuccessAt - health.lastFailureAt <= recoveryWindowMs &&
    now - health.lastSuccessAt <= recoveryWindowMs
  ) {
    return 1;
  }

  return 0;
}

/**
 * Priority multi-signal strategy comparator.
 *
 * Ranking order:
 * 1. Request-class affinity (preferred before avoided)
 * 2. Non-open before open
 * 3. Non-half-open before half-open
 * 4. Fewer fresh failures first
 * 5. Lower recovery penalty first
 * 6. Higher recovery score first
 * 7. Lower sliding-window error rate first
 * 8. Better latency SLO status first
 * 9. Lower latency delta ratio first
 * 10. Lower effective cost first
 * 11. Original route order tie-break
 */
export function compareTargetsByPriority(
  leftKey: string,
  rightKey: string,
  ctx: RoutingScoringContext,
  selection: {
    latencySloMs?: Readonly<Record<string, number>>;
    costs?: Readonly<Record<string, number>>;
  }
): number {
  const affinityCmp = compareTargetsByAffinity(leftKey, rightKey, ctx);
  if (affinityCmp !== 0) {
    return affinityCmp;
  }

  const leftHealth = getHealthForTarget(leftKey, ctx.healthByTarget);
  const rightHealth = getHealthForTarget(rightKey, ctx.healthByTarget);

  if (leftHealth.isOpen !== rightHealth.isOpen) {
    return leftHealth.isOpen ? 1 : -1;
  }

  if ((leftHealth.isHalfOpen ?? false) !== (rightHealth.isHalfOpen ?? false)) {
    return leftHealth.isHalfOpen ? 1 : -1;
  }

  const leftFailures = getFreshRetryableFailureCount(
    leftHealth,
    ctx.now,
    ctx.windows.failureFreshnessMs
  );
  const rightFailures = getFreshRetryableFailureCount(
    rightHealth,
    ctx.now,
    ctx.windows.failureFreshnessMs
  );

  if (leftFailures !== rightFailures) {
    return leftFailures - rightFailures;
  }

  const leftRecoveryPenalty = getPriorityRecoveryPenalty(
    leftHealth,
    ctx.now,
    ctx.windows.recoveryWindowMs
  );
  const rightRecoveryPenalty = getPriorityRecoveryPenalty(
    rightHealth,
    ctx.now,
    ctx.windows.recoveryWindowMs
  );

  if (leftRecoveryPenalty !== rightRecoveryPenalty) {
    return leftRecoveryPenalty - rightRecoveryPenalty;
  }

  const leftRecoveryScore = getRecoveryScore(leftHealth);
  const rightRecoveryScore = getRecoveryScore(rightHealth);

  if (leftRecoveryScore !== rightRecoveryScore) {
    return rightRecoveryScore - leftRecoveryScore;
  }

  const leftErrorRate = getSlidingWindowErrorRate(leftHealth);
  const rightErrorRate = getSlidingWindowErrorRate(rightHealth);

  if (leftErrorRate !== rightErrorRate) {
    return leftErrorRate - rightErrorRate;
  }

  const leftLatencyStatus = getPriorityLatencyStatus(
    leftKey,
    selection.latencySloMs,
    ctx.now,
    ctx.healthByTarget,
    ctx.windows.latencyFreshnessMs
  );
  const rightLatencyStatus = getPriorityLatencyStatus(
    rightKey,
    selection.latencySloMs,
    ctx.now,
    ctx.healthByTarget,
    ctx.windows.latencyFreshnessMs
  );

  if (leftLatencyStatus !== rightLatencyStatus) {
    return leftLatencyStatus - rightLatencyStatus;
  }

  const leftLatencyDeltaRatio = getPriorityLatencyDeltaRatio(
    leftKey,
    selection.latencySloMs,
    ctx.now,
    ctx.healthByTarget,
    ctx.windows.latencyFreshnessMs
  );
  const rightLatencyDeltaRatio = getPriorityLatencyDeltaRatio(
    rightKey,
    selection.latencySloMs,
    ctx.now,
    ctx.healthByTarget,
    ctx.windows.latencyFreshnessMs
  );

  if (
    leftLatencyDeltaRatio !== undefined &&
    rightLatencyDeltaRatio !== undefined &&
    leftLatencyDeltaRatio !== rightLatencyDeltaRatio
  ) {
    return leftLatencyDeltaRatio - rightLatencyDeltaRatio;
  }

  const leftCost = getPriorityEffectiveCost(
    leftKey,
    selection.costs,
    ctx.now,
    ctx.healthByTarget,
    ctx.windows.costFreshnessMs
  );
  const rightCost = getPriorityEffectiveCost(
    rightKey,
    selection.costs,
    ctx.now,
    ctx.healthByTarget,
    ctx.windows.costFreshnessMs
  );

  if (
    leftCost !== undefined &&
    rightCost !== undefined &&
    leftCost !== rightCost
  ) {
    return leftCost - rightCost;
  }

  return compareByOriginalRouteOrder(leftKey, rightKey, ctx.originalOrder);
}

/**
 * Adjusts a weight based on circuit state and failure count.
 * Returns 0 for open circuits, reduces weight by fresh failure count otherwise.
 */
export function computeAdjustedWeight(
  rawWeight: number,
  targetKey: string,
  ctx: RoutingScoringContext
): number {
  const health = getHealthForTarget(targetKey, ctx.healthByTarget);
  return adjustWeightForFailures(
    rawWeight,
    health,
    ctx.now,
    ctx.windows.failureFreshnessMs
  );
}

/**
 * Computes the hierarchical health score for a target within a routing context.
 */
export function getTargetHealthScore(
  targetKey: string,
  ctx: RoutingScoringContext,
  latencySloMs?: Readonly<Record<string, number>>
): HierarchicalHealthScore {
  const health = getHealthForTarget(targetKey, ctx.healthByTarget);
  const slo = latencySloMs?.[targetKey];
  return computeHierarchicalHealthScore(health, ctx.now, ctx.windows, slo);
}

/**
 * Hierarchical health score strategy comparator.
 *
 * Ranking order:
 * 1. Request-class affinity (preferred before avoided)
 * 2. Hierarchical health score (tier + sub-score)
 * 3. Original route order tie-break
 */
export function compareTargetsByHealthScore(
  leftKey: string,
  rightKey: string,
  ctx: RoutingScoringContext,
  latencySloMs?: Readonly<Record<string, number>>
): number {
  const affinityCmp = compareTargetsByAffinity(leftKey, rightKey, ctx);
  if (affinityCmp !== 0) {
    return affinityCmp;
  }

  const leftScore = getTargetHealthScore(leftKey, ctx, latencySloMs);
  const rightScore = getTargetHealthScore(rightKey, ctx, latencySloMs);

  const cmp = compareHierarchicalHealthScores(leftScore, rightScore);
  if (cmp !== 0) {
    return cmp;
  }

  return compareByOriginalRouteOrder(leftKey, rightKey, ctx.originalOrder);
}
