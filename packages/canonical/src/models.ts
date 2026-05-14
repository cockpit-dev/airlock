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

export type CanonicalToolChoice =
  | "auto"
  | {
      type: "tool";
      name: string;
    };

export type CanonicalMessage =
  | {
      role: "system" | "user";
      content: string;
    }
  | {
      role: "assistant";
      content: string;
      toolCalls?: CanonicalToolCall[];
    }
  | {
      role: "tool";
      content: string;
      toolCallId: string;
    };

export interface CanonicalRequest {
  model: string;
  messages: CanonicalMessage[];
  stream: boolean;
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  tools?: CanonicalToolDefinition[];
  toolChoice?: CanonicalToolChoice;
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
  finishReason: "stop" | "max_tokens" | "tool_calls";
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
      type: "tool_call_delta";
      responseId: string;
      model: string;
      toolCallId: string;
      toolIndex: number;
      toolName?: string;
      argumentsDelta: string;
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
      finishReason: "stop" | "max_tokens" | "tool_calls";
      usage?: CanonicalUsage;
    };
