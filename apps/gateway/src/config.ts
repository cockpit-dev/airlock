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

export type ModelGroupMap = Record<string, string[]>;

export interface GatewayConfig {
  mode: "free" | "scale";
  providerTimeoutMs: number;
  providerMaxRetries: number;
  providerRetryBackoffMs: number;
  gatewayApiKeys: GatewayApiKeyRecord[];
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

export function resolveGatewayConfig(bindings: GatewayBindings): GatewayConfig {
  const env = gatewayEnvSchema.parse(bindings);
  const gatewayApiKeys = parseGatewayApiKeys(env.AIRLOCK_GATEWAY_API_KEYS);
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
  const modelGroups = parseModelGroups(env.AIRLOCK_MODEL_GROUPS);
  validateModelGroups(modelGroups, modelAliases, gatewayApiKeys);
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
    gatewayApiKeys,
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
