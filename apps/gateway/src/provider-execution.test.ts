import { describe, expect, it, vi } from "vitest";

import type { CanonicalRequest } from "@airlock/canonical";
import type { GatewayApiKeyRecord } from "@airlock/governance";
import { getProviderCapabilityDescriptor } from "@airlock/providers";
import type { ModelRoute } from "@airlock/routing";
import { GatewayError } from "@airlock/shared";

import { assertProviderSupportsCanonicalRequest, executeRoutedRequest } from "./provider-execution.js";

describe("assertProviderSupportsCanonicalRequest", () => {
  it("allows canonical requests that fit the provider descriptor", () => {
    const request: CanonicalRequest = {
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

    expect(() =>
      assertProviderSupportsCanonicalRequest(
        getProviderCapabilityDescriptor("openai"),
        request,
        "req_123"
      )
    ).not.toThrow();
  });

  it("throws a typed error when the provider descriptor lacks a required capability", () => {
    const request: CanonicalRequest = {
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

    expect(() =>
      assertProviderSupportsCanonicalRequest(
        {
          provider: "gemini",
          displayName: "Gemini",
          supportsStreaming: false,
          supportsTools: false,
          supportsMultimodalInput: false,
          supportsSystemMessages: false,
          supportsRouteScopedShaping: true,
          supportsStaticFallbackSameProvider: true
        },
        request,
        "req_123"
      )
    ).toThrow(GatewayError);
  });
});

describe("executeRoutedRequest", () => {
  const allowedOpenAIOnlyKey: GatewayApiKeyRecord = {
    id: "key_openai",
    label: "OpenAI Only",
    value: "gateway-secret",
    status: "active",
    policy: {
      allowedProviders: ["openai"]
    }
  };

  it("uses the fallback target provider for a retryable cross-provider fallback attempt", async () => {
    const route: ModelRoute = {
      externalModel: "assistant-default",
      target: {
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      },
      fallbacks: [
        {
          provider: "anthropic",
          providerModel: "claude-haiku-4-5"
        }
      ]
    };
    const request: CanonicalRequest = {
      model: "gpt-4.1-mini",
      stream: false,
      messages: [
        {
          role: "user",
          content: "Say hi."
        }
      ]
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
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
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "msg_123",
            type: "message",
            role: "assistant",
            model: "claude-haiku-4-5",
            stop_reason: "end_turn",
            content: [
              {
                type: "text",
                text: "hello from anthropic"
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

    const response = await executeRoutedRequest(route, request, {
      config: {
        mode: "free",
        providerTimeoutMs: 1000,
        gatewayApiKeys: [],
        modelAliases: [],
        anthropic: {
          apiKey: "anthropic-secret",
          baseUrl: "https://api.anthropic.com/v1",
          defaultMaxTokens: 256
        },
        openAI: {
          apiKey: "openai-secret",
          baseUrl: "https://api.openai.com/v1",
          defaultModel: "gpt-4.1-mini"
        }
      },
      requestId: "req_123",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(fetcher.mock.calls[1]?.[0]).toBe("https://api.anthropic.com/v1/messages");
    expect(response.model).toBe("claude-haiku-4-5");
    expect(response.outputText).toBe("hello from anthropic");
  });

  it("returns the primary provider error when later fallback targets are filtered out by key policy", async () => {
    const route: ModelRoute = {
      externalModel: "assistant-default",
      target: {
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      },
      fallbacks: [
        {
          provider: "anthropic",
          providerModel: "claude-haiku-4-5"
        }
      ]
    };
    const request: CanonicalRequest = {
      model: "gpt-4.1-mini",
      stream: false,
      messages: [
        {
          role: "user",
          content: "Say hi."
        }
      ]
    };
    const fetcher = vi.fn().mockResolvedValueOnce(
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

    await expect(
      executeRoutedRequest(route, request, {
        config: {
          mode: "free",
          providerTimeoutMs: 1000,
          gatewayApiKeys: [],
          modelAliases: [],
          anthropic: {
            apiKey: "anthropic-secret",
            baseUrl: "https://api.anthropic.com/v1",
            defaultMaxTokens: 256
          },
          openAI: {
            apiKey: "openai-secret",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4.1-mini"
          }
        },
        requestId: "req_123",
        gatewayApiKey: allowedOpenAIOnlyKey,
        fetcher
      })
    ).rejects.toMatchObject({
      code: "provider_upstream_error",
      category: "provider",
      httpStatus: 429
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("skips a provider-disallowed primary target and starts from the first allowed fallback target", async () => {
    const route: ModelRoute = {
      externalModel: "assistant-default",
      target: {
        provider: "anthropic",
        providerModel: "claude-sonnet-4-5"
      },
      fallbacks: [
        {
          provider: "openai",
          providerModel: "gpt-4.1-mini"
        }
      ]
    };
    const request: CanonicalRequest = {
      model: "claude-sonnet-4-5",
      stream: false,
      messages: [
        {
          role: "user",
          content: "Say hi."
        }
      ]
    };
    const fetcher = vi.fn().mockResolvedValueOnce(
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
                content: "hello from openai"
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

    const response = await executeRoutedRequest(route, request, {
      config: {
        mode: "free",
        providerTimeoutMs: 1000,
        gatewayApiKeys: [],
        modelAliases: [],
        anthropic: {
          apiKey: "anthropic-secret",
          baseUrl: "https://api.anthropic.com/v1",
          defaultMaxTokens: 256
        },
        openAI: {
          apiKey: "openai-secret",
          baseUrl: "https://api.openai.com/v1",
          defaultModel: "gpt-4.1-mini"
        }
      },
      requestId: "req_123",
      gatewayApiKey: allowedOpenAIOnlyKey,
      fetcher
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(response.model).toBe("gpt-4.1-mini");
  });

  it("skips a capability-incompatible primary target and starts from a compatible fallback target", async () => {
    const route: ModelRoute = {
      externalModel: "assistant-default",
      target: {
        provider: "gemini",
        providerModel: "gemini-2.5-flash"
      },
      fallbacks: [
        {
          provider: "openai",
          providerModel: "gpt-4.1-mini"
        }
      ]
    };
    const request: CanonicalRequest = {
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
    const fetcher = vi.fn().mockResolvedValueOnce(
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
                content: "hello from openai"
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

    const response = await executeRoutedRequest(route, request, {
      config: {
        mode: "free",
        providerTimeoutMs: 1000,
        gatewayApiKeys: [],
        modelAliases: [],
        gemini: {
          apiKey: "gemini-secret",
          baseUrl: "https://generativelanguage.googleapis.com/v1beta"
        },
        openAI: {
          apiKey: "openai-secret",
          baseUrl: "https://api.openai.com/v1",
          defaultModel: "gpt-4.1-mini"
        }
      },
      requestId: "req_123",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      getProviderDescriptor: (provider) => {
        if (provider === "gemini") {
          return {
            provider: "gemini",
            displayName: "Gemini",
            supportsStreaming: false,
            supportsTools: false,
            supportsMultimodalInput: false,
            supportsSystemMessages: false,
            supportsRouteScopedShaping: true,
            supportsStaticFallbackSameProvider: true
          };
        }

        return getProviderCapabilityDescriptor(provider);
      },
      fetcher
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(response.model).toBe("gpt-4.1-mini");
  });

  it("passes only the remaining timeout budget to a later fallback attempt", async () => {
    const route: ModelRoute = {
      externalModel: "gpt-4.1-mini",
      target: {
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      },
      fallbacks: [
        {
          provider: "openai",
          providerModel: "gpt-4.1-nano"
        }
      ]
    };
    const request: CanonicalRequest = {
      model: "gpt-4.1-mini",
      stream: false,
      messages: [
        {
          role: "user",
          content: "Say hi."
        }
      ]
    };
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
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
      )
      .mockImplementationOnce(async (_input, init?: RequestInit) => {
        const signal = init?.signal;

        return await new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      });
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(850);

    const execution = executeRoutedRequest(route, request, {
      config: {
        mode: "free",
        providerTimeoutMs: 1000,
        gatewayApiKeys: [],
        modelAliases: [],
        openAI: {
          apiKey: "openai-secret",
          baseUrl: "https://api.openai.com/v1",
          defaultModel: "gpt-4.1-mini"
        }
      },
      requestId: "req_123",
      gatewayApiKey: allowedOpenAIOnlyKey,
      fetcher,
      now
    });
    const executionExpectation = expect(execution).rejects.toMatchObject({
      code: "provider_timeout",
      category: "provider",
      httpStatus: 504
    });

    await vi.advanceTimersByTimeAsync(149);
    expect(fetcher).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1);
    await executionExpectation;
    vi.useRealTimers();
  });

  it("stops failover when the shared timeout budget is already exhausted", async () => {
    const route: ModelRoute = {
      externalModel: "gpt-4.1-mini",
      target: {
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      },
      fallbacks: [
        {
          provider: "openai",
          providerModel: "gpt-4.1-nano"
        }
      ]
    };
    const request: CanonicalRequest = {
      model: "gpt-4.1-mini",
      stream: false,
      messages: [
        {
          role: "user",
          content: "Say hi."
        }
      ]
    };
    const fetcher = vi.fn().mockResolvedValueOnce(
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
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1200);

    await expect(
      executeRoutedRequest(route, request, {
        config: {
          mode: "free",
          providerTimeoutMs: 1000,
          gatewayApiKeys: [],
          modelAliases: [],
          openAI: {
            apiKey: "openai-secret",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4.1-mini"
          }
        },
        requestId: "req_123",
        gatewayApiKey: allowedOpenAIOnlyKey,
        fetcher,
        now
      })
    ).rejects.toMatchObject({
      code: "provider_timeout",
      category: "provider",
      httpStatus: 504,
      retryable: true
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
