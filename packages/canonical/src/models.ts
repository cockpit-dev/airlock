export interface CanonicalMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CanonicalRequest {
  model: string;
  messages: CanonicalMessage[];
  stream: false;
}

export interface CanonicalRequestCapabilityRequirements {
  requiresStreaming: boolean;
  requiresTools: boolean;
  requiresMultimodalInput: boolean;
  requiresSystemMessages: boolean;
}

export interface CanonicalResponse {
  id: string;
  model: string;
  outputText: string;
  finishReason: "stop";
}
