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
import { type ProviderId, GatewayError } from "@airlock/shared";

import type { GatewayBindings } from "./env.js";

import { gatewayEnvSchema } from "./env.js";
import {
  fetchConfigStoreSnapshot,
  type DashboardLimitsConfig,
  type DashboardProviderEntry,
  type DashboardProvidersConfig,
  type DashboardRouteConfig,
  type StoredConfigSnapshot
} from "./gateway-config-store.js";

export type ModelGroupMap = Record<string, string[]>;

export interface GatewayConfig {
  mode: "free" | "scale";
  corsOrigins?: string;
  requestLogging?: boolean;
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
  internalAdminToken?: string;
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
  openAI?: {
    apiKey: string;
    baseUrl: string;
    defaultModel: string;
  };
}

type GatewayProviderConfig = NonNullable<GatewayConfig["openAI"]>;

interface ParsedBusinessConfigInput {
  gatewayApiKeysValue: string | undefined;
  fallbackModel: string | undefined;
  modelAliasesValue: string | undefined;
  modelFallbacksValue: string | undefined;
  modelTargetSelectionValue: string | undefined;
  modelKeyPolicyValue: string | undefined;
  modelShapingValue: string | undefined;
  requestSigningSecretsValue: string | undefined;
  modelGroupsValue: string | undefined;
}

export interface GatewayAdminAuthConfig {
  internalAdminToken?: string;
  internalAdminCredentials: InternalAdminCredential[];
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

function createMissingBusinessConfigError(
  message: string,
  code:
    | "config_missing_gateway_api_keys"
    | "config_missing_openai"
    | "config_missing_anthropic"
    | "config_missing_gemini"
    | "config_missing_internal_admin_auth"
): GatewayError {
  return new GatewayError(message, {
    code,
    category: "configuration",
    httpStatus: 500,
    retryable: false
  });
}

function parseBusinessConfig(
  input: ParsedBusinessConfigInput
): Pick<
  GatewayConfig,
  "gatewayApiKeys" | "modelAliases" | "modelGroups" | "requestSigningSecrets"
> {
  const gatewayApiKeys = input.gatewayApiKeysValue
    ? parseGatewayApiKeys(input.gatewayApiKeysValue)
    : [];
  const requestSigningSecrets = parseRequestSigningSecrets(
    input.requestSigningSecretsValue
  );
  const baseRoutes =
    input.modelAliasesValue || input.fallbackModel
      ? parseModelAliases(
          input.modelAliasesValue,
          input.fallbackModel ?? "openai/gpt-4.1-mini"
        )
      : [];
  const modelAliases = attachRouteTargetSelection(
    attachRouteFallbacks(
      attachRouteRequestShaping(
        attachRouteKeyAccessPolicy(
          baseRoutes,
          parseRouteKeyAccessPolicy(input.modelKeyPolicyValue)
        ),
        parseRouteRequestShaping(input.modelShapingValue)
      ),
      parseRouteFallbacks(input.modelFallbacksValue)
    ),
    parseRouteTargetSelection(input.modelTargetSelectionValue)
  );
  const modelGroups = parseModelGroups(input.modelGroupsValue);

  validateModelGroups(modelGroups, modelAliases, gatewayApiKeys);

  return {
    gatewayApiKeys,
    modelAliases,
    modelGroups,
    requestSigningSecrets
  };
}

function usesProvider(
  modelAliases: readonly {
    target: { provider: string };
    fallbacks?: Array<{ provider: string }>;
  }[],
  provider: ProviderId
): boolean {
  return modelAliases.some((route) => {
    if (route.target.provider === provider) {
      return true;
    }

    return (route.fallbacks ?? []).some((fallback) => {
      return fallback.provider === provider;
    });
  });
}

function validateProviderConfiguration(config: GatewayConfig): void {
  if (usesProvider(config.modelAliases, "openai")) {
    if (
      !config.openAI?.apiKey ||
      !config.openAI.baseUrl ||
      !config.openAI.defaultModel
    ) {
      throw createMissingBusinessConfigError(
        "OpenAI configuration is required (set via environment variables or dashboard config)",
        "config_missing_openai"
      );
    }
  }

  if (usesProvider(config.modelAliases, "anthropic")) {
    if (!config.anthropic?.apiKey || !config.anthropic.baseUrl) {
      throw createMissingBusinessConfigError(
        "Anthropic configuration is required (set via environment variables or dashboard config)",
        "config_missing_anthropic"
      );
    }
  }

  if (usesProvider(config.modelAliases, "gemini")) {
    if (!config.gemini?.apiKey || !config.gemini.baseUrl) {
      throw createMissingBusinessConfigError(
        "Gemini configuration is required (set via environment variables or dashboard config)",
        "config_missing_gemini"
      );
    }
  }
}

function hasGatewayCallerAuthentication(config: GatewayConfig): boolean {
  return (
    config.gatewayApiKeys.length > 0 ||
    config.gatewayKeyRegistryEnabled === true
  );
}

function validateBusinessConfiguration(config: GatewayConfig): void {
  if (!hasGatewayCallerAuthentication(config)) {
    throw createMissingBusinessConfigError(
      "Gateway caller authentication is required (configure gateway API keys or enable the dynamic key registry)",
      "config_missing_gateway_api_keys"
    );
  }

  validateProviderConfiguration(config);
}

function validateAdminBootstrapConfiguration(config: {
  internalAdminToken?: string;
  internalAdminCredentials?: readonly InternalAdminCredential[];
}): void {
  if (
    !config.internalAdminToken &&
    config.internalAdminCredentials?.length === 0
  ) {
    throw createMissingBusinessConfigError(
      "Internal admin authentication is required (set via environment variables or dashboard config)",
      "config_missing_internal_admin_auth"
    );
  }
}

function assertAdminAuthRuntimeDependencies(
  internalAdminToken: string | undefined,
  internalAdminCredentials: readonly InternalAdminCredential[],
  revocationBinding: GatewayBindings["AIRLOCK_GATEWAY_KEY_REVOCATION"]
): void {
  if (
    (internalAdminToken || internalAdminCredentials.length > 0) &&
    !revocationBinding
  ) {
    throw new GatewayError("Gateway key revocation binding is required", {
      code: "config_missing_gateway_key_revocation",
      category: "configuration",
      httpStatus: 500,
      retryable: false
    });
  }
}

function toJsonString(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return JSON.stringify(value);
}

/**
 * Compute a fingerprint from the config-relevant env strings.
 * If these values haven't changed, the parsed config is identical.
 */
export function computeConfigFingerprint(bindings: GatewayBindings): string {
  const stringValue = (
    value: string | number | boolean | undefined
  ): string => {
    return value === undefined ? "" : String(value);
  };

  const presenceFlag = (value: unknown): string => {
    return value === undefined ? "0" : "1";
  };

  return [
    stringValue(bindings.AIRLOCK_MODE),
    stringValue(bindings.AIRLOCK_GATEWAY_API_KEYS),
    stringValue(bindings.AIRLOCK_MODEL_ALIASES),
    stringValue(bindings.AIRLOCK_MODEL_FALLBACKS),
    stringValue(bindings.AIRLOCK_MODEL_TARGET_SELECTION),
    stringValue(bindings.AIRLOCK_MODEL_KEY_POLICY),
    stringValue(bindings.AIRLOCK_MODEL_SHAPING),
    stringValue(bindings.AIRLOCK_MODEL_GROUPS),
    stringValue(bindings.AIRLOCK_REQUEST_SIGNING_SECRETS),
    stringValue(bindings.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
    stringValue(bindings.AIRLOCK_INTERNAL_ADMIN_TOKEN),
    stringValue(bindings.AIRLOCK_INTERNAL_ADMIN_ACTOR_HEADER),
    stringValue(bindings.AIRLOCK_INTERNAL_ADMIN_ACTOR_REQUIRED),
    stringValue(bindings.AIRLOCK_CORS_ORIGINS),
    stringValue(bindings.AIRLOCK_PROVIDER_TIMEOUT_MS),
    stringValue(bindings.AIRLOCK_PROVIDER_MAX_RETRIES),
    stringValue(bindings.AIRLOCK_PROVIDER_RETRY_BACKOFF_MS),
    stringValue(bindings.AIRLOCK_PROVIDER_STREAM_IDLE_TIMEOUT_MS),
    stringValue(bindings.AIRLOCK_MAX_REQUEST_BODY_BYTES),
    stringValue(bindings.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_THRESHOLD),
    stringValue(bindings.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS),
    stringValue(bindings.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_PERSISTENT),
    stringValue(bindings.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_ERROR_RATE_WINDOW_MS),
    stringValue(bindings.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_ERROR_RATE_THRESHOLD),
    stringValue(
      bindings.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_MIN_ATTEMPTS_IN_WINDOW
    ),
    stringValue(
      bindings.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_HALF_OPEN_PROMOTION_SUCCESSES
    ),
    stringValue(
      bindings.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_HALF_OPEN_PROMOTION_SUCCESS_RATE
    ),
    stringValue(
      bindings.AIRLOCK_PROVIDER_CIRCUIT_BREAKER_HALF_OPEN_PROMOTION_WINDOW
    ),
    stringValue(bindings.AIRLOCK_ROUTING_LATENCY_FRESHNESS_MS),
    stringValue(bindings.AIRLOCK_ROUTING_COST_FRESHNESS_MS),
    stringValue(bindings.AIRLOCK_ROUTING_FAILURE_FRESHNESS_MS),
    stringValue(bindings.AIRLOCK_ROUTING_RECOVERY_WINDOW_MS),
    stringValue(bindings.AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED),
    stringValue(bindings.OPENAI_API_KEY),
    stringValue(bindings.OPENAI_BASE_URL),
    stringValue(bindings.OPENAI_DEFAULT_MODEL),
    stringValue(bindings.ANTHROPIC_API_KEY),
    stringValue(bindings.ANTHROPIC_BASE_URL),
    stringValue(bindings.ANTHROPIC_DEFAULT_MAX_TOKENS),
    stringValue(bindings.GEMINI_API_KEY),
    stringValue(bindings.GEMINI_BASE_URL),
    presenceFlag(bindings.AIRLOCK_GATEWAY_KEY_QUOTA),
    presenceFlag(bindings.AIRLOCK_GATEWAY_KEY_TOKEN_QUOTA),
    presenceFlag(bindings.AIRLOCK_GATEWAY_KEY_CONCURRENCY),
    presenceFlag(bindings.AIRLOCK_GATEWAY_KEY_REGISTRY),
    presenceFlag(bindings.AIRLOCK_GATEWAY_KEY_REVOCATION),
    presenceFlag(bindings.AIRLOCK_PROVIDER_CIRCUIT_BREAKER),
    presenceFlag(bindings.AIRLOCK_IP_RATE_LIMIT),
    stringValue(bindings.AIRLOCK_IP_RATE_LIMIT_POLICY),
    presenceFlag(bindings.AIRLOCK_TELEMETRY),
    stringValue(bindings.AIRLOCK_REQUEST_LOGGING),
    presenceFlag(bindings.AIRLOCK_CONFIG_STORE),
    stringValue(bindings.AIRLOCK_GOOGLE_SUPER_ADMIN_EMAIL)
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

export function resolveGatewayAdminAuthConfig(
  bindings: GatewayBindings
): GatewayAdminAuthConfig {
  const env = gatewayEnvSchema.parse(bindings);
  const internalAdminCredentials = parseInternalAdminCredentials(
    env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS
  );

  assertAdminAuthRuntimeDependencies(
    env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
    internalAdminCredentials,
    env.AIRLOCK_GATEWAY_KEY_REVOCATION
  );

  const config: GatewayAdminAuthConfig = {
    ...(env.AIRLOCK_INTERNAL_ADMIN_TOKEN
      ? { internalAdminToken: env.AIRLOCK_INTERNAL_ADMIN_TOKEN }
      : {}),
    internalAdminCredentials
  };

  validateAdminBootstrapConfiguration(config);
  return config;
}

function parseGatewayConfigUncached(
  bindings: GatewayBindings,
  options?: { allowMissingBusinessConfig?: boolean }
): GatewayConfig {
  const allowMissingBusinessConfig =
    options?.allowMissingBusinessConfig ?? false;
  const env = gatewayEnvSchema.parse(bindings);
  const internalAdminCredentials = parseInternalAdminCredentials(
    env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS
  );
  const businessConfig = parseBusinessConfig({
    gatewayApiKeysValue: env.AIRLOCK_GATEWAY_API_KEYS,
    fallbackModel: env.OPENAI_DEFAULT_MODEL,
    modelAliasesValue: env.AIRLOCK_MODEL_ALIASES,
    modelFallbacksValue: env.AIRLOCK_MODEL_FALLBACKS,
    modelTargetSelectionValue: env.AIRLOCK_MODEL_TARGET_SELECTION,
    modelKeyPolicyValue: env.AIRLOCK_MODEL_KEY_POLICY,
    modelShapingValue: env.AIRLOCK_MODEL_SHAPING,
    requestSigningSecretsValue: env.AIRLOCK_REQUEST_SIGNING_SECRETS,
    modelGroupsValue: env.AIRLOCK_MODEL_GROUPS
  });

  assertGatewayApiKeysRuntimeDependencies(businessConfig.gatewayApiKeys, {
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

  if (env.AIRLOCK_INTERNAL_ADMIN_TOKEN || internalAdminCredentials.length > 0) {
    assertAdminAuthRuntimeDependencies(
      env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
      internalAdminCredentials,
      env.AIRLOCK_GATEWAY_KEY_REVOCATION
    );
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

  const config: GatewayConfig = {
    mode: env.AIRLOCK_MODE,
    ...(env.AIRLOCK_CORS_ORIGINS
      ? { corsOrigins: env.AIRLOCK_CORS_ORIGINS }
      : {}),
    ...(env.AIRLOCK_REQUEST_LOGGING ? { requestLogging: true } : {}),
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
    ...(env.AIRLOCK_INTERNAL_ADMIN_TOKEN
      ? { internalAdminToken: env.AIRLOCK_INTERNAL_ADMIN_TOKEN }
      : {}),
    internalAdminCredentials,
    gatewayApiKeys: businessConfig.gatewayApiKeys,
    ...(Object.keys(businessConfig.requestSigningSecrets ?? {}).length > 0
      ? { requestSigningSecrets: businessConfig.requestSigningSecrets }
      : {}),
    ...(ipRateLimitPolicy ? { ipRateLimitPolicy } : {}),
    modelGroups: businessConfig.modelGroups,
    modelAliases: businessConfig.modelAliases,
    ...(env.ANTHROPIC_API_KEY && env.ANTHROPIC_BASE_URL
      ? {
          anthropic: {
            apiKey: env.ANTHROPIC_API_KEY,
            baseUrl: env.ANTHROPIC_BASE_URL,
            defaultMaxTokens: env.ANTHROPIC_DEFAULT_MAX_TOKENS ?? 4096
          }
        }
      : {}),
    ...(env.GEMINI_API_KEY && env.GEMINI_BASE_URL
      ? {
          gemini: {
            apiKey: env.GEMINI_API_KEY,
            baseUrl: env.GEMINI_BASE_URL
          }
        }
      : {}),
    ...(env.OPENAI_API_KEY && env.OPENAI_BASE_URL && env.OPENAI_DEFAULT_MODEL
      ? {
          openAI: {
            apiKey: env.OPENAI_API_KEY,
            baseUrl: env.OPENAI_BASE_URL,
            defaultModel: env.OPENAI_DEFAULT_MODEL
          }
        }
      : {})
  };

  if (!allowMissingBusinessConfig) {
    validateBusinessConfiguration(config);
  }

  return config;
}

/**
 * Resolve gateway config with optional dashboard overlay from Config Store DO.
 * Falls back to strict env-var-only config when DO is unavailable.
 */
export async function resolveGatewayConfigWithOverlay(
  bindings: GatewayBindings,
  options?: { allowIncompleteBusinessConfig?: boolean }
): Promise<GatewayConfig> {
  const allowIncompleteBusinessConfig =
    options?.allowIncompleteBusinessConfig ?? false;
  let base: GatewayConfig;

  try {
    base = resolveGatewayConfig(bindings);
  } catch (e) {
    if (!bindings.AIRLOCK_CONFIG_STORE || !(e instanceof GatewayError)) {
      throw e;
    }
    base = parseGatewayConfigUncached(bindings, {
      allowMissingBusinessConfig: true
    });
  }

  const overlay = await resolveDashboardOverlay(bindings);
  const merged = mergeConfigWithOverlay(base, overlay);

  if (!allowIncompleteBusinessConfig) {
    validateBusinessConfiguration(merged);
  }
  return merged;
}

const DASHBOARD_OVERLAY_TTL_MS = 5_000;

let overlayCache:
  | {
      snapshot: StoredConfigSnapshot;
      fetchedAt: number;
    }
  | undefined;

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
    if (overlayCache) {
      overlayCache.fetchedAt = now;
    }
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
    const validated = validateProvidersOverlay(providersSection.data);
    if (validated) {
      config = mergeProvidersConfig(config, validated);
    }
  }

  const featureSection = overlay.sections["features"];
  if (featureSection) {
    config = mergeFeaturesConfig(
      config,
      featureSection.data as Record<string, unknown>
    );
  }

  const limitsSection = overlay.sections["limits"];
  if (limitsSection) {
    config = mergeLimitsConfig(
      config,
      limitsSection.data as DashboardLimitsConfig
    );
  }

  const routesSection = overlay.sections["routes"];
  if (routesSection) {
    config = mergeRoutesConfig(config, routesSection.data);
  }

  const keyPoliciesSection = overlay.sections["key_policies"];
  if (keyPoliciesSection) {
    config = mergeKeyPoliciesConfig(config, keyPoliciesSection.data);
  }

  const shapingSection = overlay.sections["shaping"];
  if (shapingSection) {
    config = mergeShapingConfig(config, shapingSection.data);
  }

  const signingSection = overlay.sections["signing"];
  if (signingSection) {
    config = mergeSigningConfig(config, signingSection.data);
  }

  const modelGroupsSection = overlay.sections["model_groups"];
  if (modelGroupsSection) {
    config = mergeModelGroupsConfig(config, modelGroupsSection.data);
  }

  return config;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validateProviderEntry(
  data: unknown
): DashboardProviderEntry | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const entry = data as Record<string, unknown>;
  if (!isNonEmptyString(entry.apiKey) || !isNonEmptyString(entry.baseUrl)) {
    return undefined;
  }
  return {
    apiKey: entry.apiKey,
    baseUrl: entry.baseUrl,
    ...(isNonEmptyString(entry.defaultModel)
      ? { defaultModel: entry.defaultModel }
      : {}),
    ...(typeof entry.defaultMaxTokens === "number" && entry.defaultMaxTokens > 0
      ? { defaultMaxTokens: entry.defaultMaxTokens }
      : {})
  };
}

function validateProvidersOverlay(
  data: unknown
): Partial<DashboardProvidersConfig> | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const raw = data as Record<string, unknown>;
  const openai = validateProviderEntry(raw.openai);
  const anthropic = validateProviderEntry(raw.anthropic);
  const gemini = validateProviderEntry(raw.gemini);
  if (!openai && !anthropic && !gemini) return undefined;
  return {
    ...(openai ? { openai } : {}),
    ...(anthropic ? { anthropic } : {}),
    ...(gemini ? { gemini } : {})
  };
}

function mergeProvidersConfig(
  config: GatewayConfig,
  providers: Partial<DashboardProvidersConfig>
): GatewayConfig {
  const nextOpenAI: GatewayProviderConfig | undefined = providers.openai
    ? {
        apiKey: providers.openai.apiKey,
        baseUrl: providers.openai.baseUrl,
        defaultModel:
          providers.openai.defaultModel ??
          config.openAI?.defaultModel ??
          "openai/gpt-4.1-mini"
      }
    : config.openAI;

  return {
    ...config,
    ...(nextOpenAI ? { openAI: nextOpenAI } : {}),
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
  limits: DashboardLimitsConfig
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
      ? {
          providerCircuitBreakerThreshold:
            limits.providerCircuitBreakerThreshold
        }
      : {}),
    ...(limits.providerCircuitBreakerCooldownMs !== undefined
      ? {
          providerCircuitBreakerCooldownMs:
            limits.providerCircuitBreakerCooldownMs
        }
      : {}),
    ...(limits.providerCircuitBreakerErrorRateWindowMs !== undefined
      ? {
          providerCircuitBreakerErrorRateWindowMs:
            limits.providerCircuitBreakerErrorRateWindowMs
        }
      : {}),
    ...(limits.providerCircuitBreakerErrorRateThreshold !== undefined
      ? {
          providerCircuitBreakerErrorRateThreshold:
            limits.providerCircuitBreakerErrorRateThreshold
        }
      : {}),
    ...(limits.providerCircuitBreakerMinAttemptsInWindow !== undefined
      ? {
          providerCircuitBreakerMinAttemptsInWindow:
            limits.providerCircuitBreakerMinAttemptsInWindow
        }
      : {}),
    ...(limits.providerCircuitBreakerHalfOpenPromotionSuccesses !== undefined
      ? {
          providerCircuitBreakerHalfOpenPromotionSuccesses:
            limits.providerCircuitBreakerHalfOpenPromotionSuccesses
        }
      : {}),
    ...(limits.providerCircuitBreakerHalfOpenPromotionSuccessRate !== undefined
      ? {
          providerCircuitBreakerHalfOpenPromotionSuccessRate:
            limits.providerCircuitBreakerHalfOpenPromotionSuccessRate
        }
      : {}),
    ...(limits.providerCircuitBreakerHalfOpenPromotionWindow !== undefined
      ? {
          providerCircuitBreakerHalfOpenPromotionWindow:
            limits.providerCircuitBreakerHalfOpenPromotionWindow
        }
      : {}),
    ...(limits.providerCircuitBreakerPersistent !== undefined
      ? {
          providerCircuitBreakerPersistent:
            limits.providerCircuitBreakerPersistent
        }
      : {}),
    ...(limits.routingLatencyFreshnessMs !== undefined
      ? { routingLatencyFreshnessMs: limits.routingLatencyFreshnessMs }
      : {}),
    ...(limits.routingCostFreshnessMs !== undefined
      ? { routingCostFreshnessMs: limits.routingCostFreshnessMs }
      : {}),
    ...(limits.routingFailureFreshnessMs !== undefined
      ? { routingFailureFreshnessMs: limits.routingFailureFreshnessMs }
      : {}),
    ...(limits.routingRecoveryWindowMs !== undefined
      ? { routingRecoveryWindowMs: limits.routingRecoveryWindowMs }
      : {}),
    ...(limits.ipRateLimitPolicy !== undefined
      ? {
          ipRateLimitPolicy: parseIpRateLimitPolicy(
            normalizeDashboardIpRateLimitPolicy(limits.ipRateLimitPolicy)
          )
        }
      : {})
  };
}

function mergeFeaturesConfig(
  config: GatewayConfig,
  features: Record<string, unknown>
): GatewayConfig {
  return {
    ...config,
    ...(typeof features.requestLogging === "boolean"
      ? { requestLogging: features.requestLogging }
      : {}),
    ...(typeof features.corsOrigins === "string"
      ? { corsOrigins: features.corsOrigins }
      : {})
  };
}

function parseDashboardRouteSelectionInput(
  route: DashboardRouteConfig
): Record<string, unknown> | undefined {
  if (
    route.targetSelection &&
    typeof route.targetSelection === "object" &&
    !Array.isArray(route.targetSelection)
  ) {
    return route.targetSelection;
  }

  if (!route.strategy) {
    return undefined;
  }

  return {
    strategy: route.strategy
  };
}

function parseDashboardRouteShapingInput(
  route: DashboardRouteConfig
): Record<string, unknown> | undefined {
  if (!route.shaping) {
    return undefined;
  }

  if (route.shaping.targets) {
    return route.shaping;
  }

  return {
    ...(route.shaping.headers ? { headers: route.shaping.headers } : {}),
    ...(route.shaping.query ? { query: route.shaping.query } : {}),
    ...(route.shaping.jsonBody ? { jsonBody: route.shaping.jsonBody } : {}),
    ...(route.shaping.signing ? { signing: route.shaping.signing } : {})
  };
}

function createInvalidDashboardRouteError(message: string): GatewayError {
  return new GatewayError(message, {
    code: "config_invalid_model_aliases",
    category: "configuration",
    httpStatus: 500,
    retryable: false
  });
}

function parseDashboardRouteTarget(
  value: unknown,
  fieldName: string
): { provider: string; providerModel: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw createInvalidDashboardRouteError(
      `Dashboard route ${fieldName} must be an object`
    );
  }

  const record = value as Record<string, unknown>;

  if (!isNonEmptyString(record.provider)) {
    throw createInvalidDashboardRouteError(
      `Dashboard route ${fieldName}.provider must be a non-empty string`
    );
  }

  if (!isNonEmptyString(record.providerModel)) {
    throw createInvalidDashboardRouteError(
      `Dashboard route ${fieldName}.providerModel must be a non-empty string`
    );
  }

  return {
    provider: record.provider.trim(),
    providerModel: record.providerModel.trim()
  };
}

function parseDashboardRouteTags(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw createInvalidDashboardRouteError(
      "Dashboard route requiredKeyTags must be an array"
    );
  }

  const tags = value.map((tag) => {
    if (!isNonEmptyString(tag)) {
      throw createInvalidDashboardRouteError(
        "Dashboard route requiredKeyTags entries must be non-empty strings"
      );
    }

    return tag.trim();
  });

  return tags.length > 0 ? tags : undefined;
}

function parseDashboardRoutes(data: unknown): DashboardRouteConfig[] {
  if (!Array.isArray(data)) {
    throw createInvalidDashboardRouteError(
      "Dashboard routes config must be an array"
    );
  }

  return data.map((route, index) => {
    if (typeof route !== "object" || route === null || Array.isArray(route)) {
      throw createInvalidDashboardRouteError(
        `Dashboard route at index ${index} must be an object`
      );
    }

    const record = route as Record<string, unknown>;

    if (!isNonEmptyString(record.externalModel)) {
      throw createInvalidDashboardRouteError(
        `Dashboard route at index ${index} must include a non-empty externalModel`
      );
    }

    const target = parseDashboardRouteTarget(record.target, "target");
    const fallbacks = Array.isArray(record.fallbacks)
      ? record.fallbacks.map((fallback) => {
          return parseDashboardRouteTarget(fallback, "fallback");
        })
      : undefined;
    const requiredKeyTags = parseDashboardRouteTags(record.requiredKeyTags);

    const shaping =
      record.shaping &&
      typeof record.shaping === "object" &&
      !Array.isArray(record.shaping)
        ? (record.shaping as DashboardRouteConfig["shaping"])
        : undefined;

    return {
      externalModel: record.externalModel.trim(),
      target,
      ...(fallbacks && fallbacks.length > 0 ? { fallbacks } : {}),
      ...(isNonEmptyString(record.strategy)
        ? { strategy: record.strategy.trim() }
        : {}),
      ...(record.targetSelection &&
      typeof record.targetSelection === "object" &&
      !Array.isArray(record.targetSelection)
        ? { targetSelection: record.targetSelection as Record<string, unknown> }
        : {}),
      ...(isNonEmptyString(record.requiredKeyTier)
        ? { requiredKeyTier: record.requiredKeyTier.trim() }
        : {}),
      ...(requiredKeyTags ? { requiredKeyTags } : {}),
      ...(shaping ? { shaping } : {})
    };
  });
}

function normalizeDashboardIpRateLimitPolicy(
  value: DashboardLimitsConfig["ipRateLimitPolicy"]
): unknown {
  if (!value) {
    return undefined;
  }

  if (
    "limit" in value &&
    typeof value.limit === "number" &&
    "windowSeconds" in value &&
    typeof value.windowSeconds === "number"
  ) {
    return {
      limit: value.limit,
      windowSeconds: value.windowSeconds
    };
  }

  if (
    "requestsPerMinute" in value &&
    typeof value.requestsPerMinute === "number"
  ) {
    return {
      limit: value.requestsPerMinute,
      windowSeconds: 60
    };
  }

  return value;
}

function mergeRoutesConfig(
  config: GatewayConfig,
  data: unknown
): GatewayConfig {
  const routes = parseDashboardRoutes(data);

  if (routes.length === 0) {
    validateModelGroups(config.modelGroups, [], config.gatewayApiKeys);
    return {
      ...config,
      modelAliases: []
    };
  }

  const aliases = routes.map((route) => {
    return `${route.externalModel}=${route.target.provider}:${route.target.providerModel}`;
  });
  const fallbackMap: Record<string, string[]> = {};
  const selectionMap: Record<string, Record<string, unknown>> = {};
  const keyPolicyMap: Record<string, Record<string, unknown>> = {};
  const shapingMap: Record<string, Record<string, unknown>> = {};

  for (const route of routes) {
    if (route.fallbacks?.length) {
      fallbackMap[route.externalModel] = route.fallbacks.map((fallback) => {
        return `${fallback.provider}:${fallback.providerModel}`;
      });
    }

    const selection = parseDashboardRouteSelectionInput(route);
    if (selection) {
      selectionMap[route.externalModel] = selection;
    }

    if (route.requiredKeyTier || route.requiredKeyTags?.length) {
      keyPolicyMap[route.externalModel] = {
        ...(route.requiredKeyTier
          ? { requiredKeyTier: route.requiredKeyTier }
          : {}),
        ...(route.requiredKeyTags?.length
          ? { requiredKeyTags: route.requiredKeyTags }
          : {})
      };
    }

    const shaping = parseDashboardRouteShapingInput(route);
    if (shaping) {
      shapingMap[route.externalModel] = shaping;
    }
  }

  let modelAliases = parseModelAliases(
    aliases.join(","),
    config.openAI?.defaultModel ?? "openai/gpt-4.1-mini"
  );
  modelAliases = attachRouteFallbacks(
    modelAliases,
    parseRouteFallbacks(
      Object.keys(fallbackMap).length > 0
        ? JSON.stringify(fallbackMap)
        : undefined
    )
  );
  modelAliases = attachRouteTargetSelection(
    modelAliases,
    parseRouteTargetSelection(
      Object.keys(selectionMap).length > 0
        ? JSON.stringify(selectionMap)
        : undefined
    )
  );
  modelAliases = attachRouteKeyAccessPolicy(
    modelAliases,
    parseRouteKeyAccessPolicy(
      Object.keys(keyPolicyMap).length > 0
        ? JSON.stringify(keyPolicyMap)
        : undefined
    )
  );
  modelAliases = attachRouteRequestShaping(
    modelAliases,
    parseRouteRequestShaping(
      Object.keys(shapingMap).length > 0
        ? JSON.stringify(shapingMap)
        : undefined
    )
  );
  validateModelGroups(config.modelGroups, modelAliases, config.gatewayApiKeys);

  return {
    ...config,
    modelAliases
  };
}

function mergeModelGroupsConfig(
  config: GatewayConfig,
  data: unknown
): GatewayConfig {
  const parsed = parseModelGroups(toJsonString(data));
  validateModelGroups(parsed, config.modelAliases, config.gatewayApiKeys);

  return {
    ...config,
    modelGroups: parsed
  };
}

function mergeKeyPoliciesConfig(
  config: GatewayConfig,
  data: unknown
): GatewayConfig {
  const routeKeyPolicies = parseRouteKeyAccessPolicy(toJsonString(data));

  return {
    ...config,
    modelAliases: attachRouteKeyAccessPolicy(
      config.modelAliases,
      routeKeyPolicies
    )
  };
}

function mergeShapingConfig(
  config: GatewayConfig,
  data: unknown
): GatewayConfig {
  const shaping = parseRouteRequestShaping(toJsonString(data));
  return {
    ...config,
    modelAliases: attachRouteRequestShaping(config.modelAliases, shaping)
  };
}

function mergeSigningConfig(
  config: GatewayConfig,
  data: unknown
): GatewayConfig {
  return {
    ...config,
    requestSigningSecrets: parseRequestSigningSecrets(toJsonString(data))
  };
}
