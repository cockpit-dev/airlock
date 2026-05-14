import { describe, expect, it } from "vitest";

import { createOpenAIChatRequestFixture } from "@airlock/testing";

import {
  encodeCanonicalToAnthropicMessagesResponse,
  encodeCanonicalToOpenAIResponsesResponse,
  encodeCanonicalToOpenAIChatResponse,
  normalizeAnthropicMessagesRequest,
  normalizeOpenAIResponsesRequest,
  normalizeOpenAIChatRequest
} from "./openai-chat.js";

describe("normalizeOpenAIChatRequest", () => {
  it("normalizes an OpenAI chat request into a canonical request", () => {
    const fixture = createOpenAIChatRequestFixture();

    const canonical = normalizeOpenAIChatRequest(fixture);

    expect(canonical.model).toBe("gpt-4.1-mini");
    expect(canonical.messages).toHaveLength(2);
    expect(canonical.messages[0]?.role).toBe("system");
  });

  it("preserves streaming intent while normalizing an OpenAI chat request", () => {
    const canonical = normalizeOpenAIChatRequest({
      model: "gpt-4.1-mini",
      stream: true,
      max_tokens: 128,
      messages: [
        {
          role: "user",
          content: "hello"
        }
      ]
    });

    expect(canonical.stream).toBe(true);
    expect(canonical.maxOutputTokens).toBe(128);
  });

  it("flattens openai chat text content parts into canonical text", () => {
    const canonical = normalizeOpenAIChatRequest({
      model: "gpt-4.1-mini",
      stream: false,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "hello"
            },
            {
              type: "text",
              text: "there"
            }
          ]
        }
      ]
    });

    expect(canonical.messages).toEqual([
      { role: "user", content: "hello\nthere" }
    ]);
  });
});

describe("encodeCanonicalToOpenAIChatResponse", () => {
  it("encodes a canonical response into an OpenAI-compatible response", () => {
    const encoded = encodeCanonicalToOpenAIChatResponse({
      id: "resp_123",
      model: "gpt-4.1-mini",
      outputText: "hello there",
      finishReason: "stop",
      usage: {
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20
      }
    });

    expect(encoded.object).toBe("chat.completion");
    expect(encoded.model).toBe("gpt-4.1-mini");
    expect(encoded.choices[0]?.message.content).toBe("hello there");
    expect(encoded.usage).toEqual({
      prompt_tokens: 12,
      completion_tokens: 8,
      total_tokens: 20
    });
  });
});

describe("encodeCanonicalToOpenAIChatStreamChunk", () => {
  it("encodes a response_started event into an assistant role chunk", async () => {
    const { encodeCanonicalToOpenAIChatStreamChunk } = await import(
      "./openai-chat.js"
    );

    expect(
      encodeCanonicalToOpenAIChatStreamChunk(
        {
          type: "response_started",
          responseId: "resp_123",
          model: "gpt-4.1-mini"
        },
        "chatcmpl-stream-123"
      )
    ).toEqual({
      id: "chatcmpl-stream-123",
      object: "chat.completion.chunk",
      created: 0,
      model: "gpt-4.1-mini",
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant"
          },
          finish_reason: null
        }
      ]
    });
  });

  it("encodes an output_text_delta event into a content delta chunk", async () => {
    const { encodeCanonicalToOpenAIChatStreamChunk } = await import(
      "./openai-chat.js"
    );

    expect(
      encodeCanonicalToOpenAIChatStreamChunk(
        {
          type: "output_text_delta",
          responseId: "resp_123",
          model: "gpt-4.1-mini",
          delta: "hel"
        },
        "chatcmpl-stream-123"
      )
    ).toEqual({
      id: "chatcmpl-stream-123",
      object: "chat.completion.chunk",
      created: 0,
      model: "gpt-4.1-mini",
      choices: [
        {
          index: 0,
          delta: {
            content: "hel"
          },
          finish_reason: null
        }
      ]
    });
  });

  it("encodes a response_completed event into a finish chunk", async () => {
    const { encodeCanonicalToOpenAIChatStreamChunk } = await import(
      "./openai-chat.js"
    );

    expect(
      encodeCanonicalToOpenAIChatStreamChunk(
        {
          type: "response_completed",
          responseId: "resp_123",
          model: "gpt-4.1-mini",
          finishReason: "stop",
          usage: {
            inputTokens: 12,
            outputTokens: 8,
            totalTokens: 20
          }
        },
        "chatcmpl-stream-123"
      )
    ).toEqual({
      id: "chatcmpl-stream-123",
      object: "chat.completion.chunk",
      created: 0,
      model: "gpt-4.1-mini",
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: "stop"
        }
      ],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 8,
        total_tokens: 20
      }
    });
  });
});

describe("normalizeOpenAIResponsesRequest", () => {
  it("normalizes a string input responses request into a canonical request", () => {
    const canonical = normalizeOpenAIResponsesRequest({
      model: "gpt-4.1-mini",
      input: "hello",
      stream: false
    });

    expect(canonical.model).toBe("gpt-4.1-mini");
    expect(canonical.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("flattens openai responses text content blocks into canonical text", () => {
    const canonical = normalizeOpenAIResponsesRequest({
      model: "gpt-4.1-mini",
      stream: false,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "hello"
            },
            {
              type: "input_text",
              text: "there"
            }
          ]
        }
      ]
    });

    expect(canonical.messages).toEqual([
      { role: "user", content: "hello\nthere" }
    ]);
  });

  it("preserves streaming intent for a responses request", () => {
    const canonical = normalizeOpenAIResponsesRequest({
      model: "gpt-4.1-mini",
      input: "hello",
      stream: true,
      max_output_tokens: 96
    });

    expect(canonical.stream).toBe(true);
    expect(canonical.maxOutputTokens).toBe(96);
  });
});

describe("encodeCanonicalToOpenAIResponsesResponse", () => {
  it("encodes a canonical response into an OpenAI responses payload", () => {
    const encoded = encodeCanonicalToOpenAIResponsesResponse({
      id: "resp_123",
      model: "gpt-4.1-mini",
      outputText: "hello there",
      finishReason: "stop",
      usage: {
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20
      }
    });

    expect(encoded.object).toBe("response");
    expect(encoded.output_text).toBe("hello there");
    expect(encoded.output).toEqual([
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "hello there"
          }
        ]
      }
    ]);
    expect(encoded.usage).toEqual({
      input_tokens: 12,
      output_tokens: 8,
      total_tokens: 20
    });
  });
});

describe("encodeCanonicalToOpenAIResponsesStreamEvent", () => {
  it("encodes a response_started event into a response.created event", async () => {
    const { encodeCanonicalToOpenAIResponsesStreamEvent } = await import(
      "./openai-chat.js"
    );

    expect(
      encodeCanonicalToOpenAIResponsesStreamEvent({
        type: "response_started",
        responseId: "resp_123",
        model: "gpt-4.1-mini"
      })
    ).toEqual({
      type: "response.created",
      response: {
        id: "resp_123",
        object: "response",
        model: "gpt-4.1-mini"
      }
    });
  });

  it("encodes an output_text_delta event into a responses delta event", async () => {
    const { encodeCanonicalToOpenAIResponsesStreamEvent } = await import(
      "./openai-chat.js"
    );

    expect(
      encodeCanonicalToOpenAIResponsesStreamEvent({
        type: "output_text_delta",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        delta: "hel"
      })
    ).toEqual({
      type: "response.output_text.delta",
      response_id: "resp_123",
      delta: "hel"
    });
  });

  it("encodes a response_completed event into a response.completed event", async () => {
    const { encodeCanonicalToOpenAIResponsesStreamEvent } = await import(
      "./openai-chat.js"
    );

    expect(
      encodeCanonicalToOpenAIResponsesStreamEvent({
        type: "response_completed",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        finishReason: "stop",
        usage: {
          inputTokens: 12,
          outputTokens: 8,
          totalTokens: 20
        }
      })
    ).toEqual({
      type: "response.completed",
      response: {
        id: "resp_123",
        object: "response",
        model: "gpt-4.1-mini",
        status: "completed",
        usage: {
          input_tokens: 12,
          output_tokens: 8,
          total_tokens: 20
        }
      }
    });
  });
});

describe("normalizeAnthropicMessagesRequest", () => {
  it("normalizes system plus user messages into canonical messages", () => {
    const canonical = normalizeAnthropicMessagesRequest({
      model: "claude-sonnet-4-5",
      max_tokens: 256,
      stream: false,
      system: "You are precise.",
      messages: [
        {
          role: "user",
          content: "hello"
        }
      ]
    });

    expect(canonical.messages).toEqual([
      { role: "system", content: "You are precise." },
      { role: "user", content: "hello" }
    ]);
  });

  it("preserves streaming intent for anthropic messages requests", () => {
    const canonical = normalizeAnthropicMessagesRequest({
      model: "claude-sonnet-4-5",
      max_tokens: 256,
      stream: true,
      messages: [
        {
          role: "user",
          content: "hello"
        }
      ]
    });

    expect(canonical.stream).toBe(true);
    expect(canonical.maxOutputTokens).toBe(256);
  });
});

describe("encodeCanonicalToAnthropicMessagesResponse", () => {
  it("encodes a canonical response into an Anthropic message payload", () => {
    const encoded = encodeCanonicalToAnthropicMessagesResponse({
      id: "msg_123",
      model: "claude-sonnet-4-5",
      outputText: "hello there",
      finishReason: "stop",
      usage: {
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20
      }
    });

    expect(encoded.type).toBe("message");
    expect(encoded.content[0]?.text).toBe("hello there");
    expect(encoded.stop_sequence).toBeNull();
    expect(encoded.usage).toEqual({
      input_tokens: 12,
      output_tokens: 8
    });
  });
});

describe("encodeCanonicalToAnthropicMessagesStreamEvents", () => {
  it("encodes a response_started event into message_start and content_block_start events", async () => {
    const { encodeCanonicalToAnthropicMessagesStreamEvents } = await import(
      "./openai-chat.js"
    );

    expect(
      encodeCanonicalToAnthropicMessagesStreamEvents({
        type: "response_started",
        responseId: "msg_123",
        model: "claude-sonnet-4-5"
      })
    ).toEqual([
      {
        type: "message_start",
        message: {
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-5"
        }
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "text",
          text: ""
        }
      }
    ]);
  });

  it("encodes an output_text_delta event into a content_block_delta event", async () => {
    const { encodeCanonicalToAnthropicMessagesStreamEvents } = await import(
      "./openai-chat.js"
    );

    expect(
      encodeCanonicalToAnthropicMessagesStreamEvents({
        type: "output_text_delta",
        responseId: "msg_123",
        model: "claude-sonnet-4-5",
        delta: "hel"
      })
    ).toEqual([
      {
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "text_delta",
          text: "hel"
        }
      }
    ]);
  });

  it("encodes a response_completed event into content_block_stop, message_delta, and message_stop events", async () => {
    const { encodeCanonicalToAnthropicMessagesStreamEvents } = await import(
      "./openai-chat.js"
    );

    expect(
      encodeCanonicalToAnthropicMessagesStreamEvents({
        type: "response_completed",
        responseId: "msg_123",
        model: "claude-sonnet-4-5",
        finishReason: "stop",
        usage: {
          inputTokens: 12,
          outputTokens: 8,
          totalTokens: 20
        }
      })
    ).toEqual([
      {
        type: "content_block_stop",
        index: 0
      },
      {
        type: "message_delta",
        delta: {
          stop_reason: "end_turn",
          stop_sequence: null
        },
        usage: {
          input_tokens: 12,
          output_tokens: 8
        }
      },
      {
        type: "message_stop"
      }
    ]);
  });
});
