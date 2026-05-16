import type {
  CanonicalRequest,
  CanonicalRequestCapabilityRequirements,
  RequestClass
} from "./models.js";

export function deriveRequestClass(request: CanonicalRequest): RequestClass {
  const hasToolReplay = request.messages.some((message) => {
    return (
      message.role === "tool" ||
      (message.role === "assistant" && (message.toolCalls?.length ?? 0) > 0)
    );
  });

  return {
    streaming: request.stream,
    toolUse: (request.tools?.length ?? 0) > 0 || hasToolReplay,
    structuredOutput:
      request.outputFormat !== undefined &&
      request.outputFormat.type !== "text",
    reasoning:
      request.reasoningEffort !== undefined ||
      request.reasoningSummary !== undefined,
    multiTurn: request.messages.length > 2
  };
}

export function getCanonicalRequestCapabilityRequirements(
  request: CanonicalRequest
): CanonicalRequestCapabilityRequirements {
  const requiresToolReplay = request.messages.some((message) => {
    return (
      message.role === "tool" ||
      (message.role === "assistant" && (message.toolCalls?.length ?? 0) > 0)
    );
  });
  const requiresTools = (request.tools?.length ?? 0) > 0 || requiresToolReplay;
  const requiresStreamingTools = request.stream && requiresTools;

  return {
    requiresStreaming: request.stream,
    requiresTools,
    requiresToolReplay,
    requiresStreamingTools,
    requiresMultimodalInput: false,
    requiresSystemMessages: request.messages.some((message) => {
      return message.role === "system";
    }),
    requiresEndUserId: request.endUserId !== undefined,
    requiresPreviousResponseId: request.previousResponseId !== undefined,
    requiresConversationId: request.conversationId !== undefined,
    requiresPrompt: request.prompt !== undefined,
    requiresReasoning:
      request.reasoningEffort !== undefined ||
      request.reasoningSummary !== undefined,
    requiresStructuredOutputs:
      request.outputFormat !== undefined &&
      request.outputFormat.type !== "text",
    requiresStreamingStructuredOutputs:
      request.stream &&
      request.outputFormat !== undefined &&
      request.outputFormat.type !== "text",
    requiresParallelToolCallControl:
      request.allowParallelToolCalls !== undefined,
    requiresOpenAIRequestMetadata:
      request.serviceTier !== undefined ||
      request.store !== undefined ||
      request.promptCacheKey !== undefined ||
      request.promptCacheRetention !== undefined ||
      request.providerMetadata?.openai?.metadata !== undefined ||
      request.providerMetadata?.openai?.frequencyPenalty !== undefined ||
      request.providerMetadata?.openai?.logprobs === true ||
      request.providerMetadata?.openai?.presencePenalty !== undefined ||
      request.providerMetadata?.openai?.responsesOutputTextLogprobs === true ||
      request.providerMetadata?.openai?.responsesTopLogprobs !== undefined ||
      request.providerMetadata?.openai?.seed !== undefined ||
      request.providerMetadata?.openai?.topLogprobs !== undefined ||
      request.providerMetadata?.openai?.responsesIncludeObfuscation === false,
    requiresOpenAIResponsesTextControls:
      request.responseTruncation !== undefined ||
      request.responseTextVerbosity !== undefined,
    requiresToolChoice: request.toolChoice !== undefined,
    requiresStopSequences: (request.stopSequences?.length ?? 0) > 0,
    requiresSamplingParameters:
      request.temperature !== undefined || request.topP !== undefined,
    requiresAnthropicRequestMetadata:
      request.providerMetadata?.anthropic !== undefined
  };
}
