import { describe, expect, it } from "vitest";

import { createOpenAIChatRequestFixture } from "@airlock/testing";

import {
  openAIChatCompletionRequestSchema,
  openAIChatMessageSchema
} from "./openai-chat.js";
import {
  openAIResponsesRequestSchema,
  openAIResponsesResponseSchema
} from "./responses.js";
import {
  anthropicMessagesRequestSchema,
  anthropicMessagesResponseSchema
} from "./anthropic-messages.js";

describe("openAIChatMessageSchema", () => {
  it("accepts a valid text message", () => {
    const parsed = openAIChatMessageSchema.parse({
      role: "user",
      content: "hello"
    });

    expect(parsed.role).toBe("user");
  });

  it("rejects malformed content", () => {
    const result = openAIChatMessageSchema.safeParse({
      role: "user",
      content: 42
    });

    expect(result.success).toBe(false);
  });
});

describe("openAIChatCompletionRequestSchema", () => {
  it("accepts a non-streaming chat completions request", () => {
    const fixture = createOpenAIChatRequestFixture();

    const parsed = openAIChatCompletionRequestSchema.parse(fixture);

    expect(parsed.stream).toBe(false);
    expect(parsed.messages).toHaveLength(2);
  });

  it("accepts an optional airlock request shaping extension", () => {
    const parsed = openAIChatCompletionRequestSchema.parse({
      model: "gpt-4.1-mini",
      stream: false,
      messages: [
        {
          role: "user",
          content: "hello"
        }
      ],
      airlock: {
        requestShaping: {
          headers: {
            "openai-beta": "responses=v1"
          }
        }
      }
    });

    expect(parsed.airlock?.requestShaping).toEqual({
      headers: {
        "openai-beta": "responses=v1"
      }
    });
  });

  it("accepts a streaming chat completions request", () => {
    const parsed = openAIChatCompletionRequestSchema.parse({
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

    expect(parsed.stream).toBe(true);
    expect(parsed.max_tokens).toBe(128);
  });

  it("accepts chat completion messages with text content parts", () => {
    const parsed = openAIChatCompletionRequestSchema.parse({
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

    expect(parsed.messages).toHaveLength(1);
  });

  it("accepts chat completion developer-role messages", () => {
    const parsed = openAIChatCompletionRequestSchema.parse({
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

    expect(parsed.messages[0]?.role).toBe("developer");
  });

  it("accepts max_completion_tokens for chat completions requests", () => {
    const parsed = openAIChatCompletionRequestSchema.parse({
      model: "gpt-4.1-mini",
      stream: false,
      max_completion_tokens: 128,
      messages: [
        {
          role: "user",
          content: "hello"
        }
      ]
    });

    expect(parsed.max_completion_tokens).toBe(128);
  });
});

describe("openAIResponsesRequestSchema", () => {
  it("accepts a simple string input request", () => {
    const parsed = openAIResponsesRequestSchema.parse({
      model: "gpt-4.1-mini",
      input: "hello",
      stream: false
    });

    expect(parsed.input).toBe("hello");
  });

  it("accepts an array of minimal input messages", () => {
    const parsed = openAIResponsesRequestSchema.parse({
      model: "gpt-4.1-mini",
      stream: false,
      input: [
        {
          role: "user",
          content: "hello"
        }
      ]
    });

    expect(Array.isArray(parsed.input)).toBe(true);
  });

  it("accepts an array of input messages with text content blocks", () => {
    const parsed = openAIResponsesRequestSchema.parse({
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

    expect(Array.isArray(parsed.input)).toBe(true);
  });

  it("accepts responses input messages with developer role", () => {
    const parsed = openAIResponsesRequestSchema.parse({
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

    expect(Array.isArray(parsed.input)).toBe(true);
  });

  it("accepts an optional airlock request shaping extension", () => {
    const parsed = openAIResponsesRequestSchema.parse({
      model: "gpt-4.1-mini",
      input: "hello",
      stream: false,
      airlock: {
        requestShaping: {
          query: {
            trace: "1"
          }
        }
      }
    });

    expect(parsed.airlock?.requestShaping).toEqual({
      query: {
        trace: "1"
      }
    });
  });

  it("accepts top-level responses instructions", () => {
    const parsed = openAIResponsesRequestSchema.parse({
      model: "gpt-4.1-mini",
      input: "hello",
      instructions: "Be concise.",
      stream: false
    });

    expect(parsed.instructions).toBe("Be concise.");
  });

  it("accepts top-level responses input_text item arrays", () => {
    const parsed = openAIResponsesRequestSchema.parse({
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

    expect(Array.isArray(parsed.input)).toBe(true);
  });

  it("accepts a streaming responses request", () => {
    const parsed = openAIResponsesRequestSchema.parse({
      model: "gpt-4.1-mini",
      input: "hello",
      stream: true,
      max_output_tokens: 96
    });

    expect(parsed.stream).toBe(true);
    expect(parsed.max_output_tokens).toBe(96);
  });
});

describe("openAIResponsesResponseSchema", () => {
  it("accepts a minimal response payload", () => {
    const parsed = openAIResponsesResponseSchema.parse({
      id: "resp_123",
      object: "response",
      model: "gpt-4.1-mini",
      status: "completed",
      output: [],
      output_text: "hello"
    });

    expect(parsed.object).toBe("response");
  });
});

describe("anthropicMessagesRequestSchema", () => {
  it("accepts a minimal anthropic messages request", () => {
    const parsed = anthropicMessagesRequestSchema.parse({
      model: "claude-sonnet-4-5",
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: "hello"
        }
      ]
    });

    expect(parsed.messages).toHaveLength(1);
  });

  it("accepts a streaming anthropic messages request", () => {
    const parsed = anthropicMessagesRequestSchema.parse({
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

    expect(parsed.stream).toBe(true);
  });

  it("accepts an optional airlock request shaping extension", () => {
    const parsed = anthropicMessagesRequestSchema.parse({
      model: "claude-sonnet-4-5",
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: "hello"
        }
      ],
      airlock: {
        requestShaping: {
          jsonBody: {
            metadata: {
              source: "request"
            }
          }
        }
      }
    });

    expect(parsed.airlock?.requestShaping).toEqual({
      jsonBody: {
        metadata: {
          source: "request"
        }
      }
    });
  });
});

describe("anthropicMessagesResponseSchema", () => {
  it("accepts a minimal anthropic messages response", () => {
    const parsed = anthropicMessagesResponseSchema.parse({
      id: "msg_123",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-5",
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: "hello there"
        }
      ]
    });

    expect(parsed.type).toBe("message");
  });
});
