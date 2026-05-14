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

  return {
    model: request.model,
    stream: request.stream,
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
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
        finish_reason: event.finishReason
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
        finish_reason: response.finishReason,
        message: {
          role: "assistant",
          content: response.outputText
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
    model: response.model,
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: response.outputText
          }
        ]
      }
    ],
    output_text: response.outputText,
    ...(response.usage
      ? { usage: encodeCanonicalResponsesUsage(response.usage) }
      : {})
  };
}

export function encodeCanonicalToOpenAIResponsesStreamEvent(
  event: CanonicalStreamEvent
) {
  if (event.type === "response_started") {
    return {
      type: "response.created" as const,
      response: {
        id: event.responseId,
        object: "response" as const,
        model: event.model
      }
    };
  }

  if (event.type === "output_text_delta") {
    return {
      type: "response.output_text.delta" as const,
      response_id: event.responseId,
      delta: event.delta
    };
  }

  return {
    type: "response.completed" as const,
    response: {
      id: event.responseId,
      object: "response" as const,
      model: event.model,
      status: "completed" as const,
      ...(event.usage
        ? { usage: encodeCanonicalResponsesUsage(event.usage) }
        : {})
    }
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
    stop_reason: "end_turn",
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
        stop_reason: "end_turn" as const,
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
