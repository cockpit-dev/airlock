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
import type { ModelRoute, ProviderTarget } from "@airlock/routing";
import { GatewayError } from "@airlock/shared";

import { assertGatewayKeyAllowsProvider } from "./auth.js";
import type { GatewayConfig } from "./config.js";

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
  fetcher?: typeof fetch
): ProviderAdapter {
  const descriptor = getProviderCapabilityDescriptor(target.provider);
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
  return {
    ...request,
    model: target.providerModel
  };
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
  }
): Promise<CanonicalResponse> {
  const {
    config,
    gatewayApiKey,
    requestId,
    requestShaping,
    fetcher,
    now = Date.now
  } = options;
  const targets = [route.target, ...(route.fallbacks ?? [])];
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

    assertGatewayKeyAllowsProvider(gatewayApiKey, target.provider, requestId);

    const attemptRequest = createAttemptRequest(request, target);
    const adapter = createProviderAdapter(
      route,
      target,
      config,
      attemptRequest,
      requestId,
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
