import { serializeProviderTarget, type ProviderTarget } from "@airlock/routing";

export interface ProviderCircuitBreakerPolicy {
  threshold: number;
  cooldownMs: number;
}

export interface ProviderCircuitState {
  consecutiveRetryableFailures: number;
  openedAt?: number;
  lastSuccessLatencyMs?: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
}

export interface ProviderCircuitBreakerBackend {
  getState(target: ProviderTarget): Promise<ProviderCircuitState | undefined>;
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

export function createInMemoryCircuitBreakerBackend(): ProviderCircuitBreakerBackend {
  return {
    getState(target) {
      return Promise.resolve(providerCircuitStates.get(getCircuitKey(target)));
    },
    recordSuccess(target, latencyMs, now) {
      providerCircuitStates.set(getCircuitKey(target), {
        consecutiveRetryableFailures: 0,
        ...(latencyMs !== undefined ? { lastSuccessLatencyMs: latencyMs } : {}),
        ...(now !== undefined ? { lastSuccessAt: now } : {})
      });
      return Promise.resolve();
    },
    recordRetryableFailure(target, policy, now) {
      const state = getOrCreateCircuitState(target);
      const nextFailures = state.consecutiveRetryableFailures + 1;

      state.consecutiveRetryableFailures = nextFailures;

      if (nextFailures >= policy.threshold) {
        state.openedAt = now;
      }

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

  const { consecutiveRetryableFailures, openedAt } = value;

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

  const { lastSuccessLatencyMs, lastSuccessAt, lastFailureAt } = value;

  if (
    lastSuccessLatencyMs !== undefined &&
    (typeof lastSuccessLatencyMs !== "number" ||
      !Number.isFinite(lastSuccessLatencyMs) ||
      lastSuccessLatencyMs < 0)
  ) {
    throw new Error("Provider circuit state lastSuccessLatencyMs is invalid");
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
    ...(lastSuccessLatencyMs !== undefined ? { lastSuccessLatencyMs } : {}),
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
        kind: "success" | "retryable_failure";
        threshold?: number;
        latencyMs?: number;
        now?: number;
      };
      const current =
        (await this.state.storage.get<ProviderCircuitState>("state")) ?? {
          consecutiveRetryableFailures: 0
        };

      if (body.kind === "success") {
        const next = {
          consecutiveRetryableFailures: 0,
          ...(body.latencyMs !== undefined
            ? { lastSuccessLatencyMs: body.latencyMs }
            : {}),
          ...(body.now !== undefined ? { lastSuccessAt: body.now } : {})
        };
        await this.state.storage.put("state", next);
        return Response.json(next);
      }

      const nextFailures = current.consecutiveRetryableFailures + 1;
      const next: ProviderCircuitState = {
        consecutiveRetryableFailures: nextFailures,
        ...(nextFailures >= (body.threshold ?? 1) && body.now !== undefined
          ? { openedAt: body.now }
          : {}),
        ...(body.now !== undefined ? { lastFailureAt: body.now } : {})
      };
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

  if (now() - state.openedAt >= policy.cooldownMs) {
    await backend.recordSuccess(target);
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

  if (now() - state.openedAt >= policy.cooldownMs) {
    await backend.recordSuccess(target);
    return {
      consecutiveRetryableFailures: 0
    };
  }

  return state;
}

export function resetProviderCircuitBreakerState() {
  providerCircuitStates.clear();
}
