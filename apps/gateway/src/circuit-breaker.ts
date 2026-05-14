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
  lastSuccessLatencyMs?: number;
  smoothedSuccessLatencyMs?: number;
  lastSuccessAt?: number;
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

      if (now - state.openedAt < policy.cooldownMs) {
        return Promise.resolve(false);
      }

      if (
        state.probeStartedAt !== undefined &&
        now - state.probeStartedAt < policy.cooldownMs
      ) {
        return Promise.resolve(false);
      }

      state.probeStartedAt = now;
      return Promise.resolve(true);
    },
    recordSuccess(target, latencyMs, now) {
      const existing = providerCircuitStates.get(getCircuitKey(target));
      providerCircuitStates.set(getCircuitKey(target), {
        consecutiveRetryableFailures: 0,
        ...(latencyMs !== undefined ? { lastSuccessLatencyMs: latencyMs } : {}),
        ...(latencyMs !== undefined
          ? {
              smoothedSuccessLatencyMs: computeSmoothedSuccessLatency(
                existing?.smoothedSuccessLatencyMs,
                latencyMs
              )
            }
          : {}),
        ...(now !== undefined ? { lastSuccessAt: now } : {}),
        ...(existing?.lastFailureAt !== undefined
          ? { lastFailureAt: existing.lastFailureAt }
          : {})
      });
      return Promise.resolve();
    },
    recordRetryableFailure(target, policy, now) {
      const state = getOrCreateCircuitState(target);
      const nextFailures = state.consecutiveRetryableFailures + 1;

      state.consecutiveRetryableFailures = nextFailures;

      if (state.probeStartedAt !== undefined || nextFailures >= policy.threshold) {
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

  const { consecutiveRetryableFailures, openedAt, probeStartedAt } = value;

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

  const {
    lastSuccessLatencyMs,
    smoothedSuccessLatencyMs,
    lastSuccessAt,
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
    lastSuccessAt !== undefined &&
    (typeof lastSuccessAt !== "number" || !Number.isInteger(lastSuccessAt))
  ) {
    throw new Error("Provider circuit state lastSuccessAt is invalid");
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
    ...(lastSuccessLatencyMs !== undefined ? { lastSuccessLatencyMs } : {}),
    ...(smoothedSuccessLatencyMs !== undefined
      ? { smoothedSuccessLatencyMs }
      : {}),
    ...(lastSuccessAt !== undefined ? { lastSuccessAt } : {}),
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
        const next = {
          consecutiveRetryableFailures: 0,
          ...(body.latencyMs !== undefined
            ? { lastSuccessLatencyMs: body.latencyMs }
            : {}),
          ...(nextSmoothedLatencyMs !== undefined
            ? { smoothedSuccessLatencyMs: nextSmoothedLatencyMs }
            : {}),
          ...(body.now !== undefined ? { lastSuccessAt: body.now } : {}),
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

        if (body.now - current.openedAt < cooldownMs) {
          return Response.json({ claimed: false });
        }

        if (
          current.probeStartedAt !== undefined &&
          body.now - current.probeStartedAt < cooldownMs
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
      const next: ProviderCircuitState = {
        consecutiveRetryableFailures: nextFailures,
        ...(current.lastSuccessLatencyMs !== undefined
          ? { lastSuccessLatencyMs: current.lastSuccessLatencyMs }
          : {}),
        ...(current.smoothedSuccessLatencyMs !== undefined
          ? { smoothedSuccessLatencyMs: current.smoothedSuccessLatencyMs }
          : {}),
        ...(current.lastSuccessAt !== undefined
          ? { lastSuccessAt: current.lastSuccessAt }
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
    async recordSuccess(target, latencyMs, now) {
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
              ...(now !== undefined ? { now } : {})
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
    currentNow - state.openedAt >= policy.cooldownMs &&
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

  if (currentNow - state.openedAt < policy.cooldownMs) {
    return state;
  }

  if (
    state.probeStartedAt !== undefined &&
    currentNow - state.probeStartedAt < policy.cooldownMs
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
