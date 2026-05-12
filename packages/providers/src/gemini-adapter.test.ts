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
      finishReason: "stop"
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
});
