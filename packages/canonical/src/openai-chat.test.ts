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

  it("normalizes openai chat function tools into canonical request fields", () => {
    const canonical = normalizeOpenAIChatRequest({
      model: "gpt-4.1-mini",
      stream: false,
      tool_choice: "auto",
      tools: [
        {
          type: "function",
          function: {
            name: "lookup_weather",
            description: "Lookup weather by city",
            parameters: {
              type: "object",
              properties: {
                city: {
                  type: "string"
                }
              },
              required: ["city"]
            }
          }
        }
      ],
      messages: [
        {
          role: "user",
          content: "Weather in Shanghai?"
        }
      ]
    });

    expect(canonical.toolChoice).toBe("auto");
    expect(canonical.tools).toEqual([
      {
        name: "lookup_weather",
        description: "Lookup weather by city",
        inputSchema: {
          type: "object",
          properties: {
            city: {
              type: "string"
            }
          },
          required: ["city"]
        }
      }
    ]);
  });

  it("normalizes forced openai chat function tool_choice into canonical request fields", () => {
    const canonical = normalizeOpenAIChatRequest({
      model: "gpt-4.1-mini",
      stream: false,
      tool_choice: {
        type: "function",
        function: {
          name: "lookup_weather"
        }
      },
      tools: [
        {
          type: "function",
          function: {
            name: "lookup_weather",
            parameters: {
              type: "object"
            }
          }
        }
      ],
      messages: [
        {
          role: "user",
          content: "Weather in Shanghai?"
        }
      ]
    });

    expect(canonical.toolChoice).toEqual({
      type: "tool",
      name: "lookup_weather"
    });
  });

  it("normalizes openai chat required tool_choice into canonical request fields", () => {
    const canonical = normalizeOpenAIChatRequest({
      model: "gpt-4.1-mini",
      stream: false,
      tool_choice: "required",
      tools: [
        {
          type: "function",
          function: {
            name: "lookup_weather",
            parameters: {
              type: "object"
            }
          }
        }
      ],
      messages: [
        {
          role: "user",
          content: "Weather in Shanghai?"
        }
      ]
    });

    expect(canonical.toolChoice).toBe("required");
  });

  it("normalizes openai chat none tool_choice into canonical request fields", () => {
    const canonical = normalizeOpenAIChatRequest({
      model: "gpt-4.1-mini",
      stream: false,
      tool_choice: "none",
      tools: [
        {
          type: "function",
          function: {
            name: "lookup_weather",
            parameters: {
              type: "object"
            }
          }
        }
      ],
      messages: [
        {
          role: "user",
          content: "Weather in Shanghai?"
        }
      ]
    });

    expect(canonical.toolChoice).toBe("none");
  });

  it("normalizes chat parallel_tool_calls=false into canonical request fields", () => {
    const canonical = normalizeOpenAIChatRequest({
      model: "gpt-4.1-mini",
      stream: false,
      parallel_tool_calls: false,
      tools: [
        {
          type: "function",
          function: {
            name: "lookup_weather",
            parameters: {
              type: "object"
            }
          }
        }
      ],
      messages: [
        {
          role: "user",
          content: "hi"
        }
      ]
    });

    expect(canonical.allowParallelToolCalls).toBe(false);
  });

  it("normalizes assistant tool_calls and tool results into canonical message history", () => {
    const canonical = normalizeOpenAIChatRequest({
      model: "gpt-4.1-mini",
      stream: false,
      messages: [
        {
          role: "user",
          content: "Weather in Shanghai?"
        },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_123",
              type: "function",
              function: {
                name: "lookup_weather",
                arguments: "{\"city\":\"Shanghai\"}"
              }
            }
          ]
        },
        {
          role: "tool",
          tool_call_id: "call_123",
          content: "{\"temperature_c\":26}"
        }
      ]
    });

    expect(canonical.messages).toEqual([
      { role: "user", content: "Weather in Shanghai?" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call_123",
            name: "lookup_weather",
            arguments: "{\"city\":\"Shanghai\"}"
          }
        ]
      },
      {
        role: "tool",
        content: "{\"temperature_c\":26}",
        toolCallId: "call_123"
      }
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

  it("encodes a max_tokens canonical response into an OpenAI length finish reason", () => {
    const encoded = encodeCanonicalToOpenAIChatResponse({
      id: "resp_123",
      model: "gpt-4.1-mini",
      outputText: "hello there",
      finishReason: "max_tokens"
    });

    expect(encoded.choices[0]?.finish_reason).toBe("length");
  });

  it("encodes canonical tool calls into an OpenAI chat tool_calls response", () => {
    const encoded = encodeCanonicalToOpenAIChatResponse({
      id: "resp_123",
      model: "claude-sonnet-4-5",
      outputText: "",
      finishReason: "tool_calls",
      toolCalls: [
        {
          id: "toolu_123",
          name: "lookup_weather",
          arguments: "{\"city\":\"Shanghai\"}"
        }
      ]
    });

    expect(encoded.choices[0]?.finish_reason).toBe("tool_calls");
    expect(encoded.choices[0]?.message).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "toolu_123",
          type: "function",
          function: {
            name: "lookup_weather",
            arguments: "{\"city\":\"Shanghai\"}"
          }
        }
      ]
    });
  });

  it("preserves openai chat text when canonical response contains both text and tool calls", () => {
    const encoded = encodeCanonicalToOpenAIChatResponse({
      id: "resp_123",
      model: "claude-sonnet-4-5",
      outputText: "Let me check that.",
      finishReason: "tool_calls",
      toolCalls: [
        {
          id: "toolu_123",
          name: "lookup_weather",
          arguments: "{\"city\":\"Shanghai\"}"
        }
      ]
    });

    expect(encoded.choices[0]?.finish_reason).toBe("tool_calls");
    expect(encoded.choices[0]?.message).toEqual({
      role: "assistant",
      content: "Let me check that.",
      tool_calls: [
        {
          id: "toolu_123",
          type: "function",
          function: {
            name: "lookup_weather",
            arguments: "{\"city\":\"Shanghai\"}"
          }
        }
      ]
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

  it("encodes a tool_call_delta event into a tool_calls delta chunk", async () => {
    const { encodeCanonicalToOpenAIChatStreamChunk } = await import(
      "./openai-chat.js"
    );

    expect(
      encodeCanonicalToOpenAIChatStreamChunk(
        {
          type: "tool_call_delta",
          responseId: "resp_123",
          model: "gpt-4.1-mini",
          toolCallId: "call_123",
          toolIndex: 0,
          toolName: "lookup_weather",
          argumentsDelta: "{\"city\":\"Shang"
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
            tool_calls: [
              {
                index: 0,
                id: "call_123",
                type: "function",
                function: {
                  name: "lookup_weather",
                  arguments: "{\"city\":\"Shang"
                }
              }
            ]
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

  it("encodes a max_tokens completion event into an OpenAI length finish chunk", async () => {
    const { encodeCanonicalToOpenAIChatStreamChunk } = await import(
      "./openai-chat.js"
    );

    expect(
      encodeCanonicalToOpenAIChatStreamChunk(
        {
          type: "response_completed",
          responseId: "resp_123",
          model: "gpt-4.1-mini",
          finishReason: "max_tokens"
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
          finish_reason: "length"
        }
      ]
    });
  });

  it("encodes a tool_calls completion event into an OpenAI tool_calls finish chunk", async () => {
    const { encodeCanonicalToOpenAIChatStreamChunk } = await import(
      "./openai-chat.js"
    );

    expect(
      encodeCanonicalToOpenAIChatStreamChunk(
        {
          type: "response_completed",
          responseId: "resp_123",
          model: "gpt-4.1-mini",
          finishReason: "tool_calls"
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
          finish_reason: "tool_calls"
        }
      ]
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

  it("normalizes previous_response_id into canonical request fields", () => {
    const canonical = normalizeOpenAIResponsesRequest({
      model: "gpt-4.1-mini",
      input: "hello",
      stream: false,
      previous_response_id: "resp_123"
    });

    expect(canonical.previousResponseId).toBe("resp_123");
  });

  it("normalizes conversation into canonical request fields", () => {
    const canonical = normalizeOpenAIResponsesRequest({
      model: "gpt-4.1-mini",
      input: "hello",
      stream: false,
      conversation: "conv_123"
    });

    expect(canonical.conversationId).toBe("conv_123");
  });

  it("normalizes chat json_schema response_format into canonical output format", () => {
    const canonical = normalizeOpenAIChatRequest({
      model: "gpt-4.1-mini",
      stream: false,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "weather",
          schema: {
            type: "object"
          },
          strict: true
        }
      },
      messages: [
        {
          role: "user",
          content: "hello"
        }
      ]
    });

    expect(canonical.outputFormat).toEqual({
      type: "json_schema",
      name: "weather",
      schema: {
        type: "object"
      },
      strict: true
    });
  });

  it("normalizes chat json_object response_format into canonical output format", () => {
    const canonical = normalizeOpenAIChatRequest({
      model: "gpt-4.1-mini",
      stream: false,
      response_format: {
        type: "json_object"
      },
      messages: [
        {
          role: "user",
          content: "hello"
        }
      ]
    });

    expect(canonical.outputFormat).toEqual({
      type: "json_object"
    });
  });

  it("normalizes responses prompt and reasoning effort into canonical request fields", () => {
    const canonical = normalizeOpenAIResponsesRequest({
      model: "gpt-4.1-mini",
      prompt: {
        id: "pmpt_123",
        variables: {
          city: "Shanghai"
        },
        version: "7"
      },
      stream: false,
      reasoning: {
        effort: "medium"
      }
    });

    expect(canonical.prompt).toEqual({
      id: "pmpt_123",
      variables: {
        city: "Shanghai"
      },
      version: "7"
    });
    expect(canonical.reasoningEffort).toBe("medium");
    expect(canonical.messages).toEqual([]);
  });

  it("normalizes top-level responses prompt_id alias into canonical prompt fields", () => {
    const canonical = normalizeOpenAIResponsesRequest({
      model: "gpt-4.1-mini",
      prompt_id: "pmpt_legacy_123",
      stream: false
    });

    expect(canonical.prompt).toEqual({
      id: "pmpt_legacy_123"
    });
    expect(canonical.messages).toEqual([]);
  });

  it("normalizes responses reasoning summary controls into canonical request fields", () => {
    const canonical = normalizeOpenAIResponsesRequest({
      model: "gpt-4.1-mini",
      input: "hello",
      stream: false,
      reasoning: {
        effort: "low",
        summary: "auto"
      }
    });

    expect(canonical.reasoningEffort).toBe("low");
    expect(canonical.reasoningSummary).toBe("auto");
    expect(canonical.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("normalizes deprecated responses reasoning.generate_summary into canonical reasoningSummary", () => {
    const canonical = normalizeOpenAIResponsesRequest({
      model: "gpt-4.1-mini",
      input: "hello",
      stream: false,
      reasoning: {
        effort: "low",
        generate_summary: "concise"
      }
    });

    expect(canonical.reasoningEffort).toBe("low");
    expect(canonical.reasoningSummary).toBe("concise");
    expect(canonical.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("normalizes responses json_schema text format into canonical output format", () => {
    const canonical = normalizeOpenAIResponsesRequest({
      model: "gpt-4.1-mini",
      input: "hello",
      stream: false,
      text: {
        format: {
          type: "json_schema",
          name: "weather",
          schema: {
            type: "object"
          },
          strict: true
        }
      }
    });

    expect(canonical.outputFormat).toEqual({
      type: "json_schema",
      name: "weather",
      schema: {
        type: "object"
      },
      strict: true
    });
  });

  it("normalizes responses json_object text format into canonical output format", () => {
    const canonical = normalizeOpenAIResponsesRequest({
      model: "gpt-4.1-mini",
      input: "hello",
      stream: false,
      text: {
        format: {
          type: "json_object"
        }
      }
    });

    expect(canonical.outputFormat).toEqual({
      type: "json_object"
    });
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

  it("normalizes responses stop sequences into canonical request fields", () => {
    const canonicalSingle = normalizeOpenAIResponsesRequest({
      model: "gpt-4.1-mini",
      input: "hello",
      stream: false,
      stop: "\n\n"
    });
    const canonicalMultiple = normalizeOpenAIResponsesRequest({
      model: "gpt-4.1-mini",
      input: "hello",
      stream: false,
      stop: ["END", "STOP"]
    });

    expect(canonicalSingle.stopSequences).toEqual(["\n\n"]);
    expect(canonicalMultiple.stopSequences).toEqual(["END", "STOP"]);
  });

  it("normalizes responses function tools into canonical request fields", () => {
    const canonical = normalizeOpenAIResponsesRequest({
      model: "gpt-4.1-mini",
      input: "hello",
      stream: false,
      tool_choice: "auto",
      tools: [
        {
          type: "function",
          name: "lookup_weather",
          description: "Lookup weather by city",
          parameters: {
            type: "object",
            properties: {
              city: {
                type: "string"
              }
            },
            required: ["city"]
          }
        }
      ]
    });

    expect(canonical.tools).toEqual([
      {
        name: "lookup_weather",
        description: "Lookup weather by city",
        inputSchema: {
          type: "object",
          properties: {
            city: {
              type: "string"
            }
          },
          required: ["city"]
        }
      }
    ]);
    expect(canonical.toolChoice).toBe("auto");
  });

  it("normalizes forced responses function tool_choice into canonical request fields", () => {
    const canonical = normalizeOpenAIResponsesRequest({
      model: "gpt-4.1-mini",
      input: "hello",
      stream: false,
      tool_choice: {
        type: "function",
        name: "lookup_weather"
      },
      tools: [
        {
          type: "function",
          name: "lookup_weather",
          parameters: {
            type: "object"
          }
        }
      ]
    });

    expect(canonical.toolChoice).toEqual({
      type: "tool",
      name: "lookup_weather"
    });
  });

  it("normalizes responses required tool_choice into canonical request fields", () => {
    const canonical = normalizeOpenAIResponsesRequest({
      model: "gpt-4.1-mini",
      input: "hello",
      stream: false,
      tool_choice: "required",
      tools: [
        {
          type: "function",
          name: "lookup_weather",
          parameters: {
            type: "object"
          }
        }
      ]
    });

    expect(canonical.toolChoice).toBe("required");
  });

  it("normalizes responses none tool_choice into canonical request fields", () => {
    const canonical = normalizeOpenAIResponsesRequest({
      model: "gpt-4.1-mini",
      input: "hello",
      stream: false,
      tool_choice: "none",
      tools: [
        {
          type: "function",
          name: "lookup_weather",
          parameters: {
            type: "object"
          }
        }
      ]
    });

    expect(canonical.toolChoice).toBe("none");
  });

  it("normalizes responses parallel_tool_calls=false into canonical request fields", () => {
    const canonical = normalizeOpenAIResponsesRequest({
      model: "gpt-4.1-mini",
      input: "hello",
      stream: false,
      parallel_tool_calls: false,
      tools: [
        {
          type: "function",
          name: "lookup_weather",
          parameters: {
            type: "object"
          }
        }
      ]
    });

    expect(canonical.allowParallelToolCalls).toBe(false);
  });

  it("normalizes responses function_call replay and function_call_output into canonical tool history", () => {
    const canonical = normalizeOpenAIResponsesRequest({
      model: "gpt-4.1-mini",
      stream: false,
      input: [
        {
          type: "input_text",
          text: "Weather in Shanghai?"
        },
        {
          type: "function_call",
          call_id: "call_123",
          name: "lookup_weather",
          arguments: "{\"city\":\"Shanghai\"}"
        },
        {
          type: "function_call_output",
          call_id: "call_123",
          output: "{\"temperature_c\":26}"
        }
      ]
    });

    expect(canonical.messages).toEqual([
      { role: "user", content: "Weather in Shanghai?" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call_123",
            name: "lookup_weather",
            arguments: "{\"city\":\"Shanghai\"}"
          }
        ]
      },
      {
        role: "tool",
        content: "{\"temperature_c\":26}",
        toolCallId: "call_123"
      }
    ]);
  });

  it("normalizes responses reasoning replay items into canonical assistant history", () => {
    const canonical = normalizeOpenAIResponsesRequest({
      model: "gpt-4.1-mini",
      stream: false,
      input: [
        {
          type: "reasoning",
          id: "rs_123",
          encrypted_content: "enc_123",
          summary: [
            {
              type: "summary_text",
              text: "The model checked the answer."
            }
          ]
        },
        {
          type: "message",
          role: "user",
          content: "Continue."
        }
      ]
    });

    expect(canonical.messages).toEqual([
      {
        role: "assistant",
        content: "The model checked the answer.",
        reasoningSummary: "The model checked the answer."
      },
      {
        role: "user",
        content: "Continue."
      }
    ]);
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

  it("encodes a max_tokens canonical response into an incomplete OpenAI responses payload", () => {
    const encoded = encodeCanonicalToOpenAIResponsesResponse({
      id: "resp_123",
      model: "gpt-4.1-mini",
      outputText: "hello there",
      finishReason: "max_tokens"
    });

    expect(encoded.status).toBe("incomplete");
    expect(encoded.incomplete_details).toEqual({
      reason: "max_output_tokens"
    });
  });

  it("preserves responses text output item when canonical response contains both text and tool calls", () => {
    const encoded = encodeCanonicalToOpenAIResponsesResponse({
      id: "resp_123",
      model: "gpt-4.1-mini",
      outputText: "Let me check that.",
      finishReason: "tool_calls",
      toolCalls: [
        {
          id: "call_123",
          name: "lookup_weather",
          arguments: "{\"city\":\"Shanghai\"}"
        }
      ]
    });

    expect(encoded.output_text).toBe("Let me check that.");
    expect(encoded.output).toEqual([
      {
        id: "resp_123_output_0",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: "Let me check that.",
            annotations: []
          }
        ]
      },
      {
        type: "function_call",
        call_id: "call_123",
        name: "lookup_weather",
        arguments: "{\"city\":\"Shanghai\"}",
        status: "completed"
      }
    ]);
  });

  it("encodes canonical parallel_tool_calls=false into an OpenAI responses payload", () => {
    const encoded = encodeCanonicalToOpenAIResponsesResponse({
      id: "resp_123",
      model: "gpt-4.1-mini",
      outputText: "hello there",
      finishReason: "stop",
      parallelToolCalls: false
    });

    expect(encoded.parallel_tool_calls).toBe(false);
  });

  it("preserves reasoning output items in an OpenAI responses payload", () => {
    const encoded = encodeCanonicalToOpenAIResponsesResponse({
      id: "resp_123",
      model: "gpt-4.1-mini",
      outputText: "hello there",
      finishReason: "stop",
      reasoningSummary: "The model checked the answer."
    });

    expect(encoded.output).toEqual([
      {
        type: "reasoning",
        summary: [
          {
            type: "summary_text",
            text: "The model checked the answer."
          }
        ]
      },
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
        }
      ],
      nextSequenceNumber: 2
    });
  });

  it("encodes a first output_text_delta event into text start plus delta events", async () => {
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
        {
          sequenceNumber: 2,
          outputIndex: 0,
          contentIndex: 0
        }
      )
    ).toEqual({
      events: [
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
        },
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
          startedTextOutput: true,
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

  it("encodes reasoning summary deltas and terminal reasoning output items", async () => {
    const { encodeCanonicalToOpenAIResponsesStreamEvent } = await import(
      "./openai-chat.js"
    );

    expect(
      encodeCanonicalToOpenAIResponsesStreamEvent(
        {
          type: "reasoning_summary_delta",
          responseId: "resp_123",
          model: "gpt-4.1-mini",
          delta: "The model checked"
        },
        {
          sequenceNumber: 2,
          outputIndex: 0,
          contentIndex: 0
        }
      )
    ).toEqual({
      events: [
        {
          type: "response.output_item.added",
          sequence_number: 2,
          output_index: 0,
          item: {
            type: "reasoning",
            summary: []
          }
        },
        {
          type: "response.reasoning_summary_part.added",
          sequence_number: 3,
          output_index: 0,
          summary_index: 0,
          part: {
            type: "summary_text",
            text: ""
          }
        },
        {
          type: "response.reasoning_summary_text.delta",
          sequence_number: 4,
          output_index: 0,
          summary_index: 0,
          delta: "The model checked"
        }
      ],
      nextSequenceNumber: 5
    });

    expect(
      encodeCanonicalToOpenAIResponsesStreamEvent(
        {
          type: "response_completed",
          responseId: "resp_123",
          model: "gpt-4.1-mini",
          finishReason: "stop"
        },
        {
          sequenceNumber: 5,
          outputIndex: 0,
          contentIndex: 0,
          startedReasoningOutput: true,
          reasoningSummary: "The model checked the answer."
        }
      )
    ).toEqual({
      events: [
        {
          type: "response.reasoning_summary_text.done",
          sequence_number: 5,
          output_index: 0,
          summary_index: 0,
          text: "The model checked the answer."
        },
        {
          type: "response.reasoning_summary_part.done",
          sequence_number: 6,
          output_index: 0,
          summary_index: 0,
          part: {
            type: "summary_text",
            text: "The model checked the answer."
          }
        },
        {
          type: "response.output_item.done",
          sequence_number: 7,
          output_index: 0,
          item: {
            type: "reasoning",
            summary: [
              {
                type: "summary_text",
                text: "The model checked the answer."
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
                type: "reasoning",
                summary: [
                  {
                    type: "summary_text",
                    text: "The model checked the answer."
                  }
                ]
              }
            ],
            output_text: "",
            parallel_tool_calls: true,
            tools: []
          }
        }
      ],
      nextSequenceNumber: 9
    });
  });

  it("encodes a tool_calls completion event into a minimal responses function_call terminal event sequence", async () => {
    const { encodeCanonicalToOpenAIResponsesStreamEvent } = await import(
      "./openai-chat.js"
    );

    expect(
      encodeCanonicalToOpenAIResponsesStreamEvent(
        {
          type: "tool_call_delta",
          responseId: "resp_123",
          model: "gpt-4.1-mini",
          toolCallId: "call_123",
          toolIndex: 0,
          toolName: "lookup_weather",
          argumentsDelta: "{\"city\":\"Shang"
        },
        {
          sequenceNumber: 5,
          outputIndex: 0,
          contentIndex: 0
        }
      )
    ).toEqual({
      events: [
        {
          type: "response.output_item.added",
          sequence_number: 5,
          output_index: 0,
          item: {
            type: "function_call",
            call_id: "call_123",
            name: "lookup_weather",
            arguments: "{\"city\":\"Shang",
            status: "completed"
          }
        },
        {
          type: "response.function_call_arguments.delta",
          sequence_number: 6,
          item_id: "call_123",
          output_index: 0,
          delta: "{\"city\":\"Shang"
        }
      ],
      nextSequenceNumber: 7
    });

    expect(
      encodeCanonicalToOpenAIResponsesStreamEvent(
        {
          type: "response_completed",
          responseId: "resp_123",
          model: "gpt-4.1-mini",
          finishReason: "tool_calls"
        },
        {
          sequenceNumber: 7,
          outputIndex: 0,
          contentIndex: 0,
          outputText: "",
          toolCallId: "call_123",
          toolCallName: "lookup_weather",
          toolCallArguments: "{\"city\":\"Shanghai\"}"
        }
      )
    ).toEqual({
      events: [
        {
          type: "response.function_call_arguments.done",
          sequence_number: 7,
          item_id: "call_123",
          output_index: 0,
          arguments: "{\"city\":\"Shanghai\"}"
        },
        {
          type: "response.output_item.done",
          sequence_number: 8,
          output_index: 0,
          item: {
            type: "function_call",
            call_id: "call_123",
            name: "lookup_weather",
            arguments: "{\"city\":\"Shanghai\"}",
            status: "completed"
          }
        },
        {
          type: "response.completed",
          sequence_number: 9,
          response: {
            id: "resp_123",
            object: "response",
            created_at: 0,
            model: "gpt-4.1-mini",
            status: "completed",
            output: [
              {
                type: "function_call",
                call_id: "call_123",
                name: "lookup_weather",
                arguments: "{\"city\":\"Shanghai\"}",
                status: "completed"
              }
            ],
            output_text: "",
            parallel_tool_calls: true,
            tools: []
          }
        }
      ],
      nextSequenceNumber: 10
    });
  });

  it("preserves zero-argument responses tool starts as empty streamed arguments", async () => {
    const { encodeCanonicalToOpenAIResponsesStreamEvent } = await import(
      "./openai-chat.js"
    );

    expect(
      encodeCanonicalToOpenAIResponsesStreamEvent(
        {
          type: "tool_call_delta",
          responseId: "resp_123",
          model: "gpt-4.1-mini",
          toolCallId: "call_123",
          toolIndex: 0,
          toolName: "lookup_weather",
          argumentsDelta: ""
        },
        {
          sequenceNumber: 5,
          outputIndex: 0,
          contentIndex: 0
        }
      )
    ).toEqual({
      events: [
        {
          type: "response.output_item.added",
          sequence_number: 5,
          output_index: 0,
          item: {
            type: "function_call",
            call_id: "call_123",
            name: "lookup_weather",
            arguments: "",
            status: "completed"
          }
        },
        {
          type: "response.function_call_arguments.delta",
          sequence_number: 6,
          item_id: "call_123",
          output_index: 0,
          delta: ""
        }
      ],
      nextSequenceNumber: 7
    });

    expect(
      encodeCanonicalToOpenAIResponsesStreamEvent(
        {
          type: "response_completed",
          responseId: "resp_123",
          model: "gpt-4.1-mini",
          finishReason: "tool_calls"
        },
        {
          sequenceNumber: 7,
          outputIndex: 0,
          contentIndex: 0,
          outputText: "",
          toolCalls: [
            {
              toolCallId: "call_123",
              toolCallName: "lookup_weather",
              toolCallArguments: "",
              outputIndex: 0
            }
          ]
        }
      )
    ).toEqual({
      events: [
        {
          type: "response.function_call_arguments.done",
          sequence_number: 7,
          item_id: "call_123",
          output_index: 0,
          arguments: ""
        },
        {
          type: "response.output_item.done",
          sequence_number: 8,
          output_index: 0,
          item: {
            type: "function_call",
            call_id: "call_123",
            name: "lookup_weather",
            arguments: "",
            status: "completed"
          }
        },
        {
          type: "response.completed",
          sequence_number: 9,
          response: {
            id: "resp_123",
            object: "response",
            created_at: 0,
            model: "gpt-4.1-mini",
            status: "completed",
            output: [
              {
                type: "function_call",
                call_id: "call_123",
                name: "lookup_weather",
                arguments: "",
                status: "completed"
              }
            ],
            output_text: "",
            parallel_tool_calls: true,
            tools: []
          }
        }
      ],
      nextSequenceNumber: 10
    });
  });

  it("encodes multiple responses tool calls as separate output items and completion records", async () => {
    const { encodeCanonicalToOpenAIResponsesStreamEvent } = await import(
      "./openai-chat.js"
    );

    expect(
      encodeCanonicalToOpenAIResponsesStreamEvent(
        {
          type: "tool_call_delta",
          responseId: "resp_123",
          model: "gpt-4.1-mini",
          toolCallId: "call_456",
          toolIndex: 1,
          toolName: "lookup_calendar",
          argumentsDelta: "{\"date\":\"2026-05-14\"}"
        },
        {
          sequenceNumber: 10,
          outputIndex: 1,
          contentIndex: 0
        }
      )
    ).toEqual({
      events: [
        {
          type: "response.output_item.added",
          sequence_number: 10,
          output_index: 1,
          item: {
            type: "function_call",
            call_id: "call_456",
            name: "lookup_calendar",
            arguments: "{\"date\":\"2026-05-14\"}",
            status: "completed"
          }
        },
        {
          type: "response.function_call_arguments.delta",
          sequence_number: 11,
          item_id: "call_456",
          output_index: 1,
          delta: "{\"date\":\"2026-05-14\"}"
        }
      ],
      nextSequenceNumber: 12
    });

    expect(
      encodeCanonicalToOpenAIResponsesStreamEvent(
        {
          type: "response_completed",
          responseId: "resp_123",
          model: "gpt-4.1-mini",
          finishReason: "tool_calls"
        },
        {
          sequenceNumber: 12,
          outputIndex: 1,
          contentIndex: 0,
          outputText: "",
          toolCalls: [
            {
              toolCallId: "call_123",
              toolCallName: "lookup_weather",
              toolCallArguments: "{\"city\":\"Shanghai\"}",
              outputIndex: 0
            },
            {
              toolCallId: "call_456",
              toolCallName: "lookup_calendar",
              toolCallArguments: "{\"date\":\"2026-05-14\"}",
              outputIndex: 1
            }
          ]
        }
      )
    ).toEqual({
      events: [
        {
          type: "response.function_call_arguments.done",
          sequence_number: 12,
          item_id: "call_123",
          output_index: 0,
          arguments: "{\"city\":\"Shanghai\"}"
        },
        {
          type: "response.output_item.done",
          sequence_number: 13,
          output_index: 0,
          item: {
            type: "function_call",
            call_id: "call_123",
            name: "lookup_weather",
            arguments: "{\"city\":\"Shanghai\"}",
            status: "completed"
          }
        },
        {
          type: "response.function_call_arguments.done",
          sequence_number: 14,
          item_id: "call_456",
          output_index: 1,
          arguments: "{\"date\":\"2026-05-14\"}"
        },
        {
          type: "response.output_item.done",
          sequence_number: 15,
          output_index: 1,
          item: {
            type: "function_call",
            call_id: "call_456",
            name: "lookup_calendar",
            arguments: "{\"date\":\"2026-05-14\"}",
            status: "completed"
          }
        },
        {
          type: "response.completed",
          sequence_number: 16,
          response: {
            id: "resp_123",
            object: "response",
            created_at: 0,
            model: "gpt-4.1-mini",
            status: "completed",
            output: [
              {
                type: "function_call",
                call_id: "call_123",
                name: "lookup_weather",
                arguments: "{\"city\":\"Shanghai\"}",
                status: "completed"
              },
              {
                type: "function_call",
                call_id: "call_456",
                name: "lookup_calendar",
                arguments: "{\"date\":\"2026-05-14\"}",
                status: "completed"
              }
            ],
            output_text: "",
            parallel_tool_calls: true,
            tools: []
          }
        }
      ],
      nextSequenceNumber: 17
    });
  });

  it("keeps text and tool output items distinct in mixed responses streaming completion", async () => {
    const { encodeCanonicalToOpenAIResponsesStreamEvent } = await import(
      "./openai-chat.js"
    );

    expect(
      encodeCanonicalToOpenAIResponsesStreamEvent(
        {
          type: "response_completed",
          responseId: "resp_123",
          model: "gpt-4.1-mini",
          finishReason: "tool_calls"
        },
        {
          sequenceNumber: 17,
          outputIndex: 1,
          contentIndex: 0,
          outputText: "Let me check that.",
          startedTextOutput: true,
          toolCalls: [
            {
              toolCallId: "call_123",
              toolCallName: "lookup_weather",
              toolCallArguments: "{\"city\":\"Shanghai\"}",
              outputIndex: 1
            }
          ]
        }
      )
    ).toEqual({
      events: [
        {
          type: "response.output_text.done",
          sequence_number: 17,
          item_id: "resp_123_output_0",
          output_index: 0,
          content_index: 0,
          text: "Let me check that.",
          logprobs: []
        },
        {
          type: "response.content_part.done",
          sequence_number: 18,
          item_id: "resp_123_output_0",
          output_index: 0,
          content_index: 0,
          part: {
            type: "output_text",
            text: "Let me check that.",
            annotations: []
          }
        },
        {
          type: "response.output_item.done",
          sequence_number: 19,
          output_index: 0,
          item: {
            id: "resp_123_output_0",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: "Let me check that.",
                annotations: []
              }
            ]
          }
        },
        {
          type: "response.function_call_arguments.done",
          sequence_number: 20,
          item_id: "call_123",
          output_index: 1,
          arguments: "{\"city\":\"Shanghai\"}"
        },
        {
          type: "response.output_item.done",
          sequence_number: 21,
          output_index: 1,
          item: {
            type: "function_call",
            call_id: "call_123",
            name: "lookup_weather",
            arguments: "{\"city\":\"Shanghai\"}",
            status: "completed"
          }
        },
        {
          type: "response.completed",
          sequence_number: 22,
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
                    text: "Let me check that.",
                    annotations: []
                  }
                ]
              },
              {
                type: "function_call",
                call_id: "call_123",
                name: "lookup_weather",
                arguments: "{\"city\":\"Shanghai\"}",
                status: "completed"
              }
            ],
            output_text: "Let me check that.",
            parallel_tool_calls: true,
            tools: []
          }
        }
      ],
      nextSequenceNumber: 23
    });
  });

  it("keeps reasoning, text, and tool output items distinct in mixed responses streaming completion", async () => {
    const { encodeCanonicalToOpenAIResponsesStreamEvent } = await import(
      "./openai-chat.js"
    );

    expect(
      encodeCanonicalToOpenAIResponsesStreamEvent(
        {
          type: "response_completed",
          responseId: "resp_123",
          model: "gpt-4.1-mini",
          finishReason: "tool_calls"
        },
        {
          sequenceNumber: 17,
          outputIndex: 1,
          contentIndex: 0,
          outputText: "Let me check that.",
          reasoningSummary: "The model checked the answer.",
          startedReasoningOutput: true,
          startedTextOutput: true,
          toolCalls: [
            {
              toolCallId: "call_123",
              toolCallName: "lookup_weather",
              toolCallArguments: "{\"city\":\"Shanghai\"}",
              outputIndex: 2
            }
          ]
        }
      )
    ).toEqual({
      events: [
        {
          type: "response.reasoning_summary_text.done",
          sequence_number: 17,
          output_index: 0,
          summary_index: 0,
          text: "The model checked the answer."
        },
        {
          type: "response.reasoning_summary_part.done",
          sequence_number: 18,
          output_index: 0,
          summary_index: 0,
          part: {
            type: "summary_text",
            text: "The model checked the answer."
          }
        },
        {
          type: "response.output_item.done",
          sequence_number: 19,
          output_index: 0,
          item: {
            type: "reasoning",
            summary: [
              {
                type: "summary_text",
                text: "The model checked the answer."
              }
            ]
          }
        },
        {
          type: "response.output_text.done",
          sequence_number: 20,
          item_id: "resp_123_output_0",
          output_index: 1,
          content_index: 0,
          text: "Let me check that.",
          logprobs: []
        },
        {
          type: "response.content_part.done",
          sequence_number: 21,
          item_id: "resp_123_output_0",
          output_index: 1,
          content_index: 0,
          part: {
            type: "output_text",
            text: "Let me check that.",
            annotations: []
          }
        },
        {
          type: "response.output_item.done",
          sequence_number: 22,
          output_index: 1,
          item: {
            id: "resp_123_output_0",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: "Let me check that.",
                annotations: []
              }
            ]
          }
        },
        {
          type: "response.function_call_arguments.done",
          sequence_number: 23,
          item_id: "call_123",
          output_index: 2,
          arguments: "{\"city\":\"Shanghai\"}"
        },
        {
          type: "response.output_item.done",
          sequence_number: 24,
          output_index: 2,
          item: {
            type: "function_call",
            call_id: "call_123",
            name: "lookup_weather",
            arguments: "{\"city\":\"Shanghai\"}",
            status: "completed"
          }
        },
        {
          type: "response.completed",
          sequence_number: 25,
          response: {
            id: "resp_123",
            object: "response",
            created_at: 0,
            model: "gpt-4.1-mini",
            status: "completed",
            output: [
              {
                type: "reasoning",
                summary: [
                  {
                    type: "summary_text",
                    text: "The model checked the answer."
                  }
                ]
              },
              {
                id: "resp_123_output_0",
                type: "message",
                role: "assistant",
                status: "completed",
                content: [
                  {
                    type: "output_text",
                    text: "Let me check that.",
                    annotations: []
                  }
                ]
              },
              {
                type: "function_call",
                call_id: "call_123",
                name: "lookup_weather",
                arguments: "{\"city\":\"Shanghai\"}",
                status: "completed"
              }
            ],
            output_text: "Let me check that.",
            parallel_tool_calls: true,
            tools: []
          }
        }
      ],
      nextSequenceNumber: 26
    });
  });

  it("encodes a max_tokens completion event into an incomplete terminal responses event sequence", async () => {
    const { encodeCanonicalToOpenAIResponsesStreamEvent } = await import(
      "./openai-chat.js"
    );
    const encoded = encodeCanonicalToOpenAIResponsesStreamEvent(
      {
        type: "response_completed",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        finishReason: "max_tokens"
      },
      {
        sequenceNumber: 0,
        outputIndex: 0,
        contentIndex: 0,
        outputText: "hello there"
      }
    );
    const completedEvent = encoded.events.find((event) => {
      return (
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "response.completed"
      );
    });

    expect(completedEvent).toMatchObject({
      type: "response.completed",
      response: {
        status: "incomplete",
        incomplete_details: {
          reason: "max_output_tokens"
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

  it("normalizes anthropic metadata.user_id into canonical request fields", () => {
    const canonical = normalizeAnthropicMessagesRequest({
      model: "claude-sonnet-4-5",
      max_tokens: 256,
      stream: false,
      metadata: {
        user_id: "user_123"
      },
      messages: [
        {
          role: "user",
          content: "hello"
        }
      ]
    });

    expect(canonical.providerMetadata).toEqual({
      anthropic: {
        user_id: "user_123"
      }
    });
  });

  it("normalizes anthropic tools and tool_choice into canonical request fields", () => {
    const canonical = normalizeAnthropicMessagesRequest({
      model: "claude-sonnet-4-5",
      max_tokens: 256,
      stream: false,
      tool_choice: {
        type: "auto"
      },
      tools: [
        {
          name: "lookup_weather",
          description: "Lookup weather by city",
          input_schema: {
            type: "object",
            properties: {
              city: {
                type: "string"
              }
            },
            required: ["city"]
          }
        }
      ],
      messages: [
        {
          role: "user",
          content: "Weather in Shanghai?"
        }
      ]
    });

    expect(canonical.tools).toEqual([
      {
        name: "lookup_weather",
        description: "Lookup weather by city",
        inputSchema: {
          type: "object",
          properties: {
            city: {
              type: "string"
            }
          },
          required: ["city"]
        }
      }
    ]);
    expect(canonical.toolChoice).toBe("auto");
  });

  it("normalizes forced anthropic named tool_choice into canonical request fields", () => {
    const canonical = normalizeAnthropicMessagesRequest({
      model: "claude-sonnet-4-5",
      max_tokens: 256,
      stream: false,
      tool_choice: {
        type: "tool",
        name: "lookup_weather"
      },
      tools: [
        {
          name: "lookup_weather",
          input_schema: {
            type: "object"
          }
        }
      ],
      messages: [
        {
          role: "user",
          content: "Weather in Shanghai?"
        }
      ]
    });

    expect(canonical.toolChoice).toEqual({
      type: "tool",
      name: "lookup_weather"
    });
  });

  it("normalizes anthropic any tool_choice into canonical request fields", () => {
    const canonical = normalizeAnthropicMessagesRequest({
      model: "claude-sonnet-4-5",
      max_tokens: 256,
      stream: false,
      tool_choice: {
        type: "any"
      },
      tools: [
        {
          name: "lookup_weather",
          input_schema: {
            type: "object"
          }
        }
      ],
      messages: [
        {
          role: "user",
          content: "Weather in Shanghai?"
        }
      ]
    });

    expect(canonical.toolChoice).toBe("required");
  });

  it("normalizes anthropic none tool_choice into canonical request fields", () => {
    const canonical = normalizeAnthropicMessagesRequest({
      model: "claude-sonnet-4-5",
      max_tokens: 256,
      stream: false,
      tool_choice: {
        type: "none"
      },
      tools: [
        {
          name: "lookup_weather",
          input_schema: {
            type: "object"
          }
        }
      ],
      messages: [
        {
          role: "user",
          content: "Weather in Shanghai?"
        }
      ]
    });

    expect(canonical.toolChoice).toBe("none");
  });

  it("normalizes anthropic tool_use and tool_result replay into canonical tool history", () => {
    const canonical = normalizeAnthropicMessagesRequest({
      model: "claude-sonnet-4-5",
      max_tokens: 256,
      stream: false,
      messages: [
        {
          role: "user",
          content: "Weather in Shanghai?"
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "call_123",
              name: "lookup_weather",
              input: {
                city: "Shanghai"
              }
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_123",
              content: "{\"temperature_c\":26}"
            }
          ]
        }
      ]
    });

    expect(canonical.messages).toEqual([
      { role: "user", content: "Weather in Shanghai?" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call_123",
            name: "lookup_weather",
            arguments: "{\"city\":\"Shanghai\"}"
          }
        ]
      },
      {
        role: "tool",
        content: "{\"temperature_c\":26}",
        toolCallId: "call_123"
      }
    ]);
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
    expect(encoded.content).toEqual([
      {
        type: "text",
        text: "hello there"
      }
    ]);
    expect(encoded.stop_sequence).toBeNull();
    expect(encoded.usage).toEqual({
      input_tokens: 12,
      output_tokens: 8
    });
  });

  it("encodes canonical tool calls into anthropic tool_use content", () => {
    const encoded = encodeCanonicalToAnthropicMessagesResponse({
      id: "msg_123",
      model: "claude-sonnet-4-5",
      outputText: "",
      finishReason: "tool_calls",
      toolCalls: [
        {
          id: "call_123",
          name: "lookup_weather",
          arguments: "{\"city\":\"Shanghai\"}"
        }
      ]
    });

    expect(encoded.content).toEqual([
      {
        type: "tool_use",
        id: "call_123",
        name: "lookup_weather",
        input: {
          city: "Shanghai"
        }
      }
    ]);
    expect(encoded.stop_reason).toBe("tool_use");
  });

  it("preserves anthropic text blocks when canonical response contains both text and tool calls", () => {
    const encoded = encodeCanonicalToAnthropicMessagesResponse({
      id: "msg_123",
      model: "claude-sonnet-4-5",
      outputText: "Let me check that.",
      finishReason: "tool_calls",
      toolCalls: [
        {
          id: "call_123",
          name: "lookup_weather",
          arguments: "{\"city\":\"Shanghai\"}"
        }
      ]
    });

    expect(encoded.content).toEqual([
      {
        type: "text",
        text: "Let me check that."
      },
      {
        type: "tool_use",
        id: "call_123",
        name: "lookup_weather",
        input: {
          city: "Shanghai"
        }
      }
    ]);
    expect(encoded.stop_reason).toBe("tool_use");
  });

  it("encodes a max_tokens canonical response into an Anthropic max_tokens stop reason", () => {
    const encoded = encodeCanonicalToAnthropicMessagesResponse({
      id: "msg_123",
      model: "claude-sonnet-4-5",
      outputText: "hello there",
      finishReason: "max_tokens"
    });

    expect(encoded.stop_reason).toBe("max_tokens");
  });
});

describe("encodeCanonicalToAnthropicMessagesStreamEvents", () => {
  it("encodes a response_started event into a message_start event", async () => {
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
      }
    ]);
  });

  it("encodes a first output_text_delta event into content_block_start and content_block_delta events", async () => {
    const { encodeCanonicalToAnthropicMessagesStreamEvents } = await import(
      "./openai-chat.js"
    );
    const state = {
      startedTextBlock: false,
      startedToolBlocks: [],
      pendingToolStops: []
    };

    expect(
      encodeCanonicalToAnthropicMessagesStreamEvents({
        type: "output_text_delta",
        responseId: "msg_123",
        model: "claude-sonnet-4-5",
        delta: "hel"
      }, state)
    ).toEqual([
      {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "text",
          text: ""
        }
      },
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

  it("encodes a tool_call_delta event into tool_use start and input_json_delta events", async () => {
    const { encodeCanonicalToAnthropicMessagesStreamEvents } = await import(
      "./openai-chat.js"
    );
    const state = {
      startedTextBlock: false,
      startedToolBlocks: [],
      pendingToolStops: []
    };

    expect(
      encodeCanonicalToAnthropicMessagesStreamEvents({
        type: "tool_call_delta",
        responseId: "msg_123",
        model: "claude-sonnet-4-5",
        toolCallId: "call_123",
        toolIndex: 0,
        toolName: "lookup_weather",
        argumentsDelta: "{\"city\":\"Shang"
      }, state)
    ).toEqual([
      {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "call_123",
          name: "lookup_weather",
          input: {}
        }
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "input_json_delta",
          partial_json: "{\"city\":\"Shang"
        }
      }
    ]);
  });

  it("shifts anthropic tool block indexes after a started text block", async () => {
    const { encodeCanonicalToAnthropicMessagesStreamEvents } = await import(
      "./openai-chat.js"
    );
    const state = {
      startedTextBlock: true,
      startedToolBlocks: [],
      pendingToolStops: []
    };

    expect(
      encodeCanonicalToAnthropicMessagesStreamEvents({
        type: "tool_call_delta",
        responseId: "msg_123",
        model: "claude-sonnet-4-5",
        toolCallId: "call_123",
        toolIndex: 0,
        toolName: "lookup_weather",
        argumentsDelta: "{\"city\":\"Shang"
      }, state)
    ).toEqual([
      {
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_use",
          id: "call_123",
          name: "lookup_weather",
          input: {}
        }
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: {
          type: "input_json_delta",
          partial_json: "{\"city\":\"Shang"
        }
      }
    ]);
  });

  it("encodes a response_completed event into content_block_stop, message_delta, and message_stop events", async () => {
    const { encodeCanonicalToAnthropicMessagesStreamEvents } = await import(
      "./openai-chat.js"
    );
    const state = {
      startedTextBlock: true,
      startedToolBlocks: [],
      pendingToolStops: []
    };

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
      }, state)
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

  it("encodes a max_tokens completion event into an Anthropic max_tokens message_delta", async () => {
    const { encodeCanonicalToAnthropicMessagesStreamEvents } = await import(
      "./openai-chat.js"
    );
    const state = {
      startedTextBlock: true,
      startedToolBlocks: [],
      pendingToolStops: []
    };

    expect(
      encodeCanonicalToAnthropicMessagesStreamEvents({
        type: "response_completed",
        responseId: "msg_123",
        model: "claude-sonnet-4-5",
        finishReason: "max_tokens"
      }, state)
    ).toEqual([
      {
        type: "content_block_stop",
        index: 0
      },
      {
        type: "message_delta",
        delta: {
          stop_reason: "max_tokens",
          stop_sequence: null
        }
      },
      {
        type: "message_stop"
      }
    ]);
  });

  it("encodes a tool_calls completion event after a tool block into tool stop and tool_use stop reason", async () => {
    const { encodeCanonicalToAnthropicMessagesStreamEvents } = await import(
      "./openai-chat.js"
    );
    const state = {
      startedTextBlock: false,
      startedToolBlocks: [0],
      pendingToolStops: [0]
    };

    expect(
      encodeCanonicalToAnthropicMessagesStreamEvents({
        type: "response_completed",
        responseId: "msg_123",
        model: "claude-sonnet-4-5",
        finishReason: "tool_calls"
      }, state)
    ).toEqual([
      {
        type: "content_block_stop",
        index: 0
      },
      {
        type: "message_delta",
        delta: {
          stop_reason: "tool_use",
          stop_sequence: null
        }
      },
      {
        type: "message_stop"
      }
    ]);
  });
});
