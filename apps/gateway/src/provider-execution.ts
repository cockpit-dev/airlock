import {
  getCanonicalRequestCapabilityRequirements,
  type CanonicalRequest,
  type CanonicalResponse,
  type CanonicalStreamEvent
} from "@airlock/canonical";
import {
  AnthropicProviderAdapter,
  type ProviderCapabilityDescriptor,
  GeminiProviderAdapter,
  getProviderCapabilityDescriptor,
  OpenAIProviderAdapter,
  type ProviderAdapter
} from "@airlock/providers";
import {
  deriveProviderTargetHealthSnapshot,
  compareTargetsByHealthPriority,
  compareTargetsByLowestCost,
  compareTargetsByPriority,
  computeAdjustedWeight,
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

export function assertProviderSupportsCanonicalRequest(
  descriptor: ProviderCapabilityDescriptor,
  request: CanonicalRequest,
  requestId: string
) {
  const requirements = getCanonicalRequestCapabilityRequirements(request);

  if (
    requirements.requiresSystemMessages &&
    !descriptor.supportsSystemMessages
  ) {
    throw createUnsupportedCapabilityError(
      descriptor.provider,
      "system_messages",
      requestId
    );
  }

  if (requirements.requiresStreaming && !descriptor.supportsStreaming) {
    throw createUnsupportedCapabilityError(
      descriptor.provider,
      "streaming",
      requestId
    );
  }

  if (requirements.requiresTools && !descriptor.supportsTools) {
    throw createUnsupportedCapabilityError(
      descriptor.provider,
      "tools",
      requestId
    );
  }

  if (requirements.requiresToolReplay && !descriptor.supportsToolReplay) {
    throw createUnsupportedCapabilityError(
      descriptor.provider,
      "tool_replay",
      requestId
    );
  }

  if (
    requirements.requiresStreamingTools &&
    !descriptor.supportsStreamingTools
  ) {
    throw createUnsupportedCapabilityError(
      descriptor.provider,
      "streaming_tools",
      requestId
    );
  }

  if (
    requirements.requiresMultimodalInput &&
    !descriptor.supportsMultimodalInput
  ) {
    throw createUnsupportedCapabilityError(
      descriptor.provider,
      "multimodal_input",
      requestId
    );
  }

  if (requirements.requiresEndUserId && !descriptor.supportsEndUserId) {
    throw createUnsupportedCapabilityError(
      descriptor.provider,
      "end_user_id",
      requestId
    );
  }

  if (
    requirements.requiresPreviousResponseId &&
    !descriptor.supportsPreviousResponseId
  ) {
    throw createUnsupportedCapabilityError(
      descriptor.provider,
      "previous_response_id",
      requestId
    );
  }

  if (
    requirements.requiresConversationId &&
    !descriptor.supportsConversationId
  ) {
    throw createUnsupportedCapabilityError(
      descriptor.provider,
      "conversation",
      requestId
    );
  }

  if (requirements.requiresPrompt && !descriptor.supportsPrompt) {
    throw createUnsupportedCapabilityError(
      descriptor.provider,
      "prompt",
      requestId
    );
  }

  if (requirements.requiresReasoning && !descriptor.supportsReasoning) {
    throw createUnsupportedCapabilityError(
      descriptor.provider,
      "reasoning",
      requestId
    );
  }

  if (
    requirements.requiresStructuredOutputs &&
    !descriptor.supportsStructuredOutputs
  ) {
    throw createUnsupportedCapabilityError(
      descriptor.provider,
      "structured_outputs",
      requestId
    );
  }

  if (
    requirements.requiresStreamingStructuredOutputs &&
    !descriptor.supportsStreamingStructuredOutputs
  ) {
    throw createUnsupportedCapabilityError(
      descriptor.provider,
      "streaming_structured_outputs",
      requestId
    );
  }

  if (
    requirements.requiresParallelToolCallControl &&
    !descriptor.supportsParallelToolCallControl
  ) {
    throw createUnsupportedCapabilityError(
      descriptor.provider,
      "parallel_tool_call_control",
      requestId
    );
  }

  if (
    requirements.requiresOpenAIRequestMetadata &&
    !descriptor.supportsOpenAIRequestMetadata
  ) {
    throw createUnsupportedCapabilityError(
      descriptor.provider,
      "openai_request_metadata",
      requestId
    );
  }

  if (
    requirements.requiresOpenAIResponsesTextControls &&
    !descriptor.supportsOpenAIResponsesTextControls
  ) {
    throw createUnsupportedCapabilityError(
      descriptor.provider,
      "openai_responses_text_controls",
      requestId
    );
  }

  if (requirements.requiresToolChoice && !descriptor.supportsToolChoice) {
    throw createUnsupportedCapabilityError(
      descriptor.provider,
      "tool_choice",
      requestId
    );
  }

  if (requirements.requiresStopSequences && !descriptor.supportsStopSequences) {
    throw createUnsupportedCapabilityError(
      descriptor.provider,
      "stop_sequences",
      requestId
    );
  }

  if (
    requirements.requiresSamplingParameters &&
    !descriptor.supportsSamplingParameters
  ) {
    throw createUnsupportedCapabilityError(
      descriptor.provider,
      "sampling_parameters",
      requestId
    );
  }

  if (
    requirements.requiresAnthropicRequestMetadata &&
    !descriptor.supportsAnthropicRequestMetadata
  ) {
    throw createUnsupportedCapabilityError(
      descriptor.provider,
      "anthropic_request_metadata",
      requestId
    );
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
  const routeSigning = routeShaping?.signing;

  if (target.provider === "anthropic") {
    return new AnthropicProviderAdapter({
      apiKey: config.anthropic?.apiKey ?? "",
      baseUrl: config.anthropic?.baseUrl ?? "",
      defaultMaxTokens: config.anthropic?.defaultMaxTokens ?? 256,
      ...(routeShaping ? { shaping: routeShaping } : {}),
      ...(routeSigning ? { signing: routeSigning } : {}),
      signingSecrets: config.requestSigningSecrets ?? {},
      ...(fetcher ? { fetcher } : {})
    });
  }

  if (target.provider === "gemini") {
    return new GeminiProviderAdapter({
      apiKey: config.gemini?.apiKey ?? "",
      baseUrl: config.gemini?.baseUrl ?? "",
      ...(routeShaping ? { shaping: routeShaping } : {}),
      ...(routeSigning ? { signing: routeSigning } : {}),
      signingSecrets: config.requestSigningSecrets ?? {},
      ...(fetcher ? { fetcher } : {})
    });
  }

  return new OpenAIProviderAdapter({
    apiKey: config.openAI.apiKey,
    baseUrl: config.openAI.baseUrl,
    ...(routeShaping ? { shaping: routeShaping } : {}),
    ...(routeSigning ? { signing: routeSigning } : {}),
    signingSecrets: config.requestSigningSecrets ?? {},
    ...(fetcher ? { fetcher } : {})
  });
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
  requestId: string,
  now: () => number,
  healthByTarget: Map<string, ProviderTargetHealthSnapshot>,
  windows: RoutingFreshnessWindows
): ProviderTarget[] {
  const targetSelection = route.targetSelection;

  if (!targetSelection) {
    return targets;
  }

  // Evaluate time once for consistent routing comparisons.
  const currentTime = now();
  const originalOrder = getOriginalTargetOrder(targets);
  const ctx: RoutingScoringContext = {
    now: currentTime,
    healthByTarget,
    windows,
    originalOrder
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

  // weighted strategy — uses gateway-local hash scoring, with governance
  // health-adjusted weights.
  return [...targets].sort((left, right) => {
    const leftKey = serializeProviderTarget(left);
    const rightKey = serializeProviderTarget(right);
    const leftWeight = computeAdjustedWeight(
      targetSelection.weights[leftKey] ?? 1,
      leftKey,
      ctx
    );
    const rightWeight = computeAdjustedWeight(
      targetSelection.weights[rightKey] ?? 1,
      rightKey,
      ctx
    );
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
  windows: RoutingFreshnessWindows
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

    if (eligibleTargets.length > 0) {
      return promoteHalfOpenProbeTarget(
        reorderTargetsForRoute(
          route,
          eligibleTargets,
          requestId,
          now,
          healthByTarget,
          windows
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
    circuitBreakerBackend = createInMemoryCircuitBreakerBackend()
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
    windows
  );
  const deadline = now() + config.providerTimeoutMs;
  let lastError: unknown;

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    if (!target) {
      throw new Error("Provider target is required for route execution");
    }

    let targetAttempt = 0;

    while (true) {
      onAttemptTarget?.(target);
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
          ...(targetRequestShaping
            ? { requestShaping: targetRequestShaping }
            : {})
        });
        await circuitBreakerBackend.recordSuccess(
          target,
          now() - currentAttemptStartedAt,
          response.usage?.totalTokens,
          now()
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
    circuitBreakerBackend = createInMemoryCircuitBreakerBackend()
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
      streamWindows
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
        const currentStreamAttemptRequest =
          streamAttempt === 0
            ? currentAttemptRequest
            : createAttemptRequest(request, target);

        const streamTargetShaping = resolvePerRequestShapingForTarget(
          requestShaping,
          route,
          target
        );
        for await (const event of adapter.stream(currentStreamAttemptRequest, {
          requestId,
          timeoutMs: deadline - now(),
          requestMode,
          ...(streamTargetShaping
            ? { requestShaping: streamTargetShaping }
            : {})
        })) {
          if (event.type === "response_completed") {
            completedUsageTotalTokens = event.usage?.totalTokens;
          }
          yieldedAnyEvent = true;
          yield event;
        }

        await circuitBreakerBackend.recordSuccess(
          target,
          now() - currentAttemptStartedAt,
          completedUsageTotalTokens,
          now()
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
}
