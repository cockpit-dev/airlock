import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CanonicalRequest, CanonicalStreamEvent } from "@airlock/canonical";
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

function computeSmoothedLatency(
  previous: number | undefined,
  current: number
): number {
  if (previous === undefined) {
    return current;
  }

  return Math.round(previous * 0.7 + current * 0.3);
}

function computeEffectiveTestCooldownMs(
  cooldownMs: number,
  halfOpenRetryableFailureCount: number | undefined
): number {
  const halfOpenFailures = Math.max(0, halfOpenRetryableFailureCount ?? 0);
  return cooldownMs * Math.min(4, 2 ** halfOpenFailures);
}

function createPersistentBreakerNamespace() {
  const state = new Map<
    string,
    {
      consecutiveRetryableFailures: number;
      openedAt?: number;
      probeStartedAt?: number;
      halfOpenRetryableFailureCount?: number;
      lastSuccessLatencyMs?: number;
      smoothedSuccessLatencyMs?: number;
      lastSuccessTotalTokens?: number;
      smoothedSuccessTotalTokens?: number;
      lastSuccessAt?: number;
      lastUsageObservedAt?: number;
      lastFailureAt?: number;
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
              kind: "success" | "retryable_failure" | "claim_half_open_probe";
              threshold?: number;
              cooldownMs?: number;
              latencyMs?: number;
              totalTokens?: number;
              smoothedLatencyMs?: number;
              now?: number;
            };

            if (body.kind === "success") {
              const nextSmoothedLatencyMs =
                body.latencyMs !== undefined
                  ? computeSmoothedLatency(
                      current.smoothedSuccessLatencyMs,
                      body.latencyMs
                    )
                  : body.smoothedLatencyMs;
              const nextSmoothedTotalTokens =
                body.totalTokens !== undefined
                  ? computeSmoothedLatency(
                      current.smoothedSuccessTotalTokens,
                      body.totalTokens
                    )
                  : undefined;
              const next = {
                consecutiveRetryableFailures: 0,
                halfOpenRetryableFailureCount: 0,
                ...(body.latencyMs !== undefined
                  ? { lastSuccessLatencyMs: body.latencyMs }
                  : {}),
                ...(nextSmoothedLatencyMs !== undefined
                  ? { smoothedSuccessLatencyMs: nextSmoothedLatencyMs }
                  : {}),
                ...(body.totalTokens !== undefined
                  ? { lastSuccessTotalTokens: body.totalTokens }
                  : current.lastSuccessTotalTokens !== undefined
                    ? { lastSuccessTotalTokens: current.lastSuccessTotalTokens }
                    : {}),
                ...(nextSmoothedTotalTokens !== undefined
                  ? { smoothedSuccessTotalTokens: nextSmoothedTotalTokens }
                  : current.smoothedSuccessTotalTokens !== undefined
                    ? {
                        smoothedSuccessTotalTokens:
                          current.smoothedSuccessTotalTokens
                      }
                    : {}),
                ...(body.now !== undefined ? { lastSuccessAt: body.now } : {}),
                ...(body.totalTokens !== undefined && body.now !== undefined
                  ? { lastUsageObservedAt: body.now }
                  : current.lastUsageObservedAt !== undefined
                    ? { lastUsageObservedAt: current.lastUsageObservedAt }
                    : {}),
                ...(current.lastFailureAt !== undefined
                  ? { lastFailureAt: current.lastFailureAt }
                  : {})
              };
              state.set(id.name, next);
              return Response.json(next);
            }

            if (body.kind === "claim_half_open_probe") {
              const cooldownMs = body.cooldownMs ?? 0;
              const effectiveCooldownMs = computeEffectiveTestCooldownMs(
                cooldownMs,
                current.halfOpenRetryableFailureCount
              );

              if (!current.openedAt || body.now === undefined) {
                return Response.json({ claimed: false });
              }

              if (body.now - current.openedAt < effectiveCooldownMs) {
                return Response.json({ claimed: false });
              }

              if (
                current.probeStartedAt !== undefined &&
                body.now - current.probeStartedAt < effectiveCooldownMs
              ) {
                return Response.json({ claimed: false });
              }

              const next = {
                ...current,
                probeStartedAt: body.now
              };
              state.set(id.name, next);
              return Response.json({ claimed: true });
            }

            const nextFailures = current.consecutiveRetryableFailures + 1;
            const halfOpenProbeFailed = current.probeStartedAt !== undefined;
            const next: {
              consecutiveRetryableFailures: number;
              openedAt?: number;
              probeStartedAt?: number;
              halfOpenRetryableFailureCount?: number;
              lastSuccessLatencyMs?: number;
              smoothedSuccessLatencyMs?: number;
              lastSuccessTotalTokens?: number;
              smoothedSuccessTotalTokens?: number;
              lastSuccessAt?: number;
              lastUsageObservedAt?: number;
              lastFailureAt?: number;
            } = {
              consecutiveRetryableFailures: nextFailures,
              halfOpenRetryableFailureCount: halfOpenProbeFailed
                ? (current.halfOpenRetryableFailureCount ?? 0) + 1
                : 0,
              ...(current.lastSuccessLatencyMs !== undefined
                ? { lastSuccessLatencyMs: current.lastSuccessLatencyMs }
                : {}),
              ...(current.smoothedSuccessLatencyMs !== undefined
                ? { smoothedSuccessLatencyMs: current.smoothedSuccessLatencyMs }
                : {}),
              ...(current.lastSuccessTotalTokens !== undefined
                ? { lastSuccessTotalTokens: current.lastSuccessTotalTokens }
                : {}),
              ...(current.smoothedSuccessTotalTokens !== undefined
                ? { smoothedSuccessTotalTokens: current.smoothedSuccessTotalTokens }
                : {}),
              ...(current.lastSuccessAt !== undefined
                ? { lastSuccessAt: current.lastSuccessAt }
                : {}),
              ...(current.lastUsageObservedAt !== undefined
                ? { lastUsageObservedAt: current.lastUsageObservedAt }
                : {}),
              ...((halfOpenProbeFailed ||
                nextFailures >= (body.threshold ?? 1))
                ? { openedAt: body.now ?? 0 }
                : {}),
              ...(body.now !== undefined ? { lastFailureAt: body.now } : {})
            };
            delete next.probeStartedAt;
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
          supportsToolReplay: false,
          supportsStreamingTools: false,
          supportsMultimodalInput: false,
          supportsSystemMessages: false,
          supportsEndUserId: false,
          supportsPreviousResponseId: false,
          supportsConversationId: false,
          supportsPrompt: false,
          supportsReasoning: false,
          supportsStructuredOutputs: false,
          supportsParallelToolCallControl: false,
          supportsOpenAIRequestMetadata: false,
          supportsOpenAIResponsesTextControls: false,
          supportsRouteScopedShaping: true,
          supportsStaticFallbackSameProvider: true
        },
        request,
        "req_123"
      )
    ).toThrow(GatewayError);
  });

  it("throws a typed error when the provider descriptor lacks structured output support", () => {
    const request: CanonicalRequest = {
      model: "gpt-4.1-mini",
      stream: false,
      outputFormat: {
        type: "json_schema",
        name: "weather",
        schema: {
          type: "object"
        },
        strict: true
      },
      messages: [
        {
          role: "user",
          content: "Say hi."
        }
      ]
    };

    expect(() =>
      assertProviderSupportsCanonicalRequest(
        getProviderCapabilityDescriptor("anthropic"),
        request,
        "req_123"
      )
    ).toThrow(
      new GatewayError(
        "Provider anthropic does not support required capability: structured_outputs",
        {
          code: "provider_capability_not_supported",
          category: "routing",
          httpStatus: 400,
          retryable: false,
          provider: "anthropic",
          requestId: "req_123"
        }
      )
    );
  });

  it("allows structured output requests for gemini", () => {
    const request: CanonicalRequest = {
      model: "gemini-2.5-flash",
      stream: false,
      outputFormat: {
        type: "json_schema",
        name: "weather",
        schema: {
          type: "object"
        },
        strict: true
      },
      messages: [
        {
          role: "user",
          content: "Say hi."
        }
      ]
    };

    expect(() =>
      assertProviderSupportsCanonicalRequest(
        getProviderCapabilityDescriptor("gemini"),
        request,
        "req_123"
      )
    ).not.toThrow();
  });

  it("throws a typed error when the provider descriptor lacks parallel tool call control support", () => {
    const request: CanonicalRequest = {
      model: "gpt-4.1-mini",
      stream: false,
      allowParallelToolCalls: false,
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
          content: "Say hi."
        }
      ]
    };

    expect(() =>
      assertProviderSupportsCanonicalRequest(
        getProviderCapabilityDescriptor("anthropic"),
        request,
        "req_123"
      )
    ).toThrow(
      new GatewayError(
        "Provider anthropic does not support required capability: parallel_tool_call_control",
        {
          code: "provider_capability_not_supported",
          category: "routing",
          httpStatus: 400,
          retryable: false,
          provider: "anthropic",
          requestId: "req_123"
        }
      )
    );
  });

  it("throws a typed error when the provider descriptor lacks explicit parallel tool call enablement support", () => {
    const request: CanonicalRequest = {
      model: "gpt-4.1-mini",
      stream: false,
      allowParallelToolCalls: true,
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
          content: "Say hi."
        }
      ]
    };

    expect(() =>
      assertProviderSupportsCanonicalRequest(
        getProviderCapabilityDescriptor("anthropic"),
        request,
        "req_123"
      )
    ).toThrow(
      new GatewayError(
        "Provider anthropic does not support required capability: parallel_tool_call_control",
        {
          code: "provider_capability_not_supported",
          category: "routing",
          httpStatus: 400,
          retryable: false,
          provider: "anthropic",
          requestId: "req_123"
        }
      )
    );
  });

  it("throws a typed error when the provider descriptor lacks OpenAI Responses text controls support", () => {
    const request: CanonicalRequest = {
      model: "gpt-4.1-mini",
      stream: false,
      responseTruncation: "disabled",
      responseTextVerbosity: "high",
      messages: [
        {
          role: "user",
          content: "Say hi."
        }
      ]
    };

    expect(() =>
      assertProviderSupportsCanonicalRequest(
        getProviderCapabilityDescriptor("anthropic"),
        request,
        "req_123"
      )
    ).toThrow(
      new GatewayError(
        "Provider anthropic does not support required capability: openai_responses_text_controls",
        {
          code: "provider_capability_not_supported",
          category: "routing",
          httpStatus: 400,
          retryable: false,
          provider: "anthropic",
          requestId: "req_123"
        }
      )
    );
  });

  it("throws a typed error when the provider descriptor lacks OpenAI-native request metadata envelope support", () => {
    const request: CanonicalRequest = {
      model: "gpt-4.1-mini",
      stream: false,
      serviceTier: "priority",
      store: false,
      promptCacheKey: "cache-key-123",
      promptCacheRetention: "in_memory",
      messages: [
        {
          role: "user",
          content: "Say hi."
        }
      ]
    };

    expect(() =>
      assertProviderSupportsCanonicalRequest(
        getProviderCapabilityDescriptor("anthropic"),
        request,
        "req_123"
      )
    ).toThrow(
      new GatewayError(
        "Provider anthropic does not support required capability: openai_request_metadata",
        {
          code: "provider_capability_not_supported",
          category: "routing",
          httpStatus: 400,
          retryable: false,
          provider: "anthropic",
          requestId: "req_123"
        }
      )
    );
  });

  it("throws a typed error when the provider descriptor lacks responses include_obfuscation support", () => {
    const request: CanonicalRequest = {
      model: "gpt-4.1-mini",
      stream: true,
      providerMetadata: {
        openai: {
          responsesIncludeObfuscation: false
        }
      },
      messages: [
        {
          role: "user",
          content: "Say hi."
        }
      ]
    };

    expect(() =>
      assertProviderSupportsCanonicalRequest(
        getProviderCapabilityDescriptor("anthropic"),
        request,
        "req_123"
      )
    ).toThrow(
      new GatewayError(
        "Provider anthropic does not support required capability: openai_request_metadata",
        {
          code: "provider_capability_not_supported",
          category: "routing",
          httpStatus: 400,
          retryable: false,
          provider: "anthropic",
          requestId: "req_123"
        }
      )
    );
  });

  it("allows buffered tool replay requests for gemini", () => {
    const request: CanonicalRequest = {
      model: "gemini-2.5-flash",
      stream: false,
      messages: [
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
        }
      ]
    };

    expect(() =>
      assertProviderSupportsCanonicalRequest(
        getProviderCapabilityDescriptor("gemini"),
        request,
        "req_123"
      )
    ).not.toThrow();
  });

  it("allows streamed tool requests for gemini", () => {
    const request: CanonicalRequest = {
      model: "gemini-2.5-flash",
      stream: true,
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
        }
      ]
    };

    expect(() =>
      assertProviderSupportsCanonicalRequest(
        getProviderCapabilityDescriptor("gemini"),
        request,
        "req_123"
      )
    ).not.toThrow();
  });

  it("allows streamed tool replay requests for gemini", () => {
    const request: CanonicalRequest = {
      model: "gemini-2.5-flash",
      stream: true,
      messages: [
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
        }
      ]
    };

    expect(() =>
      assertProviderSupportsCanonicalRequest(
        getProviderCapabilityDescriptor("gemini"),
        request,
        "req_123"
      )
    ).not.toThrow();
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

  it("reopens the circuit immediately when a half-open probe fails retryably", async () => {
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
    let openAIAttempts = 0;
    let anthropicAttempts = 0;
    const fetcher = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/chat/completions")) {
        openAIAttempts += 1;

        return new Response(
          JSON.stringify({
            error: {
              message: openAIAttempts === 1 ? "rate limited" : "still rate limited"
            }
          }),
          {
            status: 429,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }

      anthropicAttempts += 1;

      return new Response(
        JSON.stringify({
          id: `msg_fallback_${anthropicAttempts}`,
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5",
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: `fallback ${anthropicAttempts}`
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    });
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
      requestId: "req_half_open_first",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher,
      now: () => 1000
    });

    const secondResponse = await executeRoutedRequest(route, request, {
      config: baseConfig,
      requestId: "req_half_open_probe",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher,
      now: () => 1200
    });

    expect(secondResponse.model).toBe("claude-haiku-4-5");

    await expect(
      executeRoutedRequest(route, request, {
        config: baseConfig,
        requestId: "req_half_open_reopened",
        gatewayApiKey: {
          id: "key_any",
          label: "Any Provider",
          value: "gateway-secret",
          status: "active"
        },
        fetcher,
        now: () => 1250
      })
    ).resolves.toMatchObject({
      model: "claude-haiku-4-5"
    });

    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(openAIAttempts).toBe(2);
    expect(anthropicAttempts).toBe(3);
  });

  it("backs off the next half-open probe after repeated failed recovery probes", async () => {
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
    let openAIAttempts = 0;
    let anthropicAttempts = 0;
    const fetcher = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/chat/completions")) {
        openAIAttempts += 1;

        return new Response(
          JSON.stringify({
            error: {
              message: `rate limited ${openAIAttempts}`
            }
          }),
          {
            status: 429,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }

      anthropicAttempts += 1;

      return new Response(
        JSON.stringify({
          id: `msg_backoff_${anthropicAttempts}`,
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5",
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: `fallback ${anthropicAttempts}`
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    });
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
      requestId: "req_backoff_first_open",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher,
      now: () => 1000
    });

    await executeRoutedRequest(route, request, {
      config: baseConfig,
      requestId: "req_backoff_first_probe_fail",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher,
      now: () => 1200
    });

    const beforeExtendedBackoff = await executeRoutedRequest(route, request, {
      config: baseConfig,
      requestId: "req_backoff_before_extended_probe",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher,
      now: () => 1350
    });

    expect(beforeExtendedBackoff.model).toBe("claude-haiku-4-5");
    expect(openAIAttempts).toBe(2);

    const afterExtendedBackoff = await executeRoutedRequest(route, request, {
      config: baseConfig,
      requestId: "req_backoff_after_extended_probe",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher,
      now: () => 1450
    });

    expect(afterExtendedBackoff.model).toBe("claude-haiku-4-5");
    expect(openAIAttempts).toBe(3);
    expect(anthropicAttempts).toBe(4);
  });

  it("still probes a half-open target before a closed peer in the execution chain", async () => {
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
        strategy: "health_priority"
      }
    };
    const request: CanonicalRequest = {
      model: "assistant-default",
      stream: false,
      messages: [
        {
          role: "user",
          content: "Say hi."
        }
      ]
    };
    const backend = createPersistentCircuitBreakerBackend(
      createPersistentBreakerNamespace()
    );
    let openAIAttempts = 0;
    let anthropicAttempts = 0;
    const fetcher = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/chat/completions")) {
        openAIAttempts += 1;

        if (openAIAttempts === 1) {
          return new Response(
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
          );
        }

        return new Response(
          JSON.stringify({
            id: "chatcmpl_half_open_health",
            object: "chat.completion",
            created: 1,
            model: "gpt-4.1-mini",
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: "half-open primary was used"
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
        );
      }

      anthropicAttempts += 1;

      return new Response(
        JSON.stringify({
          id: `msg_healthy_peer_${anthropicAttempts}`,
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5",
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: `healthy fallback ${anthropicAttempts}`
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    });
    const config = {
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
      config,
      requestId: "req_half_open_health_first",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher,
      now: () => 1000,
      circuitBreakerBackend: backend
    });

    const secondResponse = await executeRoutedRequest(route, request, {
      config,
      requestId: "req_half_open_health_second",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher,
      now: () => 1200,
      circuitBreakerBackend: backend
    });

    expect(secondResponse.model).toBe("gpt-4.1-mini");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[2]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(openAIAttempts).toBe(2);
    expect(anthropicAttempts).toBe(1);
  });

  it("reuses bounded half-open probe promotion for streaming requests", async () => {
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
        strategy: "health_priority"
      }
    };
    const bufferedRequest: CanonicalRequest = {
      model: "assistant-default",
      stream: false,
      messages: [
        {
          role: "user",
          content: "Say hi."
        }
      ]
    };
    const streamingRequest: CanonicalRequest = {
      ...bufferedRequest,
      stream: true
    };
    const backend = createPersistentCircuitBreakerBackend(
      createPersistentBreakerNamespace()
    );
    let openAIAttempts = 0;
    let anthropicAttempts = 0;
    const encoder = new TextEncoder();
    const fetcher = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/chat/completions")) {
        openAIAttempts += 1;

        if (openAIAttempts === 1) {
          return new Response(
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
          );
        }

        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  [
                    'data: {"id":"chatcmpl_half_open_stream","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
                    'data: {"id":"chatcmpl_half_open_stream","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"content":"half-open stream"},"finish_reason":null}]}\n\n',
                    'data: {"id":"chatcmpl_half_open_stream","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
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
        );
      }

      anthropicAttempts += 1;

      if (anthropicAttempts === 1) {
        return new Response(
          JSON.stringify({
            id: "msg_closed_peer_1",
            type: "message",
            role: "assistant",
            model: "claude-haiku-4-5",
            stop_reason: "end_turn",
            content: [
              {
                type: "text",
                text: "closed peer 1"
              }
            ]
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }

      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                [
                  'event: message_start\ndata: {"message":{"id":"msg_closed_peer_stream","model":"claude-haiku-4-5"}}\n\n',
                  'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"closed stream"}}\n\n',
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
      );
    });
    const config = {
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

    await executeRoutedRequest(route, bufferedRequest, {
      config,
      requestId: "req_half_open_promote_first",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher,
      now: () => 1000,
      circuitBreakerBackend: backend
    });

    const events: Array<unknown> = [];

    for await (const event of executeRoutedStreamRequest(route, streamingRequest, {
      config,
      requestId: "req_half_open_promote_stream",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher,
      now: () => 1200,
      circuitBreakerBackend: backend
    })) {
      events.push(event);
    }

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[2]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(openAIAttempts).toBe(2);
    expect(anthropicAttempts).toBe(1);
    expect(events).toEqual([
      {
        type: "response_started",
        responseId: "chatcmpl_half_open_stream",
        model: "gpt-4.1-mini"
      },
      {
        type: "output_text_delta",
        responseId: "chatcmpl_half_open_stream",
        model: "gpt-4.1-mini",
        delta: "half-open stream"
      },
      {
        type: "response_completed",
        responseId: "chatcmpl_half_open_stream",
        model: "gpt-4.1-mini",
        finishReason: "stop"
      }
    ]);
  });

  it("fails over to the next streaming target when the first target errors before yielding events", async () => {
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
      model: "assistant-default",
      stream: true,
      messages: [
        {
          role: "user",
          content: "Say hi."
        }
      ]
    };
    const encoder = new TextEncoder();
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
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  [
                    'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_stream_fallback","type":"message","role":"assistant","model":"claude-haiku-4-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":12,"output_tokens":0}}}\n\n',
                    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
                    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"fallback stream"}}\n\n',
                    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
                    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":4}}\n\n',
                    'event: message_stop\ndata: {"type":"message_stop"}\n\n'
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
    const config = {
      mode: "free" as const,
      providerTimeoutMs: 1000,
      providerMaxRetries: 0,
      providerRetryBackoffMs: 0,
      providerCircuitBreakerThreshold: 3,
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

    const events: CanonicalStreamEvent[] = [];

    for await (const event of executeRoutedStreamRequest(route, request, {
      config,
      requestId: "req_stream_failover",
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

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(fetcher.mock.calls[1]?.[0]).toBe("https://api.anthropic.com/v1/messages");
    expect(events).toEqual([
      {
        type: "response_started",
        responseId: "msg_stream_fallback",
        model: "claude-haiku-4-5"
      },
      {
        type: "output_text_delta",
        responseId: "msg_stream_fallback",
        model: "claude-haiku-4-5",
        delta: "fallback stream"
      },
      {
        type: "response_completed",
        responseId: "msg_stream_fallback",
        model: "claude-haiku-4-5",
        finishReason: "stop",
        usage: {
          inputTokens: 0,
          outputTokens: 4,
          totalTokens: 4
        }
      }
    ]);
  });

  it("retries the same streaming target before falling back to the next target", async () => {
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
      model: "assistant-default",
      stream: true,
      messages: [
        {
          role: "user",
          content: "Say hi."
        }
      ]
    };
    const encoder = new TextEncoder();
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
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  [
                    'data: {"id":"chatcmpl_retry_stream","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
                    'data: {"id":"chatcmpl_retry_stream","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"content":"retry stream"},"finish_reason":null}]}\n\n',
                    'data: {"id":"chatcmpl_retry_stream","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
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
    const config = {
      mode: "free" as const,
      providerTimeoutMs: 1000,
      providerMaxRetries: 1,
      providerRetryBackoffMs: 0,
      providerCircuitBreakerThreshold: 3,
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

    const events: CanonicalStreamEvent[] = [];

    for await (const event of executeRoutedStreamRequest(route, request, {
      config,
      requestId: "req_stream_retry",
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

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(fetcher.mock.calls[1]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(events).toEqual([
      {
        type: "response_started",
        responseId: "chatcmpl_retry_stream",
        model: "gpt-4.1-mini"
      },
      {
        type: "output_text_delta",
        responseId: "chatcmpl_retry_stream",
        model: "gpt-4.1-mini",
        delta: "retry stream"
      },
      {
        type: "response_completed",
        responseId: "chatcmpl_retry_stream",
        model: "gpt-4.1-mini",
        finishReason: "stop"
      }
    ]);
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

  it("prefers a healthier closed fallback target on a later request when health-priority selection is configured", async () => {
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
        strategy: "health_priority"
      }
    };
    const request: CanonicalRequest = {
      model: "assistant-default",
      stream: false,
      messages: [
        {
          role: "user",
          content: "Say hi."
        }
      ]
    };
    const backend = createPersistentCircuitBreakerBackend(
      createPersistentBreakerNamespace()
    );
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
                text: "healthy fallback"
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
            id: "msg_124",
            type: "message",
            role: "assistant",
            model: "claude-haiku-4-5",
            stop_reason: "end_turn",
            content: [
              {
                type: "text",
                text: "healthy fallback again"
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
    const config = {
      mode: "free" as const,
      providerTimeoutMs: 1000,
      providerMaxRetries: 0,
      providerRetryBackoffMs: 0,
      providerCircuitBreakerThreshold: 3,
      providerCircuitBreakerCooldownMs: 60_000,
      providerCircuitBreakerPersistent: true,
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
      config,
      requestId: "req_health_open_primary",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher,
      now: () => 1000,
      circuitBreakerBackend: backend
    });

    expect(firstResponse.model).toBe("claude-haiku-4-5");

    const response = await executeRoutedRequest(route, request, {
      config,
      requestId: "req_health_priority_second",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher,
      now: () => 2000,
      circuitBreakerBackend: backend
    });

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://api.openai.com/v1/chat/completions"
    );
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "https://api.anthropic.com/v1/messages"
    );
    expect(fetcher.mock.calls[2]?.[0]).toBe(
      "https://api.anthropic.com/v1/messages"
    );
    expect(response.model).toBe("claude-haiku-4-5");
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
            supportsToolReplay: false,
            supportsStreamingTools: false,
            supportsMultimodalInput: false,
            supportsSystemMessages: false,
            supportsEndUserId: false,
            supportsPreviousResponseId: false,
            supportsConversationId: false,
            supportsPrompt: false,
            supportsReasoning: false,
            supportsStructuredOutputs: false,
            supportsParallelToolCallControl: false,
            supportsOpenAIRequestMetadata: false,
            supportsOpenAIResponsesTextControls: false,
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

  it("retains a smoothed latency signal across repeated successes", async () => {
    const backend = createPersistentCircuitBreakerBackend(
      createPersistentBreakerNamespace()
    );
    const target = {
      provider: "openai" as const,
      providerModel: "gpt-4.1-mini"
    };

    await backend.recordSuccess(target, 1000, 1000);
    await backend.recordSuccess(target, 100, 2000);

    await expect(backend.getState(target)).resolves.toMatchObject({
      lastSuccessLatencyMs: 100,
      smoothedSuccessLatencyMs: 730,
      lastSuccessAt: 2000
    });
  });

  it("retains the latest usage-observed timestamp independently from later usage-free successes", async () => {
    const backend = createPersistentCircuitBreakerBackend(
      createPersistentBreakerNamespace()
    );
    const target = {
      provider: "openai" as const,
      providerModel: "gpt-4.1-mini"
    };

    await backend.recordSuccess(target, 200, 500, 1000);
    await backend.recordSuccess(target, 150, undefined, 2000);

    await expect(backend.getState(target)).resolves.toMatchObject({
      lastSuccessLatencyMs: 150,
      lastSuccessAt: 2000,
      lastSuccessTotalTokens: 500,
      smoothedSuccessTotalTokens: 500,
      lastUsageObservedAt: 1000
    });
  });

  it("retains the last failure signal across a recovery success", async () => {
    const backend = createPersistentCircuitBreakerBackend(
      createPersistentBreakerNamespace()
    );
    const target = {
      provider: "openai" as const,
      providerModel: "gpt-4.1-mini"
    };

    await backend.recordSuccess(target, 300, 1000);
    await backend.recordRetryableFailure(
      target,
      {
        threshold: 3,
        cooldownMs: 60_000
      },
      1500
    );
    await backend.recordSuccess(target, 250, 2000);

    await expect(backend.getState(target)).resolves.toMatchObject({
      consecutiveRetryableFailures: 0,
      lastSuccessLatencyMs: 250,
      smoothedSuccessLatencyMs: 285,
      lastSuccessAt: 2000,
      lastFailureAt: 1500
    });
  });

  it("uses smoothed latency instead of only the latest raw latency for priority routing", async () => {
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
        strategy: "priority",
        latencySloMs: {
          "openai:gpt-4.1-mini": 300,
          "anthropic:claude-haiku-4-5": 300
        },
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
    const backend = createPersistentCircuitBreakerBackend(
      createPersistentBreakerNamespace()
    );

    await backend.recordSuccess(
      {
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      },
      1000,
      1000
    );
    await backend.recordSuccess(
      {
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      },
      100,
      2000
    );
    await backend.recordSuccess(
      {
        provider: "anthropic",
        providerModel: "claude-haiku-4-5"
      },
      200,
      1000
    );

    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "msg_smoothed_latency",
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
        providerCircuitBreakerThreshold: 3,
        providerCircuitBreakerCooldownMs: 60_000,
        providerCircuitBreakerPersistent: true,
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
      requestId: "req_priority_smoothed_latency",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher,
      now: () => 3000,
      circuitBreakerBackend: backend
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/messages");
    expect(response.model).toBe("claude-haiku-4-5");
  });

  it("keeps a recently failed target behind a stable peer during priority recovery", async () => {
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
        strategy: "priority",
        latencySloMs: {
          "openai:gpt-4.1-mini": 600,
          "anthropic:claude-haiku-4-5": 600
        },
        costs: {
          "openai:gpt-4.1-mini": 1,
          "anthropic:claude-haiku-4-5": 10
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
    const backend = createPersistentCircuitBreakerBackend(
      createPersistentBreakerNamespace()
    );

    await backend.recordSuccess(
      {
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      },
      200,
      1000
    );
    await backend.recordRetryableFailure(
      {
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      },
      {
        threshold: 3,
        cooldownMs: 60_000
      },
      1500
    );
    await backend.recordSuccess(
      {
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      },
      220,
      2000
    );
    await backend.recordSuccess(
      {
        provider: "anthropic",
        providerModel: "claude-haiku-4-5"
      },
      220,
      1000
    );

    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "msg_priority_recovery",
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
        providerCircuitBreakerThreshold: 3,
        providerCircuitBreakerCooldownMs: 60_000,
        providerCircuitBreakerPersistent: true,
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
      requestId: "req_priority_recovery",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher,
      now: () => 2500,
      circuitBreakerBackend: backend
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/messages");
    expect(response.model).toBe("claude-haiku-4-5");
  });

  it("lets a recovered priority target age out of recovery penalty after the window", async () => {
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
        strategy: "priority",
        latencySloMs: {
          "openai:gpt-4.1-mini": 400,
          "anthropic:claude-haiku-4-5": 400
        },
        costs: {
          "openai:gpt-4.1-mini": 1,
          "anthropic:claude-haiku-4-5": 10
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
    const backend = createPersistentCircuitBreakerBackend(
      createPersistentBreakerNamespace()
    );

    await backend.recordSuccess(
      {
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      },
      200,
      1_000
    );
    await backend.recordSuccess(
      {
        provider: "anthropic",
        providerModel: "claude-haiku-4-5"
      },
      200,
      1_000
    );
    await backend.recordRetryableFailure(
      {
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      },
      {
        threshold: 3,
        cooldownMs: 60_000
      },
      10_000
    );
    await backend.recordSuccess(
      {
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      },
      220,
      12_000
    );

    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "chatcmpl_priority_recovery_window_aged_out",
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
        providerCircuitBreakerThreshold: 3,
        providerCircuitBreakerCooldownMs: 60_000,
        providerCircuitBreakerPersistent: true,
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
      requestId: "req_priority_recovery_window_aged_out",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher,
      now: () => 50_000,
      circuitBreakerBackend: backend
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(response.model).toBe("gpt-4.1-mini");
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

  it("prefers a healthy in-slo target before a cheaper out-of-slo target when priority selection is configured", async () => {
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
        strategy: "priority",
        latencySloMs: {
          "openai:gpt-4.1-mini": 300,
          "anthropic:claude-haiku-4-5": 800
        },
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
    const backend = createPersistentCircuitBreakerBackend(
      createPersistentBreakerNamespace()
    );

    await backend.recordSuccess(
      {
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      },
      200,
      1000
    );
    await backend.recordSuccess(
      {
        provider: "anthropic",
        providerModel: "claude-haiku-4-5"
      },
      1200,
      1000
    );

    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "chatcmpl_priority",
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
        providerCircuitBreakerThreshold: 3,
        providerCircuitBreakerCooldownMs: 60_000,
        providerCircuitBreakerPersistent: true,
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
      requestId: "req_priority_slo",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher,
      now: () => 2000,
      circuitBreakerBackend: backend
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(response.model).toBe("gpt-4.1-mini");
  });

  it("uses cost to break priority ties when targets are equally healthy and in-slo", async () => {
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
        strategy: "priority",
        latencySloMs: {
          "openai:gpt-4.1-mini": 600,
          "anthropic:claude-haiku-4-5": 600
        },
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
    const backend = createPersistentCircuitBreakerBackend(
      createPersistentBreakerNamespace()
    );

    await backend.recordSuccess(
      {
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      },
      200,
      1000
    );
    await backend.recordSuccess(
      {
        provider: "anthropic",
        providerModel: "claude-haiku-4-5"
      },
      200,
      1000
    );

    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "msg_priority_cost",
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
        providerCircuitBreakerThreshold: 3,
        providerCircuitBreakerCooldownMs: 60_000,
        providerCircuitBreakerPersistent: true,
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
      requestId: "req_priority_cost",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher,
      now: () => 2000,
      circuitBreakerBackend: backend
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/messages");
    expect(response.model).toBe("claude-haiku-4-5");
  });

  it("uses observed token cost memory to reorder lowest-cost routing", async () => {
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
          "openai:gpt-4.1-mini": 1,
          "anthropic:claude-haiku-4-5": 2
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
    const backend = createPersistentCircuitBreakerBackend(
      createPersistentBreakerNamespace()
    );

    await backend.recordSuccess(
      {
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      },
      200,
      500,
      1000
    );
    await backend.recordSuccess(
      {
        provider: "anthropic",
        providerModel: "claude-haiku-4-5"
      },
      200,
      50,
      1000
    );

    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "msg_dynamic_cost",
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5",
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: "hello from anthropic"
            }
          ],
          usage: {
            input_tokens: 12,
            output_tokens: 8
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

    const response = await executeRoutedRequest(route, request, {
      config: {
        mode: "free",
        providerTimeoutMs: 1000,
        providerMaxRetries: 0,
        providerRetryBackoffMs: 0,
        providerCircuitBreakerThreshold: 3,
        providerCircuitBreakerCooldownMs: 60_000,
        providerCircuitBreakerPersistent: true,
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
      requestId: "req_dynamic_lowest_cost",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher,
      now: () => 2000,
      circuitBreakerBackend: backend
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/messages");
    expect(response.model).toBe("claude-haiku-4-5");
  });

  it("uses observed token cost memory to break priority cost ties", async () => {
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
        strategy: "priority",
        latencySloMs: {
          "openai:gpt-4.1-mini": 600,
          "anthropic:claude-haiku-4-5": 600
        },
        costs: {
          "openai:gpt-4.1-mini": 1,
          "anthropic:claude-haiku-4-5": 2
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
    const backend = createPersistentCircuitBreakerBackend(
      createPersistentBreakerNamespace()
    );

    await backend.recordSuccess(
      {
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      },
      200,
      500,
      1000
    );
    await backend.recordSuccess(
      {
        provider: "anthropic",
        providerModel: "claude-haiku-4-5"
      },
      200,
      50,
      1000
    );

    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "msg_dynamic_priority_cost",
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5",
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: "hello from anthropic"
            }
          ],
          usage: {
            input_tokens: 12,
            output_tokens: 8
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

    const response = await executeRoutedRequest(route, request, {
      config: {
        mode: "free",
        providerTimeoutMs: 1000,
        providerMaxRetries: 0,
        providerRetryBackoffMs: 0,
        providerCircuitBreakerThreshold: 3,
        providerCircuitBreakerCooldownMs: 60_000,
        providerCircuitBreakerPersistent: true,
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
      requestId: "req_dynamic_priority_cost",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher,
      now: () => 2000,
      circuitBreakerBackend: backend
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/messages");
    expect(response.model).toBe("claude-haiku-4-5");
  });

  it("preserves original route order when priority targets are otherwise tied", async () => {
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
        strategy: "priority",
        costs: {
          "openai:gpt-4.1-mini": 1,
          "anthropic:claude-haiku-4-5": 1
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
          id: "chatcmpl_priority_route_order_tie",
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
        providerCircuitBreakerThreshold: 3,
        providerCircuitBreakerCooldownMs: 60_000,
        providerCircuitBreakerPersistent: true,
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
      requestId: "req_priority_route_order_tie",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(response.model).toBe("gpt-4.1-mini");
  });

  it("preserves original route order when lowest-cost targets are otherwise tied", async () => {
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
          "openai:gpt-4.1-mini": 1,
          "anthropic:claude-haiku-4-5": 1
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
          id: "chatcmpl_lowest_cost_route_order_tie",
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
        providerCircuitBreakerThreshold: 3,
        providerCircuitBreakerCooldownMs: 60_000,
        providerCircuitBreakerPersistent: true,
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
      requestId: "req_lowest_cost_route_order_tie",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(response.model).toBe("gpt-4.1-mini");
  });

  it("treats stale closed-target retryable failure counts as neutral for priority routing", async () => {
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
        strategy: "priority",
        costs: {
          "openai:gpt-4.1-mini": 1,
          "anthropic:claude-haiku-4-5": 10
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
    const backend = createPersistentCircuitBreakerBackend(
      createPersistentBreakerNamespace()
    );

    await backend.recordSuccess(
      {
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      },
      200,
      1_000
    );
    await backend.recordSuccess(
      {
        provider: "anthropic",
        providerModel: "claude-haiku-4-5"
      },
      200,
      1_000
    );
    await backend.recordRetryableFailure(
      {
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      },
      {
        threshold: 3,
        cooldownMs: 60_000
      },
      10_000
    );

    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "chatcmpl_priority_stale_failure_count",
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
        providerCircuitBreakerThreshold: 3,
        providerCircuitBreakerCooldownMs: 60_000,
        providerCircuitBreakerPersistent: true,
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
      requestId: "req_priority_stale_failure_count",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher,
      now: () => 50_000,
      circuitBreakerBackend: backend
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(response.model).toBe("gpt-4.1-mini");
  });

  it("treats stale observed token cost memory as neutral for lowest-cost routing", async () => {
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
          "openai:gpt-4.1-mini": 1,
          "anthropic:claude-haiku-4-5": 10
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
    const backend = createPersistentCircuitBreakerBackend(
      createPersistentBreakerNamespace()
    );

    await backend.recordSuccess(
      {
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      },
      200,
      500,
      1_000
    );
    await backend.recordSuccess(
      {
        provider: "anthropic",
        providerModel: "claude-haiku-4-5"
      },
      200,
      50,
      60_000
    );

    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "chatcmpl_stale_dynamic_cost",
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
        providerCircuitBreakerThreshold: 3,
        providerCircuitBreakerCooldownMs: 60_000,
        providerCircuitBreakerPersistent: true,
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
      requestId: "req_stale_dynamic_lowest_cost",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher,
      now: () => 70_000,
      circuitBreakerBackend: backend
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(response.model).toBe("gpt-4.1-mini");
  });

  it("treats stale observed token cost memory as neutral for priority cost tie-breaking", async () => {
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
        strategy: "priority",
        costs: {
          "openai:gpt-4.1-mini": 1,
          "anthropic:claude-haiku-4-5": 10
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
    const backend = createPersistentCircuitBreakerBackend(
      createPersistentBreakerNamespace()
    );

    await backend.recordSuccess(
      {
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      },
      200,
      500,
      1_000
    );
    await backend.recordSuccess(
      {
        provider: "anthropic",
        providerModel: "claude-haiku-4-5"
      },
      200,
      50,
      60_000
    );

    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "chatcmpl_stale_dynamic_priority_cost",
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
        providerCircuitBreakerThreshold: 3,
        providerCircuitBreakerCooldownMs: 60_000,
        providerCircuitBreakerPersistent: true,
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
      requestId: "req_stale_dynamic_priority_cost",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher,
      now: () => 70_000,
      circuitBreakerBackend: backend
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(response.model).toBe("gpt-4.1-mini");
  });

  it("does not refresh stale observed token cost memory with a later usage-free success", async () => {
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
          "openai:gpt-4.1-mini": 1,
          "anthropic:claude-haiku-4-5": 10
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
    const backend = createPersistentCircuitBreakerBackend(
      createPersistentBreakerNamespace()
    );

    await backend.recordSuccess(
      {
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      },
      200,
      500,
      1_000
    );
    await backend.recordSuccess(
      {
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      },
      120,
      undefined,
      69_000
    );
    await backend.recordSuccess(
      {
        provider: "anthropic",
        providerModel: "claude-haiku-4-5"
      },
      200,
      50,
      60_000
    );

    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "chatcmpl_stale_usage_free_refresh",
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
        providerCircuitBreakerThreshold: 3,
        providerCircuitBreakerCooldownMs: 60_000,
        providerCircuitBreakerPersistent: true,
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
      requestId: "req_stale_usage_free_refresh",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher,
      now: () => 70_000,
      circuitBreakerBackend: backend
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(response.model).toBe("gpt-4.1-mini");
  });

  it("prefers the target that is closer to its slo when all priority targets are out of slo", async () => {
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
        strategy: "priority",
        latencySloMs: {
          "openai:gpt-4.1-mini": 300,
          "anthropic:claude-haiku-4-5": 300
        },
        costs: {
          "openai:gpt-4.1-mini": 50,
          "anthropic:claude-haiku-4-5": 1
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
    const backend = createPersistentCircuitBreakerBackend(
      createPersistentBreakerNamespace()
    );

    await backend.recordSuccess(
      {
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      },
      320,
      1000
    );
    await backend.recordSuccess(
      {
        provider: "anthropic",
        providerModel: "claude-haiku-4-5"
      },
      900,
      1000
    );

    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "chatcmpl_priority_closer_slo",
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
        providerCircuitBreakerThreshold: 3,
        providerCircuitBreakerCooldownMs: 60_000,
        providerCircuitBreakerPersistent: true,
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
      requestId: "req_priority_closer_slo",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher,
      now: () => 2000,
      circuitBreakerBackend: backend
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(response.model).toBe("gpt-4.1-mini");
  });

  it("records observed token cost memory from streaming completion usage", async () => {
    const route: ModelRoute = {
      externalModel: "assistant-default",
      target: {
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      }
    };
    const request: CanonicalRequest = {
      model: "assistant-default",
      stream: true,
      messages: [
        {
          role: "user",
          content: "Say hi."
        }
      ]
    };
    const encoder = new TextEncoder();
    const backend = createPersistentCircuitBreakerBackend(
      createPersistentBreakerNamespace()
    );
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                [
                  'data: {"id":"chatcmpl_stream_cost","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
                  'data: {"id":"chatcmpl_stream_cost","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":null}]}\n\n',
                  'data: {"id":"chatcmpl_stream_cost","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":8,"total_tokens":20}}\n\n',
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

    const events: CanonicalStreamEvent[] = [];

    for await (const event of executeRoutedStreamRequest(route, request, {
      config: {
        mode: "free",
        providerTimeoutMs: 1000,
        providerMaxRetries: 0,
        providerRetryBackoffMs: 0,
        providerCircuitBreakerThreshold: 3,
        providerCircuitBreakerCooldownMs: 60_000,
        providerCircuitBreakerPersistent: true,
        modelGroups: {},
        gatewayApiKeys: [],
        modelAliases: [],
        openAI: {
          apiKey: "openai-secret",
          baseUrl: "https://api.openai.com/v1",
          defaultModel: "gpt-4.1-mini"
        }
      },
      requestId: "req_stream_observed_cost",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher,
      circuitBreakerBackend: backend,
      now: () => 1000
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({
      type: "response_completed",
      usage: {
        totalTokens: 20
      }
    });
    await expect(
      backend.getState({
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      })
    ).resolves.toMatchObject({
      lastSuccessTotalTokens: 20,
      smoothedSuccessTotalTokens: 20
    });
  });

  it("treats stale success latency memory as neutral for priority routing", async () => {
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
        strategy: "priority",
        latencySloMs: {
          "openai:gpt-4.1-mini": 300,
          "anthropic:claude-haiku-4-5": 300
        },
        costs: {
          "openai:gpt-4.1-mini": 1,
          "anthropic:claude-haiku-4-5": 10
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
    const backend = createPersistentCircuitBreakerBackend(
      createPersistentBreakerNamespace()
    );

    await backend.recordSuccess(
      {
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      },
      120,
      1000
    );
    await backend.recordSuccess(
      {
        provider: "anthropic",
        providerModel: "claude-haiku-4-5"
      },
      200,
      60_000
    );

    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "msg_priority_freshness",
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
        providerCircuitBreakerThreshold: 3,
        providerCircuitBreakerCooldownMs: 60_000,
        providerCircuitBreakerPersistent: true,
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
      requestId: "req_priority_freshness",
      gatewayApiKey: {
        id: "key_any",
        label: "Any Provider",
        value: "gateway-secret",
        status: "active"
      },
      fetcher,
      now: () => 70_000,
      circuitBreakerBackend: backend
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/messages");
    expect(response.model).toBe("claude-haiku-4-5");
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

  it("passes only the remaining timeout budget to a streaming attempt", async () => {
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
                  'event: message_start\ndata: {"message":{"id":"msg_timeout_budget","model":"claude-haiku-4-5"}}\n\n',
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
    const abortTimeouts: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    const timeoutSpy = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation(((handler: (...args: unknown[]) => void, timeout?: number, ...args: unknown[]) => {
        abortTimeouts.push(Number(timeout));
        return originalSetTimeout(handler, 0, ...args);
      }) as typeof setTimeout);
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(850)
      .mockReturnValueOnce(850)
      .mockReturnValueOnce(900)
      .mockReturnValueOnce(900);
    try {
      for await (const event of executeRoutedStreamRequest(route, request, {
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
        requestId: "req_stream_timeout_budget",
        gatewayApiKey: {
          id: "key_any",
          label: "Any Provider",
          value: "gateway-secret",
          status: "active"
        },
        fetcher,
        now
      })) {
        void event;
      }
    } finally {
      timeoutSpy.mockRestore();
    }

    expect(abortTimeouts[0]).toBe(150);
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
