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
});
