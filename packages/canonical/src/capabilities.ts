import type {
  CanonicalRequest,
  CanonicalRequestCapabilityRequirements
} from "./models.js";

export function getCanonicalRequestCapabilityRequirements(
  request: CanonicalRequest
): CanonicalRequestCapabilityRequirements {
  return {
    requiresStreaming: request.stream,
    requiresTools: (request.tools?.length ?? 0) > 0,
    requiresMultimodalInput: false,
    requiresSystemMessages: request.messages.some((message) => {
      return message.role === "system";
    }),
    requiresPreviousResponseId: request.previousResponseId !== undefined,
    requiresConversationId: request.conversationId !== undefined
  };
}
