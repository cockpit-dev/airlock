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

  it("accepts chat completion sampling fields", () => {
    const parsed = openAIChatCompletionRequestSchema.parse({
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

    expect(parsed.temperature).toBe(0.8);
    expect(parsed.top_p).toBe(0.9);
  });

  it("accepts chat completion stop sequences as a string or array", () => {
    const single = openAIChatCompletionRequestSchema.parse({
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
    const multiple = openAIChatCompletionRequestSchema.parse({
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

    expect(single.stop).toBe("\n\n");
    expect(multiple.stop).toEqual(["END", "STOP"]);
  });

  it("accepts chat stream_options.include_usage when true", () => {
    const parsed = openAIChatCompletionRequestSchema.parse({
      model: "gpt-4.1-mini",
      stream: true,
      stream_options: {
        include_usage: true
      },
      messages: [
        {
          role: "user",
          content: "hello"
        }
      ]
    });

    expect(parsed.stream_options).toEqual({
      include_usage: true
    });
  });

  it("accepts chat function tools and tool_choice", () => {
    const parsed = openAIChatCompletionRequestSchema.parse({
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

    expect(parsed.tool_choice).toBe("auto");
    expect(parsed.tools?.[0]).toMatchObject({
      type: "function",
      function: {
        name: "lookup_weather"
      }
    });
  });

  it("accepts chat function tools with a forced function tool_choice", () => {
    const parsed = openAIChatCompletionRequestSchema.parse({
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

    expect(parsed.tool_choice).toMatchObject({
      type: "function",
      function: {
        name: "lookup_weather"
      }
    });
  });

  it("accepts chat function tools with tool_choice required", () => {
    const parsed = openAIChatCompletionRequestSchema.parse({
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

    expect(parsed.tool_choice).toBe("required");
  });

  it("accepts chat function tools with tool_choice none", () => {
    const parsed = openAIChatCompletionRequestSchema.parse({
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

    expect(parsed.tool_choice).toBe("none");
  });

  it("accepts chat parallel_tool_calls when true", () => {
    const parsed = openAIChatCompletionRequestSchema.parse({
      model: "gpt-4.1-mini",
      stream: false,
      parallel_tool_calls: true,
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

    expect(parsed.parallel_tool_calls).toBe(true);
  });

  it("accepts chat modalities when set to text only", () => {
    const parsed = openAIChatCompletionRequestSchema.parse({
      model: "gpt-4.1-mini",
      stream: false,
      modalities: ["text"],
      messages: [
        {
          role: "user",
          content: "Hello!"
        }
      ]
    });

    expect(parsed.modalities).toEqual(["text"]);
  });

  it("accepts chat response_format when type is text", () => {
    const parsed = openAIChatCompletionRequestSchema.parse({
      model: "gpt-4.1-mini",
      stream: false,
      response_format: {
        type: "text"
      },
      messages: [
        {
          role: "user",
          content: "Hello!"
        }
      ]
    });

    expect(parsed.response_format).toEqual({
      type: "text"
    });
  });

  it("accepts chat response_format when type is json_schema", () => {
    const parsed = openAIChatCompletionRequestSchema.parse({
      model: "gpt-4.1-mini",
      stream: false,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "weather",
          schema: {
            type: "object",
            properties: {
              city: {
                type: "string"
              }
            },
            required: ["city"]
          },
          strict: true
        }
      },
      messages: [
        {
          role: "user",
          content: "Hello!"
        }
      ]
    });

    expect(parsed.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "weather",
        schema: {
          type: "object",
          properties: {
            city: {
              type: "string"
            }
          },
          required: ["city"]
        },
        strict: true
      }
    });
  });

  it("accepts chat response_format when type is json_object", () => {
    const parsed = openAIChatCompletionRequestSchema.parse({
      model: "gpt-4.1-mini",
      stream: false,
      response_format: {
        type: "json_object"
      },
      messages: [
        {
          role: "user",
          content: "Hello!"
        }
      ]
    });

    expect(parsed.response_format).toEqual({
      type: "json_object"
    });
  });

  it("accepts assistant tool_calls and tool result messages for replay", () => {
    const parsed = openAIChatCompletionRequestSchema.parse({
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

    expect(parsed.messages[1]).toMatchObject({
      role: "assistant",
      tool_calls: [
        {
          id: "call_123",
          type: "function"
        }
      ]
    });
    expect(parsed.messages[2]).toMatchObject({
      role: "tool",
      tool_call_id: "call_123",
      content: "{\"temperature_c\":26}"
    });
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

  it("accepts top-level responses message item arrays", () => {
    const parsed = openAIResponsesRequestSchema.parse({
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

    expect(Array.isArray(parsed.input)).toBe(true);
  });

  it("accepts mixed typed responses input items including assistant output replay", () => {
    const parsed = openAIResponsesRequestSchema.parse({
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

  it("accepts previous_response_id for responses requests", () => {
    const parsed = openAIResponsesRequestSchema.parse({
      model: "gpt-4.1-mini",
      input: "hello",
      stream: false,
      previous_response_id: "resp_123"
    });

    expect(parsed.previous_response_id).toBe("resp_123");
  });

  it("accepts conversation for responses requests", () => {
    const parsed = openAIResponsesRequestSchema.parse({
      model: "gpt-4.1-mini",
      input: "hello",
      stream: false,
      conversation: "conv_123"
    });

    expect(parsed.conversation).toBe("conv_123");
  });

  it("accepts responses prompt and reasoning.effort fields", () => {
    const parsed = openAIResponsesRequestSchema.parse({
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

    expect(parsed.prompt).toEqual({
      id: "pmpt_123",
      variables: {
        city: "Shanghai"
      },
      version: "7"
    });
    expect(parsed.reasoning).toEqual({
      effort: "medium"
    });
  });

  it("accepts responses reasoning.summary and deprecated reasoning.generate_summary", () => {
    const summaryParsed = openAIResponsesRequestSchema.parse({
      model: "gpt-4.1-mini",
      input: "hello",
      stream: false,
      reasoning: {
        effort: "low",
        summary: "auto"
      }
    });
    const generateSummaryParsed = openAIResponsesRequestSchema.parse({
      model: "gpt-4.1-mini",
      input: "hello",
      stream: false,
      reasoning: {
        generate_summary: "concise"
      }
    });

    expect(summaryParsed.reasoning).toEqual({
      effort: "low",
      summary: "auto"
    });
    expect(generateSummaryParsed.reasoning).toEqual({
      generate_summary: "concise"
    });
  });

  it("accepts responses text.format when type is json_schema", () => {
    const parsed = openAIResponsesRequestSchema.parse({
      model: "gpt-4.1-mini",
      input: "hello",
      text: {
        format: {
          type: "json_schema",
          name: "weather",
          schema: {
            type: "object",
            properties: {
              city: {
                type: "string"
              }
            },
            required: ["city"]
          },
          strict: true
        }
      }
    });

    expect(parsed.text).toEqual({
      format: {
        type: "json_schema",
        name: "weather",
        schema: {
          type: "object",
          properties: {
            city: {
              type: "string"
            }
          },
          required: ["city"]
        },
        strict: true
      }
    });
  });

  it("accepts responses text.format when type is json_object", () => {
    const parsed = openAIResponsesRequestSchema.parse({
      model: "gpt-4.1-mini",
      input: "hello",
      text: {
        format: {
          type: "json_object"
        }
      }
    });

    expect(parsed.text).toEqual({
      format: {
        type: "json_object"
      }
    });
  });

  it("accepts responses sampling fields", () => {
    const parsed = openAIResponsesRequestSchema.parse({
      model: "gpt-4.1-mini",
      input: "hello",
      stream: false,
      temperature: 0.7,
      top_p: 0.85
    });

    expect(parsed.temperature).toBe(0.7);
    expect(parsed.top_p).toBe(0.85);
  });

  it("accepts responses function tools and tool_choice", () => {
    const parsed = openAIResponsesRequestSchema.parse({
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

    expect(parsed.tool_choice).toBe("auto");
    expect(parsed.tools?.[0]).toMatchObject({
      type: "function",
      name: "lookup_weather"
    });
  });

  it("accepts responses function tools with a forced function tool_choice", () => {
    const parsed = openAIResponsesRequestSchema.parse({
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

    expect(parsed.tool_choice).toMatchObject({
      type: "function",
      name: "lookup_weather"
    });
  });

  it("accepts responses function tools with tool_choice required", () => {
    const parsed = openAIResponsesRequestSchema.parse({
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

    expect(parsed.tool_choice).toBe("required");
  });

  it("accepts responses function tools with tool_choice none", () => {
    const parsed = openAIResponsesRequestSchema.parse({
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

    expect(parsed.tool_choice).toBe("none");
  });

  it("accepts responses parallel_tool_calls when true", () => {
    const parsed = openAIResponsesRequestSchema.parse({
      model: "gpt-4.1-mini",
      input: "hello",
      stream: false,
      parallel_tool_calls: true,
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

    expect(parsed.parallel_tool_calls).toBe(true);
  });

  it("accepts responses text config when format type is text", () => {
    const parsed = openAIResponsesRequestSchema.parse({
      model: "gpt-4.1-mini",
      input: "hello",
      stream: false,
      text: {
        format: {
          type: "text"
        }
      }
    });

    expect(parsed.text).toEqual({
      format: {
        type: "text"
      }
    });
  });

  it("accepts responses stream_options when include_obfuscation is false", () => {
    const parsed = openAIResponsesRequestSchema.parse({
      model: "gpt-4.1-mini",
      input: "hello",
      stream: false,
      stream_options: {
        include_obfuscation: false
      }
    });

    expect(parsed.stream_options).toEqual({
      include_obfuscation: false
    });
  });

  it("accepts responses function_call replay items and function_call_output items", () => {
    const parsed = openAIResponsesRequestSchema.parse({
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

    expect(Array.isArray(parsed.input)).toBe(true);
  });

  it("accepts responses reasoning replay items", () => {
    const parsed = openAIResponsesRequestSchema.parse({
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

    expect(Array.isArray(parsed.input)).toBe(true);
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

  it("accepts anthropic sampling fields", () => {
    const parsed = anthropicMessagesRequestSchema.parse({
      model: "claude-sonnet-4-5",
      max_tokens: 256,
      temperature: 0.8,
      top_p: 0.95,
      messages: [
        {
          role: "user",
          content: "hello"
        }
      ]
    });

    expect(parsed.temperature).toBe(0.8);
    expect(parsed.top_p).toBe(0.95);
  });

  it("accepts anthropic stop_sequences", () => {
    const parsed = anthropicMessagesRequestSchema.parse({
      model: "claude-sonnet-4-5",
      max_tokens: 256,
      stop_sequences: ["END", "STOP"],
      messages: [
        {
          role: "user",
          content: "hello"
        }
      ]
    });

    expect(parsed.stop_sequences).toEqual(["END", "STOP"]);
  });

  it("accepts anthropic metadata.user_id", () => {
    const parsed = anthropicMessagesRequestSchema.parse({
      model: "claude-sonnet-4-5",
      max_tokens: 256,
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

    expect(parsed.metadata).toEqual({
      user_id: "user_123"
    });
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

  it("accepts anthropic function tools and tool_choice auto", () => {
    const parsed = anthropicMessagesRequestSchema.parse({
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

    expect(parsed.tool_choice).toEqual({
      type: "auto"
    });
    expect(parsed.tools?.[0]).toMatchObject({
      name: "lookup_weather"
    });
  });

  it("accepts anthropic function tools with tool_choice any", () => {
    const parsed = anthropicMessagesRequestSchema.parse({
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

    expect(parsed.tool_choice).toEqual({
      type: "any"
    });
  });

  it("accepts anthropic function tools with tool_choice none", () => {
    const parsed = anthropicMessagesRequestSchema.parse({
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

    expect(parsed.tool_choice).toEqual({
      type: "none"
    });
  });

  it("accepts anthropic function tools with a forced named tool_choice", () => {
    const parsed = anthropicMessagesRequestSchema.parse({
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

    expect(parsed.tool_choice).toEqual({
      type: "tool",
      name: "lookup_weather"
    });
  });

  it("accepts anthropic tool_use and tool_result replay content blocks", () => {
    const parsed = anthropicMessagesRequestSchema.parse({
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

    expect(Array.isArray(parsed.messages)).toBe(true);
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
