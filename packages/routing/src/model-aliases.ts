import { GatewayError } from "@airlock/shared";
import type { ProviderId } from "@airlock/shared";
import type {
  RouteRequestShapingMap,
  RouteRequestShapingProfile
} from "@airlock/request-shaping";
import { isTargetScopedRouteShapingProfile } from "@airlock/request-shaping";

export interface ProviderTarget {
  provider: ProviderId;
  providerModel: string;
}

export interface WeightedRouteTargetSelection {
  strategy: "weighted";
  weights: Record<string, number>;
}

export interface LowestCostRouteTargetSelection {
  strategy: "lowest_cost";
  costs: Record<string, number>;
}

export interface HealthPriorityRouteTargetSelection {
  strategy: "health_priority";
}

export interface PriorityRouteTargetSelection {
  strategy: "priority";
  latencySloMs?: Record<string, number>;
  costs?: Record<string, number>;
}

export type RouteTargetSelection =
  | WeightedRouteTargetSelection
  | LowestCostRouteTargetSelection
  | HealthPriorityRouteTargetSelection
  | PriorityRouteTargetSelection;

export interface ModelRoute {
  externalModel: string;
  target: ProviderTarget;
  shaping?: RouteRequestShapingProfile;
  fallbacks?: ProviderTarget[];
  targetSelection?: RouteTargetSelection;
  requiredKeyTier?: string;
  requiredKeyTags?: string[];
}

export type ModelRouteDirectory = ModelRoute[];
export type RouteFallbackMap = Record<string, string[]>;
export type RouteTargetSelectionMap = Record<string, RouteTargetSelection>;
export interface RouteKeyAccessPolicy {
  requiredKeyTier?: string;
  requiredKeyTags?: string[];
}
export type RouteKeyAccessPolicyMap = Record<string, RouteKeyAccessPolicy>;

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

function createInvalidRouteTargetSelectionError(message: string): GatewayError {
  return new GatewayError(message, {
    code: "config_invalid_model_target_selection",
    category: "configuration",
    httpStatus: 500,
    retryable: false
  });
}

function createInvalidRouteKeyAccessPolicyError(message: string): GatewayError {
  return new GatewayError(message, {
    code: "config_invalid_model_key_policy",
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

function parseExplicitProviderTarget(
  value: string,
  createError: (message: string) => GatewayError
): ProviderTarget {
  if (!value.includes(":")) {
    throw createError(
      "Target selection weights must use explicit provider target keys"
    );
  }

  return parseProviderTarget(value, "openai", createError);
}

function parsePositiveTargetNumberMap(
  value: unknown,
  fieldName: string
): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw createInvalidRouteTargetSelectionError(
      `${fieldName} must define an object`
    );
  }

  const normalized: Record<string, number> = {};

  for (const [targetKey, numericValue] of Object.entries(value)) {
    if (
      typeof numericValue !== "number" ||
      !Number.isFinite(numericValue) ||
      numericValue <= 0
    ) {
      throw createInvalidRouteTargetSelectionError(
        `${fieldName} values must be positive finite numbers`
      );
    }

    normalized[
      serializeProviderTarget(
        parseExplicitProviderTarget(
          targetKey,
          createInvalidRouteTargetSelectionError
        )
      )
    ] = numericValue;
  }

  return normalized;
}

export function serializeProviderTarget(target: ProviderTarget): string {
  return `${target.provider}:${target.providerModel}`;
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

export function parseRouteFallbacks(
  value: string | undefined
): RouteFallbackMap {
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

export function parseRouteTargetSelection(
  value: string | undefined
): RouteTargetSelectionMap {
  if (!value) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw createInvalidRouteTargetSelectionError(
      "Route target selection config must be valid JSON"
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw createInvalidRouteTargetSelectionError(
      "Route target selection config must be a JSON object"
    );
  }

  const targetSelectionByRoute: RouteTargetSelectionMap = {};

  for (const [externalModel, selection] of Object.entries(parsed)) {
    if (
      typeof selection !== "object" ||
      selection === null ||
      Array.isArray(selection)
    ) {
      throw createInvalidRouteTargetSelectionError(
        "Route target selection entries must be objects"
      );
    }

    const strategy = (selection as Record<string, unknown>).strategy;
    if (strategy === "weighted") {
      const weightsValue = (selection as Record<string, unknown>).weights;

      if (
        typeof weightsValue !== "object" ||
        weightsValue === null ||
        Array.isArray(weightsValue)
      ) {
        throw createInvalidRouteTargetSelectionError(
          "Weighted target selection must define a weights object"
        );
      }

      const normalizedWeights: Record<string, number> = {};

      for (const [targetKey, weight] of Object.entries(weightsValue)) {
        if (
          typeof weight !== "number" ||
          !Number.isFinite(weight) ||
          weight <= 0
        ) {
          throw createInvalidRouteTargetSelectionError(
            "Target selection weights must be positive finite numbers"
          );
        }

        normalizedWeights[
          serializeProviderTarget(
            parseExplicitProviderTarget(
              targetKey,
              createInvalidRouteTargetSelectionError
            )
          )
        ] = weight;
      }

      if (Object.keys(normalizedWeights).length === 0) {
        throw createInvalidRouteTargetSelectionError(
          "Weighted target selection must define at least one target weight"
        );
      }

      targetSelectionByRoute[externalModel] = {
        strategy: "weighted",
        weights: normalizedWeights
      };
      continue;
    }

    if (strategy === "lowest_cost") {
      const costsValue = (selection as Record<string, unknown>).costs;

      if (costsValue === undefined) {
        throw createInvalidRouteTargetSelectionError(
          "Lowest-cost target selection must define a costs object"
        );
      }

      const normalizedCosts = parsePositiveTargetNumberMap(
        costsValue,
        "Lowest-cost target selection costs"
      );

      if (Object.keys(normalizedCosts).length === 0) {
        throw createInvalidRouteTargetSelectionError(
          "Lowest-cost target selection must define at least one target cost"
        );
      }

      targetSelectionByRoute[externalModel] = {
        strategy: "lowest_cost",
        costs: normalizedCosts
      };
      continue;
    }

    if (strategy === "health_priority") {
      targetSelectionByRoute[externalModel] = {
        strategy: "health_priority"
      };
      continue;
    }

    if (strategy === "priority") {
      const selectionRecord = selection as Record<string, unknown>;
      const latencySloValue = selectionRecord.latencySloMs;
      const costsValue = selectionRecord.costs;
      const latencySloMs =
        latencySloValue !== undefined
          ? parsePositiveTargetNumberMap(
              latencySloValue,
              "Priority target selection latencySloMs"
            )
          : undefined;
      const costs =
        costsValue !== undefined
          ? parsePositiveTargetNumberMap(
              costsValue,
              "Priority target selection costs"
            )
          : undefined;

      if (!latencySloMs && !costs) {
        throw createInvalidRouteTargetSelectionError(
          "Priority target selection must define latencySloMs or costs"
        );
      }

      if (
        latencySloMs !== undefined &&
        Object.keys(latencySloMs).length === 0 &&
        (!costs || Object.keys(costs).length === 0)
      ) {
        throw createInvalidRouteTargetSelectionError(
          "Priority target selection must define at least one target hint"
        );
      }

      if (
        costs !== undefined &&
        Object.keys(costs).length === 0 &&
        (!latencySloMs || Object.keys(latencySloMs).length === 0)
      ) {
        throw createInvalidRouteTargetSelectionError(
          "Priority target selection must define at least one target hint"
        );
      }

      targetSelectionByRoute[externalModel] = {
        strategy: "priority",
        ...(latencySloMs ? { latencySloMs } : {}),
        ...(costs ? { costs } : {})
      };
      continue;
    }

    throw createInvalidRouteTargetSelectionError(
      "Route target selection strategy must be supported"
    );
  }

  return targetSelectionByRoute;
}

export function parseRouteKeyAccessPolicy(
  value: string | undefined
): RouteKeyAccessPolicyMap {
  if (!value) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw createInvalidRouteKeyAccessPolicyError(
      "Route key access policy config must be valid JSON"
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw createInvalidRouteKeyAccessPolicyError(
      "Route key access policy config must be a JSON object"
    );
  }

  const routeKeyAccessPolicyByRoute: RouteKeyAccessPolicyMap = {};

  for (const [externalModel, policy] of Object.entries(parsed)) {
    if (
      typeof policy !== "object" ||
      policy === null ||
      Array.isArray(policy)
    ) {
      throw createInvalidRouteKeyAccessPolicyError(
        "Route key access policy entries must be objects"
      );
    }

    const normalizedPolicy: RouteKeyAccessPolicy = {};
    const policyRecord = policy as Record<string, unknown>;

    if (policyRecord.requiredKeyTier !== undefined) {
      if (
        typeof policyRecord.requiredKeyTier !== "string" ||
        policyRecord.requiredKeyTier.trim().length === 0
      ) {
        throw createInvalidRouteKeyAccessPolicyError(
          "Route key access policy requiredKeyTier must be a non-empty string"
        );
      }

      normalizedPolicy.requiredKeyTier = policyRecord.requiredKeyTier.trim();
    }

    if (policyRecord.requiredKeyTags !== undefined) {
      if (!Array.isArray(policyRecord.requiredKeyTags)) {
        throw createInvalidRouteKeyAccessPolicyError(
          "Route key access policy requiredKeyTags must be an array"
        );
      }

      const requiredKeyTags = policyRecord.requiredKeyTags.map((tag) => {
        if (typeof tag !== "string" || tag.trim().length === 0) {
          throw createInvalidRouteKeyAccessPolicyError(
            "Route key access policy requiredKeyTags must contain non-empty strings"
          );
        }

        return tag.trim();
      });

      if (new Set(requiredKeyTags).size !== requiredKeyTags.length) {
        throw createInvalidRouteKeyAccessPolicyError(
          "Route key access policy requiredKeyTags must be unique"
        );
      }

      normalizedPolicy.requiredKeyTags = requiredKeyTags;
    }

    routeKeyAccessPolicyByRoute[externalModel] = normalizedPolicy;
  }

  return routeKeyAccessPolicyByRoute;
}

function listTargetSelectionKeys(
  targetSelection: RouteTargetSelection
): string[] {
  if (targetSelection.strategy === "weighted") {
    return Object.keys(targetSelection.weights);
  }

  if (targetSelection.strategy === "lowest_cost") {
    return Object.keys(targetSelection.costs);
  }

  if (targetSelection.strategy === "priority") {
    return Array.from(
      new Set([
        ...Object.keys(targetSelection.latencySloMs ?? {}),
        ...Object.keys(targetSelection.costs ?? {})
      ])
    );
  }

  return [];
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
        if (isTargetScopedRouteShapingProfile(route.shaping)) {
          const primaryTargetKey = serializeProviderTarget(route.target);
          const fallbackTargetKey = serializeProviderTarget(parsedTarget);

          if (!route.shaping.targets[primaryTargetKey]) {
            throw createInvalidRouteFallbackError(
              "Cross-provider fallback requires explicit target-scoped shaping for the primary target"
            );
          }

          if (!route.shaping.targets[fallbackTargetKey]) {
            throw createInvalidRouteFallbackError(
              "Cross-provider fallback with target-scoped shaping requires explicit shaping for every fallback target; add a target entry for " +
                fallbackTargetKey +
                " or remove target-scoped shaping defaults"
            );
          }
        }
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

export function attachRouteTargetSelection(
  routes: ModelRouteDirectory,
  targetSelectionByRoute: RouteTargetSelectionMap
): ModelRouteDirectory {
  const configuredExternalModels = new Set(
    routes.map((route) => route.externalModel)
  );

  for (const externalModel of Object.keys(targetSelectionByRoute)) {
    if (!configuredExternalModels.has(externalModel)) {
      throw createInvalidRouteTargetSelectionError(
        `Route target selection references an unknown external model: ${externalModel}`
      );
    }
  }

  return routes.map((route) => {
    const targetSelection = targetSelectionByRoute[route.externalModel];

    if (!targetSelection) {
      return route;
    }

    const routeTargetKeys = new Set(
      [route.target, ...(route.fallbacks ?? [])].map((target) => {
        return serializeProviderTarget(target);
      })
    );

    for (const targetKey of listTargetSelectionKeys(targetSelection)) {
      if (!routeTargetKeys.has(targetKey)) {
        throw createInvalidRouteTargetSelectionError(
          `Route target selection references an unknown route target: ${targetKey}`
        );
      }
    }

    return {
      ...route,
      targetSelection
    };
  });
}

export function attachRouteKeyAccessPolicy(
  routes: ModelRouteDirectory,
  routeKeyAccessPolicyByRoute: RouteKeyAccessPolicyMap
): ModelRouteDirectory {
  const configuredExternalModels = new Set(
    routes.map((route) => route.externalModel)
  );

  for (const externalModel of Object.keys(routeKeyAccessPolicyByRoute)) {
    if (!configuredExternalModels.has(externalModel)) {
      throw createInvalidRouteKeyAccessPolicyError(
        `Route key access policy references an unknown external model: ${externalModel}`
      );
    }
  }

  return routes.map((route) => {
    const keyAccessPolicy = routeKeyAccessPolicyByRoute[route.externalModel];

    if (!keyAccessPolicy) {
      return route;
    }

    return {
      ...route,
      ...(keyAccessPolicy.requiredKeyTier
        ? { requiredKeyTier: keyAccessPolicy.requiredKeyTier }
        : {}),
      ...(keyAccessPolicy.requiredKeyTags
        ? { requiredKeyTags: keyAccessPolicy.requiredKeyTags }
        : {})
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
