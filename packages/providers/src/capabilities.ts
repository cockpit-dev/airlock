import { GatewayError } from "@airlock/shared";

import type { ProviderId } from "@airlock/shared";

import type { ProviderCapabilityDescriptor } from "./types.js";

const PROVIDER_CAPABILITY_DESCRIPTORS: ProviderCapabilityDescriptor[] = [
  {
    provider: "openai",
    displayName: "OpenAI",
    supportsStreaming: true,
    supportsTools: true,
    supportsToolReplay: true,
    supportsStreamingTools: true,
    supportsMultimodalInput: false,
    supportsSystemMessages: true,
    supportsPreviousResponseId: true,
    supportsConversationId: true,
    supportsPrompt: true,
    supportsReasoning: true,
    supportsStructuredOutputs: true,
    supportsParallelToolCallControl: true,
    supportsRouteScopedShaping: true,
    supportsStaticFallbackSameProvider: true
  },
  {
    provider: "anthropic",
    displayName: "Anthropic",
    supportsStreaming: true,
    supportsTools: true,
    supportsToolReplay: true,
    supportsStreamingTools: true,
    supportsMultimodalInput: false,
    supportsSystemMessages: true,
    supportsPreviousResponseId: false,
    supportsConversationId: false,
    supportsPrompt: false,
    supportsReasoning: false,
    supportsStructuredOutputs: false,
    supportsParallelToolCallControl: false,
    supportsRouteScopedShaping: true,
    supportsStaticFallbackSameProvider: true
  },
  {
    provider: "gemini",
    displayName: "Gemini",
    supportsStreaming: true,
    supportsTools: true,
    supportsToolReplay: false,
    supportsStreamingTools: false,
    supportsMultimodalInput: false,
    supportsSystemMessages: true,
    supportsPreviousResponseId: false,
    supportsConversationId: false,
    supportsPrompt: false,
    supportsReasoning: false,
    supportsStructuredOutputs: false,
    supportsParallelToolCallControl: false,
    supportsRouteScopedShaping: true,
    supportsStaticFallbackSameProvider: true
  }
];

function createUnsupportedProviderError(provider: string): GatewayError {
  return new GatewayError(`Unsupported provider: ${provider}`, {
    code: "provider_not_supported",
    category: "configuration",
    httpStatus: 500,
    retryable: false
  });
}

export function listProviderCapabilityDescriptors(): ProviderCapabilityDescriptor[] {
  return [...PROVIDER_CAPABILITY_DESCRIPTORS];
}

export function getProviderCapabilityDescriptor(
  provider: ProviderId
): ProviderCapabilityDescriptor {
  const descriptor = PROVIDER_CAPABILITY_DESCRIPTORS.find((candidate) => {
    return candidate.provider === provider;
  });

  if (!descriptor) {
    throw createUnsupportedProviderError(provider);
  }

  return descriptor;
}
