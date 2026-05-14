import type {
  AnthropicMessagesRequest,
  OpenAIChatCompletionRequest,
  OpenAIResponsesRequest
} from "@airlock/protocols";

import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalStreamEvent
} from "./models.js";

type CanonicalUsageValue = CanonicalResponse["usage"];

type OpenAIResponsesInputValue = OpenAIResponsesRequest["input"];
type OpenAIResponsesInputMessageValue = Exclude<
  Extract<OpenAIResponsesInputValue, unknown[]>,
  (
    | { type: "input_text"; text: string }
    | {
        type: "message";
        role: "user" | "assistant" | "system" | "developer";
        content:
          | string
          | { type: "input_text"; text: string }[]
          | { type: "output_text"; text: string }[];
      }
    | {
        type: "function_call";
        call_id: string;
        name: string;
        arguments: string;
      }
    | {
        type: "function_call_output";
        call_id: string;
        output: string;
      }
  )[]
>[number];
type OpenAIResponsesTypedInputItemValue = Extract<
  OpenAIResponsesInputValue,
  (
    | { type: "input_text"; text: string }
    | {
        type: "message";
        role: "user" | "assistant" | "system" | "developer";
        content:
          | string
          | { type: "input_text"; text: string }[]
          | { type: "output_text"; text: string }[];
      }
    | {
        type: "function_call";
        call_id: string;
        name: string;
        arguments: string;
      }
    | {
        type: "function_call_output";
        call_id: string;
        output: string;
      }
  )[]
>[number];

interface OpenAIResponsesEventEncodingState {
  sequenceNumber: number;
  outputIndex: number;
  contentIndex: number;
  outputText?: string;
  startedTextOutput?: boolean;
  startedToolCallIds?: string[];
  toolCallId?: string;
  toolCallName?: string;
  toolCallArguments?: string;
  toolCalls?: Array<{
    toolCallId: string;
    toolCallName?: string;
    toolCallArguments: string;
    outputIndex: number;
  }>;
}

interface AnthropicMessagesStreamEncodingState {
  startedTextBlock: boolean;
  startedToolBlocks: number[];
  pendingToolStops: number[];
}

interface OpenAIResponsesEncodedEventBatch {
  events: unknown[];
  nextSequenceNumber: number;
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

function encodeCanonicalUsage(
  usage: CanonicalUsageValue
) {
  if (!usage) {
    return undefined;
  }

  return {
    prompt_tokens: usage.inputTokens,
    completion_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens
  };
}

function encodeCanonicalResponsesUsage(
  usage: CanonicalUsageValue
) {
  if (!usage) {
    return undefined;
  }

  return {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens
  };
}

function encodeCanonicalAnthropicUsage(
  usage: CanonicalUsageValue
) {
  if (!usage) {
    return undefined;
  }

  return {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens
  };
}

function createOpenAIResponsesOutputTextPart(
  text: string
) {
  return {
    type: "output_text" as const,
    text,
    annotations: []
  };
}

function createOpenAIResponsesOutputMessage(
  responseId: string,
  text: string,
  status: "in_progress" | "completed",
  includeContent: boolean
) {
  return {
    id: `${responseId}_output_0`,
    type: "message" as const,
    role: "assistant" as const,
    status,
    content: includeContent ? [createOpenAIResponsesOutputTextPart(text)] : []
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

function createOpenAIResponsesBaseResponse(
  responseId: string,
  model: string,
  status: "in_progress" | "completed"
) {
  return {
    id: responseId,
    object: "response" as const,
    created_at: 0,
    model,
    status,
    output: [],
    parallel_tool_calls: true,
    tools: []
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
      input[0].type === "function_call_output")
  );
}

function encodeOpenAIResponsesMessageContent(
  content:
    | string
    | { type: "input_text"; text: string }[]
    | { type: "output_text"; text: string }[]
): string {
  if (typeof content === "string") {
    return content;
  }

  return content.map((block) => block.text).join("\n");
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
  if (text === undefined) {
    return undefined;
  }

  if (text.format.type === "text") {
    return {
      type: "text" as const
    };
  }

  return {
    type: "json_schema" as const,
    name: text.format.name,
    schema: text.format.schema,
    ...(text.format.strict !== undefined
      ? { strict: text.format.strict }
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

    flushPendingUserTextItems();
    messages.push({
      role: item.role === "developer" ? "system" : item.role,
      content: encodeOpenAIResponsesMessageContent(item.content)
    });
  }

  flushPendingUserTextItems();

  return messages;
}

export function normalizeOpenAIChatRequest(
  request: OpenAIChatCompletionRequest
): CanonicalRequest {
  const maxOutputTokens = request.max_completion_tokens ?? request.max_tokens;
  const stopSequences =
    request.stop === undefined
      ? undefined
      : typeof request.stop === "string"
      ? [request.stop]
      : request.stop;
  const toolChoice = normalizeOpenAIToolChoice(request.tool_choice);
  const outputFormat = normalizeOpenAIChatResponseFormat(request.response_format);

  return {
    model: request.model,
    stream: request.stream,
    ...(outputFormat ? { outputFormat } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
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
    })
  };
}

export function normalizeOpenAIResponsesRequest(
  request: OpenAIResponsesRequest
): CanonicalRequest {
  const inputMessages =
    request.input === undefined
      ? []
      : typeof request.input === "string"
        ? [{ role: "user" as const, content: request.input }]
        : isOpenAIResponsesTypedInputItems(request.input)
          ? normalizeOpenAIResponsesTypedInputItems(request.input)
          : request.input.map((message: OpenAIResponsesInputMessageValue) => ({
              role: message.role === "developer" ? "system" : message.role,
              content: encodeOpenAIResponsesMessageContent(message.content)
            }));
  const instructionMessages = request.instructions
    ? [{ role: "system" as const, content: request.instructions }]
    : [];
  const toolChoice = normalizeOpenAIToolChoice(request.tool_choice);
  const outputFormat = normalizeOpenAIResponsesTextFormat(request.text);

  return {
    model: request.model,
    stream: request.stream,
    ...(outputFormat ? { outputFormat } : {}),
    ...(request.previous_response_id !== undefined
      ? { previousResponseId: request.previous_response_id }
      : {}),
    ...(request.conversation !== undefined
      ? { conversationId: request.conversation }
      : {}),
    ...(request.prompt !== undefined
      ? {
          prompt: {
            id: request.prompt.id ?? request.prompt.prompt_id ?? "",
            ...(request.prompt.version !== undefined
              ? { version: String(request.prompt.version) }
              : {}),
            ...(request.prompt.variables !== undefined
              ? { variables: request.prompt.variables }
              : {})
          }
        }
      : {}),
    ...(request.reasoning?.effort !== undefined
      ? { reasoningEffort: request.reasoning.effort }
      : {}),
    ...(request.max_output_tokens !== undefined
      ? { maxOutputTokens: request.max_output_tokens }
      : {}),
    ...(request.temperature !== undefined
      ? { temperature: request.temperature }
      : {}),
    ...(request.top_p !== undefined ? { topP: request.top_p } : {}),
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
    messages: [...instructionMessages, ...inputMessages]
  };
}

export function normalizeAnthropicMessagesRequest(
  request: AnthropicMessagesRequest
): CanonicalRequest {
  const systemMessages = request.system
    ? [{ role: "system" as const, content: request.system }]
    : [];
  const messages = request.messages.map((message) => {
    if (typeof message.content === "string") {
      return {
        role: message.role,
        content: message.content
      };
    }

    const toolUseBlocks = message.content.filter((block) => {
      return block.type === "tool_use";
    });

    if (message.role === "assistant" && toolUseBlocks.length > 0) {
      return {
        role: "assistant" as const,
        content: message.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n"),
        toolCalls: toolUseBlocks.map((block) => ({
          id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input)
        }))
      };
    }

    const toolResultBlocks = message.content.filter((block) => {
      return block.type === "tool_result";
    });

    if (message.role === "user" && toolResultBlocks.length > 0) {
      return {
        role: "tool" as const,
        content: toolResultBlocks.map((block) => block.content).join("\n"),
        toolCallId: toolResultBlocks[0]?.tool_use_id ?? ""
      };
    }

    return {
      role: message.role,
      content: message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
    };
  });

  return {
    model: request.model,
    stream: request.stream,
    ...(request.metadata !== undefined
      ? {
          providerMetadata: {
            anthropic: {
              user_id: request.metadata.user_id
            }
          }
        }
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
    messages: [...systemMessages, ...messages]
  };
}

export function encodeCanonicalToOpenAIChatStreamChunk(
  event: CanonicalStreamEvent,
  streamId: string
) {
  if (event.type === "response_started") {
    return {
      id: streamId,
      object: "chat.completion.chunk" as const,
      created: 0,
      model: event.model,
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
    return {
      id: streamId,
      object: "chat.completion.chunk" as const,
      created: 0,
      model: event.model,
      choices: [
        {
          index: 0,
          delta: {
            content: event.delta
          },
          finish_reason: null
        }
      ]
    };
  }

  if (event.type === "tool_call_delta") {
    return {
      id: streamId,
      object: "chat.completion.chunk" as const,
      created: 0,
      model: event.model,
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

  return {
    id: streamId,
    object: "chat.completion.chunk" as const,
    created: 0,
    model: event.model,
    ...(event.usage ? { usage: encodeCanonicalUsage(event.usage) } : {}),
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: encodeCanonicalOpenAIFinishReason(event.finishReason)
      }
    ]
  };
}

export function encodeCanonicalToOpenAIChatResponse(
  response: CanonicalResponse
) {
  return {
    id: response.id,
    object: "chat.completion",
    created: 0,
    model: response.model,
    ...(response.usage ? { usage: encodeCanonicalUsage(response.usage) } : {}),
    choices: [
      {
        index: 0,
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
  const output = [
    ...(response.outputText.length > 0
      ? [
          createOpenAIResponsesOutputMessage(
            response.id,
            response.outputText,
            "completed",
            true
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
    created_at: 0,
    model: response.model,
    status: encodeCanonicalResponsesStatus(response.finishReason),
    ...(encodeCanonicalResponsesIncompleteDetails(response.finishReason)
      ? {
          incomplete_details: encodeCanonicalResponsesIncompleteDetails(
            response.finishReason
          )
        }
      : {}),
    parallel_tool_calls: true,
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
  state: OpenAIResponsesEventEncodingState
): OpenAIResponsesEncodedEventBatch {
  const itemId = `${event.responseId}_output_0`;

  if (event.type === "response_started") {
    const baseResponse = createOpenAIResponsesBaseResponse(
      event.responseId,
      event.model,
      "in_progress"
    );

    return {
      events: [
        {
          type: "response.created" as const,
          sequence_number: state.sequenceNumber,
          response: baseResponse
        },
        {
          type: "response.in_progress" as const,
          sequence_number: state.sequenceNumber + 1,
          response: baseResponse
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
            output_index: state.outputIndex,
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
            output_index: state.outputIndex,
            content_index: state.contentIndex,
            part: createOpenAIResponsesOutputTextPart("")
          },
          {
            type: "response.output_text.delta" as const,
            sequence_number: state.sequenceNumber + 2,
            item_id: itemId,
            output_index: state.outputIndex,
            content_index: state.contentIndex,
            delta: event.delta,
            logprobs: []
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
          output_index: state.outputIndex,
          content_index: state.contentIndex,
          delta: event.delta,
          logprobs: []
        }
      ],
      nextSequenceNumber: state.sequenceNumber + 1
    };
  }

  if (event.type === "tool_call_delta") {
    const functionCallItem = createOpenAIResponsesFunctionCallItem(
      event.responseId,
      event.toolCallId,
      event.toolName ?? state.toolCallName,
      (state.toolCallArguments ?? "") + event.argumentsDelta
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
            item: functionCallItem
          },
          {
            type: "response.function_call_arguments.delta" as const,
            sequence_number: state.sequenceNumber + 1,
            item_id: functionCallItem.call_id,
            output_index: state.outputIndex,
            delta: event.argumentsDelta
          }
        ],
        nextSequenceNumber: state.sequenceNumber + 2
      };
    }

    return {
      events: [
        {
          type: "response.function_call_arguments.delta" as const,
          sequence_number: state.sequenceNumber,
          item_id: functionCallItem.call_id,
          output_index: state.outputIndex,
          delta: event.argumentsDelta
        }
      ],
      nextSequenceNumber: state.sequenceNumber + 1
    };
  }

  const outputText = state.outputText ?? "";
  const responseStatus = encodeCanonicalResponsesStatus(event.finishReason);
  const isToolCallCompletion = event.finishReason === "tool_calls";
  const completedResponse = {
    ...createOpenAIResponsesBaseResponse(
      event.responseId,
      event.model,
      responseStatus === "incomplete" ? "completed" : responseStatus
    ),
    status: responseStatus,
    ...(encodeCanonicalResponsesIncompleteDetails(event.finishReason)
      ? {
          incomplete_details: encodeCanonicalResponsesIncompleteDetails(
            event.finishReason
          )
        }
      : {}),
    output: isToolCallCompletion
      ? [
          createOpenAIResponsesFunctionCallItem(
            event.responseId,
            state.toolCallId,
            state.toolCallName,
            state.toolCallArguments
          )
        ]
      : [
          createOpenAIResponsesOutputMessage(
            event.responseId,
            outputText,
            "completed",
            true
          )
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
    const textCompletionEvents =
      outputText.length > 0 && state.startedTextOutput
        ? [
            {
              type: "response.output_text.done" as const,
              sequence_number: state.sequenceNumber,
              item_id: itemId,
              output_index: 0,
              content_index: state.contentIndex,
              text: outputText,
              logprobs: []
            },
            {
              type: "response.content_part.done" as const,
              sequence_number: state.sequenceNumber + 1,
              item_id: itemId,
              output_index: 0,
              content_index: state.contentIndex,
              part: createOpenAIResponsesOutputTextPart(outputText)
            },
            {
              type: "response.output_item.done" as const,
              sequence_number: state.sequenceNumber + 2,
              output_index: 0,
              item: createOpenAIResponsesOutputMessage(
                event.responseId,
                outputText,
                "completed",
                true
              )
            }
          ]
        : [];
    const toolSequenceStart = state.sequenceNumber + textCompletionEvents.length;

    return {
      events: [
        ...textCompletionEvents,
        ...completedToolCalls.flatMap((toolCall, index) => {
          const functionCallItem = createOpenAIResponsesFunctionCallItem(
            event.responseId,
            toolCall.toolCallId,
            toolCall.toolCallName,
            toolCall.toolCallArguments
          );
          const eventSequenceBase = toolSequenceStart + index * 2;

          return [
            {
              type: "response.function_call_arguments.done" as const,
              sequence_number: eventSequenceBase,
              item_id: functionCallItem.call_id,
              output_index: toolCall.outputIndex,
              arguments: functionCallItem.arguments
            },
            {
              type: "response.output_item.done" as const,
              sequence_number: eventSequenceBase + 1,
              output_index: toolCall.outputIndex,
              item: functionCallItem
            }
          ];
        }),
        {
          type: "response.completed" as const,
          sequence_number:
            toolSequenceStart + completedToolCalls.length * 2,
          response: {
            ...completedResponse,
            output: [
              ...(outputText.length > 0
                ? [
                    createOpenAIResponsesOutputMessage(
                      event.responseId,
                      outputText,
                      "completed",
                      true
                    )
                  ]
                : []),
              ...completedToolCalls.map((toolCall) => {
                return createOpenAIResponsesFunctionCallItem(
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
        toolSequenceStart + completedToolCalls.length * 2 + 1
    };
  }

  return {
    events: [
      {
        type: "response.output_text.done" as const,
        sequence_number: state.sequenceNumber,
        item_id: itemId,
        output_index: state.outputIndex,
        content_index: state.contentIndex,
        text: outputText,
        logprobs: []
      },
      {
        type: "response.content_part.done" as const,
        sequence_number: state.sequenceNumber + 1,
        item_id: itemId,
        output_index: state.outputIndex,
        content_index: state.contentIndex,
        part: createOpenAIResponsesOutputTextPart(outputText)
      },
      {
        type: "response.output_item.done" as const,
        sequence_number: state.sequenceNumber + 2,
        output_index: state.outputIndex,
        item: createOpenAIResponsesOutputMessage(
          event.responseId,
          outputText,
          "completed",
          true
        )
      },
      {
        type: "response.completed" as const,
        sequence_number: state.sequenceNumber + 3,
        response: completedResponse
      }
    ],
    nextSequenceNumber: state.sequenceNumber + 4
  };
}

export function encodeCanonicalToAnthropicMessagesResponse(
  response: CanonicalResponse
) {
  const toolUseContent =
    response.toolCalls?.map((toolCall) => ({
      type: "tool_use" as const,
      id: toolCall.id,
      name: toolCall.name,
      input: JSON.parse(toolCall.arguments) as Record<string, unknown>
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

  if (event.type === "tool_call_delta") {
    const toolIndex = event.toolIndex;
    const toolBlockIndex = state.startedTextBlock ? toolIndex + 1 : toolIndex;
    const encodedToolStartNeeded = !state.startedToolBlocks.includes(toolBlockIndex);

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
