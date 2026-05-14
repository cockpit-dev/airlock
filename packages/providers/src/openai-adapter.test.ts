import { describe, expect, it, vi } from "vitest";

import type { CanonicalRequest } from "@airlock/canonical";

import { GatewayError } from "@airlock/shared";

import { OpenAIProviderAdapter } from "./openai-adapter.js";

function createCanonicalRequest(): CanonicalRequest {
  return {
    model: "gpt-4.1-mini",
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

describe("OpenAIProviderAdapter", () => {
  it("maps upstream success into a canonical response", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl_123",
          object: "chat.completion",
          created: 1,
          model: "gpt-4.1-mini",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "hello there"
              }
            }
          ],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 8,
            total_tokens: 20
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

    const adapter = new OpenAIProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
      shaping: {
        headers: {
          "openai-beta": "responses=v1"
        },
        query: {
          "api-version": "2025-01-01"
        },
        jsonBody: {
          temperature: 0.2
        }
      },
      fetcher
    });

    const response = await adapter.complete(createCanonicalRequest(), {
      requestId: "req_123"
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(url).toBe(
      "https://api.openai.com/v1/chat/completions?api-version=2025-01-01"
    );
    expect(init.headers).toMatchObject({
      authorization: "Bearer test-key",
      "content-type": "application/json",
      "openai-beta": "responses=v1"
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model: "gpt-4.1-mini",
      stream: false,
      messages: createCanonicalRequest().messages,
      temperature: 0.2
    });
    expect(response.outputText).toBe("hello there");
    expect(response.model).toBe("gpt-4.1-mini");
    expect(response.usage).toEqual({
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20
    });
  });

  it("maps OpenAI length finishes into canonical max_tokens", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl_123",
          object: "chat.completion",
          created: 1,
          model: "gpt-4.1-mini",
          choices: [
            {
              index: 0,
              finish_reason: "length",
              message: {
                role: "assistant",
                content: "hello there"
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

    const adapter = new OpenAIProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
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
          id: "chatcmpl_123",
          object: "chat.completion",
          created: 1,
          model: "gpt-4.1-mini",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "hello there"
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

    const adapter = new OpenAIProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
      fetcher
    });

    await adapter.complete(createCanonicalRequest(), {
      requestId: "req_123"
    });

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(init.headers).toMatchObject({
      authorization: "Bearer test-key"
    });
  });

  it("forwards an explicit canonical output token limit to OpenAI", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl_123",
          object: "chat.completion",
          created: 1,
          model: "gpt-4.1-mini",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "hello there"
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

    const adapter = new OpenAIProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
      fetcher
    });

    await adapter.complete(
      {
        ...createCanonicalRequest(),
        maxOutputTokens: 128
      },
      {
        requestId: "req_123"
      }
    );

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      max_tokens: 128
    });
  });

  it("forwards canonical sampling fields to OpenAI", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl_123",
          object: "chat.completion",
          created: 1,
          model: "gpt-4.1-mini",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "hello there"
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

    const adapter = new OpenAIProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
      fetcher
    });

    await adapter.complete(
      {
        ...createCanonicalRequest(),
        temperature: 0.8,
        topP: 0.9
      },
      {
        requestId: "req_123"
      }
    );

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      temperature: 0.8,
      top_p: 0.9
    });
  });

  it("forwards canonical stop sequences to OpenAI", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl_123",
          object: "chat.completion",
          created: 1,
          model: "gpt-4.1-mini",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "hello there"
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

    const adapter = new OpenAIProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
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
      stop: ["END", "STOP"]
    });
  });

  it("forwards canonical function tools to OpenAI and maps tool_calls responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl_123",
          object: "chat.completion",
          created: 1,
          model: "gpt-4.1-mini",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: null,
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

    const adapter = new OpenAIProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
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
      tool_choice: "auto"
    });
    expect(response.toolCalls).toEqual([
      {
        id: "call_123",
        name: "lookup_weather",
        arguments: "{\"city\":\"Shanghai\"}"
      }
    ]);
  });

  it("rejects shaping that attempts to override reserved auth headers", async () => {
    const adapter = new OpenAIProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
      shaping: {
        headers: {
          authorization: "Bearer override"
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
          id: "chatcmpl_123",
          object: "chat.completion",
          created: 1,
          model: "gpt-4.1-mini",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "hello there"
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

    const adapter = new OpenAIProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
      shaping: {
        query: {
          "api-version": "2025-01-01"
        }
      },
      signing: {
        type: "hmac_sha256_header",
        headerName: "x-airlock-signature",
        prefix: "sha256=",
        secret: {
          secretRef: "openai-signing-secret"
        },
        components: ["method", "path", "query"]
      },
      signingSecrets: {
        "openai-signing-secret": "signing-secret"
      },
      fetcher
    });

    await adapter.complete(createCanonicalRequest(), {
      requestId: "req_123"
    });

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(init.headers).toMatchObject({
      "x-airlock-signature":
        "sha256=3cfdb030ea88f177756399b431f674bb5c7ffd8f798ad18a02c758b374ce64a7"
    });
  });

  it("rejects shaping/signing collisions before the outbound fetch", async () => {
    const fetcher = vi.fn();
    const adapter = new OpenAIProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
      shaping: {
        headers: {
          "x-airlock-signature": "override"
        }
      },
      signing: {
        type: "hmac_sha256_header",
        headerName: "x-airlock-signature",
        secret: {
          secretRef: "openai-signing-secret"
        },
        components: ["method", "path"]
      },
      signingSecrets: {
        "openai-signing-secret": "signing-secret"
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

    const adapter = new OpenAIProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
      fetcher
    });

    await expect(
      adapter.complete(createCanonicalRequest(), {
        requestId: "req_123"
      })
    ).rejects.toBeInstanceOf(GatewayError);
  });

  it("parses upstream chat completion SSE into canonical stream events", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
              'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"content":"hel"},"finish_reason":null}]}\n\n',
              'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":null}]}\n\n',
              'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":8,"total_tokens":20}}\n\n',
              "data: [DONE]\n\n"
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
    const adapter = new OpenAIProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
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
      stream: true,
      stream_options: {
        include_usage: true
      }
    });
    expect(events).toEqual([
      {
        type: "response_started",
        responseId: "chatcmpl_123",
        model: "gpt-4.1-mini"
      },
      {
        type: "output_text_delta",
        responseId: "chatcmpl_123",
        model: "gpt-4.1-mini",
        delta: "hel"
      },
      {
        type: "output_text_delta",
        responseId: "chatcmpl_123",
        model: "gpt-4.1-mini",
        delta: "lo"
      },
      {
        type: "response_completed",
        responseId: "chatcmpl_123",
        model: "gpt-4.1-mini",
        finishReason: "stop",
        usage: {
          inputTokens: 12,
          outputTokens: 8,
          totalTokens: 20
        }
      }
    ]);
  });

  it("applies request-scoped shaping on top of route-level shaping", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl_123",
          object: "chat.completion",
          created: 1,
          model: "gpt-4.1-mini",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "hello there"
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

    const adapter = new OpenAIProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
      shaping: {
        headers: {
          "openai-beta": "responses=v1"
        },
        query: {
          trace: "route"
        },
        jsonBody: {
          temperature: 0.2,
          metadata: "route"
        }
      },
      fetcher
    });

    await adapter.complete(createCanonicalRequest(), {
      requestId: "req_123",
      requestShaping: {
        headers: {
          "openai-beta": "responses=v2"
        },
        query: {
          trace: "request"
        },
        jsonBody: {
          temperature: 0.8
        }
      }
    });

    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://api.openai.com/v1/chat/completions?trace=request");
    expect(init.headers).toMatchObject({
      "openai-beta": "responses=v2"
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model: "gpt-4.1-mini",
      stream: false,
      messages: createCanonicalRequest().messages,
      temperature: 0.8,
      metadata: "route"
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

    const adapter = new OpenAIProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
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
});
