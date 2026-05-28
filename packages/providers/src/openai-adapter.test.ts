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
    expect(response.createdAt).toBe(1);
    expect(response.usage).toEqual({
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20
    });
  });

  it("preserves OpenAI chat system_fingerprint on buffered responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl_123",
          object: "chat.completion",
          created: 1,
          model: "gpt-4.1-mini",
          system_fingerprint: "fp_123",
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

    const response = await adapter.complete(createCanonicalRequest(), {
      requestId: "req_123"
    });

    expect(response.systemFingerprint).toBe("fp_123");
  });

  it("uses the native OpenAI responses endpoint when requestMode=openai_responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_123",
          object: "response",
          created_at: 1,
          model: "gpt-4.1-mini",
          status: "completed",
          output: [
            {
              id: "msg_123",
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
          ],
          usage: {
            input_tokens: 12,
            output_tokens: 8,
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
      fetcher
    });

    const response = await adapter.complete(
      {
        ...createCanonicalRequest(),
        previousResponseId: "resp_prev_123",
        conversationId: "conv_123"
      },
      {
        requestId: "req_123",
        requestMode: "openai_responses"
      }
    );

    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(JSON.parse(init.body as string)).toEqual({
      model: "gpt-4.1-mini",
      stream: false,
      input: [
        {
          type: "message",
          role: "system",
          content: "You are precise."
        },
        {
          type: "message",
          role: "user",
          content: "Say hi."
        }
      ],
      previous_response_id: "resp_prev_123",
      conversation: {
        id: "conv_123"
      }
    });
    expect(response).toMatchObject({
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
    expect(response.nativeResponse?.openaiResponses).toMatchObject({
      id: "resp_123",
      object: "response",
      output: [
        {
          id: "msg_123",
          type: "message",
          role: "assistant"
        }
      ]
    });
  });

  it("extracts cached token usage from buffered chat responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl_cached",
          object: "chat.completion",
          created: 1,
          model: "gpt-4.1-mini",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "cached hello"
              }
            }
          ],
          usage: {
            prompt_tokens: 20,
            completion_tokens: 6,
            total_tokens: 26,
            prompt_tokens_details: {
              cached_tokens: 14
            }
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
      fetcher
    });

    const response = await adapter.complete(createCanonicalRequest(), {
      requestId: "req_cached_chat"
    });

    expect(response.usage).toEqual({
      inputTokens: 20,
      outputTokens: 6,
      totalTokens: 26,
      cacheReadTokens: 14,
      cachedInputTokens: 14
    });
  });

  it("extracts cached token usage from buffered responses api responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_cached",
          object: "response",
          created_at: 1,
          model: "gpt-4.1-mini",
          status: "completed",
          output: [
            {
              id: "msg_cached",
              type: "message",
              role: "assistant",
              status: "completed",
              content: [
                {
                  type: "output_text",
                  text: "cached response",
                  annotations: []
                }
              ]
            }
          ],
          usage: {
            input_tokens: 22,
            output_tokens: 7,
            total_tokens: 29,
            input_tokens_details: {
              cached_tokens: 11
            }
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
      fetcher
    });

    const response = await adapter.complete(createCanonicalRequest(), {
      requestId: "req_cached_responses",
      requestMode: "openai_responses"
    });

    expect(response.usage).toEqual({
      inputTokens: 22,
      outputTokens: 7,
      totalTokens: 29,
      cacheReadTokens: 11,
      cachedInputTokens: 11
    });
  });

  it("preserves native responses passthrough fields and payload shapes for Codex-compatible requests", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_123",
          object: "response",
          created_at: 1,
          model: "gpt-4.1-mini",
          status: "completed",
          output: [],
          usage: {
            input_tokens: 12,
            output_tokens: 8,
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
      fetcher
    });

    await adapter.complete(
      {
        model: "gpt-4.1-mini",
        stream: false,
        messages: [{ role: "user", content: "hello" }],
        passthrough: {
          include: ["reasoning.encrypted_content"],
          input: [
            {
              type: "message",
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: "hello"
                }
              ]
            },
            {
              type: "custom_tool_call",
              call_id: "custom_123",
              name: "shell_command",
              input: '{"command":"pwd"}'
            }
          ],
          tools: [
            {
              type: "web_search",
              external_web_access: true
            }
          ]
        }
      },
      {
        requestId: "req_123",
        requestMode: "openai_responses"
      }
    );

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      include: ["reasoning.encrypted_content"],
      input: [
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "hello"
            }
          ]
        },
        {
          type: "custom_tool_call",
          call_id: "custom_123",
          name: "shell_command",
          input: '{"command":"pwd"}'
        }
      ],
      tools: [
        {
          type: "web_search",
          external_web_access: true
        }
      ]
    });
  });

  it("forwards canonical endUserId through OpenAI chat completions as safety_identifier", async () => {
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
        endUserId: "user_123"
      },
      {
        requestId: "req_123"
      }
    );

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      safety_identifier: "user_123"
    });
  });

  it("forwards canonical OpenAI-native request metadata through chat completions", async () => {
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
        serviceTier: "flex",
        store: true,
        promptCacheKey: "cache-key-123",
        promptCacheRetention: "24h"
      },
      {
        requestId: "req_123"
      }
    );

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      service_tier: "flex",
      store: true,
      prompt_cache_key: "cache-key-123",
      prompt_cache_retention: "24h"
    });
  });

  it("forwards canonical OpenAI chat logprobs controls", async () => {
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
              },
              logprobs: {
                content: [
                  {
                    token: "hello",
                    logprob: -0.1,
                    top_logprobs: [
                      {
                        token: "hello",
                        logprob: -0.1
                      }
                    ]
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
        providerMetadata: {
          openai: {
            logprobs: true,
            topLogprobs: 5
          }
        }
      },
      {
        requestId: "req_123"
      }
    );

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      logprobs: true,
      top_logprobs: 5
    });
    expect(response.outputTextLogprobs).toEqual({
      content: [
        {
          token: "hello",
          logprob: -0.1,
          topLogprobs: [
            {
              token: "hello",
              logprob: -0.1
            }
          ]
        }
      ]
    });
  });

  it("forwards canonical OpenAI chat metadata and preserves it in the response", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl_123",
          object: "chat.completion",
          created: 1,
          model: "gpt-4.1-mini",
          metadata: {
            tenant: "acme",
            request_class: "interactive"
          },
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

    const response = await adapter.complete(
      {
        ...createCanonicalRequest(),
        providerMetadata: {
          openai: {
            metadata: {
              tenant: "acme",
              request_class: "interactive"
            }
          }
        }
      },
      {
        requestId: "req_123"
      }
    );

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      metadata: {
        tenant: "acme",
        request_class: "interactive"
      }
    });
    expect(response.metadata).toEqual({
      tenant: "acme",
      request_class: "interactive"
    });
  });

  it("forwards canonical endUserId through OpenAI responses as safety_identifier", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_123",
          object: "response",
          created_at: 1,
          model: "gpt-4.1-mini",
          status: "completed",
          output: [],
          output_text: "hello there"
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
        endUserId: "user_123"
      },
      {
        requestId: "req_123",
        requestMode: "openai_responses"
      }
    );

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      safety_identifier: "user_123"
    });
  });

  it("forwards canonical OpenAI-native request metadata through responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_123",
          object: "response",
          created_at: 1,
          model: "gpt-4.1-mini",
          status: "completed",
          output: [],
          output_text: "hello there"
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
        serviceTier: "priority",
        store: false,
        promptCacheKey: "cache-key-123",
        promptCacheRetention: "in_memory"
      },
      {
        requestId: "req_123",
        requestMode: "openai_responses"
      }
    );

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      service_tier: "priority",
      store: false,
      prompt_cache_key: "cache-key-123",
      prompt_cache_retention: "in_memory"
    });
  });

  it("forwards canonical OpenAI responses metadata and preserves it in the response", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_123",
          object: "response",
          created_at: 1,
          model: "gpt-4.1-mini",
          status: "completed",
          output: [],
          output_text: "hello there",
          metadata: {
            tenant: "acme",
            request_class: "interactive"
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
      fetcher
    });

    const response = await adapter.complete(
      {
        ...createCanonicalRequest(),
        providerMetadata: {
          openai: {
            metadata: {
              tenant: "acme",
              request_class: "interactive"
            }
          }
        }
      },
      {
        requestId: "req_123",
        requestMode: "openai_responses"
      }
    );

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      metadata: {
        tenant: "acme",
        request_class: "interactive"
      }
    });
    expect(response.metadata).toEqual({
      tenant: "acme",
      request_class: "interactive"
    });
  });

  it("forwards parallel_tool_calls=false through OpenAI chat completions", async () => {
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
        allowParallelToolCalls: false,
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
        requestId: "req_123"
      }
    );

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      parallel_tool_calls: false
    });
  });

  it("forwards reasoning_effort through OpenAI chat completions", async () => {
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
        reasoningEffort: "high"
      },
      {
        requestId: "req_123"
      }
    );

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      reasoning_effort: "high"
    });
  });

  it("forwards and parses parallel_tool_calls=false through the native openai responses endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_123",
          object: "response",
          created_at: 1,
          model: "gpt-4.1-mini",
          status: "completed",
          parallel_tool_calls: false,
          output: [
            {
              id: "msg_123",
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
        allowParallelToolCalls: false,
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
        requestId: "req_123",
        requestMode: "openai_responses"
      }
    );

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      parallel_tool_calls: false
    });
    expect(response.parallelToolCalls).toBe(false);
    expect(response.createdAt).toBe(1);
  });

  it("forwards parallel_tool_calls=false through streamed native openai responses requests", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'data: {"type":"response.created","sequence_number":0,"response":{"id":"resp_123","object":"response","created_at":1,"model":"gpt-4.1-mini","status":"in_progress","output":[],"parallel_tool_calls":false,"tools":[]}}\n\n',
              'data: {"type":"response.completed","sequence_number":1,"response":{"id":"resp_123","object":"response","created_at":1,"model":"gpt-4.1-mini","status":"completed","output":[],"parallel_tool_calls":false,"tools":[]}}\n\n',
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
        stream: true,
        allowParallelToolCalls: false,
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
        requestId: "req_stream_123",
        requestMode: "openai_responses"
      }
    )) {
      events.push(event);
    }

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      parallel_tool_calls: false
    });
    expect(events).toEqual([
      {
        type: "response_started",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        parallelToolCalls: false
      },
      {
        type: "response_completed",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        finishReason: "stop",
        parallelToolCalls: false
      }
    ]);
  });

  it("forwards prompt and reasoning.effort through the native openai responses endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_123",
          object: "response",
          created_at: 1,
          model: "gpt-4.1-mini",
          status: "completed",
          output: [
            {
              id: "msg_123",
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
        messages: [],
        prompt: {
          id: "pmpt_123",
          variables: {
            city: "Shanghai"
          },
          version: "7"
        },
        reasoningEffort: "medium"
      },
      {
        requestId: "req_123",
        requestMode: "openai_responses"
      }
    );

    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(JSON.parse(init.body as string)).toEqual({
      model: "gpt-4.1-mini",
      stream: false,
      input: [],
      prompt: {
        id: "pmpt_123",
        variables: {
          city: "Shanghai"
        },
        version: "7"
      },
      reasoning: {
        effort: "medium"
      }
    });
  });

  it("forwards responses output-text logprobs controls and preserves buffered output-text logprobs", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_123",
          object: "response",
          created_at: 1,
          model: "gpt-4.1-mini",
          status: "completed",
          output: [
            {
              id: "msg_123",
              type: "message",
              role: "assistant",
              status: "completed",
              content: [
                {
                  type: "output_text",
                  text: "hello",
                  annotations: [],
                  logprobs: {
                    content: [
                      {
                        token: "hello",
                        logprob: -0.1,
                        top_logprobs: [
                          {
                            token: "hello",
                            logprob: -0.1
                          }
                        ]
                      }
                    ]
                  }
                }
              ]
            }
          ],
          usage: {
            input_tokens: 12,
            output_tokens: 8,
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
      fetcher
    });

    const response = await adapter.complete(
      {
        ...createCanonicalRequest(),
        providerMetadata: {
          openai: {
            responsesOutputTextLogprobs: true,
            responsesTopLogprobs: 5
          }
        }
      },
      {
        requestId: "req_123",
        requestMode: "openai_responses"
      }
    );

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      include: ["message.output_text.logprobs"],
      top_logprobs: 5
    });
    expect(response.outputTextLogprobs).toEqual({
      content: [
        {
          token: "hello",
          logprob: -0.1,
          topLogprobs: [
            {
              token: "hello",
              logprob: -0.1
            }
          ]
        }
      ]
    });
  });

  it("forwards conversation object, truncation, and text verbosity through the native openai responses endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_123",
          object: "response",
          created_at: 1,
          model: "gpt-4.1-mini",
          status: "completed",
          conversation: {
            id: "conv_123"
          },
          truncation: "disabled",
          text: {
            verbosity: "low"
          },
          output: [
            {
              id: "msg_123",
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
        responseTruncation: "disabled",
        responseTextVerbosity: "low",
        conversationId: "conv_123"
      },
      {
        requestId: "req_123",
        requestMode: "openai_responses"
      }
    );

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      conversation: {
        id: "conv_123"
      },
      truncation: "disabled",
      text: {
        verbosity: "low"
      }
    });
    expect(response.conversationId).toBe("conv_123");
    expect(response.responseTruncation).toBe("disabled");
    expect(response.responseTextVerbosity).toBe("low");
  });

  it("forwards reasoning.summary through the native openai responses endpoint and preserves reasoning output items", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_123",
          object: "response",
          created_at: 1,
          model: "gpt-4.1-mini",
          status: "completed",
          output: [
            {
              type: "reasoning",
              id: "rs_123",
              summary: [
                {
                  type: "summary_text",
                  text: "The model checked the answer."
                }
              ]
            },
            {
              id: "msg_123",
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
        messages: [],
        reasoningEffort: "medium",
        reasoningSummary: "auto"
      },
      {
        requestId: "req_123",
        requestMode: "openai_responses"
      }
    );

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      reasoning: {
        effort: "medium",
        summary: "auto"
      }
    });
    expect(response.reasoningSummary).toBe("The model checked the answer.");
    expect(response.outputText).toBe("hello there");
  });

  it("encodes pure reasoning replay into a native openai responses reasoning item without duplicating assistant output text", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_123",
          object: "response",
          created_at: 1,
          model: "gpt-4.1-mini",
          status: "completed",
          output: []
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
        messages: [
          {
            role: "assistant",
            content: "The model checked the answer.",
            reasoningSummary: "The model checked the answer."
          },
          {
            role: "user",
            content: "Continue."
          }
        ]
      },
      {
        requestId: "req_reasoning_replay_123",
        requestMode: "openai_responses"
      }
    );

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      input: unknown[];
    };
    expect(body).toMatchObject({
      input: [
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
          type: "message",
          role: "user",
          content: "Continue."
        }
      ]
    });
    expect(body.input).toHaveLength(2);
  });

  it("streams reasoning summary events through the native openai responses endpoint", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'data: {"type":"response.created","sequence_number":0,"response":{"id":"resp_123","object":"response","created_at":1,"model":"gpt-4.1-mini","status":"in_progress","output":[],"parallel_tool_calls":true,"tools":[],"metadata":{"tenant":"acme"},"service_tier":"priority","prompt_cache_key":"cache-key-123","prompt_cache_retention":"in_memory","truncation":"disabled","text":{"verbosity":"high"},"conversation":{"id":"conv_123"}}}\n\n',
              'data: {"type":"response.output_item.added","sequence_number":1,"output_index":0,"item":{"type":"reasoning","id":"rs_123","summary":[]}}\n\n',
              'data: {"type":"response.reasoning_summary_text.delta","sequence_number":2,"output_index":0,"summary_index":0,"delta":"The model checked"}\n\n',
              'data: {"type":"response.completed","sequence_number":3,"response":{"id":"resp_123","object":"response","created_at":1,"model":"gpt-4.1-mini","status":"completed","output":[{"type":"reasoning","id":"rs_123","summary":[{"type":"summary_text","text":"The model checked the answer."}]}],"parallel_tool_calls":true,"tools":[],"metadata":{"tenant":"acme"},"service_tier":"priority","prompt_cache_key":"cache-key-123","prompt_cache_retention":"in_memory","truncation":"disabled","text":{"verbosity":"high"},"conversation":{"id":"conv_123"}}}\n\n',
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
        stream: true,
        messages: [],
        reasoningSummary: "auto"
      },
      {
        requestId: "req_stream_123",
        requestMode: "openai_responses"
      }
    )) {
      events.push(event);
    }

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      reasoning: {
        summary: "auto"
      }
    });
    expect(events).toEqual([
      {
        type: "response_started",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        parallelToolCalls: true,
        metadata: {
          tenant: "acme"
        },
        serviceTier: "priority",
        promptCacheKey: "cache-key-123",
        promptCacheRetention: "in_memory",
        responseTruncation: "disabled",
        responseTextVerbosity: "high",
        conversationId: "conv_123"
      },
      {
        type: "reasoning_summary_delta",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        delta: "The model checked"
      },
      {
        type: "reasoning_summary_delta",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        delta: " the answer."
      },
      {
        type: "response_completed",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        finishReason: "stop",
        parallelToolCalls: true,
        reasoningSummary: "The model checked the answer.",
        metadata: {
          tenant: "acme"
        },
        serviceTier: "priority",
        promptCacheKey: "cache-key-123",
        promptCacheRetention: "in_memory",
        responseTruncation: "disabled",
        responseTextVerbosity: "high",
        conversationId: "conv_123"
      }
    ]);
  });

  it("parses native responses reasoning raw-content deltas for Codex compatibility", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'data: {"type":"response.created","sequence_number":0,"response":{"id":"resp_123","object":"response","created_at":1,"model":"gpt-4.1-mini","status":"in_progress","output":[],"tools":[]}}\n\n',
              'data: {"type":"response.output_item.added","sequence_number":1,"output_index":0,"item":{"type":"reasoning","id":"rs_123","summary":[]}}\n\n',
              'data: {"type":"response.reasoning_summary_part.added","sequence_number":2,"output_index":0,"summary_index":0,"part":{"type":"summary_text","text":""}}\n\n',
              'data: {"type":"response.reasoning_text.delta","sequence_number":3,"output_index":0,"content_index":0,"delta":"raw detail"}\n\n',
              'data: {"type":"response.completed","sequence_number":4,"response":{"id":"resp_123","object":"response","created_at":1,"model":"gpt-4.1-mini","status":"completed","output":[{"type":"reasoning","id":"rs_123","summary":[{"type":"summary_text","text":"checked"}],"content":[{"type":"reasoning_text","text":"raw detail"}]}],"tools":[]}}\n\n',
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
        requestId: "req_reasoning_raw_123",
        requestMode: "openai_responses"
      }
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      expect.objectContaining({
        type: "response_started",
        responseId: "resp_123"
      }),
      expect.objectContaining({
        type: "reasoning_section_break",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        summaryIndex: 0
      }),
      expect.objectContaining({
        type: "reasoning_raw_content_delta",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        delta: "raw detail",
        contentIndex: 0
      }),
      expect.objectContaining({
        type: "reasoning_summary_delta",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        delta: "checked"
      }),
      expect.objectContaining({
        type: "response_completed",
        responseId: "resp_123"
      })
    ]);
  });

  it("parses native responses custom tool input deltas for Codex compatibility", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'data: {"type":"response.created","sequence_number":0,"response":{"id":"resp_123","object":"response","created_at":1,"model":"gpt-4.1-mini","status":"in_progress","output":[],"tools":[]}}\n\n',
              'data: {"type":"response.output_item.added","sequence_number":1,"output_index":0,"item":{"type":"custom_tool_call","call_id":"call_123","name":"apply_patch","input":""}}\n\n',
              'data: {"type":"response.custom_tool_call_input.delta","sequence_number":2,"item_id":"call_123","call_id":"call_123","output_index":0,"delta":"*** Begin Patch\\n"}\n\n',
              'data: {"type":"response.completed","sequence_number":3,"response":{"id":"resp_123","object":"response","created_at":1,"model":"gpt-4.1-mini","status":"completed","output":[{"type":"custom_tool_call","call_id":"call_123","name":"apply_patch","input":"*** Begin Patch\\n"}],"tools":[]}}\n\n',
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
        requestId: "req_custom_tool_123",
        requestMode: "openai_responses"
      }
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      expect.objectContaining({
        type: "response_started",
        responseId: "resp_123"
      }),
      expect.objectContaining({
        type: "tool_call_delta",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        toolCallId: "call_123",
        toolName: "apply_patch",
        argumentsDelta: ""
      }),
      expect.objectContaining({
        type: "tool_call_delta",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        toolCallId: "call_123",
        toolName: "apply_patch",
        argumentsDelta: "*** Begin Patch\n"
      }),
      expect.objectContaining({
        type: "response_completed",
        responseId: "resp_123",
        finishReason: "tool_calls"
      })
    ]);
  });

  it("includes include_obfuscation=false in native openai responses stream requests when explicitly requested", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'data: {"type":"response.created","sequence_number":0,"response":{"id":"resp_123","object":"response","created_at":1,"model":"gpt-4.1-mini","status":"in_progress","output":[],"parallel_tool_calls":true,"tools":[]}}\n\n',
              'data: {"type":"response.completed","sequence_number":1,"response":{"id":"resp_123","object":"response","created_at":1,"model":"gpt-4.1-mini","status":"completed","output":[],"parallel_tool_calls":true,"tools":[]}}\n\n',
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

    for await (const event of adapter.stream(
      {
        ...createCanonicalRequest(),
        stream: true,
        providerMetadata: {
          openai: {
            responsesIncludeObfuscation: false
          }
        },
        messages: []
      },
      {
        requestId: "req_stream_123",
        requestMode: "openai_responses"
      }
    )) {
      void event;
    }

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      stream: true,
      stream_options: {
        include_obfuscation: false
      }
    });
  });

  it("does not include include_obfuscation in native openai responses stream requests by default", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'data: {"type":"response.created","sequence_number":0,"response":{"id":"resp_123","object":"response","created_at":1,"model":"gpt-4.1-mini","status":"in_progress","output":[],"parallel_tool_calls":true,"tools":[]}}\n\n',
              'data: {"type":"response.completed","sequence_number":1,"response":{"id":"resp_123","object":"response","created_at":1,"model":"gpt-4.1-mini","status":"completed","output":[],"parallel_tool_calls":true,"tools":[]}}\n\n',
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

    for await (const event of adapter.stream(
      {
        ...createCanonicalRequest(),
        stream: true,
        messages: []
      },
      {
        requestId: "req_stream_123",
        requestMode: "openai_responses"
      }
    )) {
      void event;
    }

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      stream: true
    });
    expect(JSON.parse(init.body as string)).not.toHaveProperty(
      "stream_options"
    );
  });

  it("normalizes native responses tool indexes to canonical ordinals after a reasoning output item", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'data: {"type":"response.created","sequence_number":0,"response":{"id":"resp_123","object":"response","created_at":1,"model":"gpt-4.1-mini","status":"in_progress","output":[],"parallel_tool_calls":true,"tools":[]}}\n\n',
              'data: {"type":"response.output_item.added","sequence_number":1,"output_index":0,"item":{"type":"reasoning","id":"rs_123","summary":[]}}\n\n',
              'data: {"type":"response.reasoning_summary_text.delta","sequence_number":2,"output_index":0,"summary_index":0,"delta":"The model checked"}\n\n',
              'data: {"type":"response.output_item.added","sequence_number":3,"output_index":1,"item":{"type":"function_call","call_id":"call_123","name":"lookup_weather","arguments":"","status":"in_progress"}}\n\n',
              'data: {"type":"response.function_call_arguments.delta","sequence_number":4,"item_id":"call_123","output_index":1,"delta":"{\\"city\\":\\"Shanghai\\"}"}\n\n',
              'data: {"type":"response.completed","sequence_number":5,"response":{"id":"resp_123","object":"response","created_at":1,"model":"gpt-4.1-mini","status":"completed","output":[{"type":"reasoning","id":"rs_123","summary":[{"type":"summary_text","text":"The model checked the answer."}]},{"type":"function_call","call_id":"call_123","name":"lookup_weather","arguments":"{\\"city\\":\\"Shanghai\\"}","status":"completed"}],"parallel_tool_calls":true,"tools":[]}}\n\n',
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
        stream: true,
        messages: [],
        reasoningSummary: "auto",
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
        requestId: "req_stream_123",
        requestMode: "openai_responses"
      }
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "response_started",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        parallelToolCalls: true
      },
      {
        type: "reasoning_summary_delta",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        delta: "The model checked"
      },
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
        type: "tool_call_delta",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        toolCallId: "call_123",
        toolIndex: 0,
        toolName: "lookup_weather",
        argumentsDelta: '{"city":"Shanghai"}'
      },
      {
        type: "reasoning_summary_delta",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        delta: " the answer."
      },
      {
        type: "response_completed",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        finishReason: "tool_calls",
        parallelToolCalls: true,
        reasoningSummary: "The model checked the answer."
      }
    ]);
  });

  it("preserves zero-argument native responses tool starts as canonical tool call deltas", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'data: {"type":"response.created","sequence_number":0,"response":{"id":"resp_123","object":"response","created_at":1,"model":"gpt-4.1-mini","status":"in_progress","output":[],"parallel_tool_calls":true,"tools":[]}}\n\n',
              'data: {"type":"response.output_item.added","sequence_number":1,"output_index":0,"item":{"type":"function_call","call_id":"call_123","name":"lookup_weather","arguments":"","status":"in_progress"}}\n\n',
              'data: {"type":"response.completed","sequence_number":2,"response":{"id":"resp_123","object":"response","created_at":1,"model":"gpt-4.1-mini","status":"completed","output":[{"type":"function_call","call_id":"call_123","name":"lookup_weather","arguments":"","status":"completed"}],"parallel_tool_calls":true,"tools":[],"usage":{"input_tokens":11,"output_tokens":5,"total_tokens":16}}}\n\n',
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
        stream: true,
        messages: [],
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
        requestId: "req_stream_zero_arg_responses_123",
        requestMode: "openai_responses"
      }
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "response_started",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        parallelToolCalls: true
      },
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
        type: "response_completed",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        finishReason: "tool_calls",
        parallelToolCalls: true,
        usage: {
          inputTokens: 11,
          outputTokens: 5,
          totalTokens: 16
        }
      }
    ]);
  });

  it("backfills sparse native responses completed output into canonical stream deltas", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'data: {"type":"response.created","sequence_number":0,"response":{"id":"resp_123","object":"response","created_at":1,"model":"gpt-4.1-mini","status":"in_progress","output":[],"parallel_tool_calls":true,"tools":[]}}\n\n',
              'data: {"type":"response.completed","sequence_number":1,"response":{"id":"resp_123","object":"response","created_at":1,"model":"gpt-4.1-mini","status":"completed","output":[{"id":"msg_123","type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":"Let me check that.","annotations":[]}]},{"type":"function_call","call_id":"call_123","name":"lookup_weather","arguments":"{\\"city\\":\\"Shanghai\\"}","status":"completed"}],"parallel_tool_calls":true,"tools":[],"usage":{"input_tokens":12,"output_tokens":8,"total_tokens":20}}}\n\n',
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
        stream: true,
        messages: [],
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
        requestId: "req_stream_sparse_responses_123",
        requestMode: "openai_responses"
      }
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "response_started",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        parallelToolCalls: true
      },
      {
        type: "output_text_delta",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        delta: "Let me check that."
      },
      {
        type: "tool_call_delta",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        toolCallId: "call_123",
        toolIndex: 0,
        toolName: "lookup_weather",
        argumentsDelta: '{"city":"Shanghai"}'
      },
      {
        type: "response_completed",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        finishReason: "tool_calls",
        parallelToolCalls: true,
        usage: {
          inputTokens: 12,
          outputTokens: 8,
          totalTokens: 20
        }
      }
    ]);
  });

  it("backfills sparse native responses completed output in reasoning-text-tool order", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'data: {"type":"response.created","sequence_number":0,"response":{"id":"resp_123","object":"response","created_at":1,"model":"gpt-4.1-mini","status":"in_progress","output":[],"parallel_tool_calls":true,"tools":[]}}\n\n',
              'data: {"type":"response.completed","sequence_number":1,"response":{"id":"resp_123","object":"response","created_at":1,"model":"gpt-4.1-mini","status":"completed","output":[{"type":"reasoning","id":"rs_123","summary":[{"type":"summary_text","text":"The model checked the answer."}]},{"id":"msg_123","type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":"Let me check that.","annotations":[]}]},{"type":"function_call","call_id":"call_123","name":"lookup_weather","arguments":"{\\"city\\":\\"Shanghai\\"}","status":"completed"}],"parallel_tool_calls":true,"tools":[],"usage":{"input_tokens":12,"output_tokens":8,"total_tokens":20}}}\n\n',
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
        stream: true,
        messages: [],
        reasoningSummary: "auto",
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
        requestId: "req_stream_sparse_ordered_responses_123",
        requestMode: "openai_responses"
      }
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "response_started",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        parallelToolCalls: true
      },
      {
        type: "reasoning_summary_delta",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        delta: "The model checked the answer."
      },
      {
        type: "output_text_delta",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        delta: "Let me check that."
      },
      {
        type: "tool_call_delta",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        toolCallId: "call_123",
        toolIndex: 0,
        toolName: "lookup_weather",
        argumentsDelta: '{"city":"Shanghai"}'
      },
      {
        type: "response_completed",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        finishReason: "tool_calls",
        parallelToolCalls: true,
        reasoningSummary: "The model checked the answer.",
        usage: {
          inputTokens: 12,
          outputTokens: 8,
          totalTokens: 20
        }
      }
    ]);
  });

  it("forwards canonical json_schema output format to OpenAI chat completions", async () => {
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
                content: '{"city":"Shanghai"}'
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

    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(JSON.parse(init.body as string)).toMatchObject({
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "weather",
          schema: {
            type: "object"
          },
          strict: true
        }
      }
    });
  });

  it("forwards canonical json_object output format to OpenAI chat completions", async () => {
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
                content: '{"city":"Shanghai"}'
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
        outputFormat: {
          type: "json_object"
        }
      },
      {
        requestId: "req_123"
      }
    );

    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(JSON.parse(init.body as string)).toMatchObject({
      response_format: {
        type: "json_object"
      }
    });
  });

  it("forwards canonical json_schema output format through the native openai responses endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_123",
          object: "response",
          created_at: 1,
          model: "gpt-4.1-mini",
          status: "completed",
          output: [
            {
              id: "msg_123",
              type: "message",
              role: "assistant",
              status: "completed",
              content: [
                {
                  type: "output_text",
                  text: '{"city":"Shanghai"}',
                  annotations: []
                }
              ]
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
        requestId: "req_123",
        requestMode: "openai_responses"
      }
    );

    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(JSON.parse(init.body as string)).toMatchObject({
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
  });

  it("forwards canonical json_object output format through the native openai responses endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_123",
          object: "response",
          created_at: 1,
          model: "gpt-4.1-mini",
          status: "completed",
          output: [
            {
              id: "msg_123",
              type: "message",
              role: "assistant",
              status: "completed",
              content: [
                {
                  type: "output_text",
                  text: '{"city":"Shanghai"}',
                  annotations: []
                }
              ]
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
        outputFormat: {
          type: "json_object"
        }
      },
      {
        requestId: "req_123",
        requestMode: "openai_responses"
      }
    );

    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(JSON.parse(init.body as string)).toMatchObject({
      text: {
        format: {
          type: "json_object"
        }
      }
    });
  });

  it("parses upstream responses SSE into canonical stream events when requestMode=openai_responses", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'data: {"type":"response.created","sequence_number":0,"response":{"id":"resp_123","object":"response","created_at":1,"model":"gpt-4.1-mini","status":"in_progress","output":[],"parallel_tool_calls":true,"tools":[]}}\n\n',
              'data: {"type":"response.output_item.added","sequence_number":1,"output_index":0,"item":{"id":"msg_123","type":"message","role":"assistant","status":"in_progress","content":[]}}\n\n',
              'data: {"type":"response.content_part.added","sequence_number":2,"item_id":"msg_123","output_index":0,"content_index":0,"part":{"type":"output_text","text":"","annotations":[]}}\n\n',
              'data: {"type":"response.output_text.delta","sequence_number":3,"item_id":"msg_123","output_index":0,"content_index":0,"delta":"hel"}\n\n',
              'data: {"type":"response.output_text.delta","sequence_number":4,"item_id":"msg_123","output_index":0,"content_index":0,"delta":"lo"}\n\n',
              'data: {"type":"response.completed","sequence_number":5,"response":{"id":"resp_123","object":"response","created_at":1,"model":"gpt-4.1-mini","status":"completed","output":[],"parallel_tool_calls":true,"tools":[],"usage":{"input_tokens":12,"output_tokens":8,"total_tokens":20}}}\n\n',
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
        requestId: "req_stream_123",
        requestMode: "openai_responses"
      }
    )) {
      events.push(event);
    }

    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(JSON.parse(init.body as string)).toMatchObject({
      stream: true
    });
    expect(events).toEqual([
      {
        type: "response_started",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        parallelToolCalls: true
      },
      {
        type: "output_text_delta",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        delta: "hel"
      },
      {
        type: "output_text_delta",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        delta: "lo"
      },
      {
        type: "response_completed",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        finishReason: "stop",
        parallelToolCalls: true,
        usage: {
          inputTokens: 12,
          outputTokens: 8,
          totalTokens: 20
        }
      }
    ]);
  });

  it("parses upstream responses SSE output-text logprobs when requestMode=openai_responses", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'data: {"type":"response.created","sequence_number":0,"response":{"id":"resp_123","object":"response","created_at":1,"model":"gpt-4.1-mini","status":"in_progress","output":[],"tools":[]}}\n\n',
              'data: {"type":"response.output_text.delta","sequence_number":1,"item_id":"msg_123","output_index":0,"content_index":0,"delta":"hello","logprobs":[{"token":"hello","logprob":-0.1,"top_logprobs":[{"token":"hello","logprob":-0.1}]}]}\n\n',
              'data: {"type":"response.completed","sequence_number":2,"response":{"id":"resp_123","object":"response","created_at":1,"model":"gpt-4.1-mini","status":"completed","output":[{"id":"msg_123","type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":"hello","annotations":[],"logprobs":{"content":[{"token":"hello","logprob":-0.1,"top_logprobs":[{"token":"hello","logprob":-0.1}]}]}}]}],"tools":[],"usage":{"input_tokens":12,"output_tokens":8,"total_tokens":20}}}\n\n',
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
        stream: true,
        providerMetadata: {
          openai: {
            responsesOutputTextLogprobs: true,
            responsesTopLogprobs: 5
          }
        }
      },
      {
        requestId: "req_stream_123",
        requestMode: "openai_responses"
      }
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "response_started",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        createdAt: 1
      },
      {
        type: "output_text_delta",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        delta: "hello",
        outputTextLogprobs: {
          content: [
            {
              token: "hello",
              logprob: -0.1,
              topLogprobs: [
                {
                  token: "hello",
                  logprob: -0.1
                }
              ]
            }
          ]
        }
      },
      {
        type: "response_completed",
        responseId: "resp_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        finishReason: "stop",
        outputTextLogprobs: {
          content: [
            {
              token: "hello",
              logprob: -0.1,
              topLogprobs: [
                {
                  token: "hello",
                  logprob: -0.1
                }
              ]
            }
          ]
        },
        usage: {
          inputTokens: 12,
          outputTokens: 8,
          totalTokens: 20
        }
      }
    ]);
  });

  it("preserves OpenAI chat system_fingerprint on streamed events", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","system_fingerprint":"fp_123","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
              'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","system_fingerprint":"fp_123","choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":null}]}\n\n',
              'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","system_fingerprint":"fp_123","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
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
        requestId: "req_123"
      }
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "response_started",
        responseId: "chatcmpl_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        systemFingerprint: "fp_123"
      },
      {
        type: "output_text_delta",
        responseId: "chatcmpl_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        systemFingerprint: "fp_123",
        delta: "hello"
      },
      {
        type: "response_completed",
        responseId: "chatcmpl_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        systemFingerprint: "fp_123",
        finishReason: "stop"
      }
    ]);
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

  it("forwards OpenAI-native chat frequency_penalty, presence_penalty, and seed", async () => {
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
        providerMetadata: {
          openai: {
            frequencyPenalty: 0.5,
            presencePenalty: -0.25,
            seed: 1234
          }
        }
      },
      {
        requestId: "req_123"
      }
    );

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      frequency_penalty: 0.5,
      presence_penalty: -0.25,
      seed: 1234
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
                      arguments: '{"city":"Shanghai"}'
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
        arguments: '{"city":"Shanghai"}'
      }
    ]);
    expect(response.finishReason).toBe("tool_calls");
  });

  it("forwards a forced canonical tool choice to OpenAI", async () => {
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
                      arguments: '{"city":"Shanghai"}'
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
        type: "function",
        function: {
          name: "lookup_weather"
        }
      }
    });
  });

  it("forwards canonical required tool choice to OpenAI", async () => {
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
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_123",
                    type: "function",
                    function: {
                      name: "lookup_weather",
                      arguments: '{"city":"Shanghai"}'
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
      tool_choice: "required"
    });
  });

  it("forwards canonical none tool choice to OpenAI", async () => {
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
                content: "I will answer directly."
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
      tool_choice: "none"
    });
  });

  it("replays assistant tool calls and tool results into OpenAI message history", async () => {
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
                content: "The temperature is 26C."
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
        model: "gpt-4.1-mini",
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
                arguments: '{"city":"Shanghai"}'
              }
            ]
          },
          {
            role: "tool",
            content: '{"temperature_c":26}',
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
          content: "",
          tool_calls: [
            {
              id: "call_123",
              type: "function",
              function: {
                name: "lookup_weather",
                arguments: '{"city":"Shanghai"}'
              }
            }
          ]
        },
        {
          role: "tool",
          tool_call_id: "call_123",
          content: '{"temperature_c":26}'
        }
      ]
    });
  });

  it("encodes canonical tool calls into responses-style output when used through the Responses route", async () => {
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
                      arguments: '{"city":"Shanghai"}'
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

    expect(response.outputText).toBe("");
    expect(response.toolCalls).toEqual([
      {
        id: "call_123",
        name: "lookup_weather",
        arguments: '{"city":"Shanghai"}'
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
        stream: true,
        providerMetadata: {
          openai: {
            chatIncludeUsage: true
          }
        }
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
        model: "gpt-4.1-mini",
        createdAt: 1
      },
      {
        type: "output_text_delta",
        responseId: "chatcmpl_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        delta: "hel"
      },
      {
        type: "output_text_delta",
        responseId: "chatcmpl_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        delta: "lo"
      },
      {
        type: "response_completed",
        responseId: "chatcmpl_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        finishReason: "stop",
        usage: {
          inputTokens: 12,
          outputTokens: 8,
          totalTokens: 20
        }
      }
    ]);
  });

  it("parses upstream chat completion SSE logprobs into canonical stream events", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
              'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"content":"hello"},"logprobs":{"content":[{"token":"hello","logprob":-0.1,"top_logprobs":[{"token":"hello","logprob":-0.1}]}]},"finish_reason":null}]}\n\n',
              'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{},"logprobs":{"content":[{"token":"hello","logprob":-0.1,"top_logprobs":[{"token":"hello","logprob":-0.1}]}]},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":8,"total_tokens":20}}\n\n',
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
        stream: true,
        providerMetadata: {
          openai: {
            logprobs: true,
            topLogprobs: 5,
            chatIncludeUsage: true
          }
        }
      },
      {
        requestId: "req_stream_logprobs_123"
      }
    )) {
      events.push(event);
    }

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      stream: true,
      logprobs: true,
      top_logprobs: 5,
      stream_options: {
        include_usage: true
      }
    });
    expect(events).toEqual([
      {
        type: "response_started",
        responseId: "chatcmpl_123",
        model: "gpt-4.1-mini",
        createdAt: 1
      },
      {
        type: "output_text_delta",
        responseId: "chatcmpl_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        delta: "hello",
        outputTextLogprobs: {
          content: [
            {
              token: "hello",
              logprob: -0.1,
              topLogprobs: [
                {
                  token: "hello",
                  logprob: -0.1
                }
              ]
            }
          ]
        }
      },
      {
        type: "response_completed",
        responseId: "chatcmpl_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        finishReason: "stop",
        outputTextLogprobs: {
          content: [
            {
              token: "hello",
              logprob: -0.1,
              topLogprobs: [
                {
                  token: "hello",
                  logprob: -0.1
                }
              ]
            }
          ]
        },
        usage: {
          inputTokens: 12,
          outputTokens: 8,
          totalTokens: 20
        }
      }
    ]);
  });

  it("always requests upstream chat usage for internal accounting even without explicit client opt-in", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
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

    const providerStream = adapter.stream(
      {
        ...createCanonicalRequest(),
        stream: true
      },
      {
        requestId: "req_stream_implicit_usage"
      }
    );
    const streamIterator = providerStream[Symbol.asyncIterator]();

    while (true) {
      const nextChunk = await streamIterator.next();
      if (nextChunk.done) {
        break;
      }
    }

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      stream: true,
      stream_options: {
        include_usage: true
      }
    });
  });

  it("parses upstream streamed chat tool calls into tool_call_delta events and a tool_calls completion event", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"id":"call_123","type":"function","function":{"name":"lookup_weather","arguments":"{\\"city\\":\\"Shang"}}]},"finish_reason":null}]}\n\n',
              'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"hai\\"}"}}]},"finish_reason":null}]}\n\n',
              'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":12,"completion_tokens":8,"total_tokens":20}}\n\n',
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
        stream: true,
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
        requestId: "req_stream_tool_123"
      }
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "response_started",
        responseId: "chatcmpl_123",
        model: "gpt-4.1-mini",
        createdAt: 1
      },
      {
        type: "tool_call_delta",
        responseId: "chatcmpl_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        toolCallId: "call_123",
        toolIndex: 0,
        toolName: "lookup_weather",
        argumentsDelta: '{"city":"Shang'
      },
      {
        type: "tool_call_delta",
        responseId: "chatcmpl_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        toolCallId: "call_123",
        toolIndex: 0,
        toolName: "lookup_weather",
        argumentsDelta: 'hai"}'
      },
      {
        type: "response_completed",
        responseId: "chatcmpl_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        finishReason: "tool_calls",
        usage: {
          inputTokens: 12,
          outputTokens: 8,
          totalTokens: 20
        }
      }
    ]);
  });

  it("parses upstream streamed chat tool starts without argument deltas", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"id":"call_123","type":"function","function":{"name":"lookup_weather"}}]},"finish_reason":null}]}\n\n',
              'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":12,"completion_tokens":8,"total_tokens":20}}\n\n',
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
        stream: true,
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
        requestId: "req_stream_tool_empty_args_123"
      }
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "response_started",
        responseId: "chatcmpl_123",
        model: "gpt-4.1-mini",
        createdAt: 1
      },
      {
        type: "tool_call_delta",
        responseId: "chatcmpl_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        toolCallId: "call_123",
        toolIndex: 0,
        toolName: "lookup_weather",
        argumentsDelta: ""
      },
      {
        type: "response_completed",
        responseId: "chatcmpl_123",
        model: "gpt-4.1-mini",
        createdAt: 1,
        finishReason: "tool_calls",
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

    expect(url).toBe(
      "https://api.openai.com/v1/chat/completions?trace=request"
    );
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
    const fetcher = vi
      .fn()
      .mockImplementation(async (_input, init?: RequestInit) => {
        const signal = init?.signal;

        return await new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(
              new DOMException("The operation was aborted.", "AbortError")
            );
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

  describe("streaming error mapping", () => {
    it("maps streaming timeout into a retryable provider_timeout gateway error", async () => {
      const fetcher = vi
        .fn()
        .mockImplementation(async (_input, init?: RequestInit) => {
          const signal = init?.signal;

          return await new Promise<Response>((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              reject(
                new DOMException("The operation was aborted.", "AbortError")
              );
            });
          });
        });

      const adapter = new OpenAIProviderAdapter({
        apiKey: "test-key",
        baseUrl: "https://api.openai.com/v1",
        fetcher
      });

      await expect(
        (async () => {
          for await (const _event of adapter.stream(
            { ...createCanonicalRequest(), stream: true },
            { requestId: "req_stream_timeout", timeoutMs: 1 }
          )) {
            // drain
          }
        })()
      ).rejects.toMatchObject({
        code: "provider_timeout",
        category: "provider",
        httpStatus: 504,
        retryable: true
      });
    });

    it("maps streaming 403 upstream response into a non-retryable provider_upstream_error", async () => {
      const fetcher = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { message: "Incorrect API key provided" }
          }),
          { status: 403 }
        )
      );

      const adapter = new OpenAIProviderAdapter({
        apiKey: "test-key",
        baseUrl: "https://api.openai.com/v1",
        fetcher
      });

      await expect(
        (async () => {
          for await (const _event of adapter.stream(
            { ...createCanonicalRequest(), stream: true },
            { requestId: "req_stream_403" }
          )) {
            // drain
          }
        })()
      ).rejects.toMatchObject({
        code: "provider_upstream_error",
        category: "provider",
        httpStatus: 403,
        retryable: false,
        message: "Incorrect API key provided"
      });
    });

    it("maps streaming 500 upstream response into a retryable provider_upstream_error", async () => {
      const fetcher = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { message: "Internal server error" }
          }),
          { status: 500 }
        )
      );

      const adapter = new OpenAIProviderAdapter({
        apiKey: "test-key",
        baseUrl: "https://api.openai.com/v1",
        fetcher
      });

      await expect(
        (async () => {
          for await (const _event of adapter.stream(
            { ...createCanonicalRequest(), stream: true },
            { requestId: "req_stream_500" }
          )) {
            // drain
          }
        })()
      ).rejects.toMatchObject({
        code: "provider_upstream_error",
        category: "provider",
        httpStatus: 500,
        retryable: true,
        message: "Internal server error"
      });
    });

    it("maps streaming empty body into a retryable provider_upstream_error with 502", async () => {
      const fetcher = vi.fn().mockResolvedValue(
        new Response(null, {
          status: 200,
          headers: { "content-type": "text/event-stream" }
        })
      );

      const adapter = new OpenAIProviderAdapter({
        apiKey: "test-key",
        baseUrl: "https://api.openai.com/v1",
        fetcher
      });

      await expect(
        (async () => {
          for await (const _event of adapter.stream(
            { ...createCanonicalRequest(), stream: true },
            { requestId: "req_stream_empty_body" }
          )) {
            // drain
          }
        })()
      ).rejects.toMatchObject({
        code: "provider_upstream_error",
        category: "provider",
        httpStatus: 502,
        retryable: true,
        message: "Upstream provider returned an empty stream body"
      });
    });

    it("maps streaming 429 upstream response into a retryable provider_upstream_error", async () => {
      const fetcher = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { message: "Rate limit exceeded" }
          }),
          { status: 429 }
        )
      );

      const adapter = new OpenAIProviderAdapter({
        apiKey: "test-key",
        baseUrl: "https://api.openai.com/v1",
        fetcher
      });

      await expect(
        (async () => {
          for await (const _event of adapter.stream(
            { ...createCanonicalRequest(), stream: true },
            { requestId: "req_stream_429" }
          )) {
            // drain
          }
        })()
      ).rejects.toMatchObject({
        code: "provider_upstream_error",
        category: "provider",
        httpStatus: 429,
        retryable: true,
        message: "Rate limit exceeded"
      });
    });

    it("maps streaming non-200 without error message into a generic provider_upstream_error", async () => {
      const fetcher = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({}), { status: 503 }));

      const adapter = new OpenAIProviderAdapter({
        apiKey: "test-key",
        baseUrl: "https://api.openai.com/v1",
        fetcher
      });

      await expect(
        (async () => {
          for await (const _event of adapter.stream(
            { ...createCanonicalRequest(), stream: true },
            { requestId: "req_stream_503_no_msg" }
          )) {
            // drain
          }
        })()
      ).rejects.toMatchObject({
        code: "provider_upstream_error",
        category: "provider",
        httpStatus: 503,
        retryable: true,
        message: "Upstream provider error"
      });
    });
  });
});
