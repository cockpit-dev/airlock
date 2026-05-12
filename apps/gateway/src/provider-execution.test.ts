import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CanonicalRequest } from "@airlock/canonical";
import type { GatewayApiKeyRecord } from "@airlock/governance";
import { getProviderCapabilityDescriptor } from "@airlock/providers";
import type { ModelRoute } from "@airlock/routing";
import { GatewayError } from "@airlock/shared";

import {
  assertProviderSupportsCanonicalRequest,
  executeRoutedRequest,
  executeRoutedStreamRequest
} from "./provider-execution.js";
import {
  createPersistentCircuitBreakerBackend,
  resetProviderCircuitBreakerState
} from "./circuit-breaker.js";

beforeEach(() => {
  resetProviderCircuitBreakerState();
});

function createPersistentBreakerNamespace() {
  const state = new Map<
    string,
    {
      consecutiveRetryableFailures: number;
      openedAt?: number;
    }
  >();

  return {
    idFromName(name: string) {
      return { name };
    },
    get(id: { name: string }) {
      return {
        async fetch(request: Request) {
          const current = state.get(id.name) ?? {
            consecutiveRetryableFailures: 0
          };

          if (request.method === "GET") {
            return Response.json(current);
          }

          if (request.method === "POST") {
            const body = (await request.json()) as {
              kind: "success" | "retryable_failure";
              threshold?: number;
              now?: number;
            };

            if (body.kind === "success") {
              const next = {
                consecutiveRetryableFailures: 0
              };
              state.set(id.name, next);
              return Response.json(next);
            }

            const nextFailures = current.consecutiveRetryableFailures + 1;
            const next = {
              consecutiveRetryableFailures: nextFailures,
              ...(nextFailures >= (body.threshold ?? 1)
                ? { openedAt: body.now ?? 0 }
                : {})
            };
            state.set(id.name, next);
            return Response.json(next);
          }

          return new Response("Method not allowed", { status: 405 });
        }
      };
    }
  };
}

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
        providerMaxRetries: 0,
        providerRetryBackoffMs: 0,
        modelGroups: {},
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
          providerMaxRetries: 0,
          providerRetryBackoffMs: 0,
          modelGroups: {},
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

  it("opens a target circuit after repeated retryable failures and skips it on the next request", async () => {
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
                text: "hello from fallback"
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
    const baseConfig = {
      mode: "free" as const,
      providerTimeoutMs: 1000,
      providerMaxRetries: 0,
      providerRetryBackoffMs: 0,
      providerCircuitBreakerThreshold: 1,
      providerCircuitBreakerCooldownMs: 60_000,
      modelGroups: {},
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
    };

    const firstResponse = await executeRoutedRequest(route, request, {
      config: baseConfig,
      requestId: "req_breaker_first",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher,
      now: () => 1000
    });

    expect(firstResponse.model).toBe("claude-haiku-4-5");
    expect(fetcher).toHaveBeenCalledTimes(2);

    fetcher.mockClear();
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "msg_456",
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5",
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: "hello after breaker skip"
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

    const secondResponse = await executeRoutedRequest(route, request, {
      config: baseConfig,
      requestId: "req_breaker_second",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher,
      now: () => 2000
    });

    expect(secondResponse.model).toBe("claude-haiku-4-5");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/messages");
  });

  it("allows a cooled-down target to recover on a later successful request", async () => {
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
                text: "fallback"
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
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "chatcmpl_789",
            object: "chat.completion",
            created: 1,
            model: "gpt-4.1-mini",
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: "primary recovered"
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
    const baseConfig = {
      mode: "free" as const,
      providerTimeoutMs: 1000,
      providerMaxRetries: 0,
      providerRetryBackoffMs: 0,
      providerCircuitBreakerThreshold: 1,
      providerCircuitBreakerCooldownMs: 100,
      modelGroups: {},
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
    };

    await executeRoutedRequest(route, request, {
      config: baseConfig,
      requestId: "req_breaker_cooldown_first",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher,
      now: () => 1000
    });

    const recoveredResponse = await executeRoutedRequest(route, request, {
      config: baseConfig,
      requestId: "req_breaker_cooldown_second",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher,
      now: () => 1200
    });

    expect(recoveredResponse.model).toBe("gpt-4.1-mini");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[2]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("returns a typed routing error when every otherwise-eligible target is open", async () => {
    const route: ModelRoute = {
      externalModel: "assistant-default",
      target: {
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      }
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
    const config = {
      mode: "free" as const,
      providerTimeoutMs: 1000,
      providerMaxRetries: 0,
      providerRetryBackoffMs: 0,
      providerCircuitBreakerThreshold: 1,
      providerCircuitBreakerCooldownMs: 60_000,
      modelGroups: {},
      gatewayApiKeys: [],
      modelAliases: [],
      openAI: {
        apiKey: "openai-secret",
        baseUrl: "https://api.openai.com/v1",
        defaultModel: "gpt-4.1-mini"
      }
    };

    await expect(
      executeRoutedRequest(route, request, {
        config,
        requestId: "req_breaker_open_first",
        gatewayApiKey: {
          id: "key_any",
          label: "Any Provider",
          value: "gateway-secret",
          status: "active"
        },
        fetcher,
        now: () => 1000
      })
    ).rejects.toMatchObject({
      code: "provider_upstream_error",
      category: "provider",
      httpStatus: 429
    });

    await expect(
      executeRoutedRequest(route, request, {
        config,
        requestId: "req_breaker_open_second",
        gatewayApiKey: {
          id: "key_any",
          label: "Any Provider",
          value: "gateway-secret",
          status: "active"
        },
        fetcher,
        now: () => 2000
      })
    ).rejects.toMatchObject({
      code: "provider_circuit_open",
      category: "routing",
      httpStatus: 503,
      retryable: true
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("opens the circuit across later executions when using the persistent breaker backend", async () => {
    const route: ModelRoute = {
      externalModel: "assistant-default",
      target: {
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      }
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
    const backend = createPersistentCircuitBreakerBackend(
      createPersistentBreakerNamespace()
    );
    const config = {
      mode: "free" as const,
      providerTimeoutMs: 1000,
      providerMaxRetries: 0,
      providerRetryBackoffMs: 0,
      providerCircuitBreakerThreshold: 1,
      providerCircuitBreakerCooldownMs: 60_000,
      modelGroups: {},
      gatewayApiKeys: [],
      modelAliases: [],
      openAI: {
        apiKey: "openai-secret",
        baseUrl: "https://api.openai.com/v1",
        defaultModel: "gpt-4.1-mini"
      }
    };

    await expect(
      executeRoutedRequest(route, request, {
        config,
        requestId: "req_persistent_breaker_first",
        gatewayApiKey: {
          id: "key_any",
          label: "Any Provider",
          value: "gateway-secret",
          status: "active"
        },
        fetcher,
        now: () => 1000,
        circuitBreakerBackend: backend
      })
    ).rejects.toMatchObject({
      code: "provider_upstream_error",
      httpStatus: 429
    });

    await expect(
      executeRoutedRequest(route, request, {
        config,
        requestId: "req_persistent_breaker_second",
        gatewayApiKey: {
          id: "key_any",
          label: "Any Provider",
          value: "gateway-secret",
          status: "active"
        },
        fetcher,
        now: () => 2000,
        circuitBreakerBackend: backend
      })
    ).rejects.toMatchObject({
      code: "provider_circuit_open",
      httpStatus: 503
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
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
        providerMaxRetries: 0,
        providerRetryBackoffMs: 0,
        modelGroups: {},
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
        providerMaxRetries: 0,
        providerRetryBackoffMs: 0,
        modelGroups: {},
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

  it("can start from a weighted fallback target before the configured primary target", async () => {
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
      ],
      targetSelection: {
        strategy: "weighted",
        weights: {
          "openai:gpt-4.1-mini": 1,
          "anthropic:claude-haiku-4-5": 10_000
        }
      }
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
        providerMaxRetries: 0,
        providerRetryBackoffMs: 0,
        modelGroups: {},
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
      requestId: "req_weighted",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/messages");
    expect(response.model).toBe("claude-haiku-4-5");
  });

  it("uses the weighted ordered chain for retryable failover", async () => {
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
        },
        {
          provider: "gemini",
          providerModel: "gemini-2.5-flash"
        }
      ],
      targetSelection: {
        strategy: "weighted",
        weights: {
          "openai:gpt-4.1-mini": 1,
          "anthropic:claude-haiku-4-5": 10_000,
          "gemini:gemini-2.5-flash": 5_000
        }
      }
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
            responseId: "gemini-response-123",
            modelVersion: "gemini-2.5-flash",
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      text: "hello from gemini"
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

    const response = await executeRoutedRequest(route, request, {
      config: {
        mode: "free",
        providerTimeoutMs: 1000,
        providerMaxRetries: 0,
        providerRetryBackoffMs: 0,
        modelGroups: {},
        gatewayApiKeys: [],
        modelAliases: [],
        anthropic: {
          apiKey: "anthropic-secret",
          baseUrl: "https://api.anthropic.com/v1",
          defaultMaxTokens: 256
        },
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
      requestId: "req_weighted_failover",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/messages");
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    );
    expect(response.model).toBe("gemini-2.5-flash");
  });

  it("can start from a lower-cost fallback target before the configured primary target", async () => {
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
      ],
      targetSelection: {
        strategy: "lowest_cost",
        costs: {
          "openai:gpt-4.1-mini": 10,
          "anthropic:claude-haiku-4-5": 3
        }
      }
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
        providerMaxRetries: 0,
        providerRetryBackoffMs: 0,
        modelGroups: {},
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
      requestId: "req_lowest_cost",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/messages");
    expect(response.model).toBe("claude-haiku-4-5");
  });

  it("uses the cost-aware ordered chain for retryable failover", async () => {
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
        },
        {
          provider: "gemini",
          providerModel: "gemini-2.5-flash"
        }
      ],
      targetSelection: {
        strategy: "lowest_cost",
        costs: {
          "openai:gpt-4.1-mini": 10,
          "anthropic:claude-haiku-4-5": 2,
          "gemini:gemini-2.5-flash": 4
        }
      }
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
            responseId: "gemini-response-123",
            modelVersion: "gemini-2.5-flash",
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      text: "hello from gemini"
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

    const response = await executeRoutedRequest(route, request, {
      config: {
        mode: "free",
        providerTimeoutMs: 1000,
        providerMaxRetries: 0,
        providerRetryBackoffMs: 0,
        modelGroups: {},
        gatewayApiKeys: [],
        modelAliases: [],
        anthropic: {
          apiKey: "anthropic-secret",
          baseUrl: "https://api.anthropic.com/v1",
          defaultMaxTokens: 256
        },
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
      requestId: "req_lowest_cost_failover",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/messages");
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    );
    expect(response.model).toBe("gemini-2.5-flash");
  });

  it("starts streaming from the first weighted eligible target", async () => {
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
      ],
      targetSelection: {
        strategy: "weighted",
        weights: {
          "openai:gpt-4.1-mini": 1,
          "anthropic:claude-haiku-4-5": 10000
        }
      }
    };
    const request: CanonicalRequest = {
      model: "gpt-4.1-mini",
      stream: true,
      messages: [
        {
          role: "user",
          content: "Say hi."
        }
      ]
    };
    const encoder = new TextEncoder();
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                [
                  'event: message_start\ndata: {"message":{"id":"msg_123","model":"claude-haiku-4-5"}}\n\n',
                  'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"hello"}}\n\n',
                  "event: message_stop\ndata: {}\n\n",
                  "data: [DONE]\n\n"
                ].join("")
              )
            );
            controller.close();
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "text/event-stream"
          }
        }
      )
    );

    const { executeRoutedStreamRequest } = await import("./provider-execution.js");
    const events: Array<unknown> = [];

    for await (const event of executeRoutedStreamRequest(route, request, {
      config: {
        mode: "free",
        providerTimeoutMs: 1000,
        providerMaxRetries: 3,
        providerRetryBackoffMs: 0,
        modelGroups: {},
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
      requestId: "req_stream_123",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher
    })) {
      events.push(event);
    }

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/messages");
    expect(events).toEqual([
      {
        type: "response_started",
        responseId: "msg_123",
        model: "claude-haiku-4-5"
      },
      {
        type: "output_text_delta",
        responseId: "msg_123",
        model: "claude-haiku-4-5",
        delta: "hello"
      },
      {
        type: "response_completed",
        responseId: "msg_123",
        model: "claude-haiku-4-5",
        finishReason: "stop"
      }
    ]);
  });

  it("starts streaming from a weighted gemini target when it is the first eligible streaming target", async () => {
    const route: ModelRoute = {
      externalModel: "assistant-default",
      target: {
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      },
      fallbacks: [
        {
          provider: "gemini",
          providerModel: "gemini-2.5-flash"
        }
      ],
      targetSelection: {
        strategy: "weighted",
        weights: {
          "openai:gpt-4.1-mini": 1,
          "gemini:gemini-2.5-flash": 10000
        }
      }
    };
    const request: CanonicalRequest = {
      model: "gpt-4.1-mini",
      stream: true,
      messages: [
        {
          role: "user",
          content: "Say hi."
        }
      ]
    };
    const encoder = new TextEncoder();
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                [
                  'data: {"responseId":"gemini-response-123","modelVersion":"gemini-2.5-flash","candidates":[{"content":{"role":"model","parts":[{"text":"hello"}]}}]}\n\n',
                  'data: {"responseId":"gemini-response-123","modelVersion":"gemini-2.5-flash","candidates":[{"finishReason":"STOP","content":{"role":"model","parts":[]}}]}\n\n'
                ].join("")
              )
            );
            controller.close();
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "text/event-stream"
          }
        }
      )
    );
    const events: Array<unknown> = [];

    for await (const event of executeRoutedStreamRequest(route, request, {
      config: {
        mode: "free",
        providerTimeoutMs: 1000,
        providerMaxRetries: 3,
        providerRetryBackoffMs: 0,
        modelGroups: {},
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
      requestId: "req_stream_gemini_123",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher
    })) {
      events.push(event);
    }

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse"
    );
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
        delta: "hello"
      },
      {
        type: "response_completed",
        responseId: "gemini-response-123",
        model: "gemini-2.5-flash",
        finishReason: "stop"
      }
    ]);
  });

  it("retries a retryable provider failure on the same target before falling through to fallback", async () => {
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
                  content: "hello after retry"
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
        providerMaxRetries: 1,
        providerRetryBackoffMs: 10,
        modelGroups: {},
        gatewayApiKeys: [],
        modelAliases: [],
        openAI: {
          apiKey: "openai-secret",
          baseUrl: "https://api.openai.com/v1",
          defaultModel: "gpt-4.1-mini"
        }
      },
      requestId: "req_retry_same_target",
      gatewayApiKey: allowedOpenAIOnlyKey,
      fetcher
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse((fetcher.mock.calls[0] as [string, RequestInit])[1].body as string))
      .toMatchObject({
        model: "gpt-4.1-mini"
      });
    expect(JSON.parse((fetcher.mock.calls[1] as [string, RequestInit])[1].body as string))
      .toMatchObject({
        model: "gpt-4.1-mini"
      });
    expect(response.model).toBe("gpt-4.1-mini");
  });

  it("does not retry a non-retryable provider failure on the same target", async () => {
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
            message: "bad request"
          }
        }),
        {
          status: 400,
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
          providerMaxRetries: 2,
          providerRetryBackoffMs: 10,
          modelGroups: {},
          gatewayApiKeys: [],
          modelAliases: [],
          openAI: {
            apiKey: "openai-secret",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4.1-mini"
          }
        },
        requestId: "req_no_retry_bad_request",
        gatewayApiKey: allowedOpenAIOnlyKey,
        fetcher
      })
    ).rejects.toMatchObject({
      code: "provider_upstream_error",
      category: "provider",
      httpStatus: 400,
      retryable: false
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("falls through to fallback only after same-target retries are exhausted", async () => {
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
            error: {
              message: "still rate limited"
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
            id: "chatcmpl_fallback",
            object: "chat.completion",
            created: 1,
            model: "gpt-4.1-nano",
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: "fallback hello"
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
        providerMaxRetries: 1,
        providerRetryBackoffMs: 10,
        modelGroups: {},
        gatewayApiKeys: [],
        modelAliases: [],
        openAI: {
          apiKey: "openai-secret",
          baseUrl: "https://api.openai.com/v1",
          defaultModel: "gpt-4.1-mini"
        }
      },
      requestId: "req_retry_then_fallback",
      gatewayApiKey: allowedOpenAIOnlyKey,
      fetcher
    });

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(JSON.parse((fetcher.mock.calls[0] as [string, RequestInit])[1].body as string))
      .toMatchObject({
        model: "gpt-4.1-mini"
      });
    expect(JSON.parse((fetcher.mock.calls[1] as [string, RequestInit])[1].body as string))
      .toMatchObject({
        model: "gpt-4.1-mini"
      });
    expect(JSON.parse((fetcher.mock.calls[2] as [string, RequestInit])[1].body as string))
      .toMatchObject({
        model: "gpt-4.1-nano"
      });
    expect(response.model).toBe("gpt-4.1-nano");
  });

  it("stops same-target retries when retry backoff would exhaust the shared timeout budget", async () => {
    const route: ModelRoute = {
      externalModel: "gpt-4.1-mini",
      target: {
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      }
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
      .mockReturnValueOnce(980);

    const execution = executeRoutedRequest(route, request, {
      config: {
        mode: "free",
        providerTimeoutMs: 1000,
        providerMaxRetries: 1,
        providerRetryBackoffMs: 50,
        modelGroups: {},
        gatewayApiKeys: [],
        modelAliases: [],
        openAI: {
          apiKey: "openai-secret",
          baseUrl: "https://api.openai.com/v1",
          defaultModel: "gpt-4.1-mini"
        }
      },
      requestId: "req_retry_budget_exhausted",
      gatewayApiKey: allowedOpenAIOnlyKey,
      fetcher,
      now
    });

    await expect(execution).rejects.toMatchObject({
      code: "provider_timeout",
      category: "provider",
      httpStatus: 504
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
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
        providerMaxRetries: 0,
        providerRetryBackoffMs: 0,
        modelGroups: {},
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
          providerMaxRetries: 0,
          providerRetryBackoffMs: 0,
          modelGroups: {},
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
