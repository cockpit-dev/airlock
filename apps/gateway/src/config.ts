import { parseGatewayApiKeys, type GatewayApiKeyRecord } from "@airlock/governance";
import { parseRouteRequestShaping } from "@airlock/request-shaping";
import {
  attachRouteFallbacks,
  attachRouteRequestShaping,
  attachRouteTargetSelection,
  parseModelAliases,
  parseRouteFallbacks,
  parseRouteTargetSelection,
  type ModelRouteDirectory
} from "@airlock/routing";
import { GatewayError } from "@airlock/shared";

import type { GatewayBindings } from "./env.js";

import { gatewayEnvSchema } from "./env.js";

export interface GatewayConfig {
  mode: "free" | "scale";
  providerTimeoutMs: number;
  providerMaxRetries: number;
  providerRetryBackoffMs: number;
  gatewayApiKeys: GatewayApiKeyRecord[];
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

export function resolveGatewayConfig(bindings: GatewayBindings): GatewayConfig {
  const env = gatewayEnvSchema.parse(bindings);
  const modelAliases = attachRouteTargetSelection(
    attachRouteFallbacks(
      attachRouteRequestShaping(
        parseModelAliases(env.AIRLOCK_MODEL_ALIASES, env.OPENAI_DEFAULT_MODEL),
        parseRouteRequestShaping(env.AIRLOCK_MODEL_SHAPING)
      ),
      parseRouteFallbacks(env.AIRLOCK_MODEL_FALLBACKS)
    ),
    parseRouteTargetSelection(env.AIRLOCK_MODEL_TARGET_SELECTION)
  );
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
    gatewayApiKeys: parseGatewayApiKeys(env.AIRLOCK_GATEWAY_API_KEYS),
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
