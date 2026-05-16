import type { Hono } from "hono";
import type { TelemetrySink } from "@airlock/telemetry";
import {
  authorizeInternalAdminRequest,
  deriveProviderTargetHealthSnapshot,
  getSlidingWindowErrorRate,
  getRecoveryScore,
  parseInternalAdminCredentials,
  type InternalAdminScope,
  type ProviderCircuitState,
  type ProviderTargetHealthSnapshot
} from "@airlock/governance";
import { serializeProviderTarget } from "@airlock/routing";

import { getAllInMemoryCircuitBreakerStates } from "../circuit-breaker.js";
import type { GatewayConfig } from "../config.js";
import { resolveGatewayConfig } from "../config.js";
import type { GatewayBindings } from "../env.js";

type AppVariables = {
  requestId: string;
  fetcher?: typeof fetch;
  requestStartedAt: number;
  telemetrySink?: TelemetrySink;
  telemetryErrorEmitted?: boolean;
};

type GatewayApp = Hono<{
  Bindings: GatewayBindings;
  Variables: AppVariables;
}>;

export function registerAdminRoutingHealthRoutes(
  app: GatewayApp,
  getNow?: () => () => number
) {
  const requireAdminScope = async (
    context: {
      req: { header(name: string): string | undefined };
      env: GatewayBindings;
      get(key: "requestId"): string;
    },
    requiredScope: InternalAdminScope
  ): Promise<void> => {
    await authorizeInternalAdminRequest({
      authorization: context.req.header("authorization"),
      adminToken: context.env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
      adminCredentials: parseInternalAdminCredentials(
        context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS
      ),
      structuredCredentialsConfig:
        context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS,
      requiredScope,
      requestId: context.get("requestId")
    });
  };

  app.get("/_airlock/routing/health", async (context) => {
    await requireAdminScope(context, "keys.read");

    const config = resolveGatewayConfig(context.env);
    const now = getNow ? getNow()() : Date.now();
    return context.json(buildRoutingHealthResponse(config, now));
  });
}

interface TargetHealthEntry {
  circuitState: Record<string, unknown>;
  healthSnapshot: Record<string, unknown>;
  metrics: {
    errorRate: number;
    recoveryScore: number;
    freshness: {
      latencyFreshMs: number | null;
      costFreshMs: number | null;
      failureFreshMs: number | null;
    };
  };
}

interface RouteEntry {
  strategy: string;
  targets: string[];
  costs?: Record<string, number>;
  weights?: Record<string, number>;
  latencySloMs?: Record<string, number>;
}

export interface RoutingHealthResponse {
  targets: Record<string, TargetHealthEntry>;
  routes: Record<string, RouteEntry>;
  config: {
    circuitBreakerPolicy: {
      threshold: number;
      cooldownMs: number;
      errorRateWindowMs?: number;
      errorRateThreshold?: number;
      minAttemptsInWindow?: number;
    };
    freshnessWindows: {
      latencyFreshnessMs: number;
      costFreshnessMs: number;
      failureFreshnessMs: number;
      recoveryWindowMs: number;
    };
    persistentBackend: boolean;
  };
}

export function buildRoutingHealthResponse(
  config: GatewayConfig,
  now: number
): RoutingHealthResponse {
  const allStates = getAllInMemoryCircuitBreakerStates();
  const freshnessWindows = {
    latencyFreshnessMs: config.routingLatencyFreshnessMs,
    costFreshnessMs: config.routingCostFreshnessMs,
    failureFreshnessMs: config.routingFailureFreshnessMs,
    recoveryWindowMs: config.routingRecoveryWindowMs
  };

  const targets: Record<string, TargetHealthEntry> = {};

  for (const [targetKey, circuitState] of allStates) {
    const healthSnapshot = deriveProviderTargetHealthSnapshot(circuitState);
    const latencyFreshMs =
      healthSnapshot.lastSuccessAt !== undefined
        ? Math.max(0, now - healthSnapshot.lastSuccessAt)
        : null;
    const costFreshMs =
      healthSnapshot.lastUsageObservedAt !== undefined
        ? Math.max(0, now - healthSnapshot.lastUsageObservedAt)
        : null;
    const failureFreshMs =
      healthSnapshot.lastFailureAt !== undefined
        ? Math.max(0, now - healthSnapshot.lastFailureAt)
        : null;

    targets[targetKey] = {
      circuitState: serializeCircuitState(circuitState),
      healthSnapshot: serializeHealthSnapshot(healthSnapshot),
      metrics: {
        errorRate: getSlidingWindowErrorRate(healthSnapshot),
        recoveryScore: getRecoveryScore(healthSnapshot),
        freshness: { latencyFreshMs, costFreshMs, failureFreshMs }
      }
    };
  }

  const routes: Record<string, RouteEntry> = {};

  for (const route of config.modelAliases) {
    const allTargets = [route.target, ...(route.fallbacks ?? [])].map((t) =>
      serializeProviderTarget(t)
    );

    const entry: RouteEntry = {
      strategy: route.targetSelection?.strategy ?? "ordered",
      targets: allTargets
    };

    if (route.targetSelection) {
      if ("costs" in route.targetSelection && route.targetSelection.costs) {
        entry.costs = route.targetSelection.costs;
      }
      if ("weights" in route.targetSelection && route.targetSelection.weights) {
        entry.weights = route.targetSelection.weights;
      }
      if (
        "latencySloMs" in route.targetSelection &&
        route.targetSelection.latencySloMs
      ) {
        entry.latencySloMs = route.targetSelection.latencySloMs;
      }
    }

    routes[route.externalModel] = entry;
  }

  return {
    targets,
    routes,
    config: {
      circuitBreakerPolicy: {
        threshold: config.providerCircuitBreakerThreshold ?? 1,
        cooldownMs: config.providerCircuitBreakerCooldownMs ?? 0,
        ...(config.providerCircuitBreakerErrorRateWindowMs !== undefined
          ? {
              errorRateWindowMs: config.providerCircuitBreakerErrorRateWindowMs
            }
          : {}),
        ...(config.providerCircuitBreakerErrorRateThreshold !== undefined
          ? {
              errorRateThreshold:
                config.providerCircuitBreakerErrorRateThreshold
            }
          : {}),
        ...(config.providerCircuitBreakerMinAttemptsInWindow !== undefined
          ? {
              minAttemptsInWindow:
                config.providerCircuitBreakerMinAttemptsInWindow
            }
          : {})
      },
      freshnessWindows,
      persistentBackend: config.providerCircuitBreakerPersistent === true
    }
  };
}

function serializeCircuitState(
  state: ProviderCircuitState
): Record<string, unknown> {
  const { halfOpen: _removed, ...rest } = state;
  void _removed;
  return { ...rest };
}

function serializeHealthSnapshot(
  snapshot: ProviderTargetHealthSnapshot
): Record<string, unknown> {
  return { ...snapshot };
}
