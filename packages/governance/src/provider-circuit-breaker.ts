import { isRecord } from "./gateway-key-quota-shared.js";

export interface ProviderCircuitBreakerPolicy {
  threshold: number;
  cooldownMs: number;
}

export interface ProviderCircuitState {
  consecutiveRetryableFailures: number;
  openedAt?: number;
  probeStartedAt?: number;
  halfOpen?: boolean;
  halfOpenRetryableFailureCount?: number;
  lastSuccessLatencyMs?: number;
  smoothedSuccessLatencyMs?: number;
  lastSuccessTotalTokens?: number;
  smoothedSuccessTotalTokens?: number;
  lastSuccessAt?: number;
  lastUsageObservedAt?: number;
  lastFailureAt?: number;
}

const LATENCY_SMOOTHING_PREVIOUS_WEIGHT = 0.7;
const LATENCY_SMOOTHING_CURRENT_WEIGHT = 0.3;
const MAX_HALF_OPEN_REOPEN_BACKOFF_MULTIPLIER = 4;

/**
 * Exponential moving average for latency smoothing.
 */
export function computeSmoothedSuccessLatency(
  previous: number | undefined,
  current: number
): number {
  if (previous === undefined) {
    return current;
  }

  return Math.round(
    previous * LATENCY_SMOOTHING_PREVIOUS_WEIGHT +
      current * LATENCY_SMOOTHING_CURRENT_WEIGHT
  );
}

/**
 * Exponential moving average for token count smoothing.
 */
export function computeSmoothedSuccessTotalTokens(
  previous: number | undefined,
  current: number
): number {
  if (previous === undefined) {
    return current;
  }

  return Math.round(
    previous * LATENCY_SMOOTHING_PREVIOUS_WEIGHT +
      current * LATENCY_SMOOTHING_CURRENT_WEIGHT
  );
}

/**
 * Normalizes the legacy (latencyMs, totalTokensOrNow, now) argument pattern
 * for backwards compatibility with the ProviderCircuitBreakerBackend interface.
 */
export function normalizeRecordSuccessArguments(
  totalTokensOrNow: number | undefined,
  now: number | undefined
): {
  totalTokens?: number;
  now?: number;
} {
  if (now === undefined) {
    return {
      ...(totalTokensOrNow !== undefined ? { now: totalTokensOrNow } : {})
    };
  }

  return {
    ...(totalTokensOrNow !== undefined
      ? { totalTokens: totalTokensOrNow }
      : {}),
    now
  };
}

/**
 * Computes the effective cooldown duration, applying exponential backoff
 * for repeated half-open probe failures.
 */
export function computeEffectiveCooldownMs(
  policy: ProviderCircuitBreakerPolicy,
  state: Pick<ProviderCircuitState, "halfOpenRetryableFailureCount">
): number {
  const halfOpenFailures = Math.max(
    0,
    state.halfOpenRetryableFailureCount ?? 0
  );
  const multiplier = Math.min(
    MAX_HALF_OPEN_REOPEN_BACKOFF_MULTIPLIER,
    2 ** halfOpenFailures
  );

  return policy.cooldownMs * multiplier;
}

/**
 * Pure state transition: applies a successful request to the circuit state.
 * Returns the next state without performing any IO.
 */
export function applyCircuitBreakerSuccess(
  current: ProviderCircuitState,
  latencyMs: number | undefined,
  totalTokens: number | undefined,
  now: number | undefined
): ProviderCircuitState {
  const nextSmoothedLatencyMs =
    latencyMs !== undefined
      ? computeSmoothedSuccessLatency(
          current.smoothedSuccessLatencyMs,
          latencyMs
        )
      : undefined;
  const nextSmoothedTotalTokens =
    totalTokens !== undefined
      ? computeSmoothedSuccessTotalTokens(
          current.smoothedSuccessTotalTokens,
          totalTokens
        )
      : undefined;

  return {
    consecutiveRetryableFailures: 0,
    halfOpenRetryableFailureCount: 0,
    ...(latencyMs !== undefined ? { lastSuccessLatencyMs: latencyMs } : {}),
    ...(nextSmoothedLatencyMs !== undefined
      ? { smoothedSuccessLatencyMs: nextSmoothedLatencyMs }
      : {}),
    ...(totalTokens !== undefined
      ? { lastSuccessTotalTokens: totalTokens }
      : current.lastSuccessTotalTokens !== undefined
        ? { lastSuccessTotalTokens: current.lastSuccessTotalTokens }
        : {}),
    ...(nextSmoothedTotalTokens !== undefined
      ? { smoothedSuccessTotalTokens: nextSmoothedTotalTokens }
      : current.smoothedSuccessTotalTokens !== undefined
        ? {
            smoothedSuccessTotalTokens: current.smoothedSuccessTotalTokens
          }
        : {}),
    ...(now !== undefined ? { lastSuccessAt: now } : {}),
    ...(totalTokens !== undefined && now !== undefined
      ? { lastUsageObservedAt: now }
      : current.lastUsageObservedAt !== undefined
        ? { lastUsageObservedAt: current.lastUsageObservedAt }
        : {}),
    ...(current.lastFailureAt !== undefined
      ? { lastFailureAt: current.lastFailureAt }
      : {})
  };
}

/**
 * Pure state transition: applies a retryable failure to the circuit state.
 * Returns the next state without performing any IO.
 */
export function applyCircuitBreakerRetryableFailure(
  current: ProviderCircuitState,
  threshold: number,
  now: number
): ProviderCircuitState {
  const nextFailures = current.consecutiveRetryableFailures + 1;
  const halfOpenProbeFailed = current.probeStartedAt !== undefined;

  const next: ProviderCircuitState = {
    consecutiveRetryableFailures: nextFailures,
    halfOpenRetryableFailureCount: halfOpenProbeFailed
      ? (current.halfOpenRetryableFailureCount ?? 0) + 1
      : 0,
    ...(current.lastSuccessLatencyMs !== undefined
      ? { lastSuccessLatencyMs: current.lastSuccessLatencyMs }
      : {}),
    ...(current.smoothedSuccessLatencyMs !== undefined
      ? { smoothedSuccessLatencyMs: current.smoothedSuccessLatencyMs }
      : {}),
    ...(current.lastSuccessTotalTokens !== undefined
      ? { lastSuccessTotalTokens: current.lastSuccessTotalTokens }
      : {}),
    ...(current.smoothedSuccessTotalTokens !== undefined
      ? { smoothedSuccessTotalTokens: current.smoothedSuccessTotalTokens }
      : {}),
    ...(current.lastSuccessAt !== undefined
      ? { lastSuccessAt: current.lastSuccessAt }
      : {}),
    ...(current.lastUsageObservedAt !== undefined
      ? { lastUsageObservedAt: current.lastUsageObservedAt }
      : {}),
    ...(halfOpenProbeFailed || nextFailures >= threshold
      ? { openedAt: now }
      : {}),
    lastFailureAt: now
  };

  return next;
}

/**
 * Pure decision: determines whether a half-open probe can be claimed.
 */
export function shouldClaimHalfOpenProbe(
  current: ProviderCircuitState,
  policy: ProviderCircuitBreakerPolicy,
  now: number
): boolean {
  if (current.openedAt === undefined) {
    return false;
  }

  if (now - current.openedAt < computeEffectiveCooldownMs(policy, current)) {
    return false;
  }

  if (
    current.probeStartedAt !== undefined &&
    now - current.probeStartedAt < computeEffectiveCooldownMs(policy, current)
  ) {
    return false;
  }

  return true;
}

/**
 * Pure decision: determines whether a circuit is currently open.
 */
export function isCircuitBreakerOpen(
  state: ProviderCircuitState | undefined,
  policy: ProviderCircuitBreakerPolicy,
  now: number
): boolean {
  if (!state || state.openedAt === undefined) {
    return false;
  }

  if (
    now - state.openedAt >= computeEffectiveCooldownMs(policy, state) &&
    state.probeStartedAt === undefined
  ) {
    return false;
  }

  return true;
}

/**
 * Parses a raw value into a ProviderCircuitState, validating all fields.
 */
export function parseProviderCircuitState(
  value: unknown
): ProviderCircuitState {
  if (!isRecord(value)) {
    throw new Error("Provider circuit state must be an object");
  }

  const {
    consecutiveRetryableFailures,
    openedAt,
    probeStartedAt,
    halfOpenRetryableFailureCount
  } = value;

  if (
    typeof consecutiveRetryableFailures !== "number" ||
    !Number.isInteger(consecutiveRetryableFailures) ||
    consecutiveRetryableFailures < 0
  ) {
    throw new Error("Provider circuit state failure count is invalid");
  }

  if (
    openedAt !== undefined &&
    (typeof openedAt !== "number" || !Number.isInteger(openedAt))
  ) {
    throw new Error("Provider circuit state openedAt is invalid");
  }

  if (
    probeStartedAt !== undefined &&
    (typeof probeStartedAt !== "number" || !Number.isInteger(probeStartedAt))
  ) {
    throw new Error("Provider circuit state probeStartedAt is invalid");
  }

  if (
    halfOpenRetryableFailureCount !== undefined &&
    (typeof halfOpenRetryableFailureCount !== "number" ||
      !Number.isInteger(halfOpenRetryableFailureCount) ||
      halfOpenRetryableFailureCount < 0)
  ) {
    throw new Error(
      "Provider circuit state halfOpenRetryableFailureCount is invalid"
    );
  }

  const {
    lastSuccessLatencyMs,
    smoothedSuccessLatencyMs,
    lastSuccessTotalTokens,
    smoothedSuccessTotalTokens,
    lastSuccessAt,
    lastUsageObservedAt,
    lastFailureAt
  } = value;

  if (
    lastSuccessLatencyMs !== undefined &&
    (typeof lastSuccessLatencyMs !== "number" ||
      !Number.isFinite(lastSuccessLatencyMs) ||
      lastSuccessLatencyMs < 0)
  ) {
    throw new Error("Provider circuit state lastSuccessLatencyMs is invalid");
  }

  if (
    smoothedSuccessLatencyMs !== undefined &&
    (typeof smoothedSuccessLatencyMs !== "number" ||
      !Number.isFinite(smoothedSuccessLatencyMs) ||
      smoothedSuccessLatencyMs < 0)
  ) {
    throw new Error(
      "Provider circuit state smoothedSuccessLatencyMs is invalid"
    );
  }

  if (
    lastSuccessTotalTokens !== undefined &&
    (typeof lastSuccessTotalTokens !== "number" ||
      !Number.isFinite(lastSuccessTotalTokens) ||
      lastSuccessTotalTokens < 0)
  ) {
    throw new Error("Provider circuit state lastSuccessTotalTokens is invalid");
  }

  if (
    smoothedSuccessTotalTokens !== undefined &&
    (typeof smoothedSuccessTotalTokens !== "number" ||
      !Number.isFinite(smoothedSuccessTotalTokens) ||
      smoothedSuccessTotalTokens < 0)
  ) {
    throw new Error(
      "Provider circuit state smoothedSuccessTotalTokens is invalid"
    );
  }

  if (
    lastSuccessAt !== undefined &&
    (typeof lastSuccessAt !== "number" || !Number.isInteger(lastSuccessAt))
  ) {
    throw new Error("Provider circuit state lastSuccessAt is invalid");
  }

  if (
    lastUsageObservedAt !== undefined &&
    (typeof lastUsageObservedAt !== "number" ||
      !Number.isInteger(lastUsageObservedAt))
  ) {
    throw new Error("Provider circuit state lastUsageObservedAt is invalid");
  }

  if (
    lastFailureAt !== undefined &&
    (typeof lastFailureAt !== "number" || !Number.isInteger(lastFailureAt))
  ) {
    throw new Error("Provider circuit state lastFailureAt is invalid");
  }

  return {
    consecutiveRetryableFailures,
    ...(openedAt !== undefined ? { openedAt } : {}),
    ...(probeStartedAt !== undefined ? { probeStartedAt } : {}),
    ...(halfOpenRetryableFailureCount !== undefined
      ? { halfOpenRetryableFailureCount }
      : {}),
    ...(lastSuccessLatencyMs !== undefined ? { lastSuccessLatencyMs } : {}),
    ...(smoothedSuccessLatencyMs !== undefined
      ? { smoothedSuccessLatencyMs }
      : {}),
    ...(lastSuccessTotalTokens !== undefined ? { lastSuccessTotalTokens } : {}),
    ...(smoothedSuccessTotalTokens !== undefined
      ? { smoothedSuccessTotalTokens }
      : {}),
    ...(lastSuccessAt !== undefined ? { lastSuccessAt } : {}),
    ...(lastUsageObservedAt !== undefined ? { lastUsageObservedAt } : {}),
    ...(lastFailureAt !== undefined ? { lastFailureAt } : {})
  };
}
