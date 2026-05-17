import type { Hono } from "hono";

import { requireAdminScope } from "../admin-auth.js";
import type { GatewayBindings } from "../env.js";
import {
  resolveGatewayConfigWithOverlay,
  computeConfigFingerprint,
  type GatewayConfig
} from "../config.js";
import { type ModelRoute } from "@airlock/routing";
import { type ProviderCircuitState } from "@airlock/governance";
import { getAllInMemoryCircuitBreakerStates } from "../circuit-breaker.js";

type GatewayApp = Hono<{
  Bindings: GatewayBindings;
  Variables: {
    requestId: string;
    fetcher?: typeof fetch;
    requestStartedAt: number;
  };
}>;

export interface RouteStatusEntry {
  externalModel: string;
  primaryTarget: { provider: string; providerModel: string };
  fallbackCount: number;
  targetSelection?: {
    strategy: string;
    hasRequestClassAffinity: boolean;
  };
  requiredKeyTier?: string;
  requiredKeyTags?: string[];
}

export interface ProviderStatusEntry {
  id: string;
  configured: boolean;
  routeCount: number;
}

export interface CircuitBreakerStatusSummary {
  totalTargets: number;
  openTargets: string[];
  halfOpenTargets: string[];
}

export interface GatewayStatusConfig {
  providerTimeoutMs: number;
  providerMaxRetries: number;
  providerStreamIdleTimeoutMs: number;
  maxRequestBodyBytes: number;
  routingLatencyFreshnessMs: number;
  routingCostFreshnessMs: number;
  routingFailureFreshnessMs: number;
  routingRecoveryWindowMs: number;
  circuitBreakerThreshold?: number;
  circuitBreakerCooldownMs?: number;
}

export interface GatewayStatusResponse {
  configFingerprint: string;
  mode: string;
  routes: RouteStatusEntry[];
  providers: ProviderStatusEntry[];
  keys: {
    total: number;
    configured: number;
    registryOwned: number;
  };
  circuitBreaker: CircuitBreakerStatusSummary;
  config: GatewayStatusConfig;
}

export function buildGatewayStatusResponse(
  config: GatewayConfig,
  circuitBreakerStates: ReadonlyMap<string, ProviderCircuitState>,
  configFingerprint: string
): GatewayStatusResponse {
  const routes = buildRouteStatusEntries(config.modelAliases);
  const providers = buildProviderStatusEntries(config, routes);
  const keyCounts = buildKeyCounts(config);

  const openTargets: string[] = [];
  const halfOpenTargets: string[] = [];
  for (const [targetKey, state] of circuitBreakerStates) {
    // openedAt present means the circuit has been opened (not yet closed)
    if (state.openedAt !== undefined) {
      openTargets.push(targetKey);
    } else if (state.halfOpen) {
      halfOpenTargets.push(targetKey);
    }
  }

  return {
    configFingerprint,
    mode: config.mode,
    routes,
    providers,
    keys: keyCounts,
    circuitBreaker: {
      totalTargets: circuitBreakerStates.size,
      openTargets,
      halfOpenTargets
    },
    config: {
      providerTimeoutMs: config.providerTimeoutMs,
      providerMaxRetries: config.providerMaxRetries,
      providerStreamIdleTimeoutMs: config.providerStreamIdleTimeoutMs,
      maxRequestBodyBytes: config.maxRequestBodyBytes,
      routingLatencyFreshnessMs: config.routingLatencyFreshnessMs,
      routingCostFreshnessMs: config.routingCostFreshnessMs,
      routingFailureFreshnessMs: config.routingFailureFreshnessMs,
      routingRecoveryWindowMs: config.routingRecoveryWindowMs,
      ...(config.providerCircuitBreakerThreshold !== undefined
        ? { circuitBreakerThreshold: config.providerCircuitBreakerThreshold }
        : {}),
      ...(config.providerCircuitBreakerCooldownMs !== undefined
        ? { circuitBreakerCooldownMs: config.providerCircuitBreakerCooldownMs }
        : {})
    }
  };
}

function buildRouteStatusEntries(
  modelAliases: readonly ModelRoute[]
): RouteStatusEntry[] {
  return modelAliases.map((route) => ({
    externalModel: route.externalModel,
    primaryTarget: {
      provider: route.target.provider,
      providerModel: route.target.providerModel
    },
    fallbackCount: route.fallbacks?.length ?? 0,
    ...(route.targetSelection
      ? {
          targetSelection: {
            strategy: route.targetSelection.strategy,
            hasRequestClassAffinity:
              route.targetSelection.requestClassAffinity !== undefined
          }
        }
      : {}),
    ...(route.requiredKeyTier
      ? { requiredKeyTier: route.requiredKeyTier }
      : {}),
    ...(route.requiredKeyTags ? { requiredKeyTags: route.requiredKeyTags } : {})
  }));
}

function buildProviderStatusEntries(
  config: GatewayConfig,
  routes: RouteStatusEntry[]
): ProviderStatusEntry[] {
  const providerIds = new Set<string>();
  for (const route of routes) {
    providerIds.add(route.primaryTarget.provider);
  }

  const configuredProviders = new Set<string>();
  if (config.openAI) {
    configuredProviders.add("openai");
  }
  if (config.anthropic) {
    configuredProviders.add("anthropic");
  }
  if (config.gemini) {
    configuredProviders.add("gemini");
  }

  const allProviders = new Set([...providerIds, ...configuredProviders]);

  return Array.from(allProviders)
    .sort()
    .map((id) => ({
      id,
      configured: configuredProviders.has(id),
      routeCount: routes.filter((r) => r.primaryTarget.provider === id).length
    }));
}

function buildKeyCounts(config: GatewayConfig): {
  total: number;
  configured: number;
  registryOwned: number;
} {
  let configured = 0;
  let registryOwned = 0;

  for (const key of config.gatewayApiKeys) {
    configured++;
    if ("registryOwned" in key && key.registryOwned) {
      registryOwned++;
    }
  }

  return {
    total: configured,
    configured: configured - registryOwned,
    registryOwned
  };
}

export function registerAdminGatewayStatusRoutes(app: GatewayApp): void {
  app.get("/_airlock/status", async (context) => {
    await requireAdminScope(context, "status.read");
    const config = await resolveGatewayConfigWithOverlay(context.env);
    const circuitBreakerStates = getAllInMemoryCircuitBreakerStates();
    const configFingerprint = computeConfigFingerprint(context.env);
    return context.json(
      buildGatewayStatusResponse(
        config,
        circuitBreakerStates,
        configFingerprint
      )
    );
  });
}
