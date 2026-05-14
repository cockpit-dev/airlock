export interface CanonicalMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CanonicalToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface CanonicalToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface CanonicalRequest {
  model: string;
  messages: CanonicalMessage[];
  stream: boolean;
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  tools?: CanonicalToolDefinition[];
  toolChoice?: "auto";
}

export interface CanonicalRequestCapabilityRequirements {
  requiresStreaming: boolean;
  requiresTools: boolean;
  requiresMultimodalInput: boolean;
  requiresSystemMessages: boolean;
}

export interface CanonicalUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CanonicalResponse {
  id: string;
  model: string;
  outputText: string;
  finishReason: "stop" | "max_tokens";
  usage?: CanonicalUsage;
  toolCalls?: CanonicalToolCall[];
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
      finishReason: "stop" | "max_tokens";
      usage?: CanonicalUsage;
    };
