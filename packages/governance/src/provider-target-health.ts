import type { ProviderCircuitState } from "./provider-circuit-breaker.js";

/**
 * A routing-oriented view of a provider target's health, derived from
 * `ProviderCircuitState` by stripping circuit-breaker–internal fields and
 * adding computed booleans (`isOpen`, `isHalfOpen`).
 *
 * This type is the input contract for all target scoring helpers, making
 * scoring logic testable and portable independent of the gateway runtime.
 */
export interface ProviderTargetHealthSnapshot {
  isOpen: boolean;
  isHalfOpen?: boolean;
  consecutiveRetryableFailures: number;
  lastSuccessLatencyMs?: number;
  smoothedSuccessLatencyMs?: number;
  lastSuccessTotalTokens?: number;
  smoothedSuccessTotalTokens?: number;
  lastSuccessAt?: number;
  lastUsageObservedAt?: number;
  lastFailureAt?: number;
  recoverySuccessCount?: number;
  windowedTotalAttempts?: number;
  windowedFailures?: number;
}

export interface RoutingFreshnessWindows {
  latencyFreshnessMs: number;
  costFreshnessMs: number;
  failureFreshnessMs: number;
  recoveryWindowMs: number;
}

/**
 * Derives a `ProviderTargetHealthSnapshot` from a raw `ProviderCircuitState`
 * by computing `isOpen` and `isHalfOpen` from circuit-breaker timestamps.
 */
export function deriveProviderTargetHealthSnapshot(
  state: ProviderCircuitState
): ProviderTargetHealthSnapshot {
  const isHalfOpen = state.halfOpen === true;
  const isOpen =
    state.openedAt !== undefined && state.openedAt > 0 && !isHalfOpen;

  return {
    isOpen,
    ...(isHalfOpen ? { isHalfOpen: true } : {}),
    consecutiveRetryableFailures: state.consecutiveRetryableFailures,
    ...(state.lastSuccessLatencyMs !== undefined
      ? { lastSuccessLatencyMs: state.lastSuccessLatencyMs }
      : {}),
    ...(state.smoothedSuccessLatencyMs !== undefined
      ? { smoothedSuccessLatencyMs: state.smoothedSuccessLatencyMs }
      : {}),
    ...(state.lastSuccessTotalTokens !== undefined
      ? { lastSuccessTotalTokens: state.lastSuccessTotalTokens }
      : {}),
    ...(state.smoothedSuccessTotalTokens !== undefined
      ? { smoothedSuccessTotalTokens: state.smoothedSuccessTotalTokens }
      : {}),
    ...(state.lastSuccessAt !== undefined
      ? { lastSuccessAt: state.lastSuccessAt }
      : {}),
    ...(state.lastUsageObservedAt !== undefined
      ? { lastUsageObservedAt: state.lastUsageObservedAt }
      : {}),
    ...(state.lastFailureAt !== undefined
      ? { lastFailureAt: state.lastFailureAt }
      : {}),
    ...(state.recoverySuccessCount !== undefined
      ? { recoverySuccessCount: state.recoverySuccessCount }
      : {}),
    ...(state.windowedTotalAttempts !== undefined
      ? { windowedTotalAttempts: state.windowedTotalAttempts }
      : {}),
    ...(state.windowedFailures !== undefined
      ? { windowedFailures: state.windowedFailures }
      : {})
  };
}

/**
 * Returns the effective consecutive retryable failure count, subject to
 * a freshness window. Open/half-open circuits always return the raw count
 * regardless of freshness.
 */
export function getFreshRetryableFailureCount(
  health: ProviderTargetHealthSnapshot,
  now: number,
  freshnessMs: number
): number {
  if (health.consecutiveRetryableFailures <= 0) {
    return 0;
  }

  if (health.isOpen || health.isHalfOpen) {
    return health.consecutiveRetryableFailures;
  }

  if (
    health.lastFailureAt === undefined ||
    now - health.lastFailureAt > freshnessMs
  ) {
    return 0;
  }

  return health.consecutiveRetryableFailures;
}

/**
 * Returns the smoothed (or last) success latency, subject to a freshness
 * window. Returns `Infinity` if no data is available or data is stale.
 */
export function getFreshSmoothedLatency(
  health: ProviderTargetHealthSnapshot,
  now: number,
  freshnessMs: number
): number {
  const latency =
    health.smoothedSuccessLatencyMs ?? health.lastSuccessLatencyMs;

  if (latency === undefined) {
    return Number.POSITIVE_INFINITY;
  }

  if (
    health.lastSuccessAt === undefined ||
    now - health.lastSuccessAt > freshnessMs
  ) {
    return Number.POSITIVE_INFINITY;
  }

  return latency;
}

/**
 * Returns the sliding window error rate (failures / total attempts).
 * Returns 0 if no attempts have been recorded.
 */
export function getSlidingWindowErrorRate(
  health: ProviderTargetHealthSnapshot
): number {
  const total = health.windowedTotalAttempts ?? 0;
  const failures = health.windowedFailures ?? 0;

  if (total <= 0) {
    return 0;
  }

  return failures / total;
}

/**
 * Returns a recovery score for a target:
 * - 2 = fully healthy (never opened, or recovered with 2+ successes)
 * - 1 = recovering (1 success since opening)
 * - 0 = half-open (probing)
 */
export function getRecoveryScore(health: ProviderTargetHealthSnapshot): number {
  if (!health.isHalfOpen && health.recoverySuccessCount === undefined) {
    return 2;
  }

  if (health.isHalfOpen) {
    return 0;
  }

  const count = health.recoverySuccessCount ?? 0;

  if (count >= 2) {
    return 2;
  }

  return 1;
}

/**
 * Returns the observed token cost multiplier for a target, subject to a
 * freshness window. Returns `undefined` if no data is available or stale.
 */
export function getFreshObservedTokenCostMultiplier(
  targetKey: string,
  now: number,
  healthByTarget: ReadonlyMap<string, ProviderTargetHealthSnapshot>,
  costFreshnessMs: number
): number | undefined {
  const health = healthByTarget.get(targetKey);

  if (!health) {
    return undefined;
  }

  if (
    health.lastUsageObservedAt === undefined ||
    now - health.lastUsageObservedAt > costFreshnessMs
  ) {
    return undefined;
  }

  return health.smoothedSuccessTotalTokens ?? health.lastSuccessTotalTokens;
}

/**
 * Adjusts a weight based on circuit state and failure count.
 * Returns 0 for open circuits. Reduces weight by fresh failure count otherwise.
 */
export function adjustWeightForFailures(
  weight: number,
  health: ProviderTargetHealthSnapshot,
  now: number,
  freshnessMs: number
): number {
  if (health.isOpen) {
    return 0;
  }

  const freshFailureCount = getFreshRetryableFailureCount(
    health,
    now,
    freshnessMs
  );

  return Math.max(0, weight - freshFailureCount);
}

/**
 * Hierarchical health score combining multiple signals into a single
 * sortable metric with dominant tier and fine-grained sub-score.
 *
 * Tiers (dominant ordering):
 *   4 = healthy    — closed, no fresh failures
 *   3 = recovering — closed, past failures with successful recovery
 *   2 = degraded   — closed, has fresh failures
 *   1 = probing    — half-open circuit
 *   0 = unavailable — open circuit
 *
 * Sub-score (0–1 within tier, for tie-breaking):
 *   Healthy:    penalizes stale latency data and high error rate
 *   Recovering: scales with recovery success count
 *   Degraded:   inversely scales with failure count
 *   Probing:    always 0.5
 *   Unavailable: always 0
 */
export interface HierarchicalHealthScore {
  /** Health tier (0–4, higher is healthier) */
  tier: number;
  /** Sub-score within tier (0–1, higher is better) */
  subScore: number;
}

/**
 * Computes a hierarchical health score for a target.
 *
 * @param health    The target's health snapshot
 * @param now       Current wall-clock time (ms since epoch)
 * @param windows   Freshness windows for signal staleness
 * @param latencySloMs  Optional latency SLO in ms for the healthy-tier sub-score
 */
export function computeHierarchicalHealthScore(
  health: ProviderTargetHealthSnapshot,
  now: number,
  windows: RoutingFreshnessWindows,
  latencySloMs?: number
): HierarchicalHealthScore {
  // Tier 0: open circuit — completely unavailable
  if (health.isOpen) {
    return { tier: 0, subScore: 0 };
  }

  // Tier 1: half-open — probing only
  if (health.isHalfOpen) {
    return { tier: 1, subScore: 0.5 };
  }

  const freshFailures = getFreshRetryableFailureCount(
    health,
    now,
    windows.failureFreshnessMs
  );

  // Tier 2: degraded — has fresh failures
  if (freshFailures > 0) {
    const subScore = 1 / (1 + freshFailures);
    return { tier: 2, subScore };
  }

  const recoveryScore = getRecoveryScore(health);

  // Tier 3: recovering — past failures, building confidence
  if (recoveryScore < 2) {
    const count = health.recoverySuccessCount ?? 0;
    // 0 successes → 0.0, 1 success → 0.5
    const subScore = count >= 1 ? 0.5 : 0;
    return { tier: 3, subScore };
  }

  // Tier 4: healthy — combine error rate and latency signals
  const errorRate = getSlidingWindowErrorRate(health);
  const errorRateFactor = 1 - Math.min(errorRate, 1);

  const latency = getFreshSmoothedLatency(health, now, windows.latencyFreshnessMs);
  let latencyFactor: number;
  if (latency === Number.POSITIVE_INFINITY) {
    // No latency data — neutral sub-score component
    latencyFactor = 0.5;
  } else if (latencySloMs !== undefined && latencySloMs > 0) {
    // Within SLO → 1.0, up to 2× SLO → scales toward 0
    latencyFactor = Math.max(0, 1 - (latency - latencySloMs) / latencySloMs);
  } else {
    // No SLO defined — fresh latency data is a positive signal
    latencyFactor = 1;
  }

  // Weighted combination: error rate 40%, latency 60%
  const subScore = Math.min(1, errorRateFactor * 0.4 + latencyFactor * 0.6);
  return { tier: 4, subScore };
}

/**
 * Compares two hierarchical health scores.
 * Higher tier wins; within the same tier, higher sub-score wins.
 */
export function compareHierarchicalHealthScores(
  left: HierarchicalHealthScore,
  right: HierarchicalHealthScore
): number {
  if (left.tier !== right.tier) {
    return right.tier - left.tier;
  }
  return right.subScore - left.subScore;
}
