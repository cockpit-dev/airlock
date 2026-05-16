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
  serviceTier?: "auto" | "default" | "flex" | "priority" | "scale";
  store?: boolean | null;
  promptCacheKey?: string;
  promptCacheRetention?: "in_memory" | "24h";
  responseTruncation?: "auto" | "disabled";
  responseTextVerbosity?: "low" | "medium" | "high";
  conversationId?: string;
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
    openai?: {
      metadata?: Record<string, string>;
      frequencyPenalty?: number;
      logprobs?: boolean;
      presencePenalty?: number;
      responsesOutputTextLogprobs?: boolean;
      responsesTopLogprobs?: number;
      seed?: number;
      topLogprobs?: number;
      chatIncludeUsage?: true;
      responsesIncludeObfuscation?: false;
    };
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
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  reasoningSummary?: "auto" | "concise" | "detailed" | (string & {});
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  tools?: CanonicalToolDefinition[];
  toolChoice?: CanonicalToolChoice;
  allowParallelToolCalls?: boolean;
}

export interface RequestClass {
  streaming: boolean;
  toolUse: boolean;
  structuredOutput: boolean;
  reasoning: boolean;
  multiTurn: boolean;
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
  requiresStreamingStructuredOutputs: boolean;
  requiresParallelToolCallControl: boolean;
  requiresOpenAIRequestMetadata: boolean;
  requiresOpenAIResponsesTextControls: boolean;
  requiresToolChoice: boolean;
  requiresStopSequences: boolean;
  requiresSamplingParameters: boolean;
  requiresAnthropicRequestMetadata: boolean;
}

export interface CanonicalUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CanonicalTokenLogprob {
  token: string;
  logprob: number;
  bytes?: number[];
  topLogprobs?: CanonicalTokenLogprob[];
}

export interface CanonicalOutputTextLogprobs {
  content?: CanonicalTokenLogprob[];
  refusal?: CanonicalTokenLogprob[];
}

export interface CanonicalResponse {
  id: string;
  model: string;
  createdAt?: number;
  outputText: string;
  finishReason: "stop" | "max_tokens" | "tool_calls" | "safety";
  metadata?: Record<string, string>;
  systemFingerprint?: string;
  serviceTier?: "auto" | "default" | "flex" | "priority" | "scale";
  promptCacheKey?: string;
  promptCacheRetention?: "in_memory" | "24h";
  responseTruncation?: "auto" | "disabled";
  responseTextVerbosity?: "low" | "medium" | "high";
  conversationId?: string;
  outputTextLogprobs?: CanonicalOutputTextLogprobs;
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
      createdAt?: number;
      parallelToolCalls?: boolean;
      metadata?: Record<string, string>;
      systemFingerprint?: string;
      serviceTier?: "auto" | "default" | "flex" | "priority" | "scale";
      promptCacheKey?: string;
      promptCacheRetention?: "in_memory" | "24h";
      responseTruncation?: "auto" | "disabled";
      responseTextVerbosity?: "low" | "medium" | "high";
      conversationId?: string;
    }
  | {
      type: "tool_call_delta";
      responseId: string;
      model: string;
      createdAt?: number;
      systemFingerprint?: string;
      toolCallId: string;
      toolIndex: number;
      toolName?: string;
      argumentsDelta: string;
    }
  | {
      type: "output_text_delta";
      responseId: string;
      model: string;
      createdAt?: number;
      systemFingerprint?: string;
      delta: string;
      outputTextLogprobs?: CanonicalOutputTextLogprobs;
    }
  | {
      type: "reasoning_summary_delta";
      responseId: string;
      model: string;
      createdAt?: number;
      systemFingerprint?: string;
      delta: string;
    }
  | {
      type: "response_completed";
      responseId: string;
      model: string;
      createdAt?: number;
      finishReason: "stop" | "max_tokens" | "tool_calls" | "safety";
      outputTextLogprobs?: CanonicalOutputTextLogprobs;
      usage?: CanonicalUsage;
      parallelToolCalls?: boolean;
      reasoningSummary?: string;
      metadata?: Record<string, string>;
      systemFingerprint?: string;
      serviceTier?: "auto" | "default" | "flex" | "priority" | "scale";
      promptCacheKey?: string;
      promptCacheRetention?: "in_memory" | "24h";
      responseTruncation?: "auto" | "disabled";
      responseTextVerbosity?: "low" | "medium" | "high";
      conversationId?: string;
    };
