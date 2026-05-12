import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TelemetrySink } from "@airlock/telemetry";

import { createApp } from "./app.js";
import { resetProviderCircuitBreakerState } from "./circuit-breaker.js";

async function readJson(response: Response): Promise<unknown> {
  return response.json();
}

async function readText(response: Response): Promise<string> {
  return response.text();
}

interface ModelDirectoryPayload {
  object: "list";
  data: Array<{
    id: string;
    object: "model";
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isModelDirectoryPayload(
  value: unknown
): value is ModelDirectoryPayload {
  if (!isRecord(value) || value.object !== "list" || !Array.isArray(value.data)) {
    return false;
  }

  return value.data.every(
    (entry) =>
      isRecord(entry) &&
      entry.object === "model" &&
      typeof entry.id === "string"
  );
}

function createBindings() {
  return {
    AIRLOCK_MODE: "free",
    AIRLOCK_GATEWAY_API_KEYS: "gateway-secret",
    ANTHROPIC_API_KEY: "anthropic-secret",
    ANTHROPIC_BASE_URL: "https://api.anthropic.com/v1",
    ANTHROPIC_DEFAULT_MAX_TOKENS: "256",
    AIRLOCK_PROVIDER_TIMEOUT_MS: "1000",
    OPENAI_API_KEY: "openai-secret",
    OPENAI_BASE_URL: "https://api.openai.com/v1",
    OPENAI_DEFAULT_MODEL: "gpt-4.1-mini",
    AIRLOCK_MODEL_ALIASES:
      "gpt-4.1-mini=openai:gpt-4.1-mini,claude-sonnet-4-5=anthropic:claude-sonnet-4-5"
  };
}

interface DurableObjectStubLike {
  fetch(request: Request): Promise<Response>;
}

interface DurableObjectNamespaceLike {
  get(id: { name: string }): DurableObjectStubLike;
  idFromName(name: string): { name: string };
}

function createTokenQuotaNamespace() {
  const state = new Map<
    string,
    {
      windowStartedAt: number;
      usedTokens: number;
    }
  >();

  const namespace: DurableObjectNamespaceLike = {
    idFromName(name: string) {
      return { name };
    },
    get(id: { name: string }) {
      return {
        async fetch(request: Request) {
          const body = (await request.json()) as
            | {
                kind: "precheck";
                limit: number;
                windowSeconds: number;
              }
            | {
                kind: "charge";
                limit: number;
                windowSeconds: number;
                tokens: number;
              };
          const now = Date.now();
          const windowMs = body.windowSeconds * 1000;
          const windowStartedAt = now - (now % windowMs);
          const existing = state.get(id.name);
          const current =
            existing && existing.windowStartedAt === windowStartedAt
              ? existing
              : {
                  windowStartedAt,
                  usedTokens: 0
                };
          const resetAt = new Date(windowStartedAt + windowMs).toISOString();
          const retryAfterSeconds = Math.max(
            0,
            Math.ceil((windowStartedAt + windowMs - now) / 1000)
          );

          if (body.kind === "precheck") {
            return Response.json({
              allowed: current.usedTokens < body.limit,
              limit: body.limit,
              remaining: Math.max(0, body.limit - current.usedTokens),
              used: current.usedTokens,
              resetAt,
              retryAfterSeconds
            });
          }

          current.usedTokens += body.tokens;
          state.set(id.name, current);

          return Response.json({
            allowed: true,
            limit: body.limit,
            remaining: Math.max(0, body.limit - current.usedTokens),
            used: current.usedTokens,
            resetAt,
            retryAfterSeconds
          });
        }
      };
    }
  };

  return namespace;
}

function createQuotaNamespace() {
  const state = new Map<
    string,
    {
      windowStartedAt: number;
      count: number;
    }
  >();

  const namespace: DurableObjectNamespaceLike = {
    idFromName(name: string) {
      return { name };
    },
    get(id: { name: string }) {
      return {
        async fetch(request: Request) {
          const body = (await request.json()) as {
            limit: number;
            windowSeconds: number;
          };
          const now = Date.now();
          const windowMs = body.windowSeconds * 1000;
          const windowStartedAt = now - (now % windowMs);
          const existing = state.get(id.name);
          const current =
            existing && existing.windowStartedAt === windowStartedAt
              ? existing
              : { windowStartedAt, count: 0 };
          const remaining = Math.max(0, body.limit - current.count - 1);

          if (current.count >= body.limit) {
            return Response.json(
              {
                allowed: false,
                limit: body.limit,
                remaining: 0,
                resetAt: new Date(windowStartedAt + windowMs).toISOString(),
                retryAfterSeconds: Math.max(
                  0,
                  Math.ceil((windowStartedAt + windowMs - now) / 1000)
                )
              },
              { status: 200 }
            );
          }

          current.count += 1;
          state.set(id.name, current);

          return Response.json(
            {
              allowed: true,
              limit: body.limit,
              remaining,
              resetAt: new Date(windowStartedAt + windowMs).toISOString(),
              retryAfterSeconds: Math.max(
                0,
                Math.ceil((windowStartedAt + windowMs - now) / 1000)
              )
            },
            { status: 200 }
          );
        }
      };
    }
  };

  return namespace;
}

function createConcurrencyNamespace() {
  const state = new Map<
    string,
    Array<{
      leaseId: string;
      expiresAt: number;
    }>
  >();

  const namespace: DurableObjectNamespaceLike = {
    idFromName(name: string) {
      return { name };
    },
    get(id: { name: string }) {
      return {
        async fetch(request: Request) {
          const now = Date.now();
          const existing = (state.get(id.name) ?? []).filter((lease) => {
            return lease.expiresAt > now;
          });
          state.set(id.name, existing);

          if (request.method === "POST") {
            const body = (await request.json()) as {
              kind: "acquire";
              limit: number;
              leaseId: string;
              ttlMs: number;
            };

            if (existing.length >= body.limit) {
              const nextResetAt =
                existing.reduce((min, lease) => {
                  return Math.min(min, lease.expiresAt);
                }, Number.POSITIVE_INFINITY) || now;

              return Response.json({
                allowed: false,
                limit: body.limit,
                remaining: 0,
                resetAt: new Date(nextResetAt).toISOString(),
                retryAfterSeconds: Math.max(
                  0,
                  Math.ceil((nextResetAt - now) / 1000)
                )
              });
            }

            existing.push({
              leaseId: body.leaseId,
              expiresAt: now + body.ttlMs
            });
            state.set(id.name, existing);

            return Response.json({
              allowed: true,
              limit: body.limit,
              remaining: Math.max(0, body.limit - existing.length),
              resetAt: new Date(now + body.ttlMs).toISOString(),
              retryAfterSeconds: Math.max(0, Math.ceil(body.ttlMs / 1000))
            });
          }

          if (request.method === "DELETE") {
            const body = (await request.json()) as {
              leaseId: string;
            };
            state.set(
              id.name,
              existing.filter((lease) => {
                return lease.leaseId !== body.leaseId;
              })
            );
            return new Response(null, { status: 204 });
          }

          return new Response("Method not allowed", { status: 405 });
        }
      };
    }
  };

  return namespace;
}

function createRevocationNamespace() {
  const state = new Map<
    string,
    {
      revoked: boolean;
      updatedAt: string;
    }
  >();

  const namespace: DurableObjectNamespaceLike = {
    idFromName(name: string) {
      return { name };
    },
    get(id: { name: string }) {
      return {
        async fetch(request: Request) {
          await Promise.resolve();
          const method = request.method;
          const current =
            state.get(id.name) ?? {
              revoked: false,
              updatedAt: new Date(0).toISOString()
            };

          if (method === "GET") {
            return Response.json(current);
          }

          if (method === "POST") {
            const next = {
              revoked: true,
              updatedAt: new Date().toISOString()
            };
            state.set(id.name, next);
            return Response.json(next);
          }

          if (method === "DELETE") {
            const next = {
              revoked: false,
              updatedAt: new Date().toISOString()
            };
            state.set(id.name, next);
            return Response.json(next);
          }

          return new Response("Method not allowed", { status: 405 });
        }
      };
    }
  };

  return namespace;
}

function createPersistentBreakerNamespace() {
  const state = new Map<
    string,
    {
      consecutiveRetryableFailures: number;
      openedAt?: number;
    }
  >();

  const namespace: DurableObjectNamespaceLike = {
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

  return namespace;
}

const gatewaySecretHash =
  "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6";

function createTelemetryRecorder() {
  const events: unknown[] = [];
  const sink: TelemetrySink = {
    async emit(event) {
      await Promise.resolve();
      events.push(event);
    }
  };

  return { sink, events };
}

beforeEach(() => {
  resetProviderCircuitBreakerState();
});

describe("gateway app", () => {
  it("returns ok from /healthz", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/healthz",
      undefined,
      createBindings()
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ ok: true });
  });

  it("emits request telemetry for a successful buffered chat completion", async () => {
    const { sink, events } = createTelemetryRecorder();
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
    const app = createApp({ fetcher, telemetrySink: sink });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      createBindings()
    );

    expect(response.status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "gateway_request",
      routePath: "/v1/chat/completions",
      outcome: "success",
      statusCode: 200,
      provider: "openai",
      providerModel: "gpt-4.1-mini",
      externalModel: "gpt-4.1-mini",
      gatewayKeyId: "gak_1",
      fallbackUsed: false,
      usage: {
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20
      }
    });
  });

  it("emits request telemetry for a successful streaming chat completion with usage", async () => {
    const { sink, events } = createTelemetryRecorder();
    const encoder = new TextEncoder();
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                [
                  'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
                  'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":null}]}\n\n',
                  'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":8,"total_tokens":20}}\n\n',
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
    const app = createApp({ fetcher, telemetrySink: sink });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: true,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      createBindings()
    );

    expect(response.status).toBe(200);
    await expect(readText(response)).resolves.toContain("data: [DONE]");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "gateway_request",
      routePath: "/v1/chat/completions",
      outcome: "success",
      statusCode: 200,
      provider: "openai",
      providerModel: "gpt-4.1-mini",
      externalModel: "gpt-4.1-mini",
      gatewayKeyId: "gak_1",
      fallbackUsed: false,
      usage: {
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20
      }
    });
  });

  it("emits request telemetry for an authentication failure", async () => {
    const { sink, events } = createTelemetryRecorder();
    const app = createApp({ fetcher: vi.fn(), telemetrySink: sink });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer wrong-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      createBindings()
    );

    expect(response.status).toBe(401);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "gateway_request",
      routePath: "/v1/chat/completions",
      outcome: "error",
      statusCode: 401,
      errorCode: "auth_invalid_api_key",
      errorCategory: "authentication",
      retryable: false
    });
  });

  it("emits request telemetry for an upstream provider failure with attempted provider metadata", async () => {
    const { sink, events } = createTelemetryRecorder();
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
    const app = createApp({ fetcher, telemetrySink: sink });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      createBindings()
    );

    expect(response.status).toBe(429);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "gateway_request",
      routePath: "/v1/chat/completions",
      outcome: "error",
      statusCode: 429,
      provider: "openai",
      providerModel: "gpt-4.1-mini",
      errorCode: "provider_upstream_error",
      errorCategory: "provider",
      retryable: true
    });
  });

  it("returns ready from /readyz when required config is present", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/readyz",
      undefined,
      createBindings()
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ ok: true, ready: true });
  });

  it("returns ready from /readyz when structured gateway key config is valid", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_active",
          label: "Active Key",
          value: "gateway-secret",
          status: "active",
          policy: {
            tier: "prod",
            tags: ["internal"]
          }
        },
        {
          id: "key_revoked",
          label: "Revoked Key",
          value: "revoked-secret",
          status: "revoked"
        }
      ])
    });

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ ok: true, ready: true });
  });

  it("lists the configured model directory from /v1/models", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/models",
      undefined,
      createBindings()
    );

    expect(response.status).toBe(200);
    const payload = await readJson(response);

    expect(isModelDirectoryPayload(payload)).toBe(true);
    if (!isModelDirectoryPayload(payload)) {
      throw new Error("Expected a model directory payload");
    }

    expect(payload.data.map((model) => model.id)).toEqual(
      expect.arrayContaining(["gpt-4.1-mini", "claude-sonnet-4-5"])
    );
  });

  it("returns a configured model from /v1/models/:model", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/models/gpt-4.1-mini",
      undefined,
      createBindings()
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toMatchObject({
      id: "gpt-4.1-mini",
      object: "model"
    });
  });

  it("returns 404 for an unknown model from /v1/models/:model", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/models/unknown-model",
      undefined,
      createBindings()
    );

    expect(response.status).toBe(404);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "model_not_found"
      }
    });
  });

  it("returns not ready from /readyz when required config is missing", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      AIRLOCK_MODE: "free",
      AIRLOCK_GATEWAY_API_KEYS: "gateway-secret",
      OPENAI_API_KEY: "openai-secret",
      OPENAI_BASE_URL: "https://api.openai.com/v1",
      OPENAI_DEFAULT_MODEL: ""
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when gateway api key config is invalid", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      AIRLOCK_MODE: "free",
      AIRLOCK_GATEWAY_API_KEYS: "gateway-secret, gateway-secret ",
      OPENAI_API_KEY: "openai-secret",
      OPENAI_BASE_URL: "https://api.openai.com/v1",
      OPENAI_DEFAULT_MODEL: "gpt-4.1-mini"
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when structured gateway key config is invalid", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_1",
          label: "Gateway Key 1",
          value: "gateway-secret",
          status: "active",
          policy: {
            tags: ["internal", "internal"]
          }
        }
      ])
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when a structured gateway key record defines both value and valueHash", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_1",
          label: "Gateway Key 1",
          value: "gateway-secret",
          valueHash: gatewaySecretHash,
          status: "active"
        }
      ])
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when structured gateway key allowed-model policy is invalid", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_1",
          label: "Gateway Key 1",
          value: "gateway-secret",
          status: "active",
          policy: {
            allowedExternalModels: ["gpt-4.1-mini", "gpt-4.1-mini"]
          }
        }
      ])
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when structured gateway key allowed-provider policy is invalid", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_1",
          label: "Gateway Key 1",
          value: "gateway-secret",
          status: "active",
          policy: {
            allowedProviders: ["openai", "invalid-provider"]
          }
        }
      ])
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when structured gateway key allowed-model-group policy is invalid", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_1",
          label: "Gateway Key 1",
          value: "gateway-secret",
          status: "active",
          policy: {
            allowedModelGroups: ["default-chat", "default-chat"]
          }
        }
      ])
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when structured gateway key lifecycle config is invalid", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_1",
          label: "Gateway Key 1",
          value: "gateway-secret",
          status: "active",
          notBefore: "2026-05-13T00:00:00.000Z",
          expiresAt: "2026-05-13T00:00:00.000Z"
        }
      ])
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when model group config is malformed", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_MODEL_GROUPS: "{not-json"
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when a key policy references an unknown model group", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_MODEL_GROUPS: JSON.stringify({
        "cheap-chat": ["gpt-4.1-mini"]
      }),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_1",
          label: "Gateway Key 1",
          value: "gateway-secret",
          status: "active",
          policy: {
            allowedModelGroups: ["default-chat"]
          }
        }
      ])
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when a structured gateway key enables quota without a quota binding", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_1",
          label: "Gateway Key 1",
          value: "gateway-secret",
          status: "active",
          policy: {
            requestQuota: {
              limit: 1,
              windowSeconds: 3600
            }
          }
        }
      ])
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when a structured gateway key enables concurrency quota without its binding", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_1",
          label: "Gateway Key 1",
          value: "gateway-secret",
          status: "active",
          policy: {
            concurrencyQuota: {
              limit: 1
            }
          }
        }
      ])
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when a structured gateway key enables token quota without its binding", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_1",
          label: "Gateway Key 1",
          value: "gateway-secret",
          status: "active",
          policy: {
            tokenQuota: {
              limit: 20,
              windowSeconds: 3600
            }
          }
        }
      ])
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when internal revocation admin is configured without a revocation binding", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret"
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when model alias config is invalid", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      AIRLOCK_MODE: "free",
      AIRLOCK_GATEWAY_API_KEYS: "gateway-secret",
      AIRLOCK_MODEL_ALIASES:
        "gpt-4.1-mini=gpt-4.1-mini,gpt-4.1-mini=other-model",
      OPENAI_API_KEY: "openai-secret",
      OPENAI_BASE_URL: "https://api.openai.com/v1",
      OPENAI_DEFAULT_MODEL: "gpt-4.1-mini"
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when anthropic routes exist but anthropic config is missing", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      AIRLOCK_MODE: "free",
      AIRLOCK_GATEWAY_API_KEYS: "gateway-secret",
      OPENAI_API_KEY: "openai-secret",
      OPENAI_BASE_URL: "https://api.openai.com/v1",
      OPENAI_DEFAULT_MODEL: "gpt-4.1-mini",
      AIRLOCK_MODEL_ALIASES:
        "gpt-4.1-mini=openai:gpt-4.1-mini,claude-sonnet-4-5=anthropic:claude-sonnet-4-5"
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when provider timeout config is invalid", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_PROVIDER_TIMEOUT_MS: "0"
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when provider circuit breaker threshold config is invalid", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_PROVIDER_CIRCUIT_BREAKER_THRESHOLD: "0"
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when provider circuit breaker cooldown config is invalid", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS: "-1"
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when persistent provider circuit breaker config is enabled without its binding", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_PROVIDER_CIRCUIT_BREAKER_THRESHOLD: "1",
      AIRLOCK_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS: "60000",
      AIRLOCK_PROVIDER_CIRCUIT_BREAKER_PERSISTENT: "true"
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when gemini routes exist but gemini config is missing", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      AIRLOCK_MODE: "free",
      AIRLOCK_GATEWAY_API_KEYS: "gateway-secret",
      OPENAI_API_KEY: "openai-secret",
      OPENAI_BASE_URL: "https://api.openai.com/v1",
      OPENAI_DEFAULT_MODEL: "gpt-4.1-mini",
      AIRLOCK_MODEL_ALIASES:
        "gpt-4.1-mini=openai:gpt-4.1-mini,gemini-2.5-flash=gemini:gemini-2.5-flash"
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when model shaping json is malformed", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_MODEL_SHAPING: "{not-json"
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when model shaping targets an unknown route", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_MODEL_SHAPING: JSON.stringify({
        unknown: {
          headers: {
            "openai-beta": "responses=v1"
          }
        }
      })
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when route key access policy json is malformed", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_MODEL_KEY_POLICY: "{not-json"
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when route key access policy targets an unknown route", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_MODEL_KEY_POLICY: JSON.stringify({
        unknown: {
          requiredKeyTier: "prod"
        }
      })
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when fallback json is malformed", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_MODEL_FALLBACKS: "{not-json"
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("rejects unauthorized chat completions requests", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      createBindings()
    );

    expect(response.status).toBe(401);
  });

  it("rejects revoked structured gateway keys on chat completions requests", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer revoked-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "key_active",
            label: "Active Key",
            value: "gateway-secret",
            status: "active"
          },
          {
            id: "key_revoked",
            label: "Revoked Key",
            value: "revoked-secret",
            status: "revoked"
          }
        ])
      }
    );

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "auth_invalid_api_key"
      }
    });
  });

  it("rejects over-quota structured gateway keys on chat completions requests", async () => {
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
    const app = createApp({ fetcher });
    const bindings = {
      ...createBindings(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_quota",
          label: "Quota Key",
          value: "gateway-secret",
          status: "active",
          policy: {
            requestQuota: {
              limit: 1,
              windowSeconds: 3600
            }
          }
        }
      ]),
      AIRLOCK_GATEWAY_KEY_QUOTA: createQuotaNamespace()
    };

    const firstResponse = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      bindings
    );

    expect(firstResponse.status).toBe(200);

    const secondResponse = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi again" }]
        })
      },
      bindings
    );

    expect(secondResponse.status).toBe(429);
    expect(secondResponse.headers.get("retry-after")).toBeTruthy();
    expect(secondResponse.headers.get("x-ratelimit-limit")).toBe("1");
    expect(secondResponse.headers.get("x-ratelimit-remaining")).toBe("0");
    await expect(readJson(secondResponse)).resolves.toMatchObject({
      error: {
        code: "quota_requests_exceeded"
      }
    });
  });

  it("does not consume quota for malformed chat completions request bodies", async () => {
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
    const app = createApp({ fetcher });
    const bindings = {
      ...createBindings(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_quota",
          label: "Quota Key",
          value: "gateway-secret",
          status: "active",
          policy: {
            requestQuota: {
              limit: 1,
              windowSeconds: 3600
            }
          }
        }
      ]),
      AIRLOCK_GATEWAY_KEY_QUOTA: createQuotaNamespace()
    };

    const invalidResponse = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini"
        })
      },
      bindings
    );

    expect(invalidResponse.status).toBe(500);

    const validResponse = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi after invalid" }]
        })
      },
      bindings
    );

    expect(validResponse.status).toBe(200);
  });

  it("rejects a second in-flight buffered request when a key concurrency quota is exhausted", async () => {
    let resolveFirstRequest: ((response: Response) => void) | undefined;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(async () => {
        return await new Promise<Response>((resolve) => {
          resolveFirstRequest = resolve;
        });
      })
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "chatcmpl_after_release",
            object: "chat.completion",
            created: 1,
            model: "gpt-4.1-mini",
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: "hello after release"
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
    const app = createApp({ fetcher });
    const bindings = {
      ...createBindings(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_concurrency",
          label: "Concurrency Key",
          value: "gateway-secret",
          status: "active",
          policy: {
            concurrencyQuota: {
              limit: 1
            }
          }
        }
      ]),
      AIRLOCK_GATEWAY_KEY_CONCURRENCY: createConcurrencyNamespace()
    };

    const firstResponsePromise = app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "first" }]
        })
      },
      bindings
    );

    await Promise.resolve();

    const secondResponse = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "second" }]
        })
      },
      bindings
    );

    expect(secondResponse.status).toBe(429);
    await expect(readJson(secondResponse)).resolves.toMatchObject({
      error: {
        code: "quota_concurrency_exceeded"
      }
    });

    resolveFirstRequest?.(
      new Response(
        JSON.stringify({
          id: "chatcmpl_held",
          object: "chat.completion",
          created: 1,
          model: "gpt-4.1-mini",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "hello from held request"
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

    const firstResponse = await firstResponsePromise;
    expect(firstResponse.status).toBe(200);

    const thirdResponse = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "third" }]
        })
      },
      bindings
    );

    expect(thirdResponse.status).toBe(200);
  });

  it("rejects a second in-flight streaming request when a key concurrency quota is exhausted and releases the slot after stream completion", async () => {
    let releaseFirstStream: (() => void) | undefined;
    const encoder = new TextEncoder();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n'
                )
              );
              releaseFirstStream = () => {
                controller.enqueue(
                  encoder.encode(
                    [
                      'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"content":"done"},"finish_reason":null}]}\n\n',
                      'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
                      "data: [DONE]\n\n"
                    ].join("")
                  )
                );
                controller.close();
              };
            }
          }),
          {
            status: 200,
            headers: {
              "content-type": "text/event-stream"
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
                    'data: {"id":"chatcmpl_456","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
                    'data: {"id":"chatcmpl_456","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"content":"after"},"finish_reason":null}]}\n\n',
                    'data: {"id":"chatcmpl_456","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
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
    const app = createApp({ fetcher });
    const bindings = {
      ...createBindings(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_concurrency",
          label: "Concurrency Key",
          value: "gateway-secret",
          status: "active",
          policy: {
            concurrencyQuota: {
              limit: 1
            }
          }
        }
      ]),
      AIRLOCK_GATEWAY_KEY_CONCURRENCY: createConcurrencyNamespace()
    };

    const firstResponsePromise = app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: true,
          messages: [{ role: "user", content: "first stream" }]
        })
      },
      bindings
    );

    await Promise.resolve();

    const secondResponse = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: true,
          messages: [{ role: "user", content: "second stream" }]
        })
      },
      bindings
    );

    expect(secondResponse.status).toBe(429);
    await expect(readJson(secondResponse)).resolves.toMatchObject({
      error: {
        code: "quota_concurrency_exceeded"
      }
    });

    releaseFirstStream?.();

    const firstResponse = await firstResponsePromise;
    expect(firstResponse.status).toBe(200);
    await expect(readText(firstResponse)).resolves.toContain("data: [DONE]");

    const thirdResponse = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: true,
          messages: [{ role: "user", content: "third stream" }]
        })
      },
      bindings
    );

    expect(thirdResponse.status).toBe(200);
    await expect(readText(thirdResponse)).resolves.toContain("data: [DONE]");
  });

  it("charges buffered token usage and blocks later requests when the token window is exhausted", async () => {
    const fetcher = vi
      .fn()
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
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "chatcmpl_456",
            object: "chat.completion",
            created: 1,
            model: "gpt-4.1-mini",
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: "should not be reached"
                }
              }
            ],
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
              total_tokens: 2
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
    const app = createApp({ fetcher });
    const bindings = {
      ...createBindings(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_token_quota",
          label: "Token Quota Key",
          value: "gateway-secret",
          status: "active",
          policy: {
            tokenQuota: {
              limit: 20,
              windowSeconds: 3600
            }
          }
        }
      ]),
      AIRLOCK_GATEWAY_KEY_TOKEN_QUOTA: createTokenQuotaNamespace()
    };

    const firstResponse = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      bindings
    );

    expect(firstResponse.status).toBe(200);

    const secondResponse = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "second" }]
        })
      },
      bindings
    );

    expect(secondResponse.status).toBe(429);
    expect(secondResponse.headers.get("x-ratelimit-limit")).toBe("20");
    expect(secondResponse.headers.get("x-ratelimit-remaining")).toBe("0");
    await expect(readJson(secondResponse)).resolves.toMatchObject({
      error: {
        code: "quota_tokens_exceeded"
      }
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fails closed when token quota is configured but a successful buffered response does not provide usage", async () => {
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
    const app = createApp({ fetcher });
    const bindings = {
      ...createBindings(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_token_quota",
          label: "Token Quota Key",
          value: "gateway-secret",
          status: "active",
          policy: {
            tokenQuota: {
              limit: 20,
              windowSeconds: 3600
            }
          }
        }
      ]),
      AIRLOCK_GATEWAY_KEY_TOKEN_QUOTA: createTokenQuotaNamespace()
    };

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      bindings
    );

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "gateway_key_token_quota_usage_unavailable"
      }
    });
  });

  it("does not consume token quota for malformed chat completions request bodies", async () => {
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
    const app = createApp({ fetcher });
    const bindings = {
      ...createBindings(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_token_quota",
          label: "Token Quota Key",
          value: "gateway-secret",
          status: "active",
          policy: {
            tokenQuota: {
              limit: 20,
              windowSeconds: 3600
            }
          }
        }
      ]),
      AIRLOCK_GATEWAY_KEY_TOKEN_QUOTA: createTokenQuotaNamespace()
    };

    const invalidResponse = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini"
        })
      },
      bindings
    );

    expect(invalidResponse.status).toBe(500);

    const validResponse = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi after invalid" }]
        })
      },
      bindings
    );

    expect(validResponse.status).toBe(200);
  });

  it("charges streaming token usage and blocks later requests when the token window is exhausted", async () => {
    const encoder = new TextEncoder();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  [
                    'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
                    'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"content":"done"},"finish_reason":null}]}\n\n',
                    'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":8,"total_tokens":20}}\n\n',
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
      )
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  [
                    'data: {"id":"chatcmpl_456","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
                    'data: {"id":"chatcmpl_456","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
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
    const app = createApp({ fetcher });
    const bindings = {
      ...createBindings(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_token_quota",
          label: "Token Quota Key",
          value: "gateway-secret",
          status: "active",
          policy: {
            tokenQuota: {
              limit: 20,
              windowSeconds: 3600
            }
          }
        }
      ]),
      AIRLOCK_GATEWAY_KEY_TOKEN_QUOTA: createTokenQuotaNamespace()
    };

    const firstResponse = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: true,
          messages: [{ role: "user", content: "first stream" }]
        })
      },
      bindings
    );

    expect(firstResponse.status).toBe(200);
    await expect(readText(firstResponse)).resolves.toContain("data: [DONE]");

    const secondResponse = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: true,
          messages: [{ role: "user", content: "second stream" }]
        })
      },
      bindings
    );

    expect(secondResponse.status).toBe(429);
    await expect(readJson(secondResponse)).resolves.toMatchObject({
      error: {
        code: "quota_tokens_exceeded"
      }
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects missing admin auth on internal key revocation routes", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/_airlock/keys/gak_1/revocation",
      {
        method: "GET"
      },
      {
        ...createBindings(),
        AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
        AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
      }
    );

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "auth_invalid_admin_token"
      }
    });
  });

  it("can persistently revoke and clear a configured key through internal admin routes", async () => {
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
    const app = createApp({ fetcher });
    const bindings = {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
    };

    const initialStatus = await app.request(
      "http://localhost/_airlock/keys/gak_1/revocation",
      {
        method: "GET",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(initialStatus.status).toBe(200);
    await expect(readJson(initialStatus)).resolves.toMatchObject({
      keyId: "gak_1",
      revoked: false
    });

    const revokeResponse = await app.request(
      "http://localhost/_airlock/keys/gak_1/revocation",
      {
        method: "POST",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(revokeResponse.status).toBe(200);
    await expect(readJson(revokeResponse)).resolves.toMatchObject({
      keyId: "gak_1",
      revoked: true
    });

    const blockedResponse = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi while revoked" }]
        })
      },
      bindings
    );

    expect(blockedResponse.status).toBe(401);
    await expect(readJson(blockedResponse)).resolves.toMatchObject({
      error: {
        code: "auth_invalid_api_key"
      }
    });

    const clearResponse = await app.request(
      "http://localhost/_airlock/keys/gak_1/revocation",
      {
        method: "DELETE",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(clearResponse.status).toBe(200);
    await expect(readJson(clearResponse)).resolves.toMatchObject({
      keyId: "gak_1",
      revoked: false
    });

    const allowedResponse = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi after clear" }]
        })
      },
      bindings
    );

    expect(allowedResponse.status).toBe(200);
  });

  it("rejects internal revocation operations for unknown key ids", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/_airlock/keys/unknown-key/revocation",
      {
        method: "POST",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      {
        ...createBindings(),
        AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
        AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
      }
    );

    expect(response.status).toBe(404);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "gateway_key_not_found"
      }
    });
  });

  it("rejects a not-yet-active structured gateway key on the request path", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            notBefore: "2099-01-01T00:00:00.000Z"
          }
        ])
      }
    );

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "auth_api_key_not_yet_active"
      }
    });
  });

  it("rejects an expired structured gateway key on the request path", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            expiresAt: "2000-01-01T00:00:00.000Z"
          }
        ])
      }
    );

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "auth_api_key_expired"
      }
    });
  });

  it("returns effective key lifecycle status from the internal admin route", async () => {
    const app = createApp({ fetcher: vi.fn() });
    const bindings = {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_1",
          label: "Gateway Key 1",
          value: "gateway-secret",
          status: "active",
          notBefore: "2099-01-01T00:00:00.000Z"
        }
      ])
    };

    const response = await app.request(
      "http://localhost/_airlock/keys/key_1/status",
      {
        method: "GET",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toMatchObject({
      keyId: "key_1",
      configuredStatus: "active",
      lifecycleStatus: "not_yet_active",
      overlayRevoked: false,
      effectiveStatus: "not_yet_active",
      acceptedNow: false
    });
  });

  it("authorizes hashed structured gateway keys on chat completions requests", async () => {
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
    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "key_active",
            label: "Active Key",
            valueHash: gatewaySecretHash,
            status: "active"
          }
        ])
      }
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects revoked hashed structured gateway keys on chat completions requests", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "key_revoked",
            label: "Revoked Key",
            valueHash: gatewaySecretHash,
            status: "revoked"
          }
        ])
      }
    );

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "auth_invalid_api_key"
      }
    });
  });

  it("rejects authenticated keys that are not allowed to access the requested external model", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              allowedExternalModels: ["gpt-4.1-mini"]
            }
          }
        ])
      }
    );

    expect(response.status).toBe(403);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "auth_model_not_allowed",
        type: "authorization"
      }
    });
  });

  it("allows authenticated keys to access explicitly allowed external models", async () => {
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

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              allowedExternalModels: ["gpt-4.1-mini"]
            }
          }
        ])
      }
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("allows authenticated keys to access external models through allowed model groups", async () => {
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

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_MODEL_GROUPS: JSON.stringify({
          "default-chat": ["gpt-4.1-mini", "claude-sonnet-4-5"]
        }),
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              allowedModelGroups: ["default-chat"]
            }
          }
        ])
      }
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects authenticated keys when neither explicit models nor allowed model groups match", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_MODEL_GROUPS: JSON.stringify({
          "cheap-chat": ["gpt-4.1-mini"]
        }),
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              allowedModelGroups: ["cheap-chat"]
            }
          }
        ])
      }
    );

    expect(response.status).toBe(403);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "auth_model_not_allowed",
        type: "authorization"
      }
    });
  });

  it("returns an OpenAI-compatible authorization error for denied /v1/responses model access", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/responses",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          input: "hi",
          stream: false
        })
      },
      {
        ...createBindings(),
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              allowedExternalModels: ["gpt-4.1-mini"]
            }
          }
        ])
      }
    );

    expect(response.status).toBe(403);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "auth_model_not_allowed",
        type: "authorization"
      }
    });
  });

  it("returns an Anthropic-compatible authorization error for denied /v1/messages model access", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/messages",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 256,
          messages: [
            {
              role: "user",
              content: "hi"
            }
          ]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              allowedExternalModels: ["gpt-4.1-mini"]
            }
          }
        ])
      }
    );

    expect(response.status).toBe(403);
    await expect(readJson(response)).resolves.toMatchObject({
      type: "error",
      error: {
        type: "authorization",
        message: "Gateway API key is not allowed to access this model"
      }
    });
    expect(response.headers.get("request-id")).toBeTruthy();
  });

  it("returns an OpenAI-compatible authorization error for denied primary provider access", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              allowedProviders: ["anthropic"]
            }
          }
        ])
      }
    );

    expect(response.status).toBe(403);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "auth_provider_not_allowed",
        type: "authorization"
      }
    });
  });

  it("returns an OpenAI-compatible authorization error when the route requires a higher key tier", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_MODEL_KEY_POLICY: JSON.stringify({
          "gpt-4.1-mini": {
            requiredKeyTier: "prod"
          }
        }),
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              tier: "dev"
            }
          }
        ])
      }
    );

    expect(response.status).toBe(403);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "auth_route_policy_not_allowed",
        type: "authorization"
      }
    });
  });

  it("returns an OpenAI-compatible authorization error when the route requires missing key tags", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_MODEL_KEY_POLICY: JSON.stringify({
          "gpt-4.1-mini": {
            requiredKeyTags: ["internal", "critical"]
          }
        }),
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              tags: ["internal"]
            }
          }
        ])
      }
    );

    expect(response.status).toBe(403);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "auth_route_policy_not_allowed",
        type: "authorization"
      }
    });
  });

  it("allows requests when the key satisfies required route tier and tags", async () => {
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

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_MODEL_KEY_POLICY: JSON.stringify({
          "gpt-4.1-mini": {
            requiredKeyTier: "prod",
            requiredKeyTags: ["internal", "critical"]
          }
        }),
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              tier: "prod",
              tags: ["internal", "critical", "ops"]
            }
          }
        ])
      }
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns an Anthropic-compatible authorization error for denied primary provider access", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/messages",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 256,
          messages: [
            {
              role: "user",
              content: "hi"
            }
          ]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              allowedProviders: ["openai"]
            }
          }
        ])
      }
    );

    expect(response.status).toBe(403);
    await expect(readJson(response)).resolves.toMatchObject({
      type: "error",
      error: {
        type: "authorization",
        message: "Gateway API key is not allowed to access this provider"
      }
    });
    expect(response.headers.get("request-id")).toBeTruthy();
  });

  it("returns an Anthropic-compatible authorization error when the route requires missing key tags", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/messages",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 256,
          messages: [
            {
              role: "user",
              content: "hi"
            }
          ]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_MODEL_KEY_POLICY: JSON.stringify({
          "claude-sonnet-4-5": {
            requiredKeyTags: ["internal"]
          }
        }),
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              tags: ["external"]
            }
          }
        ])
      }
    );

    expect(response.status).toBe(403);
    await expect(readJson(response)).resolves.toMatchObject({
      type: "error",
      error: {
        type: "authorization",
        message: "Gateway API key is not allowed to access this route"
      }
    });
  });

  it("returns an OpenAI-compatible chat completions response when authorized", async () => {
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

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_MODEL_SHAPING: JSON.stringify({
          "gpt-4.1-mini": {
            headers: {
              "openai-beta": "responses=v1"
            },
            query: {
              "api-version": "2025-01-01"
            },
            jsonBody: {
              temperature: 0.2
            }
          }
        })
      }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(url).toBe(
      "https://api.openai.com/v1/chat/completions?api-version=2025-01-01"
    );
    expect(init.headers).toMatchObject({
      "openai-beta": "responses=v1"
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model: "gpt-4.1-mini",
      stream: false,
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.2
    });
    await expect(readJson(response)).resolves.toMatchObject({
      object: "chat.completion",
      model: "gpt-4.1-mini"
    });
  });

  it("applies request-scoped shaping to chat completions requests", async () => {
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

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }],
          airlock: {
            requestShaping: {
              headers: {
                "openai-beta": "responses=v1"
              },
              query: {
                "api-version": "2025-01-01"
              },
              jsonBody: {
                temperature: 0.2
              }
            }
          }
        })
      },
      createBindings()
    );

    expect(response.status).toBe(200);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(url).toBe(
      "https://api.openai.com/v1/chat/completions?api-version=2025-01-01"
    );
    expect(init.headers).toMatchObject({
      "openai-beta": "responses=v1"
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model: "gpt-4.1-mini",
      stream: false,
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.2
    });
  });

  it("lets request-scoped shaping override route-level shaping for chat completions", async () => {
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

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }],
          airlock: {
            requestShaping: {
              headers: {
                "openai-beta": "responses=v2"
              },
              query: {
                "api-version": "2025-02-02"
              },
              jsonBody: {
                temperature: 0.8
              }
            }
          }
        })
      },
      {
        ...createBindings(),
        AIRLOCK_MODEL_SHAPING: JSON.stringify({
          "gpt-4.1-mini": {
            headers: {
              "openai-beta": "responses=v1"
            },
            query: {
              "api-version": "2025-01-01"
            },
            jsonBody: {
              temperature: 0.2
            }
          }
        })
      }
    );

    expect(response.status).toBe(200);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(url).toBe(
      "https://api.openai.com/v1/chat/completions?api-version=2025-02-02"
    );
    expect(init.headers).toMatchObject({
      "openai-beta": "responses=v2"
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model: "gpt-4.1-mini",
      stream: false,
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.8
    });
  });

  it("fails over to the configured OpenAI fallback target on retryable upstream error", async () => {
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

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
          "gpt-4.1-mini": ["openai:gpt-4.1-nano"]
        })
      }
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse((fetcher.mock.calls[0] as [string, RequestInit])[1].body as string))
      .toMatchObject({
        model: "gpt-4.1-mini"
      });
    expect(JSON.parse((fetcher.mock.calls[1] as [string, RequestInit])[1].body as string))
      .toMatchObject({
        model: "gpt-4.1-nano"
      });
    await expect(readJson(response)).resolves.toMatchObject({
      model: "gpt-4.1-nano"
    });
  });

  it("retries a retryable provider failure on the same target before succeeding", async () => {
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
            id: "chatcmpl_retry",
            object: "chat.completion",
            created: 1,
            model: "gpt-4.1-mini",
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: "retry recovered"
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

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_PROVIDER_MAX_RETRIES: "1",
        AIRLOCK_PROVIDER_RETRY_BACKOFF_MS: "10"
      }
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse((fetcher.mock.calls[0] as [string, RequestInit])[1].body as string))
      .toMatchObject({
        model: "gpt-4.1-mini"
      });
    expect(JSON.parse((fetcher.mock.calls[1] as [string, RequestInit])[1].body as string))
      .toMatchObject({
        model: "gpt-4.1-mini"
      });
    await expect(readJson(response)).resolves.toMatchObject({
      model: "gpt-4.1-mini"
    });
  });

  it("fails over only after same-target retries are exhausted", async () => {
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

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_PROVIDER_MAX_RETRIES: "1",
        AIRLOCK_PROVIDER_RETRY_BACKOFF_MS: "10",
        AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
          "gpt-4.1-mini": ["openai:gpt-4.1-nano"]
        })
      }
    );

    expect(response.status).toBe(200);
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
    await expect(readJson(response)).resolves.toMatchObject({
      model: "gpt-4.1-nano"
    });
  });

  it("does not fail over on non-retryable upstream errors", async () => {
    const fetcher = vi.fn().mockResolvedValue(
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

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
          "gpt-4.1-mini": ["openai:gpt-4.1-nano"]
        })
      }
    );

    expect(response.status).toBe(400);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fails over when the primary provider attempt times out", async () => {
    const fetcher = vi
      .fn()
      .mockImplementationOnce(async (_input, init?: RequestInit) => {
        const signal = init?.signal;

        return await new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      })
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

    const app = createApp({ fetcher });

    const nowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(10);

    try {
      const response = await app.request(
        "http://localhost/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer gateway-secret"
          },
          body: JSON.stringify({
            model: "gpt-4.1-mini",
            stream: false,
            messages: [{ role: "user", content: "hi" }]
          })
        },
        {
          ...createBindings(),
          AIRLOCK_PROVIDER_TIMEOUT_MS: "50",
          AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
            "gpt-4.1-mini": ["openai:gpt-4.1-nano"]
          })
        }
      );

      expect(response.status).toBe(200);
      expect(fetcher).toHaveBeenCalledTimes(2);
      await expect(readJson(response)).resolves.toMatchObject({
        model: "gpt-4.1-nano"
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("returns timeout instead of issuing another fallback call when the shared timeout budget is exhausted", async () => {
    const fetcher = vi
      .fn()
      .mockImplementationOnce(async (_input, init?: RequestInit) => {
        const signal = init?.signal;

        return await new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      });

    const app = createApp({ fetcher });

    const nowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(5);

    try {
      const response = await app.request(
        "http://localhost/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer gateway-secret"
          },
          body: JSON.stringify({
            model: "gpt-4.1-mini",
            stream: false,
            messages: [{ role: "user", content: "hi" }]
          })
        },
        {
          ...createBindings(),
          AIRLOCK_PROVIDER_TIMEOUT_MS: "1",
          AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
            "gpt-4.1-mini": ["openai:gpt-4.1-nano", "openai:gpt-4.1-micro"]
          })
        }
      );

      expect(response.status).toBe(504);
      expect(fetcher).toHaveBeenCalledTimes(1);
      await expect(readJson(response)).resolves.toMatchObject({
        error: {
          code: "provider_timeout",
          type: "provider"
        }
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("fails over across providers when an unshaped route has a retryable primary failure", async () => {
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
                text: "fallback hello"
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

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "assistant-default",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_MODEL_ALIASES:
          "assistant-default=openai:gpt-4.1-mini,claude-haiku-4-5=anthropic:claude-haiku-4-5",
        AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
          "assistant-default": ["anthropic:claude-haiku-4-5"]
        })
      }
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(fetcher.mock.calls[1]?.[0]).toBe("https://api.anthropic.com/v1/messages");
    await expect(readJson(response)).resolves.toMatchObject({
      model: "claude-haiku-4-5"
    });
  });

  it("returns the primary upstream error when every later fallback target is filtered out by key policy", async () => {
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

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "assistant-default",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              allowedProviders: ["openai"]
            }
          }
        ]),
        AIRLOCK_MODEL_ALIASES:
          "assistant-default=openai:gpt-4.1-mini,claude-haiku-4-5=anthropic:claude-haiku-4-5",
        AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
          "assistant-default": ["anthropic:claude-haiku-4-5"]
        })
      }
    );

    expect(response.status).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "provider_upstream_error",
        type: "provider"
      }
    });
  });

  it("returns 503 without another upstream fetch when every eligible target is open", async () => {
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

    const app = createApp({ fetcher });
    const request = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer gateway-secret"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        stream: false,
        messages: [{ role: "user", content: "hi" }]
      })
    };
    const bindings = {
      ...createBindings(),
      AIRLOCK_PROVIDER_CIRCUIT_BREAKER_THRESHOLD: "1",
      AIRLOCK_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS: "60000"
    };

    const firstResponse = await app.request(
      "http://localhost/v1/chat/completions",
      request,
      bindings
    );

    expect(firstResponse.status).toBe(429);

    const secondResponse = await app.request(
      "http://localhost/v1/chat/completions",
      request,
      bindings
    );

    expect(secondResponse.status).toBe(503);
    await expect(readJson(secondResponse)).resolves.toMatchObject({
      error: {
        code: "provider_circuit_open",
        type: "routing"
      }
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("routes directly to the first provider-allowed fallback target without calling a disallowed primary target", async () => {
    const fetcher = vi
      .fn()
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

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "assistant-default",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              allowedProviders: ["openai"]
            }
          }
        ]),
        AIRLOCK_MODEL_ALIASES:
          "assistant-default=anthropic:claude-sonnet-4-5,gpt-4.1-mini=openai:gpt-4.1-mini",
        AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
          "assistant-default": ["openai:gpt-4.1-mini"]
        })
      }
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    await expect(readJson(response)).resolves.toMatchObject({
      model: "gpt-4.1-mini"
    });
  });

  it("can start from a weighted fallback target before the configured primary target", async () => {
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

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "assistant-default",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_MODEL_ALIASES:
          "assistant-default=openai:gpt-4.1-mini,claude-haiku-4-5=anthropic:claude-haiku-4-5",
        AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
          "assistant-default": ["anthropic:claude-haiku-4-5"]
        }),
        AIRLOCK_MODEL_TARGET_SELECTION: JSON.stringify({
          "assistant-default": {
            strategy: "weighted",
            weights: {
              "openai:gpt-4.1-mini": 1,
              "anthropic:claude-haiku-4-5": 10000
            }
          }
        })
      }
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/messages");
    await expect(readJson(response)).resolves.toMatchObject({
      model: "claude-haiku-4-5"
    });
  });

  it("can start from a lower-cost fallback target before the configured primary target", async () => {
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

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "assistant-default",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_MODEL_ALIASES:
          "assistant-default=openai:gpt-4.1-mini,claude-haiku-4-5=anthropic:claude-haiku-4-5",
        AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
          "assistant-default": ["anthropic:claude-haiku-4-5"]
        }),
        AIRLOCK_MODEL_TARGET_SELECTION: JSON.stringify({
          "assistant-default": {
            strategy: "lowest_cost",
            costs: {
              "openai:gpt-4.1-mini": 10,
              "anthropic:claude-haiku-4-5": 3
            }
          }
        })
      }
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/messages");
    await expect(readJson(response)).resolves.toMatchObject({
      model: "claude-haiku-4-5"
    });
  });

  it("prefers a healthier closed fallback target on a later request when health-priority selection is configured", async () => {
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
    const app = createApp({ fetcher });

    const bindings = {
      ...createBindings(),
      AIRLOCK_PROVIDER_CIRCUIT_BREAKER_PERSISTENT: "true",
      AIRLOCK_PROVIDER_CIRCUIT_BREAKER_THRESHOLD: "3",
      AIRLOCK_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS: "60000",
      AIRLOCK_PROVIDER_CIRCUIT_BREAKER: createPersistentBreakerNamespace(),
      AIRLOCK_MODEL_ALIASES:
        "assistant-default=openai:gpt-4.1-mini,claude-haiku-4-5=anthropic:claude-haiku-4-5",
      AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
        "assistant-default": ["anthropic:claude-haiku-4-5"]
      }),
      AIRLOCK_MODEL_TARGET_SELECTION: JSON.stringify({
        "assistant-default": {
          strategy: "health_priority"
        }
      })
    };

    const firstResponse = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "assistant-default",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      bindings
    );

    expect(firstResponse.status).toBe(200);

    const secondResponse = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "assistant-default",
          stream: false,
          messages: [{ role: "user", content: "hi again" }]
        })
      },
      bindings
    );

    expect(secondResponse.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(fetcher.mock.calls[1]?.[0]).toBe("https://api.anthropic.com/v1/messages");
    expect(fetcher.mock.calls[2]?.[0]).toBe("https://api.anthropic.com/v1/messages");
    await expect(readJson(secondResponse)).resolves.toMatchObject({
      model: "claude-haiku-4-5"
    });
  });

  it("streams openai chat completion chunks and terminates with done", async () => {
    const encoder = new TextEncoder();
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                [
                  'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
                  'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"content":"hel"},"finish_reason":null}]}\n\n',
                  'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":null}]}\n\n',
                  'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
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

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: true,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      createBindings()
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    await expect(readText(response)).resolves.toContain("data: [DONE]");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("streams gemini chat completion chunks and terminates with done", async () => {
    const encoder = new TextEncoder();
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                [
                  'data: {"responseId":"gemini-response-123","modelVersion":"gemini-2.5-flash","candidates":[{"content":{"role":"model","parts":[{"text":"hel"}]}}]}\n\n',
                  'data: {"responseId":"gemini-response-123","modelVersion":"gemini-2.5-flash","candidates":[{"content":{"role":"model","parts":[{"text":"lo"}]}}]}\n\n',
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

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gemini-2.5-flash",
          stream: true,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        GEMINI_API_KEY: "gemini-secret",
        GEMINI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
        AIRLOCK_MODEL_ALIASES:
          "gpt-4.1-mini=openai:gpt-4.1-mini,claude-sonnet-4-5=anthropic:claude-sonnet-4-5,gemini-2.5-flash=gemini:gemini-2.5-flash"
      }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const body = await readText(response);

    expect(body).toContain('"delta":{"role":"assistant"}');
    expect(body).toContain('"delta":{"content":"hel"}');
    expect(body).toContain('"delta":{"content":"lo"}');
    expect(body).toContain('"finish_reason":"stop"');
    expect(body).toContain("data: [DONE]");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse"
    );
  });

  it("returns not ready when a shaped route configures cross-provider fallback", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_MODEL_ALIASES: "assistant-default=openai:gpt-4.1-mini",
      AIRLOCK_MODEL_SHAPING: JSON.stringify({
        "assistant-default": {
          headers: {
            "openai-beta": "responses=v1"
          }
        }
      }),
      AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
        "assistant-default": ["anthropic:claude-haiku-4-5"]
      })
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready when target selection references a target outside the route chain", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_MODEL_ALIASES: "assistant-default=openai:gpt-4.1-mini",
      AIRLOCK_MODEL_TARGET_SELECTION: JSON.stringify({
        "assistant-default": {
          strategy: "weighted",
          weights: {
            "anthropic:claude-haiku-4-5": 1
          }
        }
      })
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("routes authorized chat completions requests to Gemini when configured", async () => {
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

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gemini-2.5-flash",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        GEMINI_API_KEY: "gemini-secret",
        GEMINI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
        AIRLOCK_MODEL_ALIASES:
          "gpt-4.1-mini=openai:gpt-4.1-mini,claude-sonnet-4-5=anthropic:claude-sonnet-4-5,gemini-2.5-flash=gemini:gemini-2.5-flash"
      }
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    );
    expect(init.headers).toMatchObject({
      "x-goog-api-key": "gemini-secret"
    });
    expect(JSON.parse(init.body as string)).toEqual({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: "hi"
            }
          ]
        }
      ]
    });
    await expect(readJson(response)).resolves.toMatchObject({
      object: "chat.completion",
      model: "gemini-2.5-flash"
    });
  });

  it("returns an OpenAI-compatible responses payload when authorized", async () => {
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

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/responses",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          input: "hi",
          stream: false
        })
      },
      createBindings()
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toMatchObject({
      object: "response",
      model: "gpt-4.1-mini",
      output_text: "hello there"
    });
  });

  it("streams openai responses events and terminates with done", async () => {
    const encoder = new TextEncoder();
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                [
                  'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
                  'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"content":"hel"},"finish_reason":null}]}\n\n',
                  'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":null}]}\n\n',
                  'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
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

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/responses",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          input: "hi",
          stream: true
        })
      },
      createBindings()
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const body = await readText(response);

    expect(body).toContain('"type":"response.created"');
    expect(body).toContain('"type":"response.output_text.delta"');
    expect(body).toContain('"type":"response.completed"');
    expect(body).toContain("data: [DONE]");
  });

  it("applies request-scoped shaping to responses requests", async () => {
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

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/responses",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          input: "hi",
          stream: false,
          airlock: {
            requestShaping: {
              query: {
                "api-version": "2025-01-01"
              },
              jsonBody: {
                temperature: 0.2
              }
            }
          }
        })
      },
      createBindings()
    );

    expect(response.status).toBe(200);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(url).toBe(
      "https://api.openai.com/v1/chat/completions?api-version=2025-01-01"
    );
    expect(JSON.parse(init.body as string)).toEqual({
      model: "gpt-4.1-mini",
      stream: false,
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.2
    });
  });

  it("returns an Anthropic-compatible messages payload when authorized", async () => {
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

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/messages",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 256,
          messages: [
            {
              role: "user",
              content: "hi"
            }
          ]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_MODEL_SHAPING: JSON.stringify({
          "claude-sonnet-4-5": {
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
          }
        })
      }
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://api.anthropic.com/v1/messages?trace=1");
    expect(init.headers).toMatchObject({
      "anthropic-beta": "tools-2024-04-04"
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model: "claude-sonnet-4-5",
      max_tokens: 256,
      metadata: {
        source: "airlock"
      },
      messages: [{ role: "user", content: "hi" }]
    });
    await expect(readJson(response)).resolves.toMatchObject({
      type: "message",
      role: "assistant",
      content: [
        {
          type: "text",
          text: "hello there"
        }
      ]
    });
  });

  it("streams anthropic messages events for /v1/messages", async () => {
    const encoder = new TextEncoder();
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                [
                  'event: message_start\ndata: {"message":{"id":"msg_123","model":"claude-sonnet-4-5"}}\n\n',
                  'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"hel"}}\n\n',
                  'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"lo"}}\n\n',
                  "event: message_stop\ndata: {}\n\n"
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

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/messages",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 256,
          stream: true,
          messages: [
            {
              role: "user",
              content: "hi"
            }
          ]
        })
      },
      createBindings()
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const body = await readText(response);

    expect(body).toContain("event: message_start");
    expect(body).toContain("event: content_block_start");
    expect(body).toContain("event: content_block_delta");
    expect(body).toContain("event: content_block_stop");
    expect(body).toContain("event: message_stop");
  });

  it("applies request-scoped shaping to anthropic messages requests", async () => {
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

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/messages",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 256,
          system: "You are precise.",
          messages: [
            {
              role: "user",
              content: "hi"
            }
          ],
          airlock: {
            requestShaping: {
              headers: {
                "anthropic-beta": "prompt-caching-2024-07-31"
              },
              query: {
                trace: "1"
              },
              jsonBody: {
                metadata: {
                  source: "request"
                }
              }
            }
          }
        })
      },
      createBindings()
    );

    expect(response.status).toBe(200);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://api.anthropic.com/v1/messages?trace=1");
    expect(init.headers).toMatchObject({
      "anthropic-beta": "prompt-caching-2024-07-31"
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model: "claude-sonnet-4-5",
      max_tokens: 256,
      system: "You are precise.",
      metadata: {
        source: "request"
      },
      messages: [{ role: "user", content: "hi" }]
    });
  });

  it("rejects reserved request-scoped shaping headers as a request error", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }],
          airlock: {
            requestShaping: {
              headers: {
                authorization: "Bearer override"
              }
            }
          }
        })
      },
      createBindings()
    );

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "request_invalid_request_shaping",
        type: "request"
      }
    });
  });

  it("returns an Anthropic-compatible error payload for unauthorized /v1/messages", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/messages",
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 256,
          messages: [
            {
              role: "user",
              content: "hi"
            }
          ]
        })
      },
      createBindings()
    );

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toMatchObject({
      type: "error",
      error: {
        type: "authentication",
        message: "Unauthorized"
      }
    });
    expect(response.headers.get("request-id")).toBeTruthy();
  });
});
