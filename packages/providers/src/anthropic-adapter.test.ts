import { describe, expect, it, vi } from "vitest";

import type { CanonicalRequest } from "@airlock/canonical";

import { GatewayError } from "@airlock/shared";

import { AnthropicProviderAdapter } from "./anthropic-adapter.js";

function createCanonicalRequest(): CanonicalRequest {
  return {
    model: "claude-sonnet-4-5",
    stream: false,
    messages: [
      {
        role: "system",
        content: "You are precise."
      },
      {
        role: "user",
        content: "Say hi."
      }
    ]
  };
}

describe("AnthropicProviderAdapter", () => {
  it("maps upstream success into a canonical response", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
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
          ],
          usage: {
            input_tokens: 14,
            output_tokens: 9
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.anthropic.com/v1",
      defaultMaxTokens: 256,
      shaping: {
        headers: {
          "anthropic-beta": "tools-2024-04-04"
        },
        query: {
          trace: "1"
        },
        jsonBody: {
          metadata: {
            source: "airlock"
          }
        }
      },
      fetcher
    });

    const response = await adapter.complete(createCanonicalRequest(), {
      requestId: "req_123"
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://api.anthropic.com/v1/messages?trace=1");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "x-api-key": "test-key",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "tools-2024-04-04"
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model: "claude-sonnet-4-5",
      max_tokens: 256,
      system: "You are precise.",
      metadata: {
        source: "airlock"
      },
      messages: [
        {
          role: "user",
          content: "Say hi."
        }
      ]
    });
    expect(response.outputText).toBe("hello there");
    expect(response.model).toBe("claude-sonnet-4-5");
    expect(response.usage).toEqual({
      inputTokens: 14,
      outputTokens: 9,
      totalTokens: 23
    });
  });

  it("maps Anthropic max_tokens stops into canonical max_tokens", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-5",
          stop_reason: "max_tokens",
          content: [
            {
              type: "text",
              text: "hello there"
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.anthropic.com/v1",
      defaultMaxTokens: 256,
      fetcher
    });

    const response = await adapter.complete(createCanonicalRequest(), {
      requestId: "req_123"
    });

    expect(response.finishReason).toBe("max_tokens");
  });

  it("applies auth through the shared auth strategy layer", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
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
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.anthropic.com/v1",
      defaultMaxTokens: 256,
      fetcher
    });

    await adapter.complete(createCanonicalRequest(), {
      requestId: "req_123"
    });

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(init.headers).toMatchObject({
      "x-api-key": "test-key"
    });
  });

  it("forwards an explicit canonical output token limit instead of always using the adapter default", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
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
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.anthropic.com/v1",
      defaultMaxTokens: 256,
      fetcher
    });

    await adapter.complete(
      {
        ...createCanonicalRequest(),
        maxOutputTokens: 64
      },
      {
        requestId: "req_123"
      }
    );

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      max_tokens: 64
    });
  });

  it("forwards canonical sampling fields to Anthropic", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
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
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.anthropic.com/v1",
      defaultMaxTokens: 256,
      fetcher
    });

    await adapter.complete(
      {
        ...createCanonicalRequest(),
        temperature: 0.8,
        topP: 0.95
      },
      {
        requestId: "req_123"
      }
    );

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      temperature: 0.8,
      top_p: 0.95
    });
  });

  it("forwards canonical stop sequences to Anthropic", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
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
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.anthropic.com/v1",
      defaultMaxTokens: 256,
      fetcher
    });

    await adapter.complete(
      {
        ...createCanonicalRequest(),
        stopSequences: ["END", "STOP"]
      },
      {
        requestId: "req_123"
      }
    );

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      stop_sequences: ["END", "STOP"]
    });
  });

  it("forwards canonical function tools to Anthropic tools input_schema", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-5",
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "toolu_123",
              name: "lookup_weather",
              input: {
                city: "Shanghai"
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.anthropic.com/v1",
      defaultMaxTokens: 256,
      fetcher
    });

    const response = await adapter.complete(
      {
        ...createCanonicalRequest(),
        tools: [
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
        ],
        toolChoice: "auto"
      },
      {
        requestId: "req_123"
      }
    );

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
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
      tool_choice: {
        type: "auto"
      }
    });
    expect(response.toolCalls).toEqual([
      {
        id: "toolu_123",
        name: "lookup_weather",
        arguments: "{\"city\":\"Shanghai\"}"
      }
    ]);
  });

  it("forwards a forced canonical tool choice to Anthropic", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-5",
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "toolu_123",
              name: "lookup_weather",
              input: {
                city: "Shanghai"
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.anthropic.com/v1",
      defaultMaxTokens: 256,
      fetcher
    });

    await adapter.complete(
      {
        ...createCanonicalRequest(),
        tools: [
          {
            name: "lookup_weather",
            inputSchema: {
              type: "object"
            }
          }
        ],
        toolChoice: {
          type: "tool",
          name: "lookup_weather"
        }
      },
      {
        requestId: "req_123"
      }
    );

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      tool_choice: {
        type: "tool",
        name: "lookup_weather"
      }
    });
  });

  it("replays assistant tool calls and tool results into Anthropic message history", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-5",
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: "The temperature is 26C."
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.anthropic.com/v1",
      defaultMaxTokens: 256,
      fetcher
    });

    await adapter.complete(
      {
        model: "claude-sonnet-4-5",
        stream: false,
        tools: [
          {
            name: "lookup_weather",
            inputSchema: {
              type: "object"
            }
          }
        ],
        toolChoice: "auto",
        messages: [
          {
            role: "user",
            content: "Weather in Shanghai?"
          },
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
        ]
      },
      {
        requestId: "req_123"
      }
    );

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
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
  });

  it("returns canonical tool calls with empty output text for tool_use responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-5",
          stop_reason: "tool_use",
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
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.anthropic.com/v1",
      defaultMaxTokens: 256,
      fetcher
    });

    const response = await adapter.complete(createCanonicalRequest(), {
      requestId: "req_123"
    });

    expect(response.outputText).toBe("");
    expect(response.toolCalls).toEqual([
      {
        id: "call_123",
        name: "lookup_weather",
        arguments: "{\"city\":\"Shanghai\"}"
      }
    ]);
    expect(response.finishReason).toBe("tool_calls");
  });

  it("rejects shaping that attempts to override reserved auth headers", async () => {
    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.anthropic.com/v1",
      defaultMaxTokens: 256,
      shaping: {
        headers: {
          "x-api-key": "override"
        }
      },
      fetcher: vi.fn()
    });

    await expect(
      adapter.complete(createCanonicalRequest(), {
        requestId: "req_123"
      })
    ).rejects.toBeInstanceOf(GatewayError);
  });

  it("applies request signing after shaping when configured", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
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
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.anthropic.com/v1",
      defaultMaxTokens: 256,
      shaping: {
        query: {
          trace: "1"
        }
      },
      signing: {
        type: "hmac_sha256_header",
        headerName: "x-airlock-signature",
        prefix: "sha256=",
        secret: {
          secretRef: "anthropic-signing-secret"
        },
        components: ["method", "path", "query"]
      },
      signingSecrets: {
        "anthropic-signing-secret": "signing-secret"
      },
      fetcher
    });

    await adapter.complete(createCanonicalRequest(), {
      requestId: "req_123"
    });

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(init.headers).toMatchObject({
      "x-airlock-signature":
        "sha256=d3ebed076d6ad0fe8756d9c0f422cc9f34d06532a12f16a19f3681d2559e221b"
    });
  });

  it("rejects shaping/signing collisions before the outbound fetch", async () => {
    const fetcher = vi.fn();
    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.anthropic.com/v1",
      defaultMaxTokens: 256,
      shaping: {
        headers: {
          "x-airlock-signature": "override"
        }
      },
      signing: {
        type: "hmac_sha256_header",
        headerName: "x-airlock-signature",
        secret: {
          secretRef: "anthropic-signing-secret"
        },
        components: ["method", "path"]
      },
      signingSecrets: {
        "anthropic-signing-secret": "signing-secret"
      },
      fetcher
    });

    await expect(
      adapter.complete(createCanonicalRequest(), {
        requestId: "req_signing_collision"
      })
    ).rejects.toBeInstanceOf(GatewayError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("maps upstream failures into a gateway error", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: "rate limited"
          }
        }),
        {
          status: 429,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.anthropic.com/v1",
      defaultMaxTokens: 256,
      fetcher
    });

    await expect(
      adapter.complete(createCanonicalRequest(), {
        requestId: "req_123"
      })
    ).rejects.toBeInstanceOf(GatewayError);
  });

  it("applies request-scoped shaping on top of route-level shaping", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
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
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.anthropic.com/v1",
      defaultMaxTokens: 256,
      shaping: {
        headers: {
          "anthropic-beta": "tools-2024-04-04"
        },
        query: {
          trace: "route"
        },
        jsonBody: {
          metadata: "route"
        }
      },
      fetcher
    });

    await adapter.complete(createCanonicalRequest(), {
      requestId: "req_123",
      requestShaping: {
        headers: {
          "anthropic-beta": "prompt-caching-2024-07-31"
        },
        query: {
          trace: "request"
        },
        jsonBody: {
          metadata: "request"
        }
      }
    });

    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://api.anthropic.com/v1/messages?trace=request");
    expect(init.headers).toMatchObject({
      "anthropic-beta": "prompt-caching-2024-07-31"
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model: "claude-sonnet-4-5",
      max_tokens: 256,
      system: "You are precise.",
      metadata: "request",
      messages: [
        {
          role: "user",
          content: "Say hi."
        }
      ]
    });
  });

  it("maps aborted upstream fetches into a retryable timeout gateway error", async () => {
    const fetcher = vi.fn().mockImplementation(async (_input, init?: RequestInit) => {
      const signal = init?.signal;

      return await new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });

    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.anthropic.com/v1",
      defaultMaxTokens: 256,
      fetcher
    });

    await expect(
      adapter.complete(createCanonicalRequest(), {
        requestId: "req_123",
        timeoutMs: 1
      })
    ).rejects.toMatchObject({
      code: "provider_timeout",
      category: "provider",
      httpStatus: 504,
      retryable: true
    });
  });

  it("parses upstream anthropic SSE into canonical stream events", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'event: message_start\ndata: {"message":{"id":"msg_123","model":"claude-sonnet-4-5"}}\n\n',
              'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"hel"}}\n\n',
              'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"lo"}}\n\n',
              'event: message_delta\ndata: {"usage":{"input_tokens":14,"output_tokens":9}}\n\n',
              "event: message_stop\ndata: {}\n\n"
            ].join("")
          )
        );
        controller.close();
      }
    });
    const fetcher = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: {
          "content-type": "text/event-stream"
        }
      })
    );
    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.anthropic.com/v1",
      defaultMaxTokens: 256,
      fetcher
    });
    const events: Array<unknown> = [];

    for await (const event of adapter.stream(
      {
        ...createCanonicalRequest(),
        stream: true
      },
      {
        requestId: "req_stream_123"
      }
    )) {
      events.push(event);
    }

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      stream: true
    });
    expect(events).toEqual([
      {
        type: "response_started",
        responseId: "msg_123",
        model: "claude-sonnet-4-5"
      },
      {
        type: "output_text_delta",
        responseId: "msg_123",
        model: "claude-sonnet-4-5",
        delta: "hel"
      },
      {
        type: "output_text_delta",
        responseId: "msg_123",
        model: "claude-sonnet-4-5",
        delta: "lo"
      },
      {
        type: "response_completed",
        responseId: "msg_123",
        model: "claude-sonnet-4-5",
        finishReason: "stop",
        usage: {
          inputTokens: 14,
          outputTokens: 9,
          totalTokens: 23
        }
      }
    ]);
  });
});
