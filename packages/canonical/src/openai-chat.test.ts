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

  it("maps openai chat developer role to canonical system", () => {
    const canonical = normalizeOpenAIChatRequest({
      model: "gpt-4.1-mini",
      stream: false,
      messages: [
        {
          role: "developer",
          content: "You are precise."
        },
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

  it("prefers max_completion_tokens when normalizing chat token limits", () => {
    const canonical = normalizeOpenAIChatRequest({
      model: "gpt-4.1-mini",
      stream: false,
      max_tokens: 64,
      max_completion_tokens: 128,
      messages: [
        {
          role: "user",
          content: "hello"
        }
      ]
    });

    expect(canonical.maxOutputTokens).toBe(128);
  });

  it("normalizes chat sampling fields into canonical request fields", () => {
    const canonical = normalizeOpenAIChatRequest({
      model: "gpt-4.1-mini",
      stream: false,
      temperature: 0.8,
      top_p: 0.9,
      messages: [
        {
          role: "user",
          content: "hello"
        }
      ]
    });

    expect(canonical.temperature).toBe(0.8);
    expect(canonical.topP).toBe(0.9);
  });

  it("normalizes chat stop sequences into canonical request fields", () => {
    const canonicalSingle = normalizeOpenAIChatRequest({
      model: "gpt-4.1-mini",
      stream: false,
      stop: "\n\n",
      messages: [
        {
          role: "user",
          content: "hello"
        }
      ]
    });
    const canonicalMultiple = normalizeOpenAIChatRequest({
      model: "gpt-4.1-mini",
      stream: false,
      stop: ["END", "STOP"],
      messages: [
        {
          role: "user",
          content: "hello"
        }
      ]
    });

    expect(canonicalSingle.stopSequences).toEqual(["\n\n"]);
    expect(canonicalMultiple.stopSequences).toEqual(["END", "STOP"]);
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

  it("maps responses developer role to canonical system", () => {
    const canonical = normalizeOpenAIResponsesRequest({
      model: "gpt-4.1-mini",
      stream: false,
      input: [
        {
          role: "developer",
          content: "You are precise."
        },
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

  it("prepends responses instructions as a canonical system message", () => {
    const canonical = normalizeOpenAIResponsesRequest({
      model: "gpt-4.1-mini",
      stream: false,
      instructions: "Be concise.",
      input: "hello"
    });

    expect(canonical.messages).toEqual([
      { role: "system", content: "Be concise." },
      { role: "user", content: "hello" }
    ]);
  });

  it("flattens top-level responses input_text items into one canonical user message", () => {
    const canonical = normalizeOpenAIResponsesRequest({
      model: "gpt-4.1-mini",
      stream: false,
      input: [
        {
          type: "input_text",
          text: "hello"
        },
        {
          type: "input_text",
          text: "there"
        }
      ]
    });

    expect(canonical.messages).toEqual([
      { role: "user", content: "hello\nthere" }
    ]);
  });

  it("normalizes top-level responses message items into canonical messages", () => {
    const canonical = normalizeOpenAIResponsesRequest({
      model: "gpt-4.1-mini",
      stream: false,
      input: [
        {
          type: "message",
          role: "developer",
          content: [
            {
              type: "input_text",
              text: "You are precise."
            }
          ]
        },
        {
          type: "message",
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

  it("normalizes mixed typed responses items while preserving text turn order", () => {
    const canonical = normalizeOpenAIResponsesRequest({
      model: "gpt-4.1-mini",
      stream: false,
      input: [
        {
          type: "message",
          role: "developer",
          content: [
            {
              type: "input_text",
              text: "You are precise."
            }
          ]
        },
        {
          type: "input_text",
          text: "hello"
        },
        {
          type: "input_text",
          text: "again"
        },
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "hello there"
            }
          ]
        },
        {
          type: "input_text",
          text: "continue"
        }
      ]
    });

    expect(canonical.messages).toEqual([
      { role: "system", content: "You are precise." },
      { role: "user", content: "hello\nagain" },
      { role: "assistant", content: "hello there" },
      { role: "user", content: "continue" }
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

  it("normalizes responses sampling fields into canonical request fields", () => {
    const canonical = normalizeOpenAIResponsesRequest({
      model: "gpt-4.1-mini",
      input: "hello",
      stream: false,
      temperature: 0.7,
      top_p: 0.85
    });

    expect(canonical.temperature).toBe(0.7);
    expect(canonical.topP).toBe(0.85);
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
    expect(encoded.created_at).toBe(0);
    expect(encoded.parallel_tool_calls).toBe(true);
    expect(encoded.tools).toEqual([]);
    expect(encoded.output).toEqual([
      {
        id: "resp_123_output_0",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: "hello there",
            annotations: []
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
  it("encodes a response_started event into the official initial responses event sequence", async () => {
    const { encodeCanonicalToOpenAIResponsesStreamEvent } = await import(
      "./openai-chat.js"
    );

    expect(
      encodeCanonicalToOpenAIResponsesStreamEvent(
        {
          type: "response_started",
          responseId: "resp_123",
          model: "gpt-4.1-mini"
        },
        { sequenceNumber: 0, outputIndex: 0, contentIndex: 0 }
      )
    ).toEqual({
      events: [
        {
          type: "response.created",
          sequence_number: 0,
          response: {
            id: "resp_123",
            object: "response",
            created_at: 0,
            model: "gpt-4.1-mini",
            status: "in_progress",
            output: [],
            parallel_tool_calls: true,
            tools: []
          }
        },
        {
          type: "response.in_progress",
          sequence_number: 1,
          response: {
            id: "resp_123",
            object: "response",
            created_at: 0,
            model: "gpt-4.1-mini",
            status: "in_progress",
            output: [],
            parallel_tool_calls: true,
            tools: []
          }
        },
        {
          type: "response.output_item.added",
          sequence_number: 2,
          output_index: 0,
          item: {
            id: "resp_123_output_0",
            type: "message",
            role: "assistant",
            status: "in_progress",
            content: []
          }
        },
        {
          type: "response.content_part.added",
          sequence_number: 3,
          item_id: "resp_123_output_0",
          output_index: 0,
          content_index: 0,
          part: {
            type: "output_text",
            text: "",
            annotations: []
          }
        }
      ],
      nextSequenceNumber: 4
    });
  });

  it("encodes an output_text_delta event into a responses delta event", async () => {
    const { encodeCanonicalToOpenAIResponsesStreamEvent } = await import(
      "./openai-chat.js"
    );

    expect(
      encodeCanonicalToOpenAIResponsesStreamEvent(
        {
          type: "output_text_delta",
          responseId: "resp_123",
          model: "gpt-4.1-mini",
          delta: "hel"
        },
        { sequenceNumber: 4, outputIndex: 0, contentIndex: 0 }
      )
    ).toEqual({
      events: [
        {
          type: "response.output_text.delta",
          sequence_number: 4,
          item_id: "resp_123_output_0",
          output_index: 0,
          content_index: 0,
          delta: "hel",
          logprobs: []
        }
      ],
      nextSequenceNumber: 5
    });
  });

  it("encodes a response_completed event into the official terminal responses event sequence", async () => {
    const { encodeCanonicalToOpenAIResponsesStreamEvent } = await import(
      "./openai-chat.js"
    );

    expect(
      encodeCanonicalToOpenAIResponsesStreamEvent(
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
        {
          sequenceNumber: 5,
          outputIndex: 0,
          contentIndex: 0,
          outputText: "hello"
        }
      )
    ).toEqual({
      events: [
        {
          type: "response.output_text.done",
          sequence_number: 5,
          item_id: "resp_123_output_0",
          output_index: 0,
          content_index: 0,
          text: "hello",
          logprobs: []
        },
        {
          type: "response.content_part.done",
          sequence_number: 6,
          item_id: "resp_123_output_0",
          output_index: 0,
          content_index: 0,
          part: {
            type: "output_text",
            text: "hello",
            annotations: []
          }
        },
        {
          type: "response.output_item.done",
          sequence_number: 7,
          output_index: 0,
          item: {
            id: "resp_123_output_0",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: "hello",
                annotations: []
              }
            ]
          }
        },
        {
          type: "response.completed",
          sequence_number: 8,
          response: {
            id: "resp_123",
            object: "response",
            created_at: 0,
            model: "gpt-4.1-mini",
            status: "completed",
            output: [
              {
                id: "resp_123_output_0",
                type: "message",
                role: "assistant",
                status: "completed",
                content: [
                  {
                    type: "output_text",
                    text: "hello",
                    annotations: []
                  }
                ]
              }
            ],
            output_text: "hello",
            parallel_tool_calls: true,
            tools: [],
            usage: {
              input_tokens: 12,
              output_tokens: 8,
              total_tokens: 20
            }
          }
        }
      ],
      nextSequenceNumber: 9
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

  it("normalizes anthropic sampling fields into canonical request fields", () => {
    const canonical = normalizeAnthropicMessagesRequest({
      model: "claude-sonnet-4-5",
      max_tokens: 256,
      stream: false,
      temperature: 0.8,
      top_p: 0.95,
      messages: [
        {
          role: "user",
          content: "hello"
        }
      ]
    });

    expect(canonical.temperature).toBe(0.8);
    expect(canonical.topP).toBe(0.95);
  });

  it("normalizes anthropic stop_sequences into canonical request fields", () => {
    const canonical = normalizeAnthropicMessagesRequest({
      model: "claude-sonnet-4-5",
      max_tokens: 256,
      stream: false,
      stop_sequences: ["END", "STOP"],
      messages: [
        {
          role: "user",
          content: "hello"
        }
      ]
    });

    expect(canonical.stopSequences).toEqual(["END", "STOP"]);
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
