import type { Hono } from "hono";
import type { TelemetrySink } from "@airlock/telemetry";

import { requireAdminScope } from "../admin-auth.js";
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

interface ProviderConfigEntry {
  baseUrl: string;
  configured: true;
}

interface ProviderAvailability {
  openai: ProviderConfigEntry & { defaultModel: string };
  anthropic?: ProviderConfigEntry & { defaultMaxTokens: number };
  gemini?: ProviderConfigEntry;
}

interface RouteConfigEntry {
  externalModel: string;
  target: { provider: string; providerModel: string };
  fallbacks?: Array<{ provider: string; providerModel: string }>;
  strategy?: string;
}

interface FeatureFlags {
  circuitBreaker: { enabled: boolean; persistent: boolean };
  quota: boolean;
  tokenQuota: boolean;
  concurrency: boolean;
  registry: boolean;
  ipRateLimit: boolean;
  telemetry: boolean;
  cors: boolean;
  requestLogging: boolean;
}

interface ConfigLimits {
  providerTimeoutMs: number;
  maxRequestBodyBytes: number;
  providerStreamIdleTimeoutMs: number;
  maxRetries: number;
  retryBackoffMs: number;
}

export interface AdminConfigResponse {
  providers: ProviderAvailability;
  routes: RouteConfigEntry[];
  modelGroups: Record<string, string[]>;
  keys: {
    total: number;
    configured: number;
    registryOwned: number;
  };
  features: FeatureFlags;
  limits: ConfigLimits;
}

export function buildAdminConfigResponse(
  config: GatewayConfig
): AdminConfigResponse {
  const providers: ProviderAvailability = {
    openai: {
      baseUrl: config.openAI.baseUrl,
      defaultModel: config.openAI.defaultModel,
      configured: true
    },
    ...(config.anthropic
      ? {
          anthropic: {
            baseUrl: config.anthropic.baseUrl,
            defaultMaxTokens: config.anthropic.defaultMaxTokens,
            configured: true
          }
        }
      : {}),
    ...(config.gemini
      ? {
          gemini: {
            baseUrl: config.gemini.baseUrl,
            configured: true
          }
        }
      : {})
  };

  const routes: RouteConfigEntry[] = config.modelAliases.map((route) => ({
    externalModel: route.externalModel,
    target: {
      provider: route.target.provider,
      providerModel: route.target.providerModel
    },
    ...(route.fallbacks?.length
      ? {
          fallbacks: route.fallbacks.map((f) => ({
            provider: f.provider,
            providerModel: f.providerModel
          }))
        }
      : {}),
    ...(route.targetSelection
      ? { strategy: route.targetSelection.strategy }
      : {})
  }));

  let configured = 0;
  let registryOwned = 0;
  for (const key of config.gatewayApiKeys) {
    configured++;
    if ("registryOwned" in key && key.registryOwned) {
      registryOwned++;
    }
  }

  const features: FeatureFlags = {
    circuitBreaker: {
      enabled: config.providerCircuitBreakerThreshold !== undefined,
      persistent: config.providerCircuitBreakerPersistent === true
    },
    quota: config.gatewayApiKeys.some(
      (k) => "requestQuota" in k && k.requestQuota !== undefined
    ),
    tokenQuota: config.gatewayApiKeys.some(
      (k) => "tokenQuota" in k && k.tokenQuota !== undefined
    ),
    concurrency: config.gatewayApiKeys.some(
      (k) => "concurrencyLimit" in k && k.concurrencyLimit !== undefined
    ),
    registry: config.gatewayKeyRegistryEnabled === true,
    ipRateLimit: config.ipRateLimitPolicy !== undefined,
    telemetry: false,
    cors: false,
    requestLogging: false
  };

  const limits: ConfigLimits = {
    providerTimeoutMs: config.providerTimeoutMs,
    maxRequestBodyBytes: config.maxRequestBodyBytes,
    providerStreamIdleTimeoutMs: config.providerStreamIdleTimeoutMs,
    maxRetries: config.providerMaxRetries,
    retryBackoffMs: config.providerRetryBackoffMs
  };

  return {
    providers,
    routes,
    modelGroups: config.modelGroups,
    keys: {
      total: configured,
      configured: configured - registryOwned,
      registryOwned
    },
    features,
    limits
  };
}

export function registerAdminConfigRoutes(app: GatewayApp): void {
  app.get("/_airlock/config", async (context) => {
    await requireAdminScope(context, "keys.read");
    const config = resolveGatewayConfig(context.env);
    const response = buildAdminConfigResponse(config);
    response.features.telemetry = context.env.AIRLOCK_TELEMETRY !== undefined;
    response.features.cors = context.env.AIRLOCK_CORS_ORIGINS !== undefined;
    response.features.requestLogging =
      context.env.AIRLOCK_REQUEST_LOGGING === true;
    return context.json(response);
  });
}
