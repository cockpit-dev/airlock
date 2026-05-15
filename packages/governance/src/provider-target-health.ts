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
