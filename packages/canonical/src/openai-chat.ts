import type {
  AnthropicMessagesRequest,
  GeminiGenerateContentRequest,
  OpenAIChatCompletionRequest,
  OpenAIResponsesRequest
} from "@airlock/protocols";

import type {
  CanonicalToolCall,
  CanonicalRequest,
  CanonicalResponse,
  CanonicalStreamEvent
} from "./models.js";

type CanonicalUsageValue = CanonicalResponse["usage"];

function extractPassthrough(
  request: Record<string, unknown>,
  knownFields: ReadonlySet<string>
): Record<string, unknown> | undefined {
  const entries = Object.entries(request).filter(
    ([key]) => !knownFields.has(key)
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

type OpenAIResponsesTextInputBlockValue = {
  type: "input_text";
  text: string;
};
type OpenAIResponsesTextOutputBlockValue = {
  type: "output_text";
  text: string;
};
type OpenAIResponsesMessageItemTypedValue = {
  type: "message";
  role: "user" | "assistant" | "system" | "developer";
  content:
    | string
    | OpenAIResponsesTextInputBlockValue[]
    | OpenAIResponsesTextOutputBlockValue[];
};
type OpenAIResponsesFunctionCallItemValue = {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
};
type OpenAIResponsesFunctionCallOutputItemValue = {
  type: "function_call_output";
  call_id: string;
  output: string;
};
type OpenAIResponsesReasoningItemValue = {
  type: "reasoning";
  id?: string;
  encrypted_content?: string;
  summary?: Array<{
    type: "summary_text";
    text: string;
  }>;
};
type OpenAIResponsesOpaqueTypedInputItemValue = {
  type:
    | "local_shell_call"
    | "tool_search_call"
    | "custom_tool_call"
    | "custom_tool_call_output"
    | "tool_search_output";
  [key: string]: unknown;
};
type OpenAIResponsesTypedInputItemValue =
  | OpenAIResponsesTextInputBlockValue
  | OpenAIResponsesMessageItemTypedValue
  | OpenAIResponsesFunctionCallItemValue
  | OpenAIResponsesFunctionCallOutputItemValue
  | OpenAIResponsesReasoningItemValue
  | OpenAIResponsesOpaqueTypedInputItemValue;

interface OpenAIResponsesEventEncodingState {
  sequenceNumber: number;
  outputIndex: number;
  contentIndex: number;
  outputText?: string;
  reasoningSummary?: string;
  reasoningRawContent?: string;
  startedTextOutput?: boolean;
  startedReasoningOutput?: boolean;
  startedToolCallIds?: string[];
  toolCallId?: string;
  toolCallName?: string;
  toolCallArguments?: string;
  toolCalls?: Array<{
    toolCallId: string;
    toolCallName?: string;
    toolCallArguments: string;
    outputIndex: number;
    toolType?: "function_call" | "custom_tool_call";
  }>;
  toolCallType?: "function_call" | "custom_tool_call";
}

interface AnthropicMessagesStreamEncodingState {
  startedTextBlock: boolean;
  startedToolBlocks: number[];
  pendingToolStops: number[];
  thinkingBlockIndexes?: number[];
}

interface GeminiGenerateContentStreamEncodingState {
  toolCalls: Map<
    string,
    {
      name?: string;
      arguments: string;
    }
  >;
}

interface OpenAIResponsesEncodedEventBatch {
  events: unknown[];
  nextSequenceNumber: number;
}

type OpenAIResponsesEnvelopeStreamEvent = Extract<
  CanonicalStreamEvent,
  { type: "response_started" | "response_completed" }
>;

function parseToolCallArguments(argumentsStr: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(argumentsStr);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function encodeCanonicalOpenAIFinishReason(
  finishReason: CanonicalResponse["finishReason"]
) {
  if (finishReason === "tool_calls") {
    return "tool_calls";
  }

  return finishReason === "max_tokens" ? "length" : "stop";
}

function encodeCanonicalResponsesStatus(
  finishReason: CanonicalResponse["finishReason"]
) {
  return finishReason === "max_tokens" ? "incomplete" : "completed";
}

function encodeCanonicalResponsesIncompleteDetails(
  finishReason: CanonicalResponse["finishReason"]
) {
  if (finishReason !== "max_tokens") {
    return undefined;
  }

  return {
    reason: "max_output_tokens" as const
  };
}

function encodeCanonicalAnthropicStopReason(
  finishReason: CanonicalResponse["finishReason"]
) {
  if (finishReason === "tool_calls") {
    return "tool_use";
  }

  return finishReason === "max_tokens" ? "max_tokens" : "end_turn";
}

function encodeCanonicalGeminiFinishReason(
  finishReason: CanonicalResponse["finishReason"]
) {
  if (finishReason === "max_tokens") return "MAX_TOKENS";
  if (finishReason === "safety") return "SAFETY";
  return "STOP";
}

function encodeCanonicalUsage(usage: CanonicalUsageValue) {
  if (!usage) {
    return undefined;
  }

  return {
    prompt_tokens: usage.inputTokens,
    completion_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens
  };
}

function encodeCanonicalResponsesUsage(usage: CanonicalUsageValue) {
  if (!usage) {
    return undefined;
  }

  return {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens
  };
}

function encodeCanonicalAnthropicUsage(usage: CanonicalUsageValue) {
  if (!usage) {
    return undefined;
  }

  return {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens
  };
}

function encodeCanonicalGeminiUsage(usage: CanonicalUsageValue) {
  if (!usage) {
    return undefined;
  }

  return {
    promptTokenCount: usage.inputTokens,
    candidatesTokenCount: usage.outputTokens,
    totalTokenCount: usage.totalTokens
  };
}

type CanonicalOutputTextLogprobEntry = NonNullable<
  NonNullable<CanonicalResponse["outputTextLogprobs"]>["content"]
>[number];

function encodeCanonicalOpenAIOutputTextLogprobs(
  logprobs: CanonicalResponse["outputTextLogprobs"]
) {
  if (logprobs === undefined) {
    return undefined;
  }

  const encodeEntries = (
    entries: CanonicalOutputTextLogprobEntry[] | undefined
  ) => {
    if (!entries || entries.length === 0) {
      return undefined;
    }

    return entries.map((entry) => ({
      token: entry.token,
      logprob: entry.logprob,
      ...(entry.bytes !== undefined ? { bytes: entry.bytes } : {}),
      ...(entry.topLogprobs !== undefined
        ? {
            top_logprobs: entry.topLogprobs.map((candidate) => ({
              token: candidate.token,
              logprob: candidate.logprob,
              ...(candidate.bytes !== undefined
                ? { bytes: candidate.bytes }
                : {})
            }))
          }
        : {})
    }));
  };

  const content = encodeEntries(logprobs.content);
  const refusal = encodeEntries(logprobs.refusal);

  if (content === undefined && refusal === undefined) {
    return undefined;
  }

  return {
    ...(content !== undefined ? { content } : {}),
    ...(refusal !== undefined ? { refusal } : {})
  };
}

function encodeCanonicalOpenAIOutputTextLogprobsContent(
  logprobs: CanonicalResponse["outputTextLogprobs"]
) {
  return encodeCanonicalOpenAIOutputTextLogprobs(logprobs)?.content;
}

function createOpenAIResponsesOutputTextPart(
  text: string,
  logprobs?: CanonicalResponse["outputTextLogprobs"]
) {
  return {
    type: "output_text" as const,
    text,
    annotations: [],
    ...(encodeCanonicalOpenAIOutputTextLogprobs(logprobs)
      ? { logprobs: encodeCanonicalOpenAIOutputTextLogprobs(logprobs) }
      : {})
  };
}

function createOpenAIResponsesOutputMessage(
  responseId: string,
  text: string,
  status: "in_progress" | "completed",
  includeContent: boolean,
  outputTextLogprobs?: CanonicalResponse["outputTextLogprobs"]
) {
  return {
    id: `${responseId}_output_0`,
    type: "message" as const,
    role: "assistant" as const,
    status,
    content: includeContent
      ? [createOpenAIResponsesOutputTextPart(text, outputTextLogprobs)]
      : []
  };
}

function createOpenAIResponsesFunctionCallItem(
  responseId: string,
  toolCallId?: string,
  toolCallName?: string,
  argumentsValue?: string
) {
  return {
    type: "function_call" as const,
    call_id: toolCallId ?? `${responseId}_tool_call_0`,
    name: toolCallName ?? "tool_call",
    arguments: argumentsValue ?? "{}",
    status: "completed" as const
  };
}

function createOpenAIResponsesCustomToolCallItem(
  responseId: string,
  toolCallId?: string,
  toolCallName?: string,
  inputValue?: string
) {
  return {
    type: "custom_tool_call" as const,
    call_id: toolCallId ?? `${responseId}_tool_call_0`,
    name: toolCallName ?? "custom_tool_call",
    input: inputValue ?? "",
    status: "completed" as const
  };
}

function createOpenAIResponsesReasoningItem(summaryText?: string) {
  return {
    type: "reasoning" as const,
    summary:
      summaryText && summaryText.length > 0
        ? [
            {
              type: "summary_text" as const,
              text: summaryText
            }
          ]
        : []
  };
}

function createOpenAIResponsesBaseResponse(
  responseId: string,
  model: string,
  status: "in_progress" | "completed",
  createdAt = 0,
  parallelToolCalls?: boolean
) {
  return {
    id: responseId,
    object: "response" as const,
    created_at: createdAt,
    model,
    status,
    output: [],
    ...(parallelToolCalls !== undefined
      ? { parallel_tool_calls: parallelToolCalls }
      : {}),
    tools: []
  };
}

function addOpenAIResponsesEnvelopeFields(
  response: ReturnType<typeof createOpenAIResponsesBaseResponse>,
  event: OpenAIResponsesEnvelopeStreamEvent
) {
  return {
    ...response,
    ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
    ...(event.serviceTier !== undefined
      ? { service_tier: event.serviceTier }
      : {}),
    ...(event.promptCacheKey !== undefined
      ? { prompt_cache_key: event.promptCacheKey }
      : {}),
    ...(event.promptCacheRetention !== undefined
      ? { prompt_cache_retention: event.promptCacheRetention }
      : {}),
    ...(event.responseTruncation !== undefined
      ? { truncation: event.responseTruncation }
      : {}),
    ...(event.responseTextVerbosity !== undefined
      ? {
          text: {
            verbosity: event.responseTextVerbosity
          }
        }
      : {}),
    ...(event.conversationId !== undefined
      ? {
          conversation: {
            id: event.conversationId
          }
        }
      : {})
  };
}

function isOpenAIResponsesTypedInputItems(
  input: OpenAIResponsesRequest["input"]
): input is OpenAIResponsesTypedInputItemValue[] {
  return (
    Array.isArray(input) &&
    input.length > 0 &&
    input[0] !== undefined &&
    "type" in input[0] &&
    (input[0].type === "message" ||
      input[0].type === "input_text" ||
      input[0].type === "function_call" ||
      input[0].type === "function_call_output" ||
      input[0].type === "reasoning" ||
      input[0].type === "local_shell_call" ||
      input[0].type === "tool_search_call" ||
      input[0].type === "custom_tool_call" ||
      input[0].type === "custom_tool_call_output" ||
      input[0].type === "tool_search_output")
  );
}

function encodeOpenAIResponsesMessageContent(
  content:
    | string
    | Array<{ type: string; text?: string }>
): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .flatMap((block) => (typeof block.text === "string" ? [block.text] : []))
    .join("\n");
}

function hasOpenAIResponsesOpaqueMessageContent(
  content:
    | string
    | Array<{
        type: string;
        text?: string;
      }>
) {
  return (
    Array.isArray(content) &&
    content.some((block) => block.type !== "input_text" && block.type !== "output_text")
  );
}

function shouldPreserveNativeOpenAIResponsesInput(
  input: OpenAIResponsesRequest["input"]
) {
  if (input === undefined || typeof input === "string") {
    return false;
  }

  if (!isOpenAIResponsesTypedInputItems(input)) {
    return input.some((message) =>
      hasOpenAIResponsesOpaqueMessageContent(
        message.content as string | Array<{ type: string; text?: string }>
      )
    );
  }

  return input.some((item) => {
    if (item.type === "message") {
      return hasOpenAIResponsesOpaqueMessageContent(
        item.content as string | Array<{ type: string; text?: string }>
      );
    }

    return (
      item.type === "local_shell_call" ||
      item.type === "tool_search_call" ||
      item.type === "custom_tool_call" ||
      item.type === "custom_tool_call_output" ||
      item.type === "tool_search_output"
    );
  });
}

function shouldPreserveNativeOpenAIResponsesTools(
  tools: OpenAIResponsesRequest["tools"]
) {
  return (
    tools !== undefined &&
    tools.some((tool) => {
      return tool.type !== "function";
    })
  );
}

function shouldPreserveNativeAnthropicMessages(
  request: AnthropicMessagesRequest
) {
  const containsOpaqueBlock = request.messages.some((message) => {
    if (!Array.isArray(message.content)) {
      return false;
    }

    return message.content.some((block) => {
      return (
        block.type !== "text" &&
        block.type !== "tool_use" &&
        block.type !== "tool_result"
      );
    });
  });

  return containsOpaqueBlock;
}

function normalizeOpenAIToolChoice(
  toolChoice:
    | OpenAIChatCompletionRequest["tool_choice"]
    | OpenAIResponsesRequest["tool_choice"]
) {
  if (toolChoice === undefined) {
    return undefined;
  }

  if (toolChoice === "auto") {
    return "auto" as const;
  }

  if (toolChoice === "required") {
    return "required" as const;
  }

  if (toolChoice === "none") {
    return "none" as const;
  }

  if ("function" in toolChoice) {
    return {
      type: "tool" as const,
      name: toolChoice.function.name
    };
  }

  return {
    type: "tool" as const,
    name: toolChoice.name
  };
}

function normalizeOpenAIChatResponseFormat(
  responseFormat: OpenAIChatCompletionRequest["response_format"]
) {
  if (responseFormat === undefined) {
    return undefined;
  }

  if (responseFormat.type === "text") {
    return {
      type: "text" as const
    };
  }

  if (responseFormat.type === "json_object") {
    return {
      type: "json_object" as const
    };
  }

  return {
    type: "json_schema" as const,
    name: responseFormat.json_schema.name,
    schema: responseFormat.json_schema.schema,
    ...(responseFormat.json_schema.strict !== undefined
      ? { strict: responseFormat.json_schema.strict }
      : {})
  };
}

function normalizeOpenAIResponsesTextFormat(
  text: OpenAIResponsesRequest["text"]
) {
  if (text === undefined || text.format === undefined) {
    return undefined;
  }

  if (text.format.type === "text") {
    return {
      type: "text" as const
    };
  }

  if (text.format.type === "json_object") {
    return {
      type: "json_object" as const
    };
  }

  return {
    type: "json_schema" as const,
    name: text.format.name,
    schema: text.format.schema,
    ...(text.format.strict !== undefined ? { strict: text.format.strict } : {})
  };
}

function normalizeOpenAIResponsesConversation(
  conversation: OpenAIResponsesRequest["conversation"]
) {
  if (conversation === undefined) {
    return undefined;
  }

  return typeof conversation === "string" ? conversation : conversation.id;
}

function normalizeOpenAIResponsesReasoning(
  reasoning: OpenAIResponsesRequest["reasoning"]
) {
  if (reasoning === undefined || reasoning === null) {
    return {};
  }

  if (
    reasoning.summary !== undefined &&
    reasoning.generate_summary !== undefined &&
    reasoning.summary !== reasoning.generate_summary
  ) {
    throw new Error("reasoning.summary must match reasoning.generate_summary");
  }

  return {
    ...(reasoning.effort !== undefined
      ? { reasoningEffort: reasoning.effort }
      : {}),
    ...(typeof reasoning.summary === "string"
      ? { reasoningSummary: reasoning.summary }
      : typeof reasoning.generate_summary === "string"
        ? { reasoningSummary: reasoning.generate_summary }
        : {})
  };
}

function normalizeOpenAIResponsesTypedInputItems(
  input: OpenAIResponsesTypedInputItemValue[]
) {
  const messages: CanonicalRequest["messages"] = [];
  let pendingUserTextItems: string[] = [];

  const flushPendingUserTextItems = () => {
    if (pendingUserTextItems.length === 0) {
      return;
    }

    messages.push({
      role: "user",
      content: pendingUserTextItems.join("\n")
    });
    pendingUserTextItems = [];
  };

  for (const item of input) {
    if (item.type === "input_text") {
      pendingUserTextItems.push(item.text);
      continue;
    }

    if (item.type === "reasoning") {
      flushPendingUserTextItems();
      const reasoningSummary =
        item.summary?.map((summaryItem) => summaryItem.text).join("\n") ?? "";
      messages.push({
        role: "assistant",
        content: reasoningSummary,
        ...(reasoningSummary.length > 0 ? { reasoningSummary } : {})
      });
      continue;
    }

    if (item.type === "function_call") {
      flushPendingUserTextItems();
      messages.push({
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: item.call_id,
            name: item.name,
            arguments: item.arguments
          }
        ]
      });
      continue;
    }

    if (item.type === "function_call_output") {
      flushPendingUserTextItems();
      messages.push({
        role: "tool",
        content: item.output,
        toolCallId: item.call_id
      });
      continue;
    }

    if (
      item.type === "local_shell_call" ||
      item.type === "tool_search_call" ||
      item.type === "custom_tool_call" ||
      item.type === "custom_tool_call_output" ||
      item.type === "tool_search_output"
    ) {
      flushPendingUserTextItems();
      continue;
    }

    flushPendingUserTextItems();
    messages.push({
      role: item.role === "developer" ? "system" : item.role,
      content: encodeOpenAIResponsesMessageContent(item.content)
    });
  }

  flushPendingUserTextItems();

  return messages;
}

const OPENAI_CHAT_KNOWN_FIELDS = new Set([
  "model",
  "stream",
  "user",
  "safety_identifier",
  "metadata",
  "service_tier",
  "store",
  "prompt_cache_key",
  "prompt_cache_retention",
  "max_tokens",
  "max_completion_tokens",
  "reasoning_effort",
  "temperature",
  "top_p",
  "logprobs",
  "top_logprobs",
  "frequency_penalty",
  "presence_penalty",
  "seed",
  "response_format",
  "modalities",
  "stop",
  "stream_options",
  "parallel_tool_calls",
  "tools",
  "tool_choice",
  "messages",
  "airlock"
]);

export function normalizeOpenAIChatRequest(
  request: OpenAIChatCompletionRequest
): CanonicalRequest {
  const passthrough = extractPassthrough(request, OPENAI_CHAT_KNOWN_FIELDS);
  const endUserId = request.safety_identifier ?? request.user;
  const maxOutputTokens = request.max_completion_tokens ?? request.max_tokens;
  const stopSequences =
    request.stop === undefined
      ? undefined
      : typeof request.stop === "string"
        ? [request.stop]
        : request.stop;
  const toolChoice = normalizeOpenAIToolChoice(request.tool_choice);
  const outputFormat = normalizeOpenAIChatResponseFormat(
    request.response_format
  );

  return {
    model: request.model,
    stream: request.stream,
    ...(endUserId !== undefined ? { endUserId } : {}),
    ...(request.frequency_penalty !== undefined ||
    request.logprobs === true ||
    request.metadata !== undefined ||
    request.presence_penalty !== undefined ||
    request.seed !== undefined ||
    request.top_logprobs !== undefined ||
    request.stream_options?.include_usage === true
      ? {
          providerMetadata: {
            openai: {
              ...(request.logprobs === true ? { logprobs: true } : {}),
              ...(request.metadata !== undefined
                ? { metadata: request.metadata }
                : {}),
              ...(request.frequency_penalty !== undefined
                ? { frequencyPenalty: request.frequency_penalty }
                : {}),
              ...(request.presence_penalty !== undefined
                ? { presencePenalty: request.presence_penalty }
                : {}),
              ...(request.seed !== undefined ? { seed: request.seed } : {}),
              ...(request.top_logprobs !== undefined
                ? { topLogprobs: request.top_logprobs }
                : {}),
              ...(request.stream_options?.include_usage === true
                ? { chatIncludeUsage: true }
                : {})
            }
          }
        }
      : {}),
    ...(request.service_tier !== undefined
      ? { serviceTier: request.service_tier }
      : {}),
    ...(request.store !== undefined ? { store: request.store } : {}),
    ...(request.prompt_cache_key !== undefined
      ? { promptCacheKey: request.prompt_cache_key }
      : {}),
    ...(request.prompt_cache_retention !== undefined
      ? { promptCacheRetention: request.prompt_cache_retention }
      : {}),
    ...(outputFormat ? { outputFormat } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(request.reasoning_effort !== undefined
      ? { reasoningEffort: request.reasoning_effort }
      : {}),
    ...(request.temperature !== undefined
      ? { temperature: request.temperature }
      : {}),
    ...(request.top_p !== undefined ? { topP: request.top_p } : {}),
    ...(stopSequences !== undefined ? { stopSequences } : {}),
    ...(request.tools !== undefined
      ? {
          tools: request.tools.map((tool) => ({
            name: tool.function.name,
            ...(tool.function.description
              ? { description: tool.function.description }
              : {}),
            inputSchema: tool.function.parameters
          }))
        }
      : {}),
    ...(toolChoice !== undefined ? { toolChoice } : {}),
    ...(request.parallel_tool_calls !== undefined
      ? { allowParallelToolCalls: request.parallel_tool_calls }
      : {}),
    messages: request.messages.map((message) => {
      if (message.role === "tool") {
        return {
          role: "tool" as const,
          content: message.content,
          toolCallId: message.tool_call_id
        };
      }

      const content =
        typeof message.content === "string"
          ? message.content
          : message.content.map((part) => part.text).join("\n");

      if ("tool_calls" in message && message.tool_calls) {
        return {
          role: "assistant" as const,
          content,
          toolCalls: message.tool_calls.map((toolCall) => ({
            id: toolCall.id,
            name: toolCall.function.name,
            arguments: toolCall.function.arguments
          }))
        };
      }

      return {
        role: message.role === "developer" ? "system" : message.role,
        content
      };
    }),
    ...(passthrough ? { passthrough } : {})
  };
}

const OPENAI_RESPONSES_KNOWN_FIELDS = new Set([
  "model",
  "stream",
  "user",
  "safety_identifier",
  "metadata",
  "service_tier",
  "store",
  "prompt_cache_key",
  "prompt_cache_retention",
  "max_output_tokens",
  "temperature",
  "top_p",
  "top_logprobs",
  "stop",
  "truncation",
  "reasoning",
  "text",
  "instructions",
  "input",
  "tools",
  "tool_choice",
  "parallel_tool_calls",
  "previous_response_id",
  "conversation",
  "include",
  "stream_options",
  "prompt",
  "prompt_id",
  "airlock"
]);

export function normalizeOpenAIResponsesRequest(
  request: OpenAIResponsesRequest
): CanonicalRequest {
  const passthrough = extractPassthrough(
    request,
    OPENAI_RESPONSES_KNOWN_FIELDS
  );
  const inputMessages =
    request.input === undefined
      ? []
      : typeof request.input === "string"
        ? [{ role: "user" as const, content: request.input }]
        : isOpenAIResponsesTypedInputItems(request.input)
          ? normalizeOpenAIResponsesTypedInputItems(request.input)
          : (
              request.input as Array<{
                role: "user" | "assistant" | "system" | "developer";
                content: string | OpenAIResponsesTextInputBlockValue[];
              }>
            ).map((message) => {
              return {
                role:
                  message.role === "developer"
                    ? ("system" as const)
                    : message.role,
                content: encodeOpenAIResponsesMessageContent(message.content)
              };
            });
  const instructionMessages = request.instructions
    ? [{ role: "system" as const, content: request.instructions }]
    : [];
  const toolChoice = normalizeOpenAIToolChoice(request.tool_choice);
  const outputFormat = normalizeOpenAIResponsesTextFormat(request.text);
  const conversationId = normalizeOpenAIResponsesConversation(
    request.conversation
  );
  const nativeOpenAIResponsesRequest =
    shouldPreserveNativeOpenAIResponsesInput(request.input) ||
    shouldPreserveNativeOpenAIResponsesTools(request.tools) ||
    request.include?.includes("reasoning.encrypted_content")
      ? {
          ...(request.instructions !== undefined
            ? { instructions: request.instructions }
            : {}),
          ...(shouldPreserveNativeOpenAIResponsesInput(request.input) &&
          request.input !== undefined
            ? { input: request.input }
            : {}),
          ...(shouldPreserveNativeOpenAIResponsesTools(request.tools) &&
          request.tools !== undefined
            ? { tools: request.tools }
            : {}),
          ...(request.include?.includes("reasoning.encrypted_content")
            ? { include: request.include }
            : {}),
        }
      : undefined;

  return {
    model: request.model,
    stream: request.stream,
    ...(nativeOpenAIResponsesRequest !== undefined
      ? {
          nativeRequest: {
            openaiResponses: nativeOpenAIResponsesRequest
          }
        }
      : {}),
    ...(request.safety_identifier !== undefined
      ? { endUserId: request.safety_identifier }
      : {}),
    ...(request.metadata !== undefined ||
    request.stream_options?.include_obfuscation === false ||
    request.include?.includes("message.output_text.logprobs") ||
    request.top_logprobs !== undefined
      ? {
          providerMetadata: {
            openai: {
              ...(request.metadata !== undefined
                ? { metadata: request.metadata }
                : {}),
              ...(request.include?.includes("message.output_text.logprobs")
                ? { responsesOutputTextLogprobs: true }
                : {}),
              ...(request.top_logprobs !== undefined
                ? { responsesTopLogprobs: request.top_logprobs }
                : {}),
              ...(request.stream_options?.include_obfuscation === false
                ? { responsesIncludeObfuscation: false }
                : {})
            }
          }
        }
      : {}),
    ...(request.service_tier !== undefined
      ? { serviceTier: request.service_tier }
      : {}),
    ...(request.store !== undefined ? { store: request.store } : {}),
    ...(request.prompt_cache_key !== undefined
      ? { promptCacheKey: request.prompt_cache_key }
      : {}),
    ...(request.prompt_cache_retention !== undefined
      ? { promptCacheRetention: request.prompt_cache_retention }
      : {}),
    ...(request.truncation !== undefined
      ? { responseTruncation: request.truncation }
      : {}),
    ...(outputFormat ? { outputFormat } : {}),
    ...(request.previous_response_id !== undefined
      ? { previousResponseId: request.previous_response_id }
      : {}),
    ...(conversationId !== undefined ? { conversationId } : {}),
    ...(request.prompt !== undefined || request.prompt_id !== undefined
      ? {
          prompt: {
            id:
              request.prompt?.id ??
              request.prompt?.prompt_id ??
              request.prompt_id ??
              "",
            ...(request.prompt?.version !== undefined
              ? { version: String(request.prompt.version) }
              : {}),
            ...(request.prompt?.variables !== undefined
              ? { variables: request.prompt.variables }
              : {})
          }
        }
      : {}),
    ...normalizeOpenAIResponsesReasoning(request.reasoning),
    ...(request.text?.verbosity !== undefined
      ? { responseTextVerbosity: request.text.verbosity }
      : {}),
    ...(request.max_output_tokens !== undefined
      ? { maxOutputTokens: request.max_output_tokens }
      : {}),
    ...(request.temperature !== undefined
      ? { temperature: request.temperature }
      : {}),
    ...(request.top_p !== undefined ? { topP: request.top_p } : {}),
    ...(request.stop !== undefined
      ? {
          stopSequences:
            typeof request.stop === "string" ? [request.stop] : request.stop
        }
      : {}),
    ...(request.tools !== undefined
      ? {
          tools: request.tools.map((tool) => ({
            name: tool.name,
            ...(tool.description ? { description: tool.description } : {}),
            inputSchema: tool.parameters
          }))
        }
      : {}),
    ...(toolChoice !== undefined ? { toolChoice } : {}),
    ...(request.parallel_tool_calls !== undefined
      ? { allowParallelToolCalls: request.parallel_tool_calls }
      : {}),
    messages: [...instructionMessages, ...inputMessages],
    ...(passthrough ? { passthrough } : {})
  };
}

const ANTHROPIC_MESSAGES_KNOWN_FIELDS = new Set([
  "model",
  "stream",
  "system",
  "max_tokens",
  "temperature",
  "top_p",
  "stop_sequences",
  "metadata",
  "tools",
  "tool_choice",
  "messages",
  "airlock"
]);

export function normalizeAnthropicMessagesRequest(
  request: AnthropicMessagesRequest
): CanonicalRequest {
  const passthrough = extractPassthrough(
    request,
    ANTHROPIC_MESSAGES_KNOWN_FIELDS
  );
  function joinAnthropicTextBlocks(
    blocks: Array<{
      type: "text";
      text: string;
    }>
  ) {
    return blocks.map((block) => block.text).join("\n");
  }

  function normalizeAnthropicToolResultContent(
    content:
      | string
      | Array<{
          type: "text";
          text: string;
        }>
  ) {
    return typeof content === "string"
      ? content
      : joinAnthropicTextBlocks(content);
  }

  const systemMessages = request.system
    ? [
        {
          role: "system" as const,
          content:
            typeof request.system === "string"
              ? request.system
              : joinAnthropicTextBlocks(request.system)
        }
      ]
    : [];
  const messages = request.messages.flatMap((message) => {
    if (typeof message.content === "string") {
      return [
        {
          role: message.role,
          content: message.content
        }
      ];
    }

    const toolUseBlocks = message.content.filter((block) => {
      return block.type === "tool_use";
    });

    if (message.role === "assistant" && toolUseBlocks.length > 0) {
      return [
        {
          role: "assistant" as const,
          content: joinAnthropicTextBlocks(
            message.content.filter((block) => block.type === "text")
          ),
          toolCalls: toolUseBlocks.map((block) => ({
            id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input)
          }))
        }
      ];
    }

    if (message.role === "user") {
      const normalizedMessages: Array<CanonicalRequest["messages"][number]> =
        [];
      let pendingTextBlocks: Array<{
        type: "text";
        text: string;
      }> = [];

      const flushPendingTextBlocks = () => {
        if (pendingTextBlocks.length === 0) {
          return;
        }

        normalizedMessages.push({
          role: "user",
          content: joinAnthropicTextBlocks(pendingTextBlocks)
        });
        pendingTextBlocks = [];
      };

      for (const block of message.content) {
        if (block.type === "text") {
          pendingTextBlocks.push(block);
          continue;
        }

        if (block.type === "tool_result") {
          flushPendingTextBlocks();
          normalizedMessages.push({
            role: "tool",
            content: normalizeAnthropicToolResultContent(block.content),
            toolCallId: block.tool_use_id
          });
        }
      }

      flushPendingTextBlocks();

      return normalizedMessages;
    }

    return [
      {
        role: message.role,
        content: joinAnthropicTextBlocks(
          message.content.filter((block) => block.type === "text")
        )
      }
    ];
  });

  return {
    model: request.model,
    stream: request.stream,
    ...(shouldPreserveNativeAnthropicMessages(request)
      ? {
          nativeRequest: {
            anthropicMessages: {
              ...(request.system !== undefined ? { system: request.system } : {}),
              messages: request.messages
            }
          }
        }
      : {}),
    ...(request.metadata !== undefined
      ? { endUserId: request.metadata.user_id }
      : {}),
    maxOutputTokens: request.max_tokens,
    ...(request.temperature !== undefined
      ? { temperature: request.temperature }
      : {}),
    ...(request.top_p !== undefined ? { topP: request.top_p } : {}),
    ...(request.stop_sequences !== undefined
      ? { stopSequences: request.stop_sequences }
      : {}),
    ...(request.tools !== undefined
      ? {
          tools: request.tools.map((tool) => ({
            name: tool.name,
            ...(tool.description ? { description: tool.description } : {}),
            inputSchema: tool.input_schema
          }))
        }
      : {}),
    ...(request.tool_choice !== undefined
      ? {
          toolChoice:
            request.tool_choice.type === "auto"
              ? "auto"
              : request.tool_choice.type === "any"
                ? "required"
                : request.tool_choice.type === "none"
                  ? "none"
                  : {
                      type: "tool" as const,
                      name: request.tool_choice.name
                    }
        }
      : {}),
    messages: [...systemMessages, ...messages],
    ...(passthrough ? { passthrough } : {})
  };
}

const GEMINI_GENERATE_CONTENT_KNOWN_FIELDS = new Set([
  "model",
  "stream",
  "system_instruction",
  "contents",
  "tools",
  "toolConfig",
  "generationConfig",
  "airlock"
]);

function stringifyGeminiFunctionPayload(value: unknown): string {
  if (value === undefined) return "";
  return JSON.stringify(value);
}

function normalizeGeminiTextParts(
  parts: GeminiGenerateContentRequest["contents"][number]["parts"]
) {
  return parts
    .filter((part) => "text" in part)
    .map((part) => ("text" in part ? part.text : ""))
    .join("\n");
}

function normalizeGeminiToolChoice(
  request: GeminiGenerateContentRequest
): CanonicalRequest["toolChoice"] | undefined {
  const functionCallingConfig = request.toolConfig?.functionCallingConfig;
  const mode = functionCallingConfig?.mode;

  if (mode === "NONE") return "none";
  if (mode === "ANY") {
    const allowedFunctionName = functionCallingConfig.allowedFunctionNames?.[0];
    return allowedFunctionName
      ? { type: "tool", name: allowedFunctionName }
      : "required";
  }
  if (mode === "AUTO") return "auto";
  return undefined;
}

function normalizeGeminiOutputFormat(
  generationConfig: GeminiGenerateContentRequest["generationConfig"]
): CanonicalRequest["outputFormat"] | undefined {
  if (generationConfig?.responseMimeType !== "application/json") {
    return undefined;
  }

  if (generationConfig.responseJsonSchema) {
    return {
      type: "json_schema",
      name: "gemini_response",
      schema: generationConfig.responseJsonSchema
    };
  }

  return {
    type: "json_object"
  };
}

function findLastGeminiToolCallByName(
  messages: CanonicalRequest["messages"],
  toolName: string
): CanonicalToolCall | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") {
      continue;
    }

    const matchingToolCall = message.toolCalls?.find((toolCall) => {
      return toolCall.name === toolName;
    });

    if (matchingToolCall) {
      return matchingToolCall;
    }
  }

  return undefined;
}

export function normalizeGeminiGenerateContentRequest(
  request: GeminiGenerateContentRequest & { model: string; stream?: boolean }
): CanonicalRequest {
  const passthrough = extractPassthrough(
    request,
    GEMINI_GENERATE_CONTENT_KNOWN_FIELDS
  );
  const systemText = request.system_instruction
    ? normalizeGeminiTextParts(request.system_instruction.parts)
    : "";
  const messages: CanonicalRequest["messages"] =
    systemText.length > 0
      ? [
          {
            role: "system",
            content: systemText
          }
        ]
      : [];

  for (const content of request.contents) {
    const textParts = normalizeGeminiTextParts(content.parts);
    const functionCallParts = content.parts.filter(
      (
        part
      ): part is Extract<
        (typeof content.parts)[number],
        { functionCall: unknown }
      > => {
        return "functionCall" in part;
      }
    );
    const functionResponseParts = content.parts.filter(
      (
        part
      ): part is Extract<
        (typeof content.parts)[number],
        { functionResponse: unknown }
      > => {
        return "functionResponse" in part;
      }
    );

    if (content.role === "model" || functionCallParts.length > 0) {
      messages.push({
        role: "assistant",
        content: textParts,
        ...(functionCallParts.length > 0
          ? {
              toolCalls: functionCallParts.map((part, index) => ({
                id: `gemini_call_${messages.length}_${index}`,
                name: part.functionCall.name,
                arguments: stringifyGeminiFunctionPayload(
                  part.functionCall.args
                )
              }))
            }
          : {})
      });
      continue;
    }

    if (functionResponseParts.length > 0) {
      for (const part of functionResponseParts) {
        const matchingToolCall = findLastGeminiToolCallByName(
          messages,
          part.functionResponse.name
        );
        messages.push({
          role: "tool",
          toolCallId: matchingToolCall?.id ?? `gemini_tool_${messages.length}`,
          content: stringifyGeminiFunctionPayload(
            part.functionResponse.response ?? {}
          )
        });
      }
    }

    if (textParts.length > 0) {
      messages.push({
        role: "user",
        content: textParts
      });
    }
  }

  const generationConfig = request.generationConfig;
  const outputFormat = normalizeGeminiOutputFormat(generationConfig);
  const toolChoice = normalizeGeminiToolChoice(request);

  return {
    model: request.model,
    stream: request.stream ?? false,
    messages,
    ...(generationConfig?.maxOutputTokens !== undefined
      ? { maxOutputTokens: generationConfig.maxOutputTokens }
      : {}),
    ...(generationConfig?.temperature !== undefined
      ? { temperature: generationConfig.temperature }
      : {}),
    ...(generationConfig?.topP !== undefined
      ? { topP: generationConfig.topP }
      : {}),
    ...(generationConfig?.stopSequences !== undefined
      ? { stopSequences: generationConfig.stopSequences }
      : {}),
    ...(outputFormat !== undefined ? { outputFormat } : {}),
    ...(request.tools !== undefined
      ? {
          tools: request.tools.flatMap((tool) => {
            return tool.functionDeclarations.map((declaration) => ({
              name: declaration.name,
              ...(declaration.description
                ? { description: declaration.description }
                : {}),
              inputSchema: declaration.parameters ?? {
                type: "object"
              }
            }));
          })
        }
      : {}),
    ...(toolChoice !== undefined ? { toolChoice } : {}),
    ...(passthrough ? { passthrough } : {})
  };
}

export function encodeCanonicalToOpenAIChatStreamChunk(
  event: CanonicalStreamEvent,
  streamId: string,
  includeUsage = true
) {
  if (event.type === "response_started") {
    return {
      id: streamId,
      object: "chat.completion.chunk" as const,
      created: event.createdAt ?? 0,
      model: event.model,
      ...(event.systemFingerprint !== undefined
        ? { system_fingerprint: event.systemFingerprint }
        : {}),
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant" as const
          },
          finish_reason: null
        }
      ]
    };
  }

  if (event.type === "output_text_delta") {
    const outputTextLogprobs = encodeCanonicalOpenAIOutputTextLogprobs(
      event.outputTextLogprobs
    );

    return {
      id: streamId,
      object: "chat.completion.chunk" as const,
      created: event.createdAt ?? 0,
      model: event.model,
      ...(event.systemFingerprint !== undefined
        ? { system_fingerprint: event.systemFingerprint }
        : {}),
      choices: [
        {
          index: 0,
          delta: {
            content: event.delta
          },
          ...(outputTextLogprobs !== undefined
            ? { logprobs: outputTextLogprobs }
            : {}),
          finish_reason: null
        }
      ]
    };
  }

  if (event.type === "reasoning_summary_delta") {
    return {
      id: streamId,
      object: "chat.completion.chunk" as const,
      created: event.createdAt ?? 0,
      model: event.model,
      ...(event.systemFingerprint !== undefined
        ? { system_fingerprint: event.systemFingerprint }
        : {}),
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: null
        }
      ]
    };
  }

  if (event.type === "tool_call_delta") {
    return {
      id: streamId,
      object: "chat.completion.chunk" as const,
      created: event.createdAt ?? 0,
      model: event.model,
      ...(event.systemFingerprint !== undefined
        ? { system_fingerprint: event.systemFingerprint }
        : {}),
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: event.toolIndex,
                ...(event.toolCallId ? { id: event.toolCallId } : {}),
                type: "function" as const,
                function: {
                  ...(event.toolName ? { name: event.toolName } : {}),
                  arguments: event.argumentsDelta
                }
              }
            ]
          },
          finish_reason: null
        }
      ]
    };
  }

  if (event.type !== "response_completed") {
    throw new Error("Unsupported canonical stream event for chat encoding");
  }

  return {
    id: streamId,
    object: "chat.completion.chunk" as const,
    created: event.createdAt ?? 0,
    model: event.model,
    ...(event.systemFingerprint !== undefined
      ? { system_fingerprint: event.systemFingerprint }
      : {}),
    ...(includeUsage && event.usage
      ? { usage: encodeCanonicalUsage(event.usage) }
      : {}),
    choices: [
      {
        index: 0,
        delta: {},
        ...(event.outputTextLogprobs !== undefined
          ? {
              logprobs: encodeCanonicalOpenAIOutputTextLogprobs(
                event.outputTextLogprobs
              )
            }
          : {}),
        finish_reason: encodeCanonicalOpenAIFinishReason(event.finishReason)
      }
    ]
  };
}

export function encodeCanonicalToOpenAIChatResponse(
  response: CanonicalResponse
) {
  const outputTextLogprobs = encodeCanonicalOpenAIOutputTextLogprobs(
    response.outputTextLogprobs
  );

  return {
    id: response.id,
    object: "chat.completion",
    created: response.createdAt ?? 0,
    model: response.model,
    ...(response.systemFingerprint !== undefined
      ? { system_fingerprint: response.systemFingerprint }
      : {}),
    ...(response.metadata !== undefined ? { metadata: response.metadata } : {}),
    ...(response.serviceTier !== undefined
      ? { service_tier: response.serviceTier }
      : {}),
    ...(response.usage ? { usage: encodeCanonicalUsage(response.usage) } : {}),
    choices: [
      {
        index: 0,
        ...(outputTextLogprobs !== undefined
          ? { logprobs: outputTextLogprobs }
          : {}),
        finish_reason: encodeCanonicalOpenAIFinishReason(response.finishReason),
        message: {
          role: "assistant",
          ...(response.toolCalls && response.toolCalls.length > 0
            ? {
                content:
                  response.outputText.length > 0 ? response.outputText : null,
                tool_calls: response.toolCalls.map((toolCall) => ({
                  id: toolCall.id,
                  type: "function" as const,
                  function: {
                    name: toolCall.name,
                    arguments: toolCall.arguments
                  }
                }))
              }
            : {
                content: response.outputText
              })
        }
      }
    ]
  };
}

export function encodeCanonicalToOpenAIResponsesResponse(
  response: CanonicalResponse
) {
  if (response.nativeResponse?.openaiResponses !== undefined) {
    const nativeResponse = response.nativeResponse.openaiResponses as Record<
      string,
      unknown
    >;

    return {
      ...nativeResponse,
      ...(nativeResponse.output_text === undefined
        ? { output_text: response.outputText }
        : {}),
      ...(nativeResponse.output === undefined
        ? {
            output: [
              ...(response.reasoningSummary
                ? [createOpenAIResponsesReasoningItem(response.reasoningSummary)]
                : []),
              ...(response.outputText.length > 0
                ? [
                    createOpenAIResponsesOutputMessage(
                      response.id,
                      response.outputText,
                      "completed",
                      true,
                      response.outputTextLogprobs
                    )
                  ]
                : []),
              ...(response.toolCalls?.map((toolCall) => ({
                type: "function_call" as const,
                call_id: toolCall.id,
                name: toolCall.name,
                arguments: toolCall.arguments,
                status: "completed" as const
              })) ?? [])
            ]
          }
        : {})
    };
  }

  const output = [
    ...(response.reasoningSummary
      ? [createOpenAIResponsesReasoningItem(response.reasoningSummary)]
      : []),
    ...(response.outputText.length > 0
      ? [
          createOpenAIResponsesOutputMessage(
            response.id,
            response.outputText,
            "completed",
            true,
            response.outputTextLogprobs
          )
        ]
      : []),
    ...(response.toolCalls?.map((toolCall) => ({
      type: "function_call" as const,
      call_id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments,
      status: "completed" as const
    })) ?? [])
  ];

  return {
    id: response.id,
    object: "response",
    created_at: response.createdAt ?? 0,
    model: response.model,
    status: encodeCanonicalResponsesStatus(response.finishReason),
    ...(response.metadata !== undefined ? { metadata: response.metadata } : {}),
    ...(response.serviceTier !== undefined
      ? { service_tier: response.serviceTier }
      : {}),
    ...(response.responseTextVerbosity !== undefined
      ? {
          text: {
            verbosity: response.responseTextVerbosity
          }
        }
      : {}),
    ...(response.responseTruncation !== undefined
      ? { truncation: response.responseTruncation }
      : {}),
    ...(response.promptCacheKey !== undefined
      ? { prompt_cache_key: response.promptCacheKey }
      : {}),
    ...(response.promptCacheRetention !== undefined
      ? { prompt_cache_retention: response.promptCacheRetention }
      : {}),
    ...(response.conversationId !== undefined
      ? {
          conversation: {
            id: response.conversationId
          }
        }
      : {}),
    ...(encodeCanonicalResponsesIncompleteDetails(response.finishReason)
      ? {
          incomplete_details: encodeCanonicalResponsesIncompleteDetails(
            response.finishReason
          )
        }
      : {}),
    ...(response.parallelToolCalls !== undefined
      ? { parallel_tool_calls: response.parallelToolCalls }
      : {}),
    tools: [],
    output,
    output_text: response.outputText,
    ...(response.usage
      ? { usage: encodeCanonicalResponsesUsage(response.usage) }
      : {})
  };
}

export function encodeCanonicalToOpenAIResponsesStreamEvent(
  event: CanonicalStreamEvent,
  state: OpenAIResponsesEventEncodingState & {
    parallelToolCalls?: boolean;
  }
): OpenAIResponsesEncodedEventBatch {
  const itemId = `${event.responseId}_output_0`;
  const textOutputIndex = state.startedReasoningOutput ? 1 : state.outputIndex;
  const outputTextLogprobsContent =
    event.type === "output_text_delta" || event.type === "response_completed"
      ? encodeCanonicalOpenAIOutputTextLogprobsContent(event.outputTextLogprobs)
      : undefined;

  if (event.type === "response_started") {
    const baseResponse = createOpenAIResponsesBaseResponse(
      event.responseId,
      event.model,
      "in_progress",
      event.createdAt ?? 0,
      event.parallelToolCalls ?? state.parallelToolCalls
    );
    const response = addOpenAIResponsesEnvelopeFields(baseResponse, event);

    return {
      events: [
        {
          type: "response.created" as const,
          sequence_number: state.sequenceNumber,
          response
        },
        {
          type: "response.in_progress" as const,
          sequence_number: state.sequenceNumber + 1,
          response
        }
      ],
      nextSequenceNumber: state.sequenceNumber + 2
    };
  }

  if (event.type === "output_text_delta") {
    if (!state.startedTextOutput) {
      return {
        events: [
          {
            type: "response.output_item.added" as const,
            sequence_number: state.sequenceNumber,
            output_index: textOutputIndex,
            item: createOpenAIResponsesOutputMessage(
              event.responseId,
              "",
              "in_progress",
              false
            )
          },
          {
            type: "response.content_part.added" as const,
            sequence_number: state.sequenceNumber + 1,
            item_id: itemId,
            output_index: textOutputIndex,
            content_index: state.contentIndex,
            part: createOpenAIResponsesOutputTextPart("")
          },
          {
            type: "response.output_text.delta" as const,
            sequence_number: state.sequenceNumber + 2,
            item_id: itemId,
            output_index: textOutputIndex,
            content_index: state.contentIndex,
            delta: event.delta,
            ...(outputTextLogprobsContent !== undefined
              ? { logprobs: outputTextLogprobsContent }
              : {})
          }
        ],
        nextSequenceNumber: state.sequenceNumber + 3
      };
    }

    return {
      events: [
        {
          type: "response.output_text.delta" as const,
          sequence_number: state.sequenceNumber,
          item_id: itemId,
          output_index: textOutputIndex,
          content_index: state.contentIndex,
          delta: event.delta,
          ...(outputTextLogprobsContent !== undefined
            ? { logprobs: outputTextLogprobsContent }
            : {})
        }
      ],
      nextSequenceNumber: state.sequenceNumber + 1
    };
  }

  if (event.type === "reasoning_summary_delta") {
    if (!state.startedReasoningOutput) {
      return {
        events: [
          {
            type: "response.output_item.added" as const,
            sequence_number: state.sequenceNumber,
            output_index: 0,
            item: createOpenAIResponsesReasoningItem()
          },
          {
            type: "response.reasoning_summary_part.added" as const,
            sequence_number: state.sequenceNumber + 1,
            output_index: 0,
            summary_index: 0,
            part: {
              type: "summary_text" as const,
              text: ""
            }
          },
          {
            type: "response.reasoning_summary_text.delta" as const,
            sequence_number: state.sequenceNumber + 2,
            output_index: 0,
            summary_index: 0,
            delta: event.delta
          }
        ],
        nextSequenceNumber: state.sequenceNumber + 3
      };
    }

    return {
      events: [
        {
          type: "response.reasoning_summary_text.delta" as const,
          sequence_number: state.sequenceNumber,
          output_index: 0,
          summary_index: 0,
          delta: event.delta
        }
      ],
      nextSequenceNumber: state.sequenceNumber + 1
    };
  }

  if (event.type === "reasoning_section_break") {
    return {
      events: [
        {
          type: "response.reasoning_summary_part.added" as const,
          sequence_number: state.sequenceNumber,
          output_index: 0,
          summary_index: event.summaryIndex,
          part: {
            type: "summary_text" as const,
            text: ""
          }
        }
      ],
      nextSequenceNumber: state.sequenceNumber + 1
    };
  }

  if (event.type === "reasoning_raw_content_delta") {
    return {
      events: [
        {
          type: "response.reasoning_text.delta" as const,
          sequence_number: state.sequenceNumber,
          output_index: 0,
          ...(event.contentIndex !== undefined
            ? { content_index: event.contentIndex }
            : {}),
          delta: event.delta
        }
      ],
      nextSequenceNumber: state.sequenceNumber + 1
    };
  }

  if (event.type === "tool_call_delta") {
    const toolType = state.toolCallType ?? "function_call";
    const currentArguments = (state.toolCallArguments ?? "") + event.argumentsDelta;
    const toolItem =
      toolType === "custom_tool_call"
        ? createOpenAIResponsesCustomToolCallItem(
            event.responseId,
            event.toolCallId,
            event.toolName ?? state.toolCallName,
            currentArguments
          )
        : createOpenAIResponsesFunctionCallItem(
            event.responseId,
            event.toolCallId,
            event.toolName ?? state.toolCallName,
            currentArguments
          );

    const isFirstToolDeltaForCall = !state.startedToolCallIds?.includes(
      event.toolCallId
    );

    if (isFirstToolDeltaForCall) {
      return {
        events: [
          {
            type: "response.output_item.added" as const,
            sequence_number: state.sequenceNumber,
            output_index: state.outputIndex,
            item: toolItem
          },
          ...(toolType === "custom_tool_call"
            ? [
                {
                  type: "response.custom_tool_call_input.delta" as const,
                  sequence_number: state.sequenceNumber + 1,
                  item_id: toolItem.call_id,
                  call_id: toolItem.call_id,
                  output_index: state.outputIndex,
                  delta: event.argumentsDelta
                }
              ]
            : [
                {
                  type: "response.function_call_arguments.delta" as const,
                  sequence_number: state.sequenceNumber + 1,
                  item_id: toolItem.call_id,
                  output_index: state.outputIndex,
                  delta: event.argumentsDelta
                }
              ])
        ],
        nextSequenceNumber: state.sequenceNumber + 2
      };
    }

    return {
      events: [
        ...(toolType === "custom_tool_call"
          ? [
              {
                type: "response.custom_tool_call_input.delta" as const,
                sequence_number: state.sequenceNumber,
                item_id: toolItem.call_id,
                call_id: toolItem.call_id,
                output_index: state.outputIndex,
                delta: event.argumentsDelta
              }
            ]
          : [
              {
                type: "response.function_call_arguments.delta" as const,
                sequence_number: state.sequenceNumber,
                item_id: toolItem.call_id,
                output_index: state.outputIndex,
                delta: event.argumentsDelta
              }
            ])
      ],
      nextSequenceNumber: state.sequenceNumber + 1
    };
  }

  const outputText = state.outputText ?? "";
  const reasoningSummary =
    event.reasoningSummary ?? state.reasoningSummary ?? "";
  const reasoningRawContent = state.reasoningRawContent ?? "";
  const responseStatus = encodeCanonicalResponsesStatus(event.finishReason);
  const isToolCallCompletion = event.finishReason === "tool_calls";
  const completedResponse = {
    ...createOpenAIResponsesBaseResponse(
      event.responseId,
      event.model,
      responseStatus === "incomplete" ? "completed" : responseStatus,
      event.createdAt ?? 0,
      event.parallelToolCalls ?? state.parallelToolCalls
    ),
    status: responseStatus,
    ...(encodeCanonicalResponsesIncompleteDetails(event.finishReason)
      ? {
          incomplete_details: encodeCanonicalResponsesIncompleteDetails(
            event.finishReason
          )
        }
      : {}),
    ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
    ...(event.serviceTier !== undefined
      ? { service_tier: event.serviceTier }
      : {}),
    ...(event.promptCacheKey !== undefined
      ? { prompt_cache_key: event.promptCacheKey }
      : {}),
    ...(event.promptCacheRetention !== undefined
      ? { prompt_cache_retention: event.promptCacheRetention }
      : {}),
    ...(event.responseTruncation !== undefined
      ? { truncation: event.responseTruncation }
      : {}),
    ...(event.responseTextVerbosity !== undefined
      ? {
          text: {
            verbosity: event.responseTextVerbosity
          }
        }
      : {}),
    ...(event.conversationId !== undefined
      ? {
          conversation: {
            id: event.conversationId
          }
        }
      : {}),
    output: [
      ...(reasoningSummary.length > 0
        ? [createOpenAIResponsesReasoningItem(reasoningSummary)]
        : []),
      ...(isToolCallCompletion
        ? [
            createOpenAIResponsesFunctionCallItem(
              event.responseId,
              state.toolCallId,
              state.toolCallName,
              state.toolCallArguments
            )
          ]
        : outputText.length > 0
          ? [
              createOpenAIResponsesOutputMessage(
                event.responseId,
                outputText,
                "completed",
                true,
                event.outputTextLogprobs
              )
            ]
          : [])
    ],
    output_text: outputText,
    ...(event.usage
      ? { usage: encodeCanonicalResponsesUsage(event.usage) }
      : {})
  };

  if (isToolCallCompletion) {
    const completedToolCalls =
      state.toolCalls && state.toolCalls.length > 0
        ? state.toolCalls
        : [
            {
              toolCallId: state.toolCallId ?? `${event.responseId}_tool_call_0`,
              toolCallName: state.toolCallName,
              toolCallArguments: state.toolCallArguments ?? "{}",
              outputIndex: state.outputIndex
            }
          ];
    const reasoningCompletionEvents =
      reasoningSummary.length > 0 && state.startedReasoningOutput
        ? [
            {
              type: "response.reasoning_summary_text.done" as const,
              sequence_number: state.sequenceNumber,
              output_index: 0,
              summary_index: 0,
              text: reasoningSummary
            },
            {
              type: "response.reasoning_summary_part.done" as const,
              sequence_number: state.sequenceNumber + 1,
              output_index: 0,
              summary_index: 0,
              part: {
                type: "summary_text" as const,
                text: reasoningSummary
              }
            },
            {
              type: "response.output_item.done" as const,
              sequence_number: state.sequenceNumber + 2,
              output_index: 0,
              item: {
                ...createOpenAIResponsesReasoningItem(reasoningSummary),
                ...(reasoningRawContent.length > 0
                  ? {
                      content: [
                        {
                          type: "reasoning_text" as const,
                          text: reasoningRawContent
                        }
                      ]
                    }
                  : {})
              }
            }
          ]
        : [];
    const textCompletionEvents =
      outputText.length > 0 && state.startedTextOutput
        ? [
            {
              type: "response.output_text.done" as const,
              sequence_number:
                state.sequenceNumber + reasoningCompletionEvents.length,
              item_id: itemId,
              output_index: state.startedReasoningOutput ? 1 : 0,
              content_index: state.contentIndex,
              text: outputText,
              ...(outputTextLogprobsContent !== undefined
                ? { logprobs: outputTextLogprobsContent }
                : {})
            },
            {
              type: "response.content_part.done" as const,
              sequence_number:
                state.sequenceNumber + reasoningCompletionEvents.length + 1,
              item_id: itemId,
              output_index: state.startedReasoningOutput ? 1 : 0,
              content_index: state.contentIndex,
              part: createOpenAIResponsesOutputTextPart(outputText)
            },
            {
              type: "response.output_item.done" as const,
              sequence_number:
                state.sequenceNumber + reasoningCompletionEvents.length + 2,
              output_index: state.startedReasoningOutput ? 1 : 0,
              item: createOpenAIResponsesOutputMessage(
                event.responseId,
                outputText,
                "completed",
                true,
                event.outputTextLogprobs
              )
            }
          ]
        : [];
    const toolSequenceStart =
      state.sequenceNumber +
      reasoningCompletionEvents.length +
      textCompletionEvents.length;

    return {
      events: [
        ...reasoningCompletionEvents,
        ...textCompletionEvents,
        ...completedToolCalls.flatMap((toolCall, index) => {
          const functionCallItem = createOpenAIResponsesFunctionCallItem(
            event.responseId,
            toolCall.toolCallId,
            toolCall.toolCallName,
            toolCall.toolCallArguments
          );
          const customToolItem = createOpenAIResponsesCustomToolCallItem(
            event.responseId,
            toolCall.toolCallId,
            toolCall.toolCallName,
            toolCall.toolCallArguments
          );
          const eventSequenceBase = toolSequenceStart + index * 2;

          return [
            ...(toolCall.toolType === "custom_tool_call"
              ? []
              : [
                  {
                    type: "response.function_call_arguments.done" as const,
                    sequence_number: eventSequenceBase,
                    item_id: functionCallItem.call_id,
                    output_index: toolCall.outputIndex,
                    arguments: functionCallItem.arguments
                  }
                ]),
            {
              type: "response.output_item.done" as const,
              sequence_number:
                eventSequenceBase +
                (toolCall.toolType === "custom_tool_call" ? 0 : 1),
              output_index: toolCall.outputIndex,
              item:
                toolCall.toolType === "custom_tool_call"
                  ? customToolItem
                  : functionCallItem
            }
          ];
        }),
        {
          type: "response.completed" as const,
          sequence_number:
            toolSequenceStart +
            completedToolCalls.reduce((count, toolCall) => {
              return count + (toolCall.toolType === "custom_tool_call" ? 1 : 2);
            }, 0),
          response: {
            ...completedResponse,
            output: [
              ...(reasoningSummary.length > 0
                ? [
                    {
                      ...createOpenAIResponsesReasoningItem(reasoningSummary),
                      ...(reasoningRawContent.length > 0
                        ? {
                            content: [
                              {
                                type: "reasoning_text" as const,
                                text: reasoningRawContent
                              }
                            ]
                          }
                        : {})
                    }
                  ]
                : []),
              ...(outputText.length > 0
                ? [
                    createOpenAIResponsesOutputMessage(
                      event.responseId,
                      outputText,
                      "completed",
                      true,
                      event.outputTextLogprobs
                    )
                  ]
                : []),
              ...completedToolCalls.map((toolCall) => {
                return toolCall.toolType === "custom_tool_call"
                  ? createOpenAIResponsesCustomToolCallItem(
                      event.responseId,
                      toolCall.toolCallId,
                      toolCall.toolCallName,
                      toolCall.toolCallArguments
                    )
                  : createOpenAIResponsesFunctionCallItem(
                      event.responseId,
                      toolCall.toolCallId,
                      toolCall.toolCallName,
                      toolCall.toolCallArguments
                    );
              })
            ]
          }
        }
      ],
      nextSequenceNumber:
        toolSequenceStart +
        completedToolCalls.reduce((count, toolCall) => {
          return count + (toolCall.toolType === "custom_tool_call" ? 1 : 2);
        }, 0) +
        1
    };
  }

  const reasoningCompletionEvents =
    reasoningSummary.length > 0 && state.startedReasoningOutput
      ? [
          {
            type: "response.reasoning_summary_text.done" as const,
            sequence_number: state.sequenceNumber,
            output_index: 0,
            summary_index: 0,
            text: reasoningSummary
          },
          {
            type: "response.reasoning_summary_part.done" as const,
            sequence_number: state.sequenceNumber + 1,
            output_index: 0,
            summary_index: 0,
            part: {
              type: "summary_text" as const,
              text: reasoningSummary
            }
          },
          {
            type: "response.output_item.done" as const,
            sequence_number: state.sequenceNumber + 2,
            output_index: 0,
            item: {
              ...createOpenAIResponsesReasoningItem(reasoningSummary),
              ...(reasoningRawContent.length > 0
                ? {
                    content: [
                      {
                        type: "reasoning_text" as const,
                        text: reasoningRawContent
                      }
                    ]
                  }
                : {})
            }
          }
        ]
      : [];

  const textCompletionEvents =
    outputText.length > 0 && state.startedTextOutput
      ? [
          {
            type: "response.output_text.done" as const,
            sequence_number:
              state.sequenceNumber + reasoningCompletionEvents.length,
            item_id: itemId,
            output_index: state.startedReasoningOutput ? 1 : state.outputIndex,
            content_index: state.contentIndex,
            text: outputText,
            ...(outputTextLogprobsContent !== undefined
              ? { logprobs: outputTextLogprobsContent }
              : {})
          },
          {
            type: "response.content_part.done" as const,
            sequence_number:
              state.sequenceNumber + reasoningCompletionEvents.length + 1,
            item_id: itemId,
            output_index: state.startedReasoningOutput ? 1 : state.outputIndex,
            content_index: state.contentIndex,
            part: createOpenAIResponsesOutputTextPart(outputText)
          },
          {
            type: "response.output_item.done" as const,
            sequence_number:
              state.sequenceNumber + reasoningCompletionEvents.length + 2,
            output_index: state.startedReasoningOutput ? 1 : state.outputIndex,
            item: createOpenAIResponsesOutputMessage(
              event.responseId,
              outputText,
              "completed",
              true,
              event.outputTextLogprobs
            )
          }
        ]
      : [];

  return {
    events: [
      ...reasoningCompletionEvents,
      ...textCompletionEvents,
      {
        type: "response.completed" as const,
        sequence_number:
          state.sequenceNumber +
          reasoningCompletionEvents.length +
          textCompletionEvents.length,
        response: completedResponse
      }
    ],
    nextSequenceNumber:
      state.sequenceNumber +
      reasoningCompletionEvents.length +
      textCompletionEvents.length +
      1
  };
}

export function encodeCanonicalToAnthropicMessagesResponse(
  response: CanonicalResponse
) {
  if (response.nativeResponse?.anthropicMessages !== undefined) {
    return response.nativeResponse.anthropicMessages;
  }

  const toolUseContent =
    response.toolCalls?.map((toolCall) => ({
      type: "tool_use" as const,
      id: toolCall.id,
      name: toolCall.name,
      input: parseToolCallArguments(toolCall.arguments)
    })) ?? [];

  const textContent =
    response.outputText.length > 0
      ? [
          {
            type: "text" as const,
            text: response.outputText
          }
        ]
      : [];

  const content = [...textContent, ...toolUseContent];

  return {
    id: response.id,
    type: "message",
    role: "assistant",
    model: response.model,
    stop_reason: encodeCanonicalAnthropicStopReason(response.finishReason),
    stop_sequence: null,
    ...(response.usage
      ? { usage: encodeCanonicalAnthropicUsage(response.usage) }
      : {}),
    content
  };
}

export function encodeCanonicalToGeminiGenerateContentResponse(
  response: CanonicalResponse
) {
  const parts = [
    ...(response.outputText.length > 0 ? [{ text: response.outputText }] : []),
    ...(response.toolCalls?.map((toolCall) => ({
      functionCall: {
        name: toolCall.name,
        ...(toolCall.arguments.length > 0
          ? { args: parseToolCallArguments(toolCall.arguments) }
          : {})
      }
    })) ?? [])
  ];

  return {
    responseId: response.id,
    modelVersion: response.model,
    candidates: [
      {
        finishReason: encodeCanonicalGeminiFinishReason(response.finishReason),
        content: {
          role: "model" as const,
          parts
        }
      }
    ],
    ...(response.usage
      ? { usageMetadata: encodeCanonicalGeminiUsage(response.usage) }
      : {})
  };
}

export function encodeCanonicalToGeminiGenerateContentStreamEvents(
  event: CanonicalStreamEvent,
  state: GeminiGenerateContentStreamEncodingState = {
    toolCalls: new Map()
  }
) {
  if (event.type === "response_started") {
    return [
      {
        responseId: event.responseId,
        modelVersion: event.model,
        candidates: [
          {
            content: {
              role: "model" as const,
              parts: []
            }
          }
        ]
      }
    ];
  }

  if (event.type === "output_text_delta") {
    return [
      {
        responseId: event.responseId,
        modelVersion: event.model,
        candidates: [
          {
            content: {
              role: "model" as const,
              parts: [
                {
                  text: event.delta
                }
              ]
            }
          }
        ]
      }
    ];
  }

  if (event.type === "tool_call_delta") {
    const current = state.toolCalls.get(event.toolCallId) ?? {
      arguments: ""
    };
    current.arguments += event.argumentsDelta;
    if (event.toolName !== undefined) {
      current.name = event.toolName;
    }
    state.toolCalls.set(event.toolCallId, current);

    return [
      {
        responseId: event.responseId,
        modelVersion: event.model,
        candidates: [
          {
            content: {
              role: "model" as const,
              parts: [
                {
                  functionCall: {
                    name: current.name ?? event.toolCallId,
                    ...(current.arguments.length > 0
                      ? {
                          args: parseToolCallArguments(current.arguments)
                        }
                      : {})
                  }
                }
              ]
            }
          }
        ]
      }
    ];
  }

  if (event.type === "response_completed") {
    return [
      {
        responseId: event.responseId,
        modelVersion: event.model,
        candidates: [
          {
            finishReason: encodeCanonicalGeminiFinishReason(event.finishReason),
            content: {
              role: "model" as const,
              parts: []
            }
          }
        ],
        ...(event.usage
          ? { usageMetadata: encodeCanonicalGeminiUsage(event.usage) }
          : {})
      }
    ];
  }

  return [];
}

export function encodeCanonicalToAnthropicMessagesStreamEvents(
  event: CanonicalStreamEvent,
  state: AnthropicMessagesStreamEncodingState = {
    startedTextBlock: false,
    startedToolBlocks: [],
    pendingToolStops: []
  }
) {
  if (event.type === "response_started") {
    return [
      {
        type: "message_start" as const,
        message: {
          id: event.responseId,
          type: "message" as const,
          role: "assistant" as const,
          model: event.model
        }
      }
    ];
  }

  if (event.type === "output_text_delta") {
    if (!state.startedTextBlock) {
      state.startedTextBlock = true;
      return [
        {
          type: "content_block_start" as const,
          index: 0,
          content_block: {
            type: "text" as const,
            text: ""
          }
        },
        {
          type: "content_block_delta" as const,
          index: 0,
          delta: {
            type: "text_delta" as const,
            text: event.delta
          }
        }
      ];
    }

    return [
      {
        type: "content_block_delta" as const,
        index: 0,
        delta: {
          type: "text_delta" as const,
          text: event.delta
        }
      }
    ];
  }

  if (event.type === "reasoning_summary_delta") {
    return [];
  }

  if (event.type === "thinking_delta") {
    const thinkingBlockIndex =
      event.thinkingBlockIndex ?? (state.startedTextBlock ? 1 : 0);

    if (!state.thinkingBlockIndexes?.includes(thinkingBlockIndex)) {
      state.thinkingBlockIndexes = [
        ...(state.thinkingBlockIndexes ?? []),
        thinkingBlockIndex
      ];

      return [
        {
          type: "content_block_start" as const,
          index: thinkingBlockIndex,
          content_block: {
            type: "thinking" as const,
            thinking: "",
            signature: ""
          }
        },
        {
          type: "content_block_delta" as const,
          index: thinkingBlockIndex,
          delta: {
            type: "thinking_delta" as const,
            thinking: event.delta
          }
        }
      ];
    }

    return [
      {
        type: "content_block_delta" as const,
        index: thinkingBlockIndex,
        delta: {
          type: "thinking_delta" as const,
          thinking: event.delta
        }
      }
    ];
  }

  if (event.type === "thinking_signature_delta") {
    const thinkingBlockIndex =
      event.thinkingBlockIndex ?? (state.startedTextBlock ? 1 : 0);

    if (!state.thinkingBlockIndexes?.includes(thinkingBlockIndex)) {
      state.thinkingBlockIndexes = [
        ...(state.thinkingBlockIndexes ?? []),
        thinkingBlockIndex
      ];

      return [
        {
          type: "content_block_start" as const,
          index: thinkingBlockIndex,
          content_block: {
            type: "thinking" as const,
            thinking: "",
            signature: ""
          }
        },
        {
          type: "content_block_delta" as const,
          index: thinkingBlockIndex,
          delta: {
            type: "signature_delta" as const,
            signature: event.signature
          }
        }
      ];
    }

    return [
      {
        type: "content_block_delta" as const,
        index: thinkingBlockIndex,
        delta: {
          type: "signature_delta" as const,
          signature: event.signature
        }
      }
    ];
  }

  if (event.type === "tool_call_delta") {
    const toolIndex = event.toolIndex;
    const toolBlockIndex = state.startedTextBlock ? toolIndex + 1 : toolIndex;
    const encodedToolStartNeeded =
      !state.startedToolBlocks.includes(toolBlockIndex);

    if (encodedToolStartNeeded) {
      state.startedToolBlocks.push(toolBlockIndex);
    }

    if (!state.pendingToolStops.includes(toolBlockIndex)) {
      state.pendingToolStops.push(toolBlockIndex);
    }

    const events = [];

    if (encodedToolStartNeeded) {
      events.push({
        type: "content_block_start" as const,
        index: toolBlockIndex,
        content_block: {
          type: "tool_use" as const,
          id: event.toolCallId,
          name: event.toolName ?? "tool_call",
          input: {}
        }
      });
    }

    events.push({
      type: "content_block_delta" as const,
      index: toolBlockIndex,
      delta: {
        type: "input_json_delta" as const,
        partial_json: event.argumentsDelta
      }
    });

    return events;
  }

  if (event.type !== "response_completed") {
    return [];
  }

  const stopEvents = [];

  if (state.startedTextBlock) {
    stopEvents.push({
      type: "content_block_stop" as const,
      index: 0
    });
    state.startedTextBlock = false;
  }

  for (const pendingToolStop of state.pendingToolStops) {
    stopEvents.push({
      type: "content_block_stop" as const,
      index: pendingToolStop
    });
  }
  state.pendingToolStops = [];

  return [
    ...stopEvents,
    {
      type: "message_delta" as const,
      delta: {
        stop_reason: encodeCanonicalAnthropicStopReason(event.finishReason),
        stop_sequence: null
      },
      ...(event.usage
        ? { usage: encodeCanonicalAnthropicUsage(event.usage) }
        : {})
    },
    {
      type: "message_stop" as const
    }
  ];
}
