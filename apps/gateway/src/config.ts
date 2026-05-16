import {
  assertGatewayApiKeysRuntimeDependencies,
  parseGatewayApiKeys,
  parseInternalAdminCredentials,
  parseIpRateLimitPolicy,
  type GatewayApiKeyRecord,
  type InternalAdminCredential,
  type IpRateLimitPolicy
} from "@airlock/governance";
import { parseRouteRequestShaping } from "@airlock/request-shaping";
import {
  attachRouteFallbacks,
  attachRouteKeyAccessPolicy,
  attachRouteRequestShaping,
  attachRouteTargetSelection,
  parseModelAliases,
  parseRouteFallbacks,
  parseRouteKeyAccessPolicy,
  parseRouteTargetSelection,
  type ModelRouteDirectory
} from "@airlock/routing";
import { GatewayError } from "@airlock/shared";

import type { GatewayBindings } from "./env.js";

import { gatewayEnvSchema } from "./env.js";
import {
  fetchConfigStoreSnapshot,
  type DashboardConfigOverlay,
  type DashboardProvidersConfig,
  type StoredConfigSnapshot
} from "./gateway-config-store.js";

export type ModelGroupMap = Record<string, string[]>;

export interface GatewayConfig {
  mode: "free" | "scale";
  providerTimeoutMs: number;
  providerMaxRetries: number;
  providerRetryBackoffMs: number;
  providerStreamIdleTimeoutMs: number;
  maxRequestBodyBytes: number;
  providerCircuitBreakerThreshold?: number;
  providerCircuitBreakerCooldownMs?: number;
  providerCircuitBreakerPersistent?: boolean;
  providerCircuitBreakerErrorRateWindowMs?: number;
  providerCircuitBreakerErrorRateThreshold?: number;
  providerCircuitBreakerMinAttemptsInWindow?: number;
  providerCircuitBreakerHalfOpenPromotionSuccesses?: number;
  providerCircuitBreakerHalfOpenPromotionSuccessRate?: number;
  providerCircuitBreakerHalfOpenPromotionWindow?: number;
  routingLatencyFreshnessMs: number;
  routingCostFreshnessMs: number;
  routingFailureFreshnessMs: number;
  routingRecoveryWindowMs: number;
  gatewayKeyRegistryEnabled?: boolean;
  internalAdminCredentials?: InternalAdminCredential[];
  gatewayApiKeys: GatewayApiKeyRecord[];
  requestSigningSecrets?: Record<string, string>;
  ipRateLimitPolicy?: IpRateLimitPolicy;
  modelGroups: ModelGroupMap;
  modelAliases: ModelRouteDirectory;
  anthropic?: {
    apiKey: string;
    baseUrl: string;
    defaultMaxTokens: number;
  };
  gemini?: {
    apiKey: string;
    baseUrl: string;
  };
  openAI: {
    apiKey: string;
    baseUrl: string;
    defaultModel: string;
  };
}

function parseModelGroups(value: string | undefined): ModelGroupMap {
  if (!value) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw new GatewayError("Model group config must be valid JSON", {
      code: "config_invalid_model_groups",
      category: "configuration",
      httpStatus: 500,
      retryable: false
    });
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new GatewayError("Model group config must be a JSON object", {
      code: "config_invalid_model_groups",
      category: "configuration",
      httpStatus: 500,
      retryable: false
    });
  }

  const modelGroups: ModelGroupMap = {};

  for (const [groupName, members] of Object.entries(parsed)) {
    if (groupName.trim().length === 0) {
      throw new GatewayError("Model group names must be non-empty", {
        code: "config_invalid_model_groups",
        category: "configuration",
        httpStatus: 500,
        retryable: false
      });
    }

    if (!Array.isArray(members)) {
      throw new GatewayError("Model group members must be arrays", {
        code: "config_invalid_model_groups",
        category: "configuration",
        httpStatus: 500,
        retryable: false
      });
    }

    const normalizedMembers = members.map((member) => {
      if (typeof member !== "string" || member.trim().length === 0) {
        throw new GatewayError(
          "Model group members must be non-empty strings",
          {
            code: "config_invalid_model_groups",
            category: "configuration",
            httpStatus: 500,
            retryable: false
          }
        );
      }

      return member.trim();
    });

    if (new Set(normalizedMembers).size !== normalizedMembers.length) {
      throw new GatewayError(
        "Model group members must be unique within a group",
        {
          code: "config_invalid_model_groups",
          category: "configuration",
          httpStatus: 500,
          retryable: false
        }
      );
    }

    modelGroups[groupName.trim()] = normalizedMembers;
  }

  return modelGroups;
}

function validateModelGroups(
  modelGroups: ModelGroupMap,
  modelAliases: ModelRouteDirectory,
  gatewayApiKeys: GatewayApiKeyRecord[]
) {
  const configuredExternalModels = new Set(
    modelAliases.map((route) => route.externalModel)
  );

  for (const [, members] of Object.entries(modelGroups)) {
    for (const member of members) {
      if (!configuredExternalModels.has(member)) {
        throw new GatewayError(
          `Model group references an unknown external model: ${member}`,
          {
            code: "config_invalid_model_groups",
            category: "configuration",
            httpStatus: 500,
            retryable: false
          }
        );
      }
    }
  }

  for (const gatewayApiKey of gatewayApiKeys) {
    const allowedModelGroups = gatewayApiKey.policy?.allowedModelGroups;

    if (!allowedModelGroups) {
      continue;
    }

    for (const groupName of allowedModelGroups) {
      if (!modelGroups[groupName]) {
        throw new GatewayError(
          `Gateway API key policy references an unknown model group: ${groupName}`,
          {
            code: "config_invalid_model_groups",
            category: "configuration",
            httpStatus: 500,
            retryable: false
          }
        );
      }
    }
  }
}

function parseRequestSigningSecrets(
  value: string | undefined
): Record<string, string> {
  if (!value) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw new GatewayError(
      "Request signing secrets config must be valid JSON",
      {
        code: "config_invalid_request_signing_secrets",
        category: "configuration",
        httpStatus: 500,
        retryable: false
      }
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new GatewayError(
      "Request signing secrets config must be a JSON object",
      {
        code: "config_invalid_request_signing_secrets",
        category: "configuration",
        httpStatus: 500,
        retryable: false
      }
    );
  }

  const secrets: Record<string, string> = {};

  for (const [key, secretValue] of Object.entries(parsed)) {
    const normalizedKey = key.trim();

    if (normalizedKey.length === 0) {
      throw new GatewayError(
        "Request signing secret keys must be non-empty strings",
        {
          code: "config_invalid_request_signing_secrets",
          category: "configuration",
          httpStatus: 500,
          retryable: false
        }
      );
    }

    if (typeof secretValue !== "string" || secretValue.length === 0) {
      throw new GatewayError(
        "Request signing secret values must be non-empty strings",
        {
          code: "config_invalid_request_signing_secrets",
          category: "configuration",
          httpStatus: 500,
          retryable: false
        }
      );
    }

    secrets[normalizedKey] = secretValue;
  }

  return secrets;
}

/**
 * Compute a fingerprint from the config-relevant env strings.
 * If these values haven't changed, the parsed config is identical.
 */
export function computeConfigFingerprint(bindings: GatewayBindings): string {
  return [
    bindings.AIRLOCK_MODE,
    bindings.AIRLOCK_GATEWAY_API_KEYS,
    bindings.AIRLOCK_MODEL_ALIASES,
    bindings.AIRLOCK_MODEL_FALLBACKS,
    bindings.AIRLOCK_MODEL_TARGET_SELECTION,
    bindings.AIRLOCK_MODEL_KEY_POLICY,
    bindings.AIRLOCK_MODEL_SHAPING,
    bindings.AIRLOCK_MODEL_GROUPS,
    bindings.AIRLOCK_REQUEST_SIGNING_SECRETS,
    bindings.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS,
    bindings.AIRLOCK_INTERNAL_ADMIN_TOKEN,
    bindings.AIRLOCK_INTERNAL_ADMIN_ACTOR_HEADER,
    bindings.AIRLOCK_INTERNAL_ADMIN_ACTOR_REQUIRED,
    bindings.AIRLOCK_CORS_ORIGINS,
    bindings.AIRLOCK_PROVIDER_TIMEOUT_MS,
    bindings.AIRLOCK_PROVIDER_MAX_RETRIES,
    bindings.AIRLOCK_PROVIDER_RETRY_BACKOFF_MS,
    bindings.AIRLOCK_PROVIDER_STREAM_IDLE_TIMEOUT_MS,
    bindings.AIRLOCK_MAX_REQUEST_BODY_BYTES,
    bindings.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_THRESHOLD,
    bindings.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS,
    bindings.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_PERSISTENT,
    bindings.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_ERROR_RATE_WINDOW_MS,
    bindings.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_ERROR_RATE_THRESHOLD,
    bindings.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_MIN_ATTEMPTS_IN_WINDOW,
    bindings.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_HALF_OPEN_PROMOTION_SUCCESSES,
    bindings.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_HALF_OPEN_PROMOTION_SUCCESS_RATE,
    bindings.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_HALF_OPEN_PROMOTION_WINDOW,
    bindings.AIRLOCK_ROUTING_LATENCY_FRESHNESS_MS,
    bindings.AIRLOCK_ROUTING_COST_FRESHNESS_MS,
    bindings.AIRLOCK_ROUTING_FAILURE_FRESHNESS_MS,
    bindings.AIRLOCK_ROUTING_RECOVERY_WINDOW_MS,
    bindings.AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED,
    bindings.OPENAI_API_KEY,
    bindings.OPENAI_BASE_URL,
    bindings.OPENAI_DEFAULT_MODEL,
    bindings.ANTHROPIC_API_KEY,
    bindings.ANTHROPIC_BASE_URL,
    bindings.ANTHROPIC_DEFAULT_MAX_TOKENS,
    bindings.GEMINI_API_KEY,
    bindings.GEMINI_BASE_URL,
    bindings.AIRLOCK_GATEWAY_KEY_QUOTA !== undefined ? "1" : "0",
    bindings.AIRLOCK_GATEWAY_KEY_TOKEN_QUOTA !== undefined ? "1" : "0",
    bindings.AIRLOCK_GATEWAY_KEY_CONCURRENCY !== undefined ? "1" : "0",
    bindings.AIRLOCK_GATEWAY_KEY_REGISTRY !== undefined ? "1" : "0",
    bindings.AIRLOCK_GATEWAY_KEY_REVOCATION !== undefined ? "1" : "0",
    bindings.AIRLOCK_PROVIDER_CIRCUIT_BREAKER !== undefined ? "1" : "0",
    bindings.AIRLOCK_IP_RATE_LIMIT !== undefined ? "1" : "0",
    bindings.AIRLOCK_IP_RATE_LIMIT_POLICY ?? "",
    bindings.AIRLOCK_TELEMETRY ?? "",
    bindings.AIRLOCK_REQUEST_LOGGING ?? "",
    bindings.AIRLOCK_CONFIG_STORE !== undefined ? "1" : "0"
  ].join("\0");
}

let configCache: { fingerprint: string; config: GatewayConfig } | undefined;

/** Reset config cache (for testing). */
export function resetConfigCache(): void {
  configCache = undefined;
}

export function resolveGatewayConfig(bindings: GatewayBindings): GatewayConfig {
  const fingerprint = computeConfigFingerprint(bindings);
  if (configCache && configCache.fingerprint === fingerprint) {
    return configCache.config;
  }

  const config = parseGatewayConfigUncached(bindings);
  configCache = { fingerprint, config };
  return config;
}

function parseGatewayConfigUncached(bindings: GatewayBindings): GatewayConfig {
  const env = gatewayEnvSchema.parse(bindings);
  const gatewayApiKeys = parseGatewayApiKeys(env.AIRLOCK_GATEWAY_API_KEYS);
  const requestSigningSecrets = parseRequestSigningSecrets(
    env.AIRLOCK_REQUEST_SIGNING_SECRETS
  );
  const internalAdminCredentials = parseInternalAdminCredentials(
    env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS
  );
  const modelAliases = attachRouteTargetSelection(
    attachRouteFallbacks(
      attachRouteRequestShaping(
        attachRouteKeyAccessPolicy(
          parseModelAliases(
            env.AIRLOCK_MODEL_ALIASES,
            env.OPENAI_DEFAULT_MODEL
          ),
          parseRouteKeyAccessPolicy(env.AIRLOCK_MODEL_KEY_POLICY)
        ),
        parseRouteRequestShaping(env.AIRLOCK_MODEL_SHAPING)
      ),
      parseRouteFallbacks(env.AIRLOCK_MODEL_FALLBACKS)
    ),
    parseRouteTargetSelection(env.AIRLOCK_MODEL_TARGET_SELECTION)
  );
  const modelGroups = parseModelGroups(env.AIRLOCK_MODEL_GROUPS);
  validateModelGroups(modelGroups, modelAliases, gatewayApiKeys);
  assertGatewayApiKeysRuntimeDependencies(gatewayApiKeys, {
    gatewayKeyQuota: env.AIRLOCK_GATEWAY_KEY_QUOTA !== undefined,
    gatewayKeyTokenQuota: env.AIRLOCK_GATEWAY_KEY_TOKEN_QUOTA !== undefined,
    gatewayKeyConcurrency: env.AIRLOCK_GATEWAY_KEY_CONCURRENCY !== undefined
  });

  if (
    env.AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED &&
    !env.AIRLOCK_GATEWAY_KEY_REGISTRY
  ) {
    throw new GatewayError("Gateway key registry binding is required", {
      code: "config_missing_gateway_key_registry",
      category: "configuration",
      httpStatus: 500,
      retryable: false
    });
  }

  if (
    (env.AIRLOCK_INTERNAL_ADMIN_TOKEN || internalAdminCredentials.length > 0) &&
    !env.AIRLOCK_GATEWAY_KEY_REVOCATION
  ) {
    throw new GatewayError("Gateway key revocation binding is required", {
      code: "config_missing_gateway_key_revocation",
      category: "configuration",
      httpStatus: 500,
      retryable: false
    });
  }

  if (
    env.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_PERSISTENT &&
    !env.AIRLOCK_PROVIDER_CIRCUIT_BREAKER
  ) {
    throw new GatewayError("Provider circuit breaker binding is required", {
      code: "config_missing_provider_circuit_breaker",
      category: "configuration",
      httpStatus: 500,
      retryable: false
    });
  }

  let ipRateLimitPolicy: IpRateLimitPolicy | undefined;
  if (env.AIRLOCK_IP_RATE_LIMIT_POLICY) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(env.AIRLOCK_IP_RATE_LIMIT_POLICY);
    } catch {
      throw new GatewayError("IP rate limit policy must be valid JSON", {
        code: "config_invalid_ip_rate_limit_policy",
        category: "configuration",
        httpStatus: 500,
        retryable: false
      });
    }

    try {
      ipRateLimitPolicy = parseIpRateLimitPolicy(parsed);
    } catch (cause) {
      throw new GatewayError(
        "IP rate limit policy is invalid: " +
          (cause instanceof Error ? cause.message : String(cause)),
        {
          code: "config_invalid_ip_rate_limit_policy",
          category: "configuration",
          httpStatus: 500,
          retryable: false,
          cause: cause instanceof Error ? cause : undefined
        }
      );
    }
  }

  if (ipRateLimitPolicy && !env.AIRLOCK_IP_RATE_LIMIT) {
    throw new GatewayError(
      "IP rate limit Durable Object binding is required when policy is configured",
      {
        code: "config_missing_ip_rate_limit_binding",
        category: "configuration",
        httpStatus: 500,
        retryable: false
      }
    );
  }

  const usedProviders = new Set(
    modelAliases.flatMap((route) => {
      return [route.target, ...(route.fallbacks ?? [])].map((target) => {
        return target.provider;
      });
    })
  );
  const usesAnthropic = usedProviders.has("anthropic");
  const usesGemini = usedProviders.has("gemini");

  if (
    usesAnthropic &&
    (!env.ANTHROPIC_API_KEY ||
      !env.ANTHROPIC_BASE_URL ||
      !env.ANTHROPIC_DEFAULT_MAX_TOKENS)
  ) {
    throw new GatewayError("Anthropic configuration is required", {
      code: "config_missing_anthropic",
      category: "configuration",
      httpStatus: 500,
      retryable: false
    });
  }

  if (usesGemini && (!env.GEMINI_API_KEY || !env.GEMINI_BASE_URL)) {
    throw new GatewayError("Gemini configuration is required", {
      code: "config_missing_gemini",
      category: "configuration",
      httpStatus: 500,
      retryable: false
    });
  }

  return {
    mode: env.AIRLOCK_MODE,
    providerTimeoutMs: env.AIRLOCK_PROVIDER_TIMEOUT_MS,
    providerMaxRetries: env.AIRLOCK_PROVIDER_MAX_RETRIES,
    providerRetryBackoffMs: env.AIRLOCK_PROVIDER_RETRY_BACKOFF_MS,
    providerStreamIdleTimeoutMs: env.AIRLOCK_PROVIDER_STREAM_IDLE_TIMEOUT_MS,
    maxRequestBodyBytes: env.AIRLOCK_MAX_REQUEST_BODY_BYTES,
    providerCircuitBreakerThreshold:
      env.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_THRESHOLD,
    providerCircuitBreakerCooldownMs:
      env.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS,
    providerCircuitBreakerPersistent:
      env.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_PERSISTENT,
    ...(env.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_ERROR_RATE_WINDOW_MS !== undefined
      ? {
          providerCircuitBreakerErrorRateWindowMs:
            env.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_ERROR_RATE_WINDOW_MS
        }
      : {}),
    ...(env.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_ERROR_RATE_THRESHOLD !== undefined
      ? {
          providerCircuitBreakerErrorRateThreshold:
            env.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_ERROR_RATE_THRESHOLD
        }
      : {}),
    ...(env.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_MIN_ATTEMPTS_IN_WINDOW !==
    undefined
      ? {
          providerCircuitBreakerMinAttemptsInWindow:
            env.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_MIN_ATTEMPTS_IN_WINDOW
        }
      : {}),
    ...(env.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_HALF_OPEN_PROMOTION_SUCCESSES !==
    undefined
      ? {
          providerCircuitBreakerHalfOpenPromotionSuccesses:
            env.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_HALF_OPEN_PROMOTION_SUCCESSES
        }
      : {}),
    ...(env.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_HALF_OPEN_PROMOTION_SUCCESS_RATE !==
    undefined
      ? {
          providerCircuitBreakerHalfOpenPromotionSuccessRate:
            env.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_HALF_OPEN_PROMOTION_SUCCESS_RATE
        }
      : {}),
    ...(env.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_HALF_OPEN_PROMOTION_WINDOW !==
    undefined
      ? {
          providerCircuitBreakerHalfOpenPromotionWindow:
            env.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_HALF_OPEN_PROMOTION_WINDOW
        }
      : {}),
    routingLatencyFreshnessMs: env.AIRLOCK_ROUTING_LATENCY_FRESHNESS_MS,
    routingCostFreshnessMs: env.AIRLOCK_ROUTING_COST_FRESHNESS_MS,
    routingFailureFreshnessMs: env.AIRLOCK_ROUTING_FAILURE_FRESHNESS_MS,
    routingRecoveryWindowMs: env.AIRLOCK_ROUTING_RECOVERY_WINDOW_MS,
    gatewayKeyRegistryEnabled: env.AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED,
    internalAdminCredentials,
    gatewayApiKeys,
    requestSigningSecrets,
    ...(ipRateLimitPolicy ? { ipRateLimitPolicy } : {}),
    modelGroups,
    modelAliases,
    ...(usesAnthropic
      ? {
          anthropic: {
            apiKey: env.ANTHROPIC_API_KEY as string,
            baseUrl: env.ANTHROPIC_BASE_URL as string,
            defaultMaxTokens: env.ANTHROPIC_DEFAULT_MAX_TOKENS as number
          }
        }
      : {}),
    ...(usesGemini
      ? {
          gemini: {
            apiKey: env.GEMINI_API_KEY as string,
            baseUrl: env.GEMINI_BASE_URL as string
          }
        }
      : {}),
    openAI: {
      apiKey: env.OPENAI_API_KEY,
      baseUrl: env.OPENAI_BASE_URL,
      defaultModel: env.OPENAI_DEFAULT_MODEL
    }
  };
}

const DASHBOARD_OVERLAY_TTL_MS = 5_000;

let overlayCache: {
  snapshot: StoredConfigSnapshot;
  fetchedAt: number;
} | undefined;

export function resetDashboardOverlayCache(): void {
  overlayCache = undefined;
}

export async function resolveDashboardOverlay(
  bindings: GatewayBindings
): Promise<StoredConfigSnapshot | undefined> {
  const namespace = bindings.AIRLOCK_CONFIG_STORE;
  if (!namespace) {
    return undefined;
  }

  const now = Date.now();
  if (overlayCache && now - overlayCache.fetchedAt < DASHBOARD_OVERLAY_TTL_MS) {
    return overlayCache.snapshot;
  }

  try {
    const snapshot = await fetchConfigStoreSnapshot(namespace);
    overlayCache = { snapshot, fetchedAt: now };
    return snapshot;
  } catch {
    return overlayCache?.snapshot;
  }
}

export function mergeConfigWithOverlay(
  base: GatewayConfig,
  overlay: StoredConfigSnapshot | undefined
): GatewayConfig {
  if (!overlay || Object.keys(overlay.sections).length === 0) {
    return base;
  }

  let config = base;

  const providersSection = overlay.sections["providers"];
  if (providersSection) {
    config = mergeProvidersConfig(config, providersSection.data as DashboardProvidersConfig);
  }

  const limitsSection = overlay.sections["limits"];
  if (limitsSection) {
    config = mergeLimitsConfig(config, limitsSection.data as DashboardLimitsOverlay);
  }

  return config;
}

interface DashboardLimitsOverlay {
  providerTimeoutMs?: number;
  maxRequestBodyBytes?: number;
  providerStreamIdleTimeoutMs?: number;
  providerMaxRetries?: number;
  providerRetryBackoffMs?: number;
  providerCircuitBreakerThreshold?: number;
  providerCircuitBreakerCooldownMs?: number;
  providerCircuitBreakerPersistent?: boolean;
}

function mergeProvidersConfig(
  config: GatewayConfig,
  providers: DashboardProvidersConfig
): GatewayConfig {
  return {
    ...config,
    openAI: {
      ...config.openAI,
      ...(providers.openai
        ? {
            apiKey: providers.openai.apiKey,
            baseUrl: providers.openai.baseUrl,
            ...(providers.openai.defaultModel
              ? { defaultModel: providers.openai.defaultModel }
              : {})
          }
        : {}),
    },
    ...(providers.anthropic
      ? {
          anthropic: {
            apiKey: providers.anthropic.apiKey,
            baseUrl: providers.anthropic.baseUrl,
            defaultMaxTokens:
              providers.anthropic.defaultMaxTokens ??
              config.anthropic?.defaultMaxTokens ??
              4096
          }
        }
      : config.anthropic
        ? { anthropic: config.anthropic }
        : {}),
    ...(providers.gemini
      ? {
          gemini: {
            apiKey: providers.gemini.apiKey,
            baseUrl: providers.gemini.baseUrl
          }
        }
      : config.gemini
        ? { gemini: config.gemini }
        : {})
  };
}

function mergeLimitsConfig(
  config: GatewayConfig,
  limits: DashboardLimitsOverlay
): GatewayConfig {
  return {
    ...config,
    ...(limits.providerTimeoutMs !== undefined
      ? { providerTimeoutMs: limits.providerTimeoutMs }
      : {}),
    ...(limits.maxRequestBodyBytes !== undefined
      ? { maxRequestBodyBytes: limits.maxRequestBodyBytes }
      : {}),
    ...(limits.providerStreamIdleTimeoutMs !== undefined
      ? { providerStreamIdleTimeoutMs: limits.providerStreamIdleTimeoutMs }
      : {}),
    ...(limits.providerMaxRetries !== undefined
      ? { providerMaxRetries: limits.providerMaxRetries }
      : {}),
    ...(limits.providerRetryBackoffMs !== undefined
      ? { providerRetryBackoffMs: limits.providerRetryBackoffMs }
      : {}),
    ...(limits.providerCircuitBreakerThreshold !== undefined
      ? { providerCircuitBreakerThreshold: limits.providerCircuitBreakerThreshold }
      : {}),
    ...(limits.providerCircuitBreakerCooldownMs !== undefined
      ? { providerCircuitBreakerCooldownMs: limits.providerCircuitBreakerCooldownMs }
      : {}),
    ...(limits.providerCircuitBreakerPersistent !== undefined
      ? { providerCircuitBreakerPersistent: limits.providerCircuitBreakerPersistent }
      : {})
  };
}
