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
  | "required"
  | "none"
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
      reasoningSummary?: string;
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
  endUserId?: string;
  outputFormat?:
    | {
        type: "text";
      }
    | {
        type: "json_object";
      }
    | {
        type: "json_schema";
        name: string;
        schema: Record<string, unknown>;
        strict?: boolean;
      };
  providerMetadata?: {
    anthropic?: {
      user_id: string;
    };
  };
  prompt?: {
    id: string;
    version?: string;
    variables?: Record<string, string | number | boolean>;
  };
  previousResponseId?: string;
  conversationId?: string;
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  reasoningSummary?:
    | "auto"
    | "concise"
    | "detailed"
    | (string & {});
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  tools?: CanonicalToolDefinition[];
  toolChoice?: CanonicalToolChoice;
  allowParallelToolCalls?: boolean;
}

export interface CanonicalRequestCapabilityRequirements {
  requiresStreaming: boolean;
  requiresTools: boolean;
  requiresToolReplay: boolean;
  requiresStreamingTools: boolean;
  requiresMultimodalInput: boolean;
  requiresSystemMessages: boolean;
  requiresEndUserId: boolean;
  requiresPreviousResponseId: boolean;
  requiresConversationId: boolean;
  requiresPrompt: boolean;
  requiresReasoning: boolean;
  requiresStructuredOutputs: boolean;
  requiresParallelToolCallControl: boolean;
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
  parallelToolCalls?: boolean;
  reasoningSummary?: string;
}

export type CanonicalStreamEvent =
  | {
      type: "response_started";
      responseId: string;
      model: string;
      parallelToolCalls?: boolean;
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
      type: "reasoning_summary_delta";
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
      parallelToolCalls?: boolean;
      reasoningSummary?: string;
    };
