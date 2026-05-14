import type {
  CanonicalRequest,
  CanonicalRequestCapabilityRequirements
} from "./models.js";

export function getCanonicalRequestCapabilityRequirements(
  request: CanonicalRequest
): CanonicalRequestCapabilityRequirements {
  return {
    requiresStreaming: false,
    requiresTools: (request.tools?.length ?? 0) > 0,
    requiresMultimodalInput: false,
    requiresSystemMessages: request.messages.some((message) => {
      return message.role === "system";
    })
  };
}
