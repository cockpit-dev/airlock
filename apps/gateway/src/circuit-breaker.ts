import { serializeProviderTarget, type ProviderTarget } from "@airlock/routing";

export interface ProviderCircuitBreakerPolicy {
  threshold: number;
  cooldownMs: number;
}

interface ProviderCircuitState {
  consecutiveRetryableFailures: number;
  openedAt?: number;
}

const providerCircuitStates = new Map<string, ProviderCircuitState>();

function getCircuitKey(target: ProviderTarget): string {
  return serializeProviderTarget(target);
}

function getOrCreateCircuitState(target: ProviderTarget): ProviderCircuitState {
  const key = getCircuitKey(target);
  const existing = providerCircuitStates.get(key);

  if (existing) {
    return existing;
  }

  const created: ProviderCircuitState = {
    consecutiveRetryableFailures: 0
  };
  providerCircuitStates.set(key, created);

  return created;
}

export function isProviderTargetCircuitOpen(
  target: ProviderTarget,
  policy: ProviderCircuitBreakerPolicy,
  now: () => number
): boolean {
  const state = providerCircuitStates.get(getCircuitKey(target));

  if (!state || state.openedAt === undefined) {
    return false;
  }

  if (now() - state.openedAt >= policy.cooldownMs) {
    delete state.openedAt;
    state.consecutiveRetryableFailures = 0;
    return false;
  }

  return true;
}

export function recordProviderTargetSuccess(target: ProviderTarget) {
  providerCircuitStates.set(getCircuitKey(target), {
    consecutiveRetryableFailures: 0
  });
}

export function recordProviderTargetRetryableFailure(
  target: ProviderTarget,
  policy: ProviderCircuitBreakerPolicy,
  now: number
) {
  const state = getOrCreateCircuitState(target);
  const nextFailures = state.consecutiveRetryableFailures + 1;

  state.consecutiveRetryableFailures = nextFailures;

  if (nextFailures >= policy.threshold) {
    state.openedAt = now;
  }
}

export function resetProviderCircuitBreakerState() {
  providerCircuitStates.clear();
}
