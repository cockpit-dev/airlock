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
    supportsEndUserId: true,
    supportsPreviousResponseId: true,
    supportsConversationId: true,
    supportsPrompt: true,
    supportsReasoning: true,
    supportsStructuredOutputs: true,
    supportsStreamingStructuredOutputs: true,
    supportsParallelToolCallControl: true,
    supportsOpenAIRequestMetadata: true,
    supportsOpenAIResponsesTextControls: true,
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
    supportsEndUserId: true,
    supportsPreviousResponseId: false,
    supportsConversationId: false,
    supportsPrompt: false,
    supportsReasoning: false,
    supportsStructuredOutputs: false,
    supportsStreamingStructuredOutputs: false,
    supportsParallelToolCallControl: false,
    supportsOpenAIRequestMetadata: false,
    supportsOpenAIResponsesTextControls: false,
    supportsRouteScopedShaping: true,
    supportsStaticFallbackSameProvider: true
  },
  {
    provider: "gemini",
    displayName: "Gemini",
    supportsStreaming: true,
    supportsTools: true,
    supportsToolReplay: true,
    supportsStreamingTools: true,
    supportsMultimodalInput: false,
    supportsSystemMessages: true,
    supportsEndUserId: false,
    supportsPreviousResponseId: false,
    supportsConversationId: false,
    supportsPrompt: false,
    supportsReasoning: false,
    supportsStructuredOutputs: true,
    supportsStreamingStructuredOutputs: true,
    supportsParallelToolCallControl: false,
    supportsOpenAIRequestMetadata: false,
    supportsOpenAIResponsesTextControls: false,
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
