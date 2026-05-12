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

export function normalizeOpenAIChatRequest(
  request: OpenAIChatCompletionRequest
): CanonicalRequest {
  return {
    model: request.model,
    stream: request.stream,
    messages: request.messages.map((message) => ({
      role: message.role,
      content: message.content
    }))
  };
}

export function normalizeOpenAIResponsesRequest(
  request: OpenAIResponsesRequest
): CanonicalRequest {
  const messages =
    typeof request.input === "string"
      ? [{ role: "user" as const, content: request.input }]
      : request.input.map((message) => ({
          role: message.role,
          content: message.content
        }));

  return {
    model: request.model,
    stream: request.stream,
    messages
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
    stream: false,
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
    output: [],
    output_text: response.outputText
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
      status: "completed" as const
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
    content: [
      {
        type: "text",
        text: response.outputText
      }
    ]
  };
}
