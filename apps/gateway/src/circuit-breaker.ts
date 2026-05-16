import type {
  ProviderCircuitBreakerPolicy,
  ProviderCircuitState
} from "@airlock/governance";
import {
  applyCircuitBreakerRetryableFailure,
  applyCircuitBreakerSuccess,
  isCircuitBreakerOpen,
  normalizeRecordSuccessArguments,
  parseProviderCircuitState,
  shouldAttemptHalfOpenRecovery,
  shouldClaimHalfOpenProbe
} from "@airlock/governance";
import { serializeProviderTarget, type ProviderTarget } from "@airlock/routing";

export type { ProviderCircuitBreakerPolicy, ProviderCircuitState };

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
    now?: number,
    successPolicy?: Pick<
      ProviderCircuitBreakerPolicy,
      | "errorRateWindowMs"
      | "errorRateThreshold"
      | "minAttemptsInWindow"
      | "halfOpenPromotionSuccesses"
      | "halfOpenPromotionSuccessRate"
      | "halfOpenPromotionWindow"
    >
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
    claimHalfOpenProbe(target, policy, now) {
      const state = providerCircuitStates.get(getCircuitKey(target));

      if (!state || !shouldClaimHalfOpenProbe(state, policy, now)) {
        return Promise.resolve(false);
      }

      state.probeStartedAt = now;
      return Promise.resolve(true);
    },
    recordSuccess(target, latencyMs, totalTokensOrNow, now, successPolicy) {
      const normalized = normalizeRecordSuccessArguments(totalTokensOrNow, now);
      const existing = providerCircuitStates.get(getCircuitKey(target));
      providerCircuitStates.set(
        getCircuitKey(target),
        applyCircuitBreakerSuccess(
          existing ?? { consecutiveRetryableFailures: 0 },
          latencyMs,
          normalized.totalTokens,
          normalized.now,
          successPolicy
        )
      );
      return Promise.resolve();
    },
    recordRetryableFailure(target, policy, now) {
      const state = getOrCreateCircuitState(target);
      const next = applyCircuitBreakerRetryableFailure(
        state,
        policy.threshold,
        now,
        policy
      );
      Object.assign(state, next);
      delete state.probeStartedAt;
      return Promise.resolve();
    }
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
        errorRateWindowMs?: number;
        errorRateThreshold?: number;
        minAttemptsInWindow?: number;
        halfOpenPromotionSuccesses?: number;
        halfOpenPromotionSuccessRate?: number;
        halfOpenPromotionWindow?: number;
      };
      const current = (await this.state.storage.get<ProviderCircuitState>(
        "state"
      )) ?? {
        consecutiveRetryableFailures: 0
      };

      if (body.kind === "success") {
        const hasErrorRatePolicy = body.errorRateWindowMs !== undefined;
        const hasPromotionPolicy =
          body.halfOpenPromotionSuccesses !== undefined ||
          body.halfOpenPromotionSuccessRate !== undefined ||
          body.halfOpenPromotionWindow !== undefined;
        const successPolicy =
          hasErrorRatePolicy || hasPromotionPolicy
            ? {
                ...(hasErrorRatePolicy
                  ? {
                      errorRateWindowMs: body.errorRateWindowMs!,
                      ...(body.errorRateThreshold !== undefined
                        ? { errorRateThreshold: body.errorRateThreshold }
                        : {}),
                      ...(body.minAttemptsInWindow !== undefined
                        ? { minAttemptsInWindow: body.minAttemptsInWindow }
                        : {})
                    }
                  : {}),
                ...(body.halfOpenPromotionSuccesses !== undefined
                  ? {
                      halfOpenPromotionSuccesses:
                        body.halfOpenPromotionSuccesses
                    }
                  : {}),
                ...(body.halfOpenPromotionSuccessRate !== undefined
                  ? {
                      halfOpenPromotionSuccessRate:
                        body.halfOpenPromotionSuccessRate
                    }
                  : {}),
                ...(body.halfOpenPromotionWindow !== undefined
                  ? { halfOpenPromotionWindow: body.halfOpenPromotionWindow }
                  : {})
              }
            : undefined;
        const next = applyCircuitBreakerSuccess(
          current,
          body.latencyMs,
          body.totalTokens,
          body.now,
          successPolicy
        );
        await this.state.storage.put("state", next);
        return Response.json(next);
      }

      if (body.kind === "claim_half_open_probe") {
        const policy: ProviderCircuitBreakerPolicy = {
          threshold: body.threshold ?? 1,
          cooldownMs: body.cooldownMs ?? 0
        };

        if (
          body.now === undefined ||
          !shouldClaimHalfOpenProbe(current, policy, body.now)
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

      const errorRatePolicy =
        body.errorRateWindowMs !== undefined
          ? {
              errorRateWindowMs: body.errorRateWindowMs,
              ...(body.errorRateThreshold !== undefined
                ? { errorRateThreshold: body.errorRateThreshold }
                : {}),
              ...(body.minAttemptsInWindow !== undefined
                ? { minAttemptsInWindow: body.minAttemptsInWindow }
                : {})
            }
          : undefined;
      const raw = applyCircuitBreakerRetryableFailure(
        current,
        body.threshold ?? 1,
        body.now ?? Date.now(),
        errorRatePolicy
      );
      const { probeStartedAt: _removed, ...next } = raw;
      void _removed;
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
    async recordSuccess(
      target,
      latencyMs,
      totalTokensOrNow,
      now,
      successPolicy
    ) {
      const normalized = normalizeRecordSuccessArguments(totalTokensOrNow, now);
      await namespace.get(namespace.idFromName(getCircuitKey(target))).fetch(
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
            ...(normalized.now !== undefined ? { now: normalized.now } : {}),
            ...(successPolicy?.errorRateWindowMs !== undefined
              ? { errorRateWindowMs: successPolicy.errorRateWindowMs }
              : {}),
            ...(successPolicy?.errorRateThreshold !== undefined
              ? { errorRateThreshold: successPolicy.errorRateThreshold }
              : {}),
            ...(successPolicy?.minAttemptsInWindow !== undefined
              ? { minAttemptsInWindow: successPolicy.minAttemptsInWindow }
              : {}),
            ...(successPolicy?.halfOpenPromotionSuccesses !== undefined
              ? {
                  halfOpenPromotionSuccesses:
                    successPolicy.halfOpenPromotionSuccesses
                }
              : {}),
            ...(successPolicy?.halfOpenPromotionSuccessRate !== undefined
              ? {
                  halfOpenPromotionSuccessRate:
                    successPolicy.halfOpenPromotionSuccessRate
                }
              : {}),
            ...(successPolicy?.halfOpenPromotionWindow !== undefined
              ? {
                  halfOpenPromotionWindow: successPolicy.halfOpenPromotionWindow
                }
              : {})
          })
        })
      );
    },
    async recordRetryableFailure(target, policy, now) {
      await namespace.get(namespace.idFromName(getCircuitKey(target))).fetch(
        new Request("https://airlock.internal/provider-circuit-breaker", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            kind: "retryable_failure",
            threshold: policy.threshold,
            now,
            ...(policy.errorRateWindowMs !== undefined
              ? {
                  errorRateWindowMs: policy.errorRateWindowMs,
                  ...(policy.errorRateThreshold !== undefined
                    ? { errorRateThreshold: policy.errorRateThreshold }
                    : {}),
                  ...(policy.minAttemptsInWindow !== undefined
                    ? { minAttemptsInWindow: policy.minAttemptsInWindow }
                    : {})
                }
              : {})
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
  return isCircuitBreakerOpen(state, policy, now());
}

export async function getProviderTargetCircuitState(
  target: ProviderTarget,
  policy: ProviderCircuitBreakerPolicy,
  now: () => number,
  backend: ProviderCircuitBreakerBackend
): Promise<ProviderCircuitState | undefined> {
  const state = await backend.getState(target);

  if (!state || !shouldAttemptHalfOpenRecovery(state, policy, now())) {
    return state;
  }

  const currentNow = now();
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

export function getAllInMemoryCircuitBreakerStates(): ReadonlyMap<
  string,
  ProviderCircuitState
> {
  return providerCircuitStates;
}

export function resetProviderCircuitBreakerState() {
  providerCircuitStates.clear();
}
