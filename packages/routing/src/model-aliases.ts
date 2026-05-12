import { GatewayError } from "@airlock/shared";
import type { ProviderId } from "@airlock/shared";
import type {
  RequestShapingProfile,
  RouteRequestShapingMap
} from "@airlock/request-shaping";

export interface ProviderTarget {
  provider: ProviderId;
  providerModel: string;
}

export interface ModelRoute {
  externalModel: string;
  target: ProviderTarget;
  shaping?: RequestShapingProfile;
  fallbacks?: ProviderTarget[];
}

export type ModelRouteDirectory = ModelRoute[];
export type RouteFallbackMap = Record<string, string[]>;

function createInvalidModelAliasError(message: string): GatewayError {
  return new GatewayError(message, {
    code: "config_invalid_model_aliases",
    category: "configuration",
    httpStatus: 500,
    retryable: false
  });
}

function createInvalidRouteShapingError(message: string): GatewayError {
  return new GatewayError(message, {
    code: "config_invalid_request_shaping",
    category: "configuration",
    httpStatus: 500,
    retryable: false
  });
}

function createInvalidRouteFallbackError(message: string): GatewayError {
  return new GatewayError(message, {
    code: "config_invalid_model_fallbacks",
    category: "configuration",
    httpStatus: 500,
    retryable: false
  });
}

function parseProviderId(
  value: string,
  createError: (message: string) => GatewayError = createInvalidModelAliasError
): ProviderId {
  if (value === "openai" || value === "anthropic" || value === "gemini") {
    return value;
  }

  throw createError("Provider targets must use a supported provider id");
}

function parseProviderTarget(
  value: string,
  defaultProvider: ProviderId,
  createError: (message: string) => GatewayError
): ProviderTarget {
  const normalizedTarget = value.trim();
  const providerSeparatorIndex = normalizedTarget.indexOf(":");
  const hasExplicitProvider = providerSeparatorIndex >= 0;
  const provider = hasExplicitProvider
    ? parseProviderId(
        normalizedTarget.slice(0, providerSeparatorIndex).trim(),
        createError
      )
    : defaultProvider;
  const providerModel = hasExplicitProvider
    ? normalizedTarget.slice(providerSeparatorIndex + 1).trim()
    : normalizedTarget;

  if (providerModel.length === 0) {
    throw createError(
      "Provider target entries must include a non-empty provider model"
    );
  }

  return {
    provider,
    providerModel
  };
}

export function parseModelAliases(
  value: string | undefined,
  fallbackModel: string
): ModelRouteDirectory {
  if (!value) {
    return [
      {
        externalModel: fallbackModel,
        target: {
          provider: "openai",
          providerModel: fallbackModel
        }
      }
    ];
  }

  const routes = value.split(",").map((entry) => {
    const [externalModel, providerTarget] = entry.split("=");
    const normalizedExternalModel = externalModel?.trim() ?? "";
    const normalizedProviderTarget = providerTarget?.trim() ?? "";

    if (
      normalizedExternalModel.length === 0 ||
      normalizedProviderTarget.length === 0
    ) {
      throw createInvalidModelAliasError(
        "Model alias entries must include both external and provider models"
      );
    }

    const parsedTarget = parseProviderTarget(
      normalizedProviderTarget,
      "openai",
      createInvalidModelAliasError
    );

    return {
      externalModel: normalizedExternalModel,
      target: parsedTarget
    };
  });

  const externalModels = new Set<string>();
  for (const route of routes) {
    if (externalModels.has(route.externalModel)) {
      throw createInvalidModelAliasError(
        "External model aliases must be unique"
      );
    }

    externalModels.add(route.externalModel);
  }

  return routes;
}

export function parseRouteFallbacks(value: string | undefined): RouteFallbackMap {
  if (!value) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw createInvalidRouteFallbackError(
      "Route fallback config must be valid JSON"
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw createInvalidRouteFallbackError(
      "Route fallback config must be a JSON object"
    );
  }

  const fallbackMap: RouteFallbackMap = {};

  for (const [externalModel, targets] of Object.entries(parsed)) {
    if (!Array.isArray(targets)) {
      throw createInvalidRouteFallbackError(
        "Route fallback entries must be arrays"
      );
    }

    const normalizedTargets = targets.map((target) => {
      if (typeof target !== "string" || target.trim().length === 0) {
        throw createInvalidRouteFallbackError(
          "Route fallback targets must be non-empty strings"
        );
      }

      return target.trim();
    });

    fallbackMap[externalModel] = normalizedTargets;
  }

  return fallbackMap;
}

export function attachRouteRequestShaping(
  routes: ModelRouteDirectory,
  shapingByRoute: RouteRequestShapingMap
): ModelRouteDirectory {
  const configuredExternalModels = new Set(
    routes.map((route) => route.externalModel)
  );

  for (const externalModel of Object.keys(shapingByRoute)) {
    if (!configuredExternalModels.has(externalModel)) {
      throw createInvalidRouteShapingError(
        `Request shaping references an unknown external model: ${externalModel}`
      );
    }
  }

  return routes.map((route) => {
    const shaping = shapingByRoute[route.externalModel];

    return shaping ? { ...route, shaping } : route;
  });
}

export function attachRouteFallbacks(
  routes: ModelRouteDirectory,
  fallbackByRoute: RouteFallbackMap
): ModelRouteDirectory {
  const configuredExternalModels = new Set(
    routes.map((route) => route.externalModel)
  );

  for (const externalModel of Object.keys(fallbackByRoute)) {
    if (!configuredExternalModels.has(externalModel)) {
      throw createInvalidRouteFallbackError(
        `Route fallback references an unknown external model: ${externalModel}`
      );
    }
  }

  return routes.map((route) => {
    const configuredFallbacks = fallbackByRoute[route.externalModel];

    if (!configuredFallbacks) {
      return route;
    }

    const normalizedFallbacks = configuredFallbacks.map((target) => {
      const parsedTarget = parseProviderTarget(
        target,
        route.target.provider,
        createInvalidRouteFallbackError
      );

      const isCrossProvider = parsedTarget.provider !== route.target.provider;

      if (isCrossProvider && route.shaping) {
        throw createInvalidRouteFallbackError(
          "Cross-provider fallback requires routes without shaping"
        );
      }

      if (
        parsedTarget.provider === route.target.provider &&
        parsedTarget.providerModel === route.target.providerModel
      ) {
        throw createInvalidRouteFallbackError(
          "Route fallback targets must not duplicate the primary provider model"
        );
      }

      return parsedTarget;
    });

    const uniqueFallbacks = new Set<string>();
    for (const target of normalizedFallbacks) {
      const targetKey = `${target.provider}:${target.providerModel}`;

      if (uniqueFallbacks.has(targetKey)) {
        throw createInvalidRouteFallbackError(
          "Route fallback targets must be unique within a route"
        );
      }

      uniqueFallbacks.add(targetKey);
    }

    return {
      ...route,
      fallbacks: normalizedFallbacks
    };
  });
}

export function resolveModelRoute(
  externalModel: string,
  routes: ModelRouteDirectory,
  requestId?: string
) {
  const route = routes.find((candidate) => {
    return candidate.externalModel === externalModel;
  });

  if (!route) {
    throw new GatewayError("Model not found", {
      code: "model_not_found",
      category: "routing",
      httpStatus: 404,
      retryable: false,
      ...(requestId ? { requestId } : {})
    });
  }

  return route;
}

export function listExternalModels(routes: ModelRouteDirectory) {
  return routes.map((route) => route.externalModel);
}
