import {
  getCanonicalRequestCapabilityRequirements,
  type CanonicalRequest,
  type CanonicalResponse
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
import type { GatewayConfig } from "./config.js";

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

  if (!targetSelection || targetSelection.strategy !== "weighted") {
    return targets;
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
  getProviderDescriptor: ProviderCapabilityDescriptorResolver
): ProviderTarget[] {
  const candidates = [route.target, ...(route.fallbacks ?? [])];
  const eligibleTargets: ProviderTarget[] = [];
  let lastAuthorizationError: GatewayError | undefined;
  let lastCapabilityError: GatewayError | undefined;

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

  throw new Error("At least one provider target is required for route execution");
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
  }
): Promise<CanonicalResponse> {
  const {
    config,
    gatewayApiKey,
    requestId,
    requestShaping,
    fetcher,
    now = Date.now,
    getProviderDescriptor = getProviderCapabilityDescriptor
  } = options;
  const targets = selectEligibleTargets(
    route,
    request,
    gatewayApiKey,
    requestId,
    getProviderDescriptor
  );
  const deadline = now() + config.providerTimeoutMs;
  let lastError: unknown;

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    if (!target) {
      throw new Error("Provider target is required for route execution");
    }

    const remainingTimeoutMs = deadline - now();

    if (remainingTimeoutMs <= 0) {
      throw createProviderTimeoutError(requestId);
    }

    const attemptRequest = createAttemptRequest(request, target);
    const adapter = createProviderAdapter(
      route,
      target,
      config,
      attemptRequest,
      requestId,
      getProviderDescriptor,
      fetcher
    );

    try {
      return await adapter.complete(attemptRequest, {
        requestId,
        timeoutMs: remainingTimeoutMs,
        ...(requestShaping ? { requestShaping } : {})
      });
    } catch (error) {
      lastError = error;

      const shouldFailOver =
        error instanceof GatewayError &&
        error.category === "provider" &&
        error.retryable &&
        index < targets.length - 1;

      if (!shouldFailOver) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Provider execution failed");
}
