import type {
  CanonicalRequest,
  CanonicalRequestCapabilityRequirements
} from "./models.js";

export function getCanonicalRequestCapabilityRequirements(
  request: CanonicalRequest
): CanonicalRequestCapabilityRequirements {
  const requiresTools =
    (request.tools?.length ?? 0) > 0 ||
    request.messages.some((message) => {
      return (
        message.role === "tool" ||
        (message.role === "assistant" && (message.toolCalls?.length ?? 0) > 0)
      );
    });

  return {
    requiresStreaming: request.stream,
    requiresTools,
    requiresMultimodalInput: false,
    requiresSystemMessages: request.messages.some((message) => {
      return message.role === "system";
    }),
    requiresPreviousResponseId: request.previousResponseId !== undefined,
    requiresConversationId: request.conversationId !== undefined,
    requiresPrompt: request.prompt !== undefined,
    requiresReasoning:
      request.reasoningEffort !== undefined ||
      request.reasoningSummary !== undefined,
    requiresStructuredOutputs:
      request.outputFormat !== undefined &&
      request.outputFormat.type !== "text",
    requiresParallelToolCallControl:
      request.allowParallelToolCalls !== undefined &&
      request.allowParallelToolCalls === false
  };
}
