import {
  getCanonicalRequestCapabilityRequirements,
  deriveRequestClass,
  type CanonicalRequest,
  type CanonicalRequestCapabilityRequirements,
  type CanonicalResponse,
  type CanonicalStreamEvent
} from "@airlock/canonical";
import {
  type ProviderCapabilityDescriptor,
  getProviderCapabilityDescriptor,
  type ProviderAdapter,
  createProviderAdapterFromRegistry,
  type ProviderAdapterConstructionOptions
} from "@airlock/providers";
import {
  deriveProviderTargetHealthSnapshot,
  compareTargetsByHealthPriority,
  compareTargetsByLowestCost,
  compareTargetsByPriority,
  compareTargetsByHealthScore,
  computeAdjustedWeight,
  computeHalfOpenTrafficRamp,
  computeAffinityByTarget,
  compareByOriginalRouteOrder,
  type ProviderTargetHealthSnapshot,
  type RoutingFreshnessWindows,
  type RoutingScoringContext
} from "@airlock/governance";
import type { GatewayApiKeyRecord } from "@airlock/governance";
import {
  resolveRouteRequestShapingForTarget,
  type RequestShapingProfile
} from "@airlock/request-shaping";
import {
  serializeProviderTarget,
  type ModelRoute,
  type ProviderTarget
} from "@airlock/routing";
import { GatewayError } from "@airlock/shared";

import { assertGatewayKeyAllowsProvider } from "./auth.js";
import {
  createInMemoryCircuitBreakerBackend,
  getProviderTargetCircuitState,
  type ProviderCircuitBreakerBackend,
  type ProviderCircuitBreakerPolicy
} from "./circuit-breaker.js";
import type { GatewayConfig } from "./config.js";

export type RoutingMetadataAccumulator = {
  primaryTargetOpen?: boolean;
  attemptCount?: number;
  timeoutBudgetMs?: number;
  timeoutBudgetRemainingMs?: number;
  malformedSseEventCount?: number;
};

const DEFAULT_PROVIDER_CIRCUIT_BREAKER_THRESHOLD = 3;
const DEFAULT_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

type ProviderCapabilityDescriptorResolver = (
  provider: ProviderTarget["provider"]
) => ProviderCapabilityDescriptor;

const DEFAULT_LATENCY_FRESHNESS_MS = 30_000;
const DEFAULT_COST_FRESHNESS_MS = 30_000;
const DEFAULT_FAILURE_FRESHNESS_MS = 30_000;
const DEFAULT_RECOVERY_WINDOW_MS = 30_000;

function createUnsupportedCapabilityError(
  provider: string,
  capability: string,
  requestId: string
): GatewayError {
  return new GatewayError(
    `Provider ${provider} does not support required capability: ${capability}`,
    {
      code: "provider_capability_not_supported",
      category: "routing",
      httpStatus: 400,
      retryable: false,
      provider,
      requestId
    }
  );
}

function createProviderTimeoutError(requestId: string): GatewayError {
  return new GatewayError("Upstream provider timed out", {
    code: "provider_timeout",
    category: "provider",
    httpStatus: 504,
    retryable: true,
    requestId
  });
}

function createProviderEmptyStreamError(
  provider: string,
  providerModel: string,
  requestId: string
): GatewayError {
  return new GatewayError(
    `Provider ${provider} returned an empty stream for model ${providerModel}`,
    {
      code: "provider_empty_stream",
      category: "provider",
      httpStatus: 502,
      retryable: true,
      provider,
      requestId
    }
  );
}

function createProviderCircuitOpenError(requestId: string): GatewayError {
  return new GatewayError(
    "All eligible provider targets are temporarily unavailable",
    {
      code: "provider_circuit_open",
      category: "routing",
      httpStatus: 503,
      retryable: true,
      requestId
    }
  );
}

function getProviderCircuitBreakerPolicy(
  config: GatewayConfig
): ProviderCircuitBreakerPolicy {
  return {
    threshold:
      config.providerCircuitBreakerThreshold ??
      DEFAULT_PROVIDER_CIRCUIT_BREAKER_THRESHOLD,
    cooldownMs:
      config.providerCircuitBreakerCooldownMs ??
      DEFAULT_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS,
    ...(config.providerCircuitBreakerErrorRateWindowMs !== undefined
      ? { errorRateWindowMs: config.providerCircuitBreakerErrorRateWindowMs }
      : {}),
    ...(config.providerCircuitBreakerErrorRateThreshold !== undefined
      ? { errorRateThreshold: config.providerCircuitBreakerErrorRateThreshold }
      : {}),
    ...(config.providerCircuitBreakerMinAttemptsInWindow !== undefined
      ? {
          minAttemptsInWindow: config.providerCircuitBreakerMinAttemptsInWindow
        }
      : {}),
    ...(config.providerCircuitBreakerHalfOpenPromotionSuccesses !== undefined
      ? {
          halfOpenPromotionSuccesses:
            config.providerCircuitBreakerHalfOpenPromotionSuccesses
        }
      : {}),
    ...(config.providerCircuitBreakerHalfOpenPromotionSuccessRate !== undefined
      ? {
          halfOpenPromotionSuccessRate:
            config.providerCircuitBreakerHalfOpenPromotionSuccessRate
        }
      : {}),
    ...(config.providerCircuitBreakerHalfOpenPromotionWindow !== undefined
      ? {
          halfOpenPromotionWindow:
            config.providerCircuitBreakerHalfOpenPromotionWindow
        }
      : {})
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildAttemptRequest(
  request: CanonicalRequest,
  target: ProviderTarget
): CanonicalRequest {
  return {
    ...request,
    model: target.providerModel
  };
}

function getOriginalTargetOrder(
  targets: ProviderTarget[]
): Map<string, number> {
  return new Map(
    targets.map((target, index) => [serializeProviderTarget(target), index])
  );
}

const CAPABILITY_REQUIREMENTS: readonly {
  requirement: keyof CanonicalRequestCapabilityRequirements;
  support: keyof ProviderCapabilityDescriptor;
  capabilityName: string;
}[] = [
  {
    requirement: "requiresSystemMessages",
    support: "supportsSystemMessages",
    capabilityName: "system_messages"
  },
  {
    requirement: "requiresStreaming",
    support: "supportsStreaming",
    capabilityName: "streaming"
  },
  {
    requirement: "requiresTools",
    support: "supportsTools",
    capabilityName: "tools"
  },
  {
    requirement: "requiresToolReplay",
    support: "supportsToolReplay",
    capabilityName: "tool_replay"
  },
  {
    requirement: "requiresStreamingTools",
    support: "supportsStreamingTools",
    capabilityName: "streaming_tools"
  },
  {
    requirement: "requiresMultimodalInput",
    support: "supportsMultimodalInput",
    capabilityName: "multimodal_input"
  },
  {
    requirement: "requiresEndUserId",
    support: "supportsEndUserId",
    capabilityName: "end_user_id"
  },
  {
    requirement: "requiresPreviousResponseId",
    support: "supportsPreviousResponseId",
    capabilityName: "previous_response_id"
  },
  {
    requirement: "requiresConversationId",
    support: "supportsConversationId",
    capabilityName: "conversation"
  },
  {
    requirement: "requiresPrompt",
    support: "supportsPrompt",
    capabilityName: "prompt"
  },
  {
    requirement: "requiresReasoning",
    support: "supportsReasoning",
    capabilityName: "reasoning"
  },
  {
    requirement: "requiresStructuredOutputs",
    support: "supportsStructuredOutputs",
    capabilityName: "structured_outputs"
  },
  {
    requirement: "requiresStreamingStructuredOutputs",
    support: "supportsStreamingStructuredOutputs",
    capabilityName: "streaming_structured_outputs"
  },
  {
    requirement: "requiresParallelToolCallControl",
    support: "supportsParallelToolCallControl",
    capabilityName: "parallel_tool_call_control"
  },
  {
    requirement: "requiresOpenAIRequestMetadata",
    support: "supportsOpenAIRequestMetadata",
    capabilityName: "openai_request_metadata"
  },
  {
    requirement: "requiresOpenAIResponsesTextControls",
    support: "supportsOpenAIResponsesTextControls",
    capabilityName: "openai_responses_text_controls"
  },
  {
    requirement: "requiresToolChoice",
    support: "supportsToolChoice",
    capabilityName: "tool_choice"
  },
  {
    requirement: "requiresStopSequences",
    support: "supportsStopSequences",
    capabilityName: "stop_sequences"
  },
  {
    requirement: "requiresSamplingParameters",
    support: "supportsSamplingParameters",
    capabilityName: "sampling_parameters"
  },
  {
    requirement: "requiresAnthropicRequestMetadata",
    support: "supportsAnthropicRequestMetadata",
    capabilityName: "anthropic_request_metadata"
  }
];

export function assertProviderSupportsCanonicalRequest(
  descriptor: ProviderCapabilityDescriptor,
  request: CanonicalRequest,
  requestId: string
) {
  const requirements = getCanonicalRequestCapabilityRequirements(request);

  for (const entry of CAPABILITY_REQUIREMENTS) {
    if (requirements[entry.requirement] && !descriptor[entry.support]) {
      throw createUnsupportedCapabilityError(
        descriptor.provider,
        entry.capabilityName,
        requestId
      );
    }
  }
}

function createProviderAdapter(
  route: ModelRoute,
  target: ProviderTarget,
  config: GatewayConfig,
  request: CanonicalRequest,
  requestId: string,
  getProviderDescriptor: ProviderCapabilityDescriptorResolver,
  fetcher?: typeof fetch
): ProviderAdapter {
  const descriptor = getProviderDescriptor(target.provider);
  assertProviderSupportsCanonicalRequest(descriptor, request, requestId);
  const routeShaping = resolveRouteRequestShapingForTarget(
    route.shaping,
    serializeProviderTarget(route.target),
    serializeProviderTarget(target)
  );

  const providerConfig = resolveProviderConfig(target.provider, config);
  const options: ProviderAdapterConstructionOptions = {
    apiKey: providerConfig.apiKey,
    baseUrl: providerConfig.baseUrl,
    ...(providerConfig.defaultMaxTokens != null
      ? { defaultMaxTokens: providerConfig.defaultMaxTokens }
      : {}),
    ...(routeShaping ? { shaping: routeShaping } : {}),
    ...(routeShaping?.signing ? { signing: routeShaping.signing } : {}),
    signingSecrets: config.requestSigningSecrets ?? {},
    ...(fetcher ? { fetcher } : {})
  };

  return createProviderAdapterFromRegistry(target.provider, options);
}

interface ResolvedProviderConfig {
  apiKey: string;
  baseUrl: string;
  defaultMaxTokens?: number;
}

function resolveProviderConfig(
  provider: string,
  config: GatewayConfig
): ResolvedProviderConfig {
  switch (provider) {
    case "anthropic":
      return {
        apiKey: config.anthropic?.apiKey ?? "",
        baseUrl: config.anthropic?.baseUrl ?? "",
        defaultMaxTokens: config.anthropic?.defaultMaxTokens ?? 256
      };
    case "gemini":
      return {
        apiKey: config.gemini?.apiKey ?? "",
        baseUrl: config.gemini?.baseUrl ?? ""
      };
    case "openai":
      return {
        apiKey: config.openAI.apiKey,
        baseUrl: config.openAI.baseUrl
      };
    default:
      throw new GatewayError(`Unknown provider: ${provider}`, {
        code: "provider_not_supported",
        category: "configuration",
        httpStatus: 500,
        retryable: false
      });
  }
}

function createAttemptRequest(
  request: CanonicalRequest,
  target: ProviderTarget
): CanonicalRequest {
  return buildAttemptRequest(request, target);
}

function resolvePerRequestShapingForTarget(
  requestShaping: RequestShapingProfile | undefined,
  route: ModelRoute,
  target: ProviderTarget
): RequestShapingProfile | undefined {
  if (!requestShaping) {
    return undefined;
  }

  if (target.provider === route.target.provider) {
    return requestShaping;
  }

  return undefined;
}

function hashString(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function scoreWeightedTarget(
  route: ModelRoute,
  target: ProviderTarget,
  requestId: string,
  weight: number
): number {
  const seed = `${requestId}:${route.externalModel}:${serializeProviderTarget(target)}`;
  const hash = hashString(seed);

  return hash * weight;
}

function reorderTargetsForRoute(
  route: ModelRoute,
  targets: ProviderTarget[],
  request: CanonicalRequest,
  requestId: string,
  now: () => number,
  healthByTarget: Map<string, ProviderTargetHealthSnapshot>,
  windows: RoutingFreshnessWindows,
  circuitBreakerPolicy: ProviderCircuitBreakerPolicy
): ProviderTarget[] {
  const targetSelection = route.targetSelection;

  if (!targetSelection) {
    return targets;
  }

  // Evaluate time once for consistent routing comparisons.
  const currentTime = now();
  const originalOrder = getOriginalTargetOrder(targets);

  // Derive request class and compute affinity adjustments.
  const requestClass = deriveRequestClass(request);
  const affinityByTarget = computeAffinityByTarget(
    requestClass,
    targetSelection.requestClassAffinity,
    targets.map((t) => serializeProviderTarget(t))
  );

  const ctx: RoutingScoringContext = {
    now: currentTime,
    healthByTarget,
    windows,
    originalOrder,
    ...(affinityByTarget ? { affinityByTarget } : {})
  };

  if (targetSelection.strategy === "health_priority") {
    return [...targets].sort((left, right) =>
      compareTargetsByHealthPriority(
        serializeProviderTarget(left),
        serializeProviderTarget(right),
        ctx
      )
    );
  }

  if (targetSelection.strategy === "lowest_cost") {
    return [...targets].sort((left, right) =>
      compareTargetsByLowestCost(
        serializeProviderTarget(left),
        serializeProviderTarget(right),
        ctx,
        targetSelection.costs
      )
    );
  }

  if (targetSelection.strategy === "priority") {
    return [...targets].sort((left, right) =>
      compareTargetsByPriority(
        serializeProviderTarget(left),
        serializeProviderTarget(right),
        ctx,
        targetSelection
      )
    );
  }

  if (targetSelection.strategy === "health_score") {
    return [...targets].sort((left, right) =>
      compareTargetsByHealthScore(
        serializeProviderTarget(left),
        serializeProviderTarget(right),
        ctx,
        targetSelection.latencySloMs
      )
    );
  }

  // weighted strategy — uses gateway-local hash scoring, with governance
  // health-adjusted weights and half-open traffic ramping.
  return [...targets].sort((left, right) => {
    const leftKey = serializeProviderTarget(left);
    const rightKey = serializeProviderTarget(right);
    const leftBaseWeight = computeAdjustedWeight(
      targetSelection.weights[leftKey] ?? 1,
      leftKey,
      ctx
    );
    const rightBaseWeight = computeAdjustedWeight(
      targetSelection.weights[rightKey] ?? 1,
      rightKey,
      ctx
    );
    const leftHealth = ctx.healthByTarget.get(leftKey);
    const rightHealth = ctx.healthByTarget.get(rightKey);
    // Apply traffic ramp factor for half-open targets: multiply the health-adjusted
    // weight by the ramp factor (0 = probe only, 1 = fully promoted).
    const leftRamp = leftHealth?.isHalfOpen
      ? computeHalfOpenTrafficRamp(
          {
            consecutiveRetryableFailures: 0,
            openedAt: 1,
            recoverySuccessCount: leftHealth.recoverySuccessCount ?? 0
          },
          circuitBreakerPolicy
        )
      : 1;
    const rightRamp = rightHealth?.isHalfOpen
      ? computeHalfOpenTrafficRamp(
          {
            consecutiveRetryableFailures: 0,
            openedAt: 1,
            recoverySuccessCount: rightHealth.recoverySuccessCount ?? 0
          },
          circuitBreakerPolicy
        )
      : 1;
    // Apply affinity adjustment: preferred targets get a weight boost,
    // avoided targets get a weight penalty. Neutral (0) means no change.
    const leftAffinity = ctx.affinityByTarget?.get(leftKey) ?? 0;
    const rightAffinity = ctx.affinityByTarget?.get(rightKey) ?? 0;
    const AFFINITY_WEIGHT_FACTOR = 2;
    const leftWeight = leftBaseWeight * leftRamp * (1 + leftAffinity * AFFINITY_WEIGHT_FACTOR);
    const rightWeight = rightBaseWeight * rightRamp * (1 + rightAffinity * AFFINITY_WEIGHT_FACTOR);
    const rightScore = scoreWeightedTarget(
      route,
      right,
      requestId,
      rightWeight
    );
    const leftScore = scoreWeightedTarget(route, left, requestId, leftWeight);

    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    return compareByOriginalRouteOrder(leftKey, rightKey, originalOrder);
  });
}

function promoteHalfOpenProbeTarget(
  targets: ProviderTarget[],
  healthByTarget?: Map<string, ProviderTargetHealthSnapshot>
): ProviderTarget[] {
  // Preserve ordinary health ordering, but give one cooled-down target a real
  // recovery probe so it cannot starve behind permanently healthy peers.
  const firstHalfOpenIndex = targets.findIndex((target) => {
    return (
      healthByTarget?.get(serializeProviderTarget(target))?.isHalfOpen === true
    );
  });

  if (firstHalfOpenIndex < 0) {
    return targets;
  }

  const promoted = targets[firstHalfOpenIndex];

  if (!promoted) {
    return targets;
  }

  const withoutPromoted = targets.filter((_, index) => {
    return index !== firstHalfOpenIndex;
  });
  return [promoted, ...withoutPromoted];
}

function selectEligibleTargets(
  route: ModelRoute,
  request: CanonicalRequest,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string,
  getProviderDescriptor: ProviderCapabilityDescriptorResolver,
  circuitBreakerPolicy: ProviderCircuitBreakerPolicy,
  now: () => number,
  circuitBreakerBackend: ProviderCircuitBreakerBackend,
  windows: RoutingFreshnessWindows,
  routingMetadataRef?: RoutingMetadataAccumulator
): Promise<ProviderTarget[]> {
  const candidates = [route.target, ...(route.fallbacks ?? [])];
  const eligibleTargets: ProviderTarget[] = [];
  let lastAuthorizationError: GatewayError | undefined;
  let lastCapabilityError: GatewayError | undefined;
  let skippedOpenCircuitCount = 0;

  return (async () => {
    const healthByTarget = new Map<string, ProviderTargetHealthSnapshot>();

    for (const target of candidates) {
      if (!target) {
        continue;
      }

      try {
        assertGatewayKeyAllowsProvider(
          gatewayApiKey,
          target.provider,
          requestId
        );
      } catch (error) {
        if (error instanceof GatewayError) {
          lastAuthorizationError = error;
          continue;
        }

        throw error;
      }

      try {
        const descriptor = getProviderDescriptor(target.provider);
        assertProviderSupportsCanonicalRequest(
          descriptor,
          buildAttemptRequest(request, target),
          requestId
        );
      } catch (error) {
        if (error instanceof GatewayError) {
          lastCapabilityError = error;
          continue;
        }

        throw error;
      }

      const circuitState = await getProviderTargetCircuitState(
        target,
        circuitBreakerPolicy,
        now,
        circuitBreakerBackend
      );
      const snapshot = circuitState
        ? deriveProviderTargetHealthSnapshot(circuitState)
        : { isOpen: false, consecutiveRetryableFailures: 0 };

      healthByTarget.set(serializeProviderTarget(target), snapshot);

      if (snapshot.isOpen) {
        skippedOpenCircuitCount += 1;
        continue;
      }

      eligibleTargets.push(target);
    }

    if (routingMetadataRef) {
      routingMetadataRef.primaryTargetOpen =
        healthByTarget.get(serializeProviderTarget(route.target))?.isOpen ===
        true;
    }

    if (eligibleTargets.length > 0) {
      return promoteHalfOpenProbeTarget(
        reorderTargetsForRoute(
          route,
          eligibleTargets,
          request,
          requestId,
          now,
          healthByTarget,
          windows,
          circuitBreakerPolicy
        ),
        healthByTarget
      );
    }

    if (lastAuthorizationError) {
      throw lastAuthorizationError;
    }

    if (lastCapabilityError) {
      throw lastCapabilityError;
    }

    if (skippedOpenCircuitCount > 0) {
      throw createProviderCircuitOpenError(requestId);
    }

    throw new Error(
      "At least one provider target is required for route execution"
    );
  })();
}

export async function executeRoutedRequest(
  route: ModelRoute,
  request: CanonicalRequest,
  options: {
    config: GatewayConfig;
    gatewayApiKey: GatewayApiKeyRecord;
    requestId: string;
    requestMode?: "default" | "openai_responses";
    requestShaping?: RequestShapingProfile;
    fetcher?: typeof fetch;
    now?: () => number;
    getProviderDescriptor?: ProviderCapabilityDescriptorResolver;
    onAttemptTarget?: (target: ProviderTarget) => void;
    circuitBreakerBackend?: ProviderCircuitBreakerBackend;
    routingMetadata?: RoutingMetadataAccumulator;
    signal?: AbortSignal;
  }
): Promise<CanonicalResponse> {
  const {
    config,
    gatewayApiKey,
    requestId,
    requestMode = "default",
    requestShaping,
    fetcher,
    now = Date.now,
    getProviderDescriptor = getProviderCapabilityDescriptor,
    onAttemptTarget,
    circuitBreakerBackend = createInMemoryCircuitBreakerBackend(),
    routingMetadata: routingMetadataRef,
    signal
  } = options;
  const circuitBreakerPolicy = getProviderCircuitBreakerPolicy(config);
  const windows: RoutingFreshnessWindows = {
    latencyFreshnessMs:
      config.routingLatencyFreshnessMs ?? DEFAULT_LATENCY_FRESHNESS_MS,
    costFreshnessMs: config.routingCostFreshnessMs ?? DEFAULT_COST_FRESHNESS_MS,
    failureFreshnessMs:
      config.routingFailureFreshnessMs ?? DEFAULT_FAILURE_FRESHNESS_MS,
    recoveryWindowMs:
      config.routingRecoveryWindowMs ?? DEFAULT_RECOVERY_WINDOW_MS
  };
  const targets = await selectEligibleTargets(
    route,
    request,
    gatewayApiKey,
    requestId,
    getProviderDescriptor,
    circuitBreakerPolicy,
    now,
    circuitBreakerBackend,
    windows,
    routingMetadataRef
  );
  const deadline = now() + config.providerTimeoutMs;
  let lastError: unknown;
  let attemptCount = 0;

  try {
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      if (!target) {
        throw new Error("Provider target is required for route execution");
      }

      let targetAttempt = 0;

      while (true) {
        onAttemptTarget?.(target);
        attemptCount += 1;
        if (routingMetadataRef) {
          routingMetadataRef.attemptCount = attemptCount;
        }
        const currentAttemptRequest = createAttemptRequest(request, target);
        const currentAttemptStartedAt = now();
        const currentRemainingTimeoutMs = deadline - currentAttemptStartedAt;

        if (currentRemainingTimeoutMs <= 0) {
          throw createProviderTimeoutError(requestId);
        }

        const adapter = createProviderAdapter(
          route,
          target,
          config,
          currentAttemptRequest,
          requestId,
          getProviderDescriptor,
          fetcher
        );

        try {
          const targetRequestShaping = resolvePerRequestShapingForTarget(
            requestShaping,
            route,
            target
          );
          const response = await adapter.complete(currentAttemptRequest, {
            requestId,
            timeoutMs: currentRemainingTimeoutMs,
            requestMode,
            ...(signal ? { signal } : {}),
            ...(targetRequestShaping
              ? { requestShaping: targetRequestShaping }
              : {})
          });
          await circuitBreakerBackend.recordSuccess(
            target,
            now() - currentAttemptStartedAt,
            response.usage?.totalTokens,
            now(),
            circuitBreakerPolicy
          );

          return response;
        } catch (error) {
          lastError = error;

          if (
            error instanceof GatewayError &&
            error.category === "provider" &&
            error.retryable
          ) {
            await circuitBreakerBackend.recordRetryableFailure(
              target,
              circuitBreakerPolicy,
              currentAttemptStartedAt
            );
          }

          const shouldRetrySameTarget =
            error instanceof GatewayError &&
            error.category === "provider" &&
            error.retryable &&
            targetAttempt < config.providerMaxRetries;

          if (shouldRetrySameTarget) {
            const remainingBeforeBackoff = deadline - now();

            if (remainingBeforeBackoff <= 0) {
              throw createProviderTimeoutError(requestId);
            }

            const retryBackoffMs = config.providerRetryBackoffMs;

            if (retryBackoffMs > 0) {
              if (remainingBeforeBackoff < retryBackoffMs) {
                throw createProviderTimeoutError(requestId);
              }

              await sleep(retryBackoffMs);
            }

            targetAttempt += 1;
            continue;
          }

          const shouldFailOver =
            error instanceof GatewayError &&
            error.category === "provider" &&
            error.retryable &&
            index < targets.length - 1;

          if (!shouldFailOver) {
            throw error;
          }

          break;
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Provider execution failed");
  } finally {
    if (routingMetadataRef) {
      routingMetadataRef.timeoutBudgetMs = config.providerTimeoutMs;
      routingMetadataRef.timeoutBudgetRemainingMs = Math.max(
        0,
        deadline - now()
      );
    }
  }
}

export async function* executeRoutedStreamRequest(
  route: ModelRoute,
  request: CanonicalRequest,
  options: {
    config: GatewayConfig;
    gatewayApiKey: GatewayApiKeyRecord;
    requestId: string;
    requestMode?: "default" | "openai_responses";
    requestShaping?: RequestShapingProfile;
    fetcher?: typeof fetch;
    now?: () => number;
    getProviderDescriptor?: ProviderCapabilityDescriptorResolver;
    onAttemptTarget?: (target: ProviderTarget) => void;
    circuitBreakerBackend?: ProviderCircuitBreakerBackend;
    routingMetadata?: RoutingMetadataAccumulator;
    signal?: AbortSignal;
  }
): AsyncIterable<CanonicalStreamEvent> {
  const {
    config,
    gatewayApiKey,
    requestId,
    requestMode = "default",
    requestShaping,
    fetcher,
    now = Date.now,
    getProviderDescriptor = getProviderCapabilityDescriptor,
    onAttemptTarget,
    circuitBreakerBackend = createInMemoryCircuitBreakerBackend(),
    routingMetadata: routingMetadataRef,
    signal
  } = options;
  const circuitBreakerPolicy = getProviderCircuitBreakerPolicy(config);
  const streamWindows: RoutingFreshnessWindows = {
    latencyFreshnessMs:
      config.routingLatencyFreshnessMs ?? DEFAULT_LATENCY_FRESHNESS_MS,
    costFreshnessMs: config.routingCostFreshnessMs ?? DEFAULT_COST_FRESHNESS_MS,
    failureFreshnessMs:
      config.routingFailureFreshnessMs ?? DEFAULT_FAILURE_FRESHNESS_MS,
    recoveryWindowMs:
      config.routingRecoveryWindowMs ?? DEFAULT_RECOVERY_WINDOW_MS
  };
  const targets = (
    await selectEligibleTargets(
      route,
      request,
      gatewayApiKey,
      requestId,
      getProviderDescriptor,
      circuitBreakerPolicy,
      now,
      circuitBreakerBackend,
      streamWindows,
      routingMetadataRef
    )
  ).filter((target) => {
    return getProviderDescriptor(target.provider).supportsStreaming;
  });
  if (targets.length === 0) {
    throw createUnsupportedCapabilityError(
      route.target.provider,
      "streaming",
      requestId
    );
  }

  const deadline = now() + config.providerTimeoutMs;
  let lastError: unknown;
  let attemptCount = 0;

  try {
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];

      if (!target) {
        throw new Error("Provider target is required for stream execution");
      }

      const currentAttemptStartedAt = now();
      const currentRemainingTimeoutMs = deadline - currentAttemptStartedAt;

      if (currentRemainingTimeoutMs <= 0) {
        throw createProviderTimeoutError(requestId);
      }

      const currentAttemptRequest = createAttemptRequest(request, target);
      onAttemptTarget?.(target);
      const adapter = createProviderAdapter(
        route,
        target,
        config,
        currentAttemptRequest,
        requestId,
        getProviderDescriptor,
        fetcher
      );

      if (!adapter.stream) {
        throw createUnsupportedCapabilityError(
          target.provider,
          "streaming",
          requestId
        );
      }

      let yieldedAnyEvent = false;
      let streamAttempt = 0;
      let completedUsageTotalTokens: number | undefined;

      while (true) {
        try {
          onAttemptTarget?.(target);
          attemptCount += 1;
          if (routingMetadataRef) {
            routingMetadataRef.attemptCount = attemptCount;
          }
          const currentStreamAttemptRequest =
            streamAttempt === 0
              ? currentAttemptRequest
              : createAttemptRequest(request, target);

          const streamTargetShaping = resolvePerRequestShapingForTarget(
            requestShaping,
            route,
            target
          );
          const streamContext = {
            requestId,
            timeoutMs: deadline - now(),
            streamIdleTimeoutMs: config.providerStreamIdleTimeoutMs,
            requestMode,
            malformedSseEventCount: 0,
            ...(signal ? { signal } : {}),
            ...(streamTargetShaping
              ? { requestShaping: streamTargetShaping }
              : {})
          };
          let sawCompleted = false;
          for await (const event of adapter.stream(
            currentStreamAttemptRequest,
            streamContext
          )) {
            if (event.type === "response_completed") {
              sawCompleted = true;
              completedUsageTotalTokens = event.usage?.totalTokens;
            }
            yieldedAnyEvent = true;
            yield event;
          }

          if (!yieldedAnyEvent) {
            throw createProviderEmptyStreamError(
              target.provider,
              target.providerModel,
              requestId
            );
          }

          if (routingMetadataRef && streamContext.malformedSseEventCount > 0) {
            routingMetadataRef.malformedSseEventCount =
              (routingMetadataRef.malformedSseEventCount ?? 0) +
              streamContext.malformedSseEventCount;
          }

          await circuitBreakerBackend.recordSuccess(
            target,
            now() - currentAttemptStartedAt,
            completedUsageTotalTokens,
            now(),
            circuitBreakerPolicy
          );

          return;
        } catch (error) {
          lastError = error;

          if (
            error instanceof GatewayError &&
            error.category === "provider" &&
            error.retryable
          ) {
            await circuitBreakerBackend.recordRetryableFailure(
              target,
              circuitBreakerPolicy,
              currentAttemptStartedAt
            );
          }

          const shouldRetrySameTarget =
            error instanceof GatewayError &&
            error.category === "provider" &&
            error.retryable &&
            !yieldedAnyEvent &&
            streamAttempt < config.providerMaxRetries &&
            deadline - now() > 0;

          if (shouldRetrySameTarget) {
            const retryBackoffMs = config.providerRetryBackoffMs;
            const remainingBeforeBackoff = deadline - now();

            if (retryBackoffMs > 0) {
              if (remainingBeforeBackoff < retryBackoffMs) {
                throw createProviderTimeoutError(requestId);
              }

              await sleep(retryBackoffMs);
            }

            streamAttempt += 1;
            continue;
          }

          const shouldFailOver =
            !yieldedAnyEvent &&
            error instanceof GatewayError &&
            error.category === "provider" &&
            error.retryable &&
            index < targets.length - 1;

          if (!shouldFailOver) {
            throw error;
          }

          break;
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Provider stream execution failed");
  } finally {
    if (routingMetadataRef) {
      routingMetadataRef.timeoutBudgetMs = config.providerTimeoutMs;
      routingMetadataRef.timeoutBudgetRemainingMs = Math.max(
        0,
        deadline - now()
      );
    }
  }
}
