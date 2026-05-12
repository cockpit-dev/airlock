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
import type { GatewayApiKeyRecord } from "@airlock/governance";
import type { RequestShapingProfile } from "@airlock/request-shaping";
import {
  serializeProviderTarget,
  type ModelRoute,
  type ProviderTarget
} from "@airlock/routing";
import { GatewayError } from "@airlock/shared";

import { assertGatewayKeyAllowsProvider } from "./auth.js";
import {
  createInMemoryCircuitBreakerBackend,
  isProviderTargetCircuitOpen,
  type ProviderCircuitBreakerBackend,
  type ProviderCircuitBreakerPolicy
} from "./circuit-breaker.js";
import type { GatewayConfig } from "./config.js";

const DEFAULT_PROVIDER_CIRCUIT_BREAKER_THRESHOLD = 3;
const DEFAULT_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

type ProviderCapabilityDescriptorResolver = (
  provider: ProviderTarget["provider"]
) => ProviderCapabilityDescriptor;

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
  return new GatewayError("All eligible provider targets are temporarily unavailable", {
    code: "provider_circuit_open",
    category: "routing",
    httpStatus: 503,
    retryable: true,
    requestId
  });
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
      DEFAULT_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS
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

export function assertProviderSupportsCanonicalRequest(
  descriptor: ProviderCapabilityDescriptor,
  request: CanonicalRequest,
  requestId: string
) {
  const requirements = getCanonicalRequestCapabilityRequirements(request);

  if (requirements.requiresSystemMessages && !descriptor.supportsSystemMessages) {
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

  if (target.provider === "anthropic") {
    return new AnthropicProviderAdapter({
      apiKey: config.anthropic?.apiKey ?? "",
      baseUrl: config.anthropic?.baseUrl ?? "",
      defaultMaxTokens: config.anthropic?.defaultMaxTokens ?? 256,
      ...(route.shaping ? { shaping: route.shaping } : {}),
      ...(fetcher ? { fetcher } : {})
    });
  }

  if (target.provider === "gemini") {
    return new GeminiProviderAdapter({
      apiKey: config.gemini?.apiKey ?? "",
      baseUrl: config.gemini?.baseUrl ?? "",
      ...(route.shaping ? { shaping: route.shaping } : {}),
      ...(fetcher ? { fetcher } : {})
    });
  }

  return new OpenAIProviderAdapter({
    apiKey: config.openAI.apiKey,
    baseUrl: config.openAI.baseUrl,
    ...(route.shaping ? { shaping: route.shaping } : {}),
    ...(fetcher ? { fetcher } : {})
  });
}

function createAttemptRequest(
  request: CanonicalRequest,
  target: ProviderTarget
): CanonicalRequest {
  return buildAttemptRequest(request, target);
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
  requestId: string
): ProviderTarget[] {
  const targetSelection = route.targetSelection;

  if (!targetSelection) {
    return targets;
  }

  if (targetSelection.strategy === "lowest_cost") {
    return [...targets].sort((left, right) => {
      const leftCost = targetSelection.costs[serializeProviderTarget(left)] ?? 1;
      const rightCost =
        targetSelection.costs[serializeProviderTarget(right)] ?? 1;

      if (leftCost !== rightCost) {
        return leftCost - rightCost;
      }

      return serializeProviderTarget(left).localeCompare(
        serializeProviderTarget(right)
      );
    });
  }

  return [...targets].sort((left, right) => {
    const leftWeight =
      targetSelection.weights[serializeProviderTarget(left)] ?? 1;
    const rightWeight =
      targetSelection.weights[serializeProviderTarget(right)] ?? 1;
    const rightScore = scoreWeightedTarget(route, right, requestId, rightWeight);
    const leftScore = scoreWeightedTarget(route, left, requestId, leftWeight);

    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    return serializeProviderTarget(left).localeCompare(
      serializeProviderTarget(right)
    );
  });
}

function selectEligibleTargets(
  route: ModelRoute,
  request: CanonicalRequest,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string,
  getProviderDescriptor: ProviderCapabilityDescriptorResolver,
  circuitBreakerPolicy: ProviderCircuitBreakerPolicy,
  now: () => number,
  circuitBreakerBackend: ProviderCircuitBreakerBackend
): Promise<ProviderTarget[]> {
  const candidates = [route.target, ...(route.fallbacks ?? [])];
  const eligibleTargets: ProviderTarget[] = [];
  let lastAuthorizationError: GatewayError | undefined;
  let lastCapabilityError: GatewayError | undefined;
  let skippedOpenCircuitCount = 0;

  return (async () => {
    for (const target of candidates) {
    if (!target) {
      continue;
    }

    try {
      assertGatewayKeyAllowsProvider(gatewayApiKey, target.provider, requestId);
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

      if (
        await isProviderTargetCircuitOpen(
          target,
          circuitBreakerPolicy,
          now,
          circuitBreakerBackend
        )
      ) {
      skippedOpenCircuitCount += 1;
      continue;
    }

    eligibleTargets.push(target);
  }

    if (eligibleTargets.length > 0) {
      return reorderTargetsForRoute(route, eligibleTargets, requestId);
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

    throw new Error("At least one provider target is required for route execution");
  })();
}

export async function executeRoutedRequest(
  route: ModelRoute,
  request: CanonicalRequest,
  options: {
    config: GatewayConfig;
    gatewayApiKey: GatewayApiKeyRecord;
    requestId: string;
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
    requestShaping,
    fetcher,
    now = Date.now,
    getProviderDescriptor = getProviderCapabilityDescriptor,
    onAttemptTarget,
    circuitBreakerBackend = createInMemoryCircuitBreakerBackend()
  } = options;
  const circuitBreakerPolicy = getProviderCircuitBreakerPolicy(config);
  const targets = await selectEligibleTargets(
    route,
    request,
    gatewayApiKey,
    requestId,
    getProviderDescriptor,
    circuitBreakerPolicy,
    now,
    circuitBreakerBackend
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
        const response = await adapter.complete(currentAttemptRequest, {
          requestId,
          timeoutMs: currentRemainingTimeoutMs,
          ...(requestShaping ? { requestShaping } : {})
        });
        await circuitBreakerBackend.recordSuccess(target);

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

  throw lastError instanceof Error ? lastError : new Error("Provider execution failed");
}

export async function* executeRoutedStreamRequest(
  route: ModelRoute,
  request: CanonicalRequest,
  options: {
    config: GatewayConfig;
    gatewayApiKey: GatewayApiKeyRecord;
    requestId: string;
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
    requestShaping,
    fetcher,
    now = Date.now,
    getProviderDescriptor = getProviderCapabilityDescriptor,
    onAttemptTarget,
    circuitBreakerBackend = createInMemoryCircuitBreakerBackend()
  } = options;
  const circuitBreakerPolicy = getProviderCircuitBreakerPolicy(config);
  const targets = (
    await selectEligibleTargets(
    route,
    request,
    gatewayApiKey,
    requestId,
    getProviderDescriptor,
    circuitBreakerPolicy,
    now,
    circuitBreakerBackend
  )
  ).filter((target) => {
    return getProviderDescriptor(target.provider).supportsStreaming;
  });
  const target = targets[0];

  if (!target) {
    throw createUnsupportedCapabilityError(route.target.provider, "streaming", requestId);
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
    throw createUnsupportedCapabilityError(target.provider, "streaming", requestId);
  }

  try {
    for await (const event of adapter.stream(currentAttemptRequest, {
      requestId,
      timeoutMs: config.providerTimeoutMs,
      ...(requestShaping ? { requestShaping } : {})
    })) {
      yield event;
    }

    await circuitBreakerBackend.recordSuccess(target);
  } catch (error) {
    if (
      error instanceof GatewayError &&
      error.category === "provider" &&
      error.retryable
    ) {
      await circuitBreakerBackend.recordRetryableFailure(
        target,
        circuitBreakerPolicy,
        now()
      );
    }

    throw error;
  }
}
