export interface CanonicalMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CanonicalRequest {
  model: string;
  messages: CanonicalMessage[];
  stream: boolean;
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

export type CanonicalStreamEvent =
  | {
      type: "response_started";
      responseId: string;
      model: string;
    }
  | {
      type: "output_text_delta";
      responseId: string;
      model: string;
      delta: string;
    }
  | {
      type: "response_completed";
      responseId: string;
      model: string;
      finishReason: "stop";
    };
