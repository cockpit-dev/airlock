import { describe, expect, it, vi } from "vitest";

import type { CanonicalRequest } from "@airlock/canonical";

import { GatewayError } from "@airlock/shared";

import { GeminiProviderAdapter } from "./gemini-adapter.js";

function createCanonicalRequest(): CanonicalRequest {
  return {
    model: "gemini-2.5-flash",
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

describe("GeminiProviderAdapter", () => {
  it("maps upstream success into a canonical response", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          responseId: "gemini-response-123",
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    text: "hello there"
                  }
                ]
              }
            }
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 6,
            totalTokenCount: 16
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

    const adapter = new GeminiProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      fetcher
    });

    const response = await adapter.complete(createCanonicalRequest(), {
      requestId: "req_123"
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    );
    expect(init.headers).toMatchObject({
      "x-goog-api-key": "test-key",
      "content-type": "application/json"
    });
    expect(JSON.parse(init.body as string)).toEqual({
      system_instruction: {
        parts: [
          {
            text: "You are precise."
          }
        ]
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: "Say hi."
            }
          ]
        }
      ]
    });
    expect(response).toEqual({
      id: "gemini-response-123",
      model: "gemini-2.5-flash",
      outputText: "hello there",
      finishReason: "stop",
      usage: {
        inputTokens: 10,
        outputTokens: 6,
        totalTokens: 16
      }
    });
  });

  it("maps Gemini MAX_TOKENS finishes into canonical max_tokens", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          responseId: "gemini-response-123",
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              finishReason: "MAX_TOKENS",
              content: {
                role: "model",
                parts: [
                  {
                    text: "hello there"
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

    const adapter = new GeminiProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
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
          responseId: "gemini-response-123",
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    text: "hello there"
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

    const adapter = new GeminiProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      fetcher
    });

    await adapter.complete(createCanonicalRequest(), {
      requestId: "req_123"
    });

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(init.headers).toMatchObject({
      "x-goog-api-key": "test-key"
    });
  });

  it("forwards an explicit canonical output token limit into Gemini generationConfig", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          responseId: "gemini-response-123",
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    text: "hello there"
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

    const adapter = new GeminiProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      fetcher
    });

    await adapter.complete(
      {
        ...createCanonicalRequest(),
        maxOutputTokens: 80
      },
      {
        requestId: "req_123"
      }
    );

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      generationConfig: {
        maxOutputTokens: 80
      }
    });
  });

  it("forwards canonical sampling fields into Gemini generationConfig", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          responseId: "gemini-response-123",
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    text: "hello there"
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

    const adapter = new GeminiProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
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
      generationConfig: {
        temperature: 0.8,
        topP: 0.9
      }
    });
  });

  it("forwards canonical stop sequences into Gemini generationConfig", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          responseId: "gemini-response-123",
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    text: "hello there"
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

    const adapter = new GeminiProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
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
      generationConfig: {
        stopSequences: ["END", "STOP"]
      }
    });
  });

  it("forwards canonical function tools into Gemini tool declarations", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          responseId: "gemini-response-123",
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              finishReason: "STOP",
              content: {
                role: "model",
                parts: []
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

    const adapter = new GeminiProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      fetcher
    });

    await adapter.complete(
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
          functionDeclarations: [
            {
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
        }
      ],
      toolConfig: {
        functionCallingConfig: {
          mode: "AUTO"
        }
      }
    });
  });

  it("forwards canonical required tool choice into Gemini ANY mode", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          responseId: "gemini-response-123",
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              finishReason: "STOP",
              content: {
                role: "model",
                parts: []
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

    const adapter = new GeminiProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
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
        toolChoice: "required"
      },
      {
        requestId: "req_123"
      }
    );

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      toolConfig: {
        functionCallingConfig: {
          mode: "ANY"
        }
      }
    });
  });

  it("forwards canonical none tool choice into Gemini NONE mode", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          responseId: "gemini-response-123",
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              finishReason: "STOP",
              content: {
                role: "model",
                parts: []
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

    const adapter = new GeminiProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
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
        toolChoice: "none"
      },
      {
        requestId: "req_123"
      }
    );

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      toolConfig: {
        functionCallingConfig: {
          mode: "NONE"
        }
      }
    });
  });

  it("forwards canonical forced tool choice into Gemini allowedFunctionNames", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          responseId: "gemini-response-123",
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              finishReason: "STOP",
              content: {
                role: "model",
                parts: []
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

    const adapter = new GeminiProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
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
      toolConfig: {
        functionCallingConfig: {
          mode: "ANY",
          allowedFunctionNames: ["lookup_weather"]
        }
      }
    });
  });

  it("forwards canonical json_object output format into Gemini JSON generation config", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          responseId: "gemini-response-123",
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    text: "{\"city\":\"Shanghai\"}"
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

    const adapter = new GeminiProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      fetcher
    });

    await adapter.complete(
      {
        ...createCanonicalRequest(),
        outputFormat: {
          type: "json_object"
        }
      },
      {
        requestId: "req_123"
      }
    );

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      generationConfig: {
        responseMimeType: "application/json"
      }
    });
  });

  it("forwards canonical json_schema output format into Gemini JSON schema generation config", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          responseId: "gemini-response-123",
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    text: "{\"city\":\"Shanghai\"}"
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

    const adapter = new GeminiProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      fetcher
    });

    await adapter.complete(
      {
        ...createCanonicalRequest(),
        outputFormat: {
          type: "json_schema",
          name: "weather",
          schema: {
            type: "object"
          },
          strict: true
        }
      },
      {
        requestId: "req_123"
      }
    );

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object"
        }
      }
    });
  });

  it("maps Gemini functionCall responses into canonical tool calls", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          responseId: "gemini-response-123",
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              finishReason: "STOP",
              content: {
                role: "model",
                parts: [
                  {
                    functionCall: {
                      name: "lookup_weather",
                      args: {
                        city: "Shanghai"
                      }
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

    const adapter = new GeminiProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      fetcher
    });

    const response = await adapter.complete(
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
        toolChoice: "auto"
      },
      {
        requestId: "req_123"
      }
    );

    expect(response).toMatchObject({
      id: "gemini-response-123",
      model: "gemini-2.5-flash",
      outputText: "",
      finishReason: "tool_calls",
      toolCalls: [
        {
          name: "lookup_weather",
          arguments: "{\"city\":\"Shanghai\"}"
        }
      ]
    });
  });

  it("forwards canonical tool replay history into Gemini contents", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          responseId: "gemini-response-123",
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              finishReason: "STOP",
              content: {
                role: "model",
                parts: [
                  {
                    text: "The temperature is 26C."
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

    const adapter = new GeminiProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      fetcher
    });

    await adapter.complete(
      {
        model: "gemini-2.5-flash",
        stream: false,
        tools: [
          {
            name: "lookup_weather",
            inputSchema: {
              type: "object"
            }
          }
        ],
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
            toolCallId: "call_123",
            content: "{\"temperature_c\":26}"
          }
        ]
      },
      {
        requestId: "req_123"
      }
    );

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: "Weather in Shanghai?"
            }
          ]
        },
        {
          role: "model",
          parts: [
            {
              functionCall: {
                name: "lookup_weather",
                args: {
                  city: "Shanghai"
                }
              }
            }
          ]
        },
        {
          role: "user",
          parts: [
            {
              functionResponse: {
                name: "lookup_weather",
                response: {
                  temperature_c: 26
                }
              }
            }
          ]
        }
      ]
    });
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

    const adapter = new GeminiProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      fetcher
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
          responseId: "gemini-response-123",
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    text: "hello there"
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

    const adapter = new GeminiProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      shaping: {
        query: {
          alt: "json"
        }
      },
      signing: {
        type: "hmac_sha256_header",
        headerName: "x-airlock-signature",
        prefix: "sha256=",
        secret: {
          secretRef: "gemini-signing-secret"
        },
        components: ["method", "path", "query"]
      },
      signingSecrets: {
        "gemini-signing-secret": "signing-secret"
      },
      fetcher
    });

    await adapter.complete(createCanonicalRequest(), {
      requestId: "req_123"
    });

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(init.headers).toMatchObject({
      "x-airlock-signature":
        "sha256=f28e88734920bbc564fee90da404eb3e1197cbc13d4f641aa7409b8db133a5f4"
    });
  });

  it("rejects shaping/signing collisions before the outbound fetch", async () => {
    const fetcher = vi.fn();
    const adapter = new GeminiProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      shaping: {
        headers: {
          "x-airlock-signature": "override"
        }
      },
      signing: {
        type: "hmac_sha256_header",
        headerName: "x-airlock-signature",
        secret: {
          secretRef: "gemini-signing-secret"
        },
        components: ["method", "path"]
      },
      signingSecrets: {
        "gemini-signing-secret": "signing-secret"
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

  it("applies request-scoped shaping on top of route-level shaping", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          responseId: "gemini-response-123",
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    text: "hello there"
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

    const adapter = new GeminiProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      shaping: {
        query: {
          trace: "route"
        },
        jsonBody: {
          generationConfig: {
            temperature: 0.2
          }
        }
      },
      fetcher
    });

    await adapter.complete(createCanonicalRequest(), {
      requestId: "req_123",
      requestShaping: {
        query: {
          trace: "request"
        },
        jsonBody: {
          generationConfig: {
            temperature: 0.8
          }
        }
      }
    });

    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?trace=request"
    );
    expect(JSON.parse(init.body as string)).toEqual({
      system_instruction: {
        parts: [
          {
            text: "You are precise."
          }
        ]
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: "Say hi."
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.8
      }
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

    const adapter = new GeminiProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
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

  it("parses upstream gemini SSE into canonical stream events", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'data: {"responseId":"gemini-response-123","modelVersion":"gemini-2.5-flash","candidates":[{"content":{"role":"model","parts":[{"text":"hel"}]}}]}\n\n',
              'data: {"responseId":"gemini-response-123","modelVersion":"gemini-2.5-flash","candidates":[{"content":{"role":"model","parts":[{"text":"lo"}]}}]}\n\n',
              'data: {"responseId":"gemini-response-123","modelVersion":"gemini-2.5-flash","candidates":[{"finishReason":"STOP","content":{"role":"model","parts":[]}}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":6,"totalTokenCount":16}}\n\n'
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
    const adapter = new GeminiProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
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

    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse"
    );
    expect(JSON.parse(init.body as string)).toMatchObject({
      system_instruction: {
        parts: [
          {
            text: "You are precise."
          }
        ]
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: "Say hi."
            }
          ]
        }
      ]
    });
    expect(events).toEqual([
      {
        type: "response_started",
        responseId: "gemini-response-123",
        model: "gemini-2.5-flash"
      },
      {
        type: "output_text_delta",
        responseId: "gemini-response-123",
        model: "gemini-2.5-flash",
        delta: "hel"
      },
      {
        type: "output_text_delta",
        responseId: "gemini-response-123",
        model: "gemini-2.5-flash",
        delta: "lo"
      },
      {
        type: "response_completed",
        responseId: "gemini-response-123",
        model: "gemini-2.5-flash",
        finishReason: "stop",
        usage: {
          inputTokens: 10,
          outputTokens: 6,
          totalTokens: 16
        }
      }
    ]);
  });

  it("parses upstream gemini SSE tool calls into canonical tool_call_delta events", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'data: {"responseId":"gemini-response-123","modelVersion":"gemini-2.5-flash","candidates":[{"content":{"role":"model","parts":[{"text":"Let me check "},{"functionCall":{"name":"lookup_weather","args":{"city":"Shanghai"}}}]}}]}\n\n',
              'data: {"responseId":"gemini-response-123","modelVersion":"gemini-2.5-flash","candidates":[{"finishReason":"STOP","content":{"role":"model","parts":[]}}],"usageMetadata":{"promptTokenCount":11,"candidatesTokenCount":5,"totalTokenCount":16}}\n\n'
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
    const adapter = new GeminiProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      fetcher
    });
    const events: Array<unknown> = [];

    for await (const event of adapter.stream(
      {
        ...createCanonicalRequest(),
        stream: true,
        tools: [
          {
            name: "lookup_weather",
            inputSchema: {
              type: "object"
            }
          }
        ]
      },
      {
        requestId: "req_stream_tool_123"
      }
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "response_started",
        responseId: "gemini-response-123",
        model: "gemini-2.5-flash"
      },
      {
        type: "output_text_delta",
        responseId: "gemini-response-123",
        model: "gemini-2.5-flash",
        delta: "Let me check "
      },
      {
        type: "tool_call_delta",
        responseId: "gemini-response-123",
        model: "gemini-2.5-flash",
        toolCallId: "gemini-response-123_tool_1",
        toolIndex: 1,
        toolName: "lookup_weather",
        argumentsDelta: "{\"city\":\"Shanghai\"}"
      },
      {
        type: "response_completed",
        responseId: "gemini-response-123",
        model: "gemini-2.5-flash",
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "gemini-response-123_tool_1",
            name: "lookup_weather",
            arguments: "{\"city\":\"Shanghai\"}"
          }
        ],
        usage: {
          inputTokens: 11,
          outputTokens: 5,
          totalTokens: 16
        }
      }
    ]);
  });

  it("preserves zero-argument streamed gemini tool starts as empty argument deltas", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'data: {"responseId":"gemini-response-123","modelVersion":"gemini-2.5-flash","candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"lookup_weather"}}]}}]}\n\n',
              'data: {"responseId":"gemini-response-123","modelVersion":"gemini-2.5-flash","candidates":[{"finishReason":"STOP","content":{"role":"model","parts":[]}}],"usageMetadata":{"promptTokenCount":11,"candidatesTokenCount":5,"totalTokenCount":16}}\n\n'
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
    const adapter = new GeminiProviderAdapter({
      apiKey: "test-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      fetcher
    });
    const events: Array<unknown> = [];

    for await (const event of adapter.stream(
      {
        ...createCanonicalRequest(),
        stream: true,
        tools: [
          {
            name: "lookup_weather",
            inputSchema: {
              type: "object"
            }
          }
        ]
      },
      {
        requestId: "req_stream_tool_123"
      }
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "response_started",
        responseId: "gemini-response-123",
        model: "gemini-2.5-flash"
      },
      {
        type: "tool_call_delta",
        responseId: "gemini-response-123",
        model: "gemini-2.5-flash",
        toolCallId: "gemini-response-123_tool_0",
        toolIndex: 0,
        toolName: "lookup_weather",
        argumentsDelta: ""
      },
      {
        type: "response_completed",
        responseId: "gemini-response-123",
        model: "gemini-2.5-flash",
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "gemini-response-123_tool_0",
            name: "lookup_weather",
            arguments: ""
          }
        ],
        usage: {
          inputTokens: 11,
          outputTokens: 5,
          totalTokens: 16
        }
      }
    ]);
  });
});
