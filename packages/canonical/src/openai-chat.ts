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
  )[]
>[number];

interface OpenAIResponsesEventEncodingState {
  sequenceNumber: number;
  outputIndex: number;
  contentIndex: number;
  outputText?: string;
}

interface OpenAIResponsesEncodedEventBatch {
  events: unknown[];
  nextSequenceNumber: number;
}

function encodeCanonicalOpenAIFinishReason(
  finishReason: CanonicalResponse["finishReason"]
) {
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
    (input[0].type === "message" || input[0].type === "input_text")
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

  return {
    model: request.model,
    stream: request.stream,
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
    ...(request.tool_choice !== undefined
      ? { toolChoice: request.tool_choice }
      : {}),
    messages: request.messages.map((message) => ({
      role: message.role === "developer" ? "system" : message.role,
      content:
        typeof message.content === "string"
          ? message.content
          : message.content.map((part) => part.text).join("\n")
    }))
  };
}

export function normalizeOpenAIResponsesRequest(
  request: OpenAIResponsesRequest
): CanonicalRequest {
  const inputMessages =
    typeof request.input === "string"
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

  return {
    model: request.model,
    stream: request.stream,
    ...(request.max_output_tokens !== undefined
      ? { maxOutputTokens: request.max_output_tokens }
      : {}),
    ...(request.temperature !== undefined
      ? { temperature: request.temperature }
      : {}),
    ...(request.top_p !== undefined ? { topP: request.top_p } : {}),
    messages: [...instructionMessages, ...inputMessages]
  };
}

export function normalizeAnthropicMessagesRequest(
  request: AnthropicMessagesRequest
): CanonicalRequest {
  const systemMessages = request.system
    ? [{ role: "system" as const, content: request.system }]
    : [];
  const messages = request.messages.map((message) => ({
    role: message.role,
    content:
      typeof message.content === "string"
        ? message.content
        : message.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n")
  }));

  return {
    model: request.model,
    stream: request.stream,
    maxOutputTokens: request.max_tokens,
    ...(request.temperature !== undefined
      ? { temperature: request.temperature }
      : {}),
    ...(request.top_p !== undefined ? { topP: request.top_p } : {}),
    ...(request.stop_sequences !== undefined
      ? { stopSequences: request.stop_sequences }
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
                content: null,
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
    output: [
      createOpenAIResponsesOutputMessage(
        response.id,
        response.outputText,
        "completed",
        true
      )
    ],
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
        },
        {
          type: "response.output_item.added" as const,
          sequence_number: state.sequenceNumber + 2,
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
          sequence_number: state.sequenceNumber + 3,
          item_id: itemId,
          output_index: state.outputIndex,
          content_index: state.contentIndex,
          part: createOpenAIResponsesOutputTextPart("")
        }
      ],
      nextSequenceNumber: state.sequenceNumber + 4
    };
  }

  if (event.type === "output_text_delta") {
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

  const outputText = state.outputText ?? "";
  const responseStatus = encodeCanonicalResponsesStatus(event.finishReason);
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
    output: [
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
    content: [
      {
        type: "text",
        text: response.outputText
      }
    ]
  };
}

export function encodeCanonicalToAnthropicMessagesStreamEvents(
  event: CanonicalStreamEvent
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
      },
      {
        type: "content_block_start" as const,
        index: 0,
        content_block: {
          type: "text" as const,
          text: ""
        }
      }
    ];
  }

  if (event.type === "output_text_delta") {
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

  return [
    {
      type: "content_block_stop" as const,
      index: 0
    },
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
