import { serializeProviderTarget, type ProviderTarget } from "@airlock/routing";

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

export interface ProviderCircuitBreakerBackend {
  getState(target: ProviderTarget): Promise<ProviderCircuitState | undefined>;
  claimHalfOpenProbe(
    target: ProviderTarget,
    policy: ProviderCircuitBreakerPolicy,
    now: number
  ): Promise<boolean>;
  recordSuccess(
    target: ProviderTarget,
    latencyMs?: number,
    totalTokensOrNow?: number,
    now?: number
  ): Promise<void>;
  recordRetryableFailure(
    target: ProviderTarget,
    policy: ProviderCircuitBreakerPolicy,
    now: number
  ): Promise<void>;
}

const providerCircuitStates = new Map<string, ProviderCircuitState>();
const LATENCY_SMOOTHING_PREVIOUS_WEIGHT = 0.7;
const LATENCY_SMOOTHING_CURRENT_WEIGHT = 0.3;
const MAX_HALF_OPEN_REOPEN_BACKOFF_MULTIPLIER = 4;

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

function computeSmoothedSuccessLatency(
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

function computeSmoothedSuccessTotalTokens(
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

function normalizeRecordSuccessArguments(
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
    ...(totalTokensOrNow !== undefined ? { totalTokens: totalTokensOrNow } : {}),
    now
  };
}

function computeEffectiveCooldownMs(
  policy: ProviderCircuitBreakerPolicy,
  state: Pick<ProviderCircuitState, "halfOpenRetryableFailureCount">
): number {
  const halfOpenFailures = Math.max(0, state.halfOpenRetryableFailureCount ?? 0);
  const multiplier = Math.min(
    MAX_HALF_OPEN_REOPEN_BACKOFF_MULTIPLIER,
    2 ** halfOpenFailures
  );

  return policy.cooldownMs * multiplier;
}

export function createInMemoryCircuitBreakerBackend(): ProviderCircuitBreakerBackend {
  return {
    getState(target) {
      return Promise.resolve(providerCircuitStates.get(getCircuitKey(target)));
    },
    claimHalfOpenProbe(target, policy, now) {
      const state = providerCircuitStates.get(getCircuitKey(target));

      if (!state || state.openedAt === undefined) {
        return Promise.resolve(false);
      }

      if (now - state.openedAt < computeEffectiveCooldownMs(policy, state)) {
        return Promise.resolve(false);
      }

      if (
        state.probeStartedAt !== undefined &&
        now - state.probeStartedAt < computeEffectiveCooldownMs(policy, state)
      ) {
        return Promise.resolve(false);
      }

      state.probeStartedAt = now;
      return Promise.resolve(true);
    },
    recordSuccess(target, latencyMs, totalTokensOrNow, now) {
      const normalized = normalizeRecordSuccessArguments(totalTokensOrNow, now);
      const existing = providerCircuitStates.get(getCircuitKey(target));
      providerCircuitStates.set(getCircuitKey(target), {
        consecutiveRetryableFailures: 0,
        halfOpenRetryableFailureCount: 0,
        ...(latencyMs !== undefined ? { lastSuccessLatencyMs: latencyMs } : {}),
        ...(latencyMs !== undefined
          ? {
              smoothedSuccessLatencyMs: computeSmoothedSuccessLatency(
                existing?.smoothedSuccessLatencyMs,
                latencyMs
              )
            }
          : {}),
        ...(normalized.totalTokens !== undefined
          ? { lastSuccessTotalTokens: normalized.totalTokens }
          : existing?.lastSuccessTotalTokens !== undefined
            ? { lastSuccessTotalTokens: existing.lastSuccessTotalTokens }
            : {}),
        ...(normalized.totalTokens !== undefined
          ? {
              smoothedSuccessTotalTokens: computeSmoothedSuccessTotalTokens(
                existing?.smoothedSuccessTotalTokens,
                normalized.totalTokens
              )
            }
          : existing?.smoothedSuccessTotalTokens !== undefined
            ? {
                smoothedSuccessTotalTokens:
                  existing.smoothedSuccessTotalTokens
              }
            : {}),
        ...(normalized.now !== undefined ? { lastSuccessAt: normalized.now } : {}),
        ...(normalized.totalTokens !== undefined && normalized.now !== undefined
          ? { lastUsageObservedAt: normalized.now }
          : existing?.lastUsageObservedAt !== undefined
            ? { lastUsageObservedAt: existing.lastUsageObservedAt }
            : {}),
        ...(existing?.lastFailureAt !== undefined
          ? { lastFailureAt: existing.lastFailureAt }
          : {})
      });
      return Promise.resolve();
    },
    recordRetryableFailure(target, policy, now) {
      const state = getOrCreateCircuitState(target);
      const nextFailures = state.consecutiveRetryableFailures + 1;
      const halfOpenProbeFailed = state.probeStartedAt !== undefined;

      state.consecutiveRetryableFailures = nextFailures;
      state.halfOpenRetryableFailureCount = halfOpenProbeFailed
        ? (state.halfOpenRetryableFailureCount ?? 0) + 1
        : 0;

      if (halfOpenProbeFailed || nextFailures >= policy.threshold) {
        state.openedAt = now;
      }

      delete state.probeStartedAt;
      state.lastFailureAt = now;

      return Promise.resolve();
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseProviderCircuitState(value: unknown): ProviderCircuitState {
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
    throw new Error("Provider circuit state smoothedSuccessLatencyMs is invalid");
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
    throw new Error("Provider circuit state smoothedSuccessTotalTokens is invalid");
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
    ...(lastSuccessTotalTokens !== undefined
      ? { lastSuccessTotalTokens }
      : {}),
    ...(smoothedSuccessTotalTokens !== undefined
      ? { smoothedSuccessTotalTokens }
      : {}),
    ...(lastSuccessAt !== undefined ? { lastSuccessAt } : {}),
    ...(lastUsageObservedAt !== undefined ? { lastUsageObservedAt } : {}),
    ...(lastFailureAt !== undefined ? { lastFailureAt } : {})
  };
}

export class ProviderCircuitBreakerDurableObject {
  constructor(
    private readonly state: {
      storage: {
        get<T>(key: string): Promise<T | undefined>;
        put<T>(key: string, value: T): Promise<void>;
      };
    }
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method === "GET") {
      const state = await this.state.storage.get<ProviderCircuitState>("state");
      return Response.json(
        state ?? {
          consecutiveRetryableFailures: 0
        }
      );
    }

    if (request.method === "POST") {
      const body = (await request.json()) as {
        kind: "success" | "retryable_failure" | "claim_half_open_probe";
        threshold?: number;
        cooldownMs?: number;
        latencyMs?: number;
        totalTokens?: number;
        now?: number;
      };
      const current =
        (await this.state.storage.get<ProviderCircuitState>("state")) ?? {
          consecutiveRetryableFailures: 0
        };

      if (body.kind === "success") {
        const nextSmoothedLatencyMs =
          body.latencyMs !== undefined
            ? computeSmoothedSuccessLatency(
                current.smoothedSuccessLatencyMs,
                body.latencyMs
              )
            : undefined;
        const nextSmoothedTotalTokens =
          body.totalTokens !== undefined
            ? computeSmoothedSuccessTotalTokens(
                current.smoothedSuccessTotalTokens,
                body.totalTokens
              )
            : undefined;
        const next = {
          consecutiveRetryableFailures: 0,
          halfOpenRetryableFailureCount: 0,
          ...(body.latencyMs !== undefined
            ? { lastSuccessLatencyMs: body.latencyMs }
            : {}),
          ...(nextSmoothedLatencyMs !== undefined
            ? { smoothedSuccessLatencyMs: nextSmoothedLatencyMs }
            : {}),
          ...(body.totalTokens !== undefined
            ? { lastSuccessTotalTokens: body.totalTokens }
            : current.lastSuccessTotalTokens !== undefined
              ? { lastSuccessTotalTokens: current.lastSuccessTotalTokens }
              : {}),
          ...(nextSmoothedTotalTokens !== undefined
            ? { smoothedSuccessTotalTokens: nextSmoothedTotalTokens }
            : current.smoothedSuccessTotalTokens !== undefined
              ? {
                  smoothedSuccessTotalTokens:
                    current.smoothedSuccessTotalTokens
                }
              : {}),
          ...(body.now !== undefined ? { lastSuccessAt: body.now } : {}),
          ...(body.totalTokens !== undefined && body.now !== undefined
            ? { lastUsageObservedAt: body.now }
            : current.lastUsageObservedAt !== undefined
              ? { lastUsageObservedAt: current.lastUsageObservedAt }
              : {}),
          ...(current.lastFailureAt !== undefined
            ? { lastFailureAt: current.lastFailureAt }
            : {})
        };
        await this.state.storage.put("state", next);
        return Response.json(next);
      }

      if (body.kind === "claim_half_open_probe") {
        const cooldownMs = body.cooldownMs ?? 0;

        if (!current.openedAt || body.now === undefined) {
          return Response.json({ claimed: false });
        }

        if (
          body.now - current.openedAt <
          computeEffectiveCooldownMs(
            {
              threshold: body.threshold ?? 1,
              cooldownMs
            },
            current
          )
        ) {
          return Response.json({ claimed: false });
        }

        if (
          current.probeStartedAt !== undefined &&
          body.now - current.probeStartedAt <
            computeEffectiveCooldownMs(
              {
                threshold: body.threshold ?? 1,
                cooldownMs
              },
              current
            )
        ) {
          return Response.json({ claimed: false });
        }

        const next: ProviderCircuitState = {
          ...current,
          probeStartedAt: body.now
        };
        await this.state.storage.put("state", next);
        return Response.json({ claimed: true });
      }

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
        ...((current.probeStartedAt !== undefined ||
          nextFailures >= (body.threshold ?? 1)) &&
        body.now !== undefined
          ? { openedAt: body.now }
          : {}),
        ...(body.now !== undefined ? { lastFailureAt: body.now } : {})
      };
      delete next.probeStartedAt;
      await this.state.storage.put("state", next);
      return Response.json(next);
    }

    return new Response("Method not allowed", { status: 405 });
  }
}

export function createPersistentCircuitBreakerBackend(namespace: {
  idFromName(name: string): unknown;
  get(id: unknown): {
    fetch(request: Request): Promise<Response>;
  };
}): ProviderCircuitBreakerBackend {
  return {
    async getState(target) {
      const response = await namespace
        .get(namespace.idFromName(getCircuitKey(target)))
        .fetch(
          new Request("https://airlock.internal/provider-circuit-breaker", {
            method: "GET"
          })
        );

      return parseProviderCircuitState(await response.json());
    },
    async claimHalfOpenProbe(target, policy, now) {
      const response = await namespace
        .get(namespace.idFromName(getCircuitKey(target)))
        .fetch(
          new Request("https://airlock.internal/provider-circuit-breaker", {
            method: "POST",
            headers: {
              "content-type": "application/json"
            },
            body: JSON.stringify({
              kind: "claim_half_open_probe",
              cooldownMs: policy.cooldownMs,
              now
            })
          })
        );
      const body = (await response.json()) as { claimed?: boolean };
      return body.claimed === true;
    },
    async recordSuccess(target, latencyMs, totalTokensOrNow, now) {
      const normalized = normalizeRecordSuccessArguments(totalTokensOrNow, now);
      await namespace
        .get(namespace.idFromName(getCircuitKey(target)))
        .fetch(
          new Request("https://airlock.internal/provider-circuit-breaker", {
            method: "POST",
            headers: {
              "content-type": "application/json"
            },
            body: JSON.stringify({
              kind: "success",
              ...(latencyMs !== undefined ? { latencyMs } : {}),
              ...(normalized.totalTokens !== undefined
                ? { totalTokens: normalized.totalTokens }
                : {}),
              ...(normalized.now !== undefined ? { now: normalized.now } : {})
            })
          })
        );
    },
    async recordRetryableFailure(target, policy, now) {
      await namespace
        .get(namespace.idFromName(getCircuitKey(target)))
        .fetch(
          new Request("https://airlock.internal/provider-circuit-breaker", {
            method: "POST",
            headers: {
              "content-type": "application/json"
            },
            body: JSON.stringify({
              kind: "retryable_failure",
              threshold: policy.threshold,
              now
            })
          })
        );
    }
  };
}

export async function isProviderTargetCircuitOpen(
  target: ProviderTarget,
  policy: ProviderCircuitBreakerPolicy,
  now: () => number,
  backend: ProviderCircuitBreakerBackend
): Promise<boolean> {
  const state = await backend.getState(target);

  if (!state || state.openedAt === undefined) {
    return false;
  }

  const currentNow = now();

  if (
    currentNow - state.openedAt >= computeEffectiveCooldownMs(policy, state) &&
    state.probeStartedAt === undefined
  ) {
    return false;
  }

  return true;
}

export async function getProviderTargetCircuitState(
  target: ProviderTarget,
  policy: ProviderCircuitBreakerPolicy,
  now: () => number,
  backend: ProviderCircuitBreakerBackend
): Promise<ProviderCircuitState | undefined> {
  const state = await backend.getState(target);

  if (!state || state.openedAt === undefined) {
    return state;
  }

  const currentNow = now();

  if (currentNow - state.openedAt < computeEffectiveCooldownMs(policy, state)) {
    return state;
  }

  if (
    state.probeStartedAt !== undefined &&
    currentNow - state.probeStartedAt < computeEffectiveCooldownMs(policy, state)
  ) {
    return state;
  }

  const claimed = await backend.claimHalfOpenProbe(target, policy, currentNow);

  if (!claimed) {
    return state;
  }

  return {
    ...state,
    probeStartedAt: currentNow,
    halfOpen: true
  };
}

export function resetProviderCircuitBreakerState() {
  providerCircuitStates.clear();
}
