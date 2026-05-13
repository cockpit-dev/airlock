import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TelemetrySink } from "@airlock/telemetry";

import { createApp } from "./app.js";
import { resetProviderCircuitBreakerState } from "./circuit-breaker.js";
import { GatewayKeyRegistryDurableObject } from "./gateway-key-registry.js";

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

function isGatewayKeyEventsPayload(
  value: unknown
): value is {
  keyId: string;
  events: Array<{
    keyId: string;
    kind: string;
    ownership?: string;
    occurredAt?: string;
    reason?: string;
    actor?: string;
  }>;
} {
  return (
    isRecord(value) &&
    typeof value.keyId === "string" &&
    Array.isArray(value.events) &&
    value.events.every((event) => {
      return (
        isRecord(event) &&
        typeof event.keyId === "string" &&
        typeof event.kind === "string" &&
        (event.ownership === undefined || typeof event.ownership === "string") &&
        (event.occurredAt === undefined || typeof event.occurredAt === "string") &&
        (event.reason === undefined || typeof event.reason === "string") &&
        (event.actor === undefined || typeof event.actor === "string")
      );
    })
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
      reservations: Array<{
        reservationId: string;
        tokens: number;
        expiresAt: number;
      }>;
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
              }
            | {
                kind: "reserve";
                limit: number;
                windowSeconds: number;
                reservationId: string;
                tokens: number;
                ttlMs: number;
              }
            | {
                kind: "release";
                limit: number;
                windowSeconds: number;
                reservationId: string;
              }
            | {
                kind: "reconcile";
                limit: number;
                windowSeconds: number;
                reservationId: string;
                actualTokens: number;
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
                  usedTokens: 0,
                  reservations: []
                };
          current.reservations = current.reservations.filter((reservation) => {
            return reservation.expiresAt > now;
          });
          const resetAt = new Date(windowStartedAt + windowMs).toISOString();
          const retryAfterSeconds = Math.max(
            0,
            Math.ceil((windowStartedAt + windowMs - now) / 1000)
          );
          const reserved = current.reservations.reduce((sum, reservation) => {
            return sum + reservation.tokens;
          }, 0);

          const decision = (used: number, nextReserved: number, allowed: boolean) => {
            return {
              allowed,
              limit: body.limit,
              remaining: Math.max(0, body.limit - used - nextReserved),
              used,
              reserved: nextReserved,
              resetAt,
              retryAfterSeconds
            };
          };

          if (body.kind === "precheck") {
            return Response.json(
              decision(
                current.usedTokens,
                reserved,
                current.usedTokens + reserved < body.limit
              )
            );
          }

          if (body.kind === "charge") {
            current.usedTokens += body.tokens;
            state.set(id.name, current);
            const nextReserved = current.reservations.reduce((sum, reservation) => {
              return sum + reservation.tokens;
            }, 0);

            return Response.json(
              decision(current.usedTokens, nextReserved, true)
            );
          }

          if (body.kind === "reserve") {
            const nextReservations = [
              ...current.reservations.filter((reservation) => {
                return reservation.reservationId !== body.reservationId;
              }),
              {
                reservationId: body.reservationId,
                tokens: body.tokens,
                expiresAt: now + body.ttlMs
              }
            ];
            const nextReserved = nextReservations.reduce((sum, reservation) => {
              return sum + reservation.tokens;
            }, 0);
            const allowed = current.usedTokens + nextReserved < body.limit;

            if (!allowed) {
              return Response.json(
                decision(current.usedTokens, nextReserved, false)
              );
            }

            current.reservations = nextReservations;
            state.set(id.name, current);

            return Response.json(
              decision(current.usedTokens, nextReserved, true)
            );
          }

          if (body.kind === "release") {
            current.reservations = current.reservations.filter((reservation) => {
              return reservation.reservationId !== body.reservationId;
            });
            state.set(id.name, current);
            const nextReserved = current.reservations.reduce((sum, reservation) => {
              return sum + reservation.tokens;
            }, 0);

            return Response.json(
              decision(current.usedTokens, nextReserved, true)
            );
          }

          const reservation = current.reservations.find((candidate) => {
            return candidate.reservationId === body.reservationId;
          });
          current.reservations = current.reservations.filter((candidate) => {
            return candidate.reservationId !== body.reservationId;
          });
          current.usedTokens = Math.max(
            0,
            current.usedTokens + body.actualTokens - (reservation?.tokens ?? 0)
          );
          state.set(id.name, current);
          const nextReserved = current.reservations.reduce((sum, nextReservation) => {
            return sum + nextReservation.tokens;
          }, 0);

          return Response.json(
            decision(current.usedTokens, nextReserved, true)
          );
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
      events: Array<{
        keyId: string;
        kind: "revoked" | "unrevoked";
        ownership: "configured" | "registry";
        occurredAt: string;
        reason?: string;
        actor?: string;
      }>;
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
          const url = new URL(request.url);
          const current =
            state.get(id.name) ?? {
              revoked: false,
              updatedAt: new Date(0).toISOString(),
              events: []
            };

          if (method === "GET" && url.searchParams.get("kind") === "events") {
            return Response.json({
              keyId: id.name,
              events: current.events
            });
          }

          if (method === "GET") {
            return Response.json({
              revoked: current.revoked,
              updatedAt: current.updatedAt
            });
          }

          if (method === "POST") {
            const body = (await request.json()) as {
              keyId?: string;
              recordEvent?: boolean;
              ownership?: "configured" | "registry";
              reason?: string;
              actor?: string;
            };
            const occurredAt = new Date().toISOString();
            const next = {
              revoked: true,
              updatedAt: occurredAt,
              events:
                body.recordEvent === false
                  ? current.events
                  : [
                      ...current.events,
                      {
                        keyId: body.keyId ?? id.name,
                        kind: "revoked" as const,
                        ownership: body.ownership ?? "configured",
                        occurredAt,
                        ...(body.reason ? { reason: body.reason } : {}),
                        ...(body.actor ? { actor: body.actor } : {})
                      }
                    ]
            };
            state.set(id.name, next);
            return Response.json({
              revoked: next.revoked,
              updatedAt: next.updatedAt
            });
          }

          if (method === "DELETE") {
            const body = (await request.json()) as {
              keyId?: string;
              recordEvent?: boolean;
              ownership?: "configured" | "registry";
              reason?: string;
              actor?: string;
            };
            const occurredAt = new Date().toISOString();
            const next = {
              revoked: false,
              updatedAt: occurredAt,
              events:
                body.recordEvent === false
                  ? current.events
                  : [
                      ...current.events,
                      {
                        keyId: body.keyId ?? id.name,
                        kind: "unrevoked" as const,
                        ownership: body.ownership ?? "configured",
                        occurredAt,
                        ...(body.reason ? { reason: body.reason } : {}),
                        ...(body.actor ? { actor: body.actor } : {})
                      }
                    ]
            };
            state.set(id.name, next);
            return Response.json({
              revoked: next.revoked,
              updatedAt: next.updatedAt
            });
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

function createRegistryNamespace() {
  const state = new Map<string, unknown>();
  const storage = {
    get<T>(key: string) {
      return Promise.resolve(state.get(key) as T | undefined);
    },
    put<T>(key: string, value: T) {
      state.set(key, value);
      return Promise.resolve();
    },
    delete(key: string) {
      return Promise.resolve(state.delete(key));
    }
  };
  const registry = new GatewayKeyRegistryDurableObject({
    storage
  });

  const namespace: DurableObjectNamespaceLike = {
    idFromName(name: string) {
      return { name };
    },
    get(id: { name: string }) {
      return {
        async fetch(request: Request) {
          if (id.name !== "gateway-key-registry") {
            return new Response("Not found", { status: 404 });
          }

          return registry.fetch(request);
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

  it("preserves an explicit chat completions max_tokens limit when forwarding upstream", async () => {
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
            prompt_tokens: 10,
            completion_tokens: 4,
            total_tokens: 14
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
          max_tokens: 128,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      createBindings()
    );

    expect(response.status).toBe(200);
    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      max_tokens: 128
    });
  });

  it("preserves an explicit anthropic max_tokens limit when forwarding upstream", async () => {
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
            input_tokens: 10,
            output_tokens: 4
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
          max_tokens: 64,
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
    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toMatchObject({
      max_tokens: 64
    });
  });

  it("reserves explicit output token budget before committed usage alone would block a later request", async () => {
    let releaseFirstRequest: (() => void) | undefined;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              releaseFirstRequest = () => {
                controller.enqueue(
                  new TextEncoder().encode(
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
                        prompt_tokens: 8,
                        completion_tokens: 4,
                        total_tokens: 12
                      }
                    })
                  )
                );
                controller.close();
              };
            }
          }).pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              transform(chunk, controller) {
                controller.enqueue(chunk);
              }
            })
          ),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      })
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
                  content: "should not run"
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
          max_tokens: 16,
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
          max_tokens: 16,
          messages: [{ role: "user", content: "second" }]
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

    releaseFirstRequest?.();
    const firstResponse = await firstResponsePromise;

    expect(firstResponse.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("releases reserved token budget when a buffered upstream request fails", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "upstream failed"
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
                  content: "recovered"
                }
              }
            ],
            usage: {
              prompt_tokens: 8,
              completion_tokens: 4,
              total_tokens: 12
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

    const failedResponse = await app.request(
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
          max_tokens: 16,
          messages: [{ role: "user", content: "fail" }]
        })
      },
      bindings
    );

    expect(failedResponse.status).toBe(429);

    const recoveredResponse = await app.request(
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
          max_tokens: 16,
          messages: [{ role: "user", content: "recover" }]
        })
      },
      bindings
    );

    expect(recoveredResponse.status).toBe(200);
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

  it("can persistently revoke and clear a registry-owned dynamic key through internal admin routes", async () => {
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
                content: "hello runtime"
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
      AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
      AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace(),
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
    };

    const createResponse = await app.request(
      "http://localhost/_airlock/keys",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret"
        },
        body: JSON.stringify({
          id: "key_dynamic",
          label: "Dynamic Runtime Key",
          valueHash:
            "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
          status: "active"
        })
      },
      bindings
    );

    expect(createResponse.status).toBe(200);

    const initialStatus = await app.request(
      "http://localhost/_airlock/keys/key_dynamic/revocation",
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
      keyId: "key_dynamic",
      revoked: false
    });

    const revokeResponse = await app.request(
      "http://localhost/_airlock/keys/key_dynamic/revocation",
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
      keyId: "key_dynamic",
      revoked: true
    });

    const blockedResponse = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer runtime-secret"
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
      "http://localhost/_airlock/keys/key_dynamic/revocation",
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
      keyId: "key_dynamic",
      revoked: false
    });

    const allowedResponse = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer runtime-secret"
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

  it("clears persistent revocation state when deleting and recreating a registry-owned dynamic key", async () => {
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
                content: "hello runtime"
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
      AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
      AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace(),
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
    };

    const createRequest = () =>
      app.request(
        "http://localhost/_airlock/keys",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer admin-secret"
          },
          body: JSON.stringify({
            id: "key_dynamic",
            label: "Dynamic Runtime Key",
            valueHash:
              "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
            status: "active"
          })
        },
        bindings
      );

    expect((await createRequest()).status).toBe(200);

    const revokeResponse = await app.request(
      "http://localhost/_airlock/keys/key_dynamic/revocation",
      {
        method: "POST",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(revokeResponse.status).toBe(200);

    const deleteResponse = await app.request(
      "http://localhost/_airlock/keys/key_dynamic",
      {
        method: "DELETE",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(deleteResponse.status).toBe(200);
    expect((await createRequest()).status).toBe(200);

    const allowedResponse = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer runtime-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi after recreate" }]
        })
      },
      bindings
    );

    expect(allowedResponse.status).toBe(200);
  });

  it("can rotate a registry-owned dynamic key in place and cut auth over to the new secret", async () => {
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
                content: "hello runtime"
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
      AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
      AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace(),
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
    };

    const createResponse = await app.request(
      "http://localhost/_airlock/keys",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret"
        },
        body: JSON.stringify({
          id: "key_dynamic",
          label: "Dynamic Runtime Key",
          valueHash:
            "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
          status: "active"
        })
      },
      bindings
    );

    expect(createResponse.status).toBe(200);

    const revokeResponse = await app.request(
      "http://localhost/_airlock/keys/key_dynamic/revocation",
      {
        method: "POST",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(revokeResponse.status).toBe(200);

    const rotateResponse = await app.request(
      "http://localhost/_airlock/keys/key_dynamic/rotate",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret"
        },
        body: JSON.stringify({
          valueHash:
            "a26fa50cba5c8fefa46af3f7d9fa9a00f01eea2bcf5e3db253aa7e6e39c4b388"
        })
      },
      bindings
    );

    expect(rotateResponse.status).toBe(200);
    await expect(readJson(rotateResponse)).resolves.toMatchObject({
      keyId: "key_dynamic",
      ownership: "registry",
      key: {
        id: "key_dynamic",
        valueHash:
          "a26fa50cba5c8fefa46af3f7d9fa9a00f01eea2bcf5e3db253aa7e6e39c4b388"
      }
    });

    const oldSecretResponse = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer runtime-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "old secret" }]
        })
      },
      bindings
    );

    expect(oldSecretResponse.status).toBe(401);

    const newSecretResponse = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer rotated-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "new secret" }]
        })
      },
      bindings
    );

    expect(newSecretResponse.status).toBe(200);

    const revocationStatus = await app.request(
      "http://localhost/_airlock/keys/key_dynamic/revocation",
      {
        method: "GET",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(revocationStatus.status).toBe(200);
    await expect(readJson(revocationStatus)).resolves.toMatchObject({
      keyId: "key_dynamic",
      revoked: false
    });
  });

  it("can stage a registry-owned key rotation with a bounded overlap window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-13T02:20:00.000Z"));

    try {
      const fetcher = vi.fn().mockImplementation(() => {
        return new Response(
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
                  content: "hello runtime"
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
      });
      const app = createApp({ fetcher });
      const bindings = {
        ...createBindings(),
        AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
        AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
        AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace(),
        AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
      };

      const createResponse = await app.request(
        "http://localhost/_airlock/keys",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer admin-secret"
          },
          body: JSON.stringify({
            id: "key_dynamic",
            label: "Dynamic Runtime Key",
            valueHash:
              "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
            status: "active"
          })
        },
        bindings
      );

      expect(createResponse.status).toBe(200);

      const oldSecretBeforeRotate = await app.request(
        "http://localhost/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer runtime-secret"
          },
          body: JSON.stringify({
            model: "gpt-4.1-mini",
            stream: false,
            messages: [{ role: "user", content: "old secret before rotate" }]
          })
        },
        bindings
      );

      expect(oldSecretBeforeRotate.status).toBe(200);

      const rotateResponse = await app.request(
        "http://localhost/_airlock/keys/key_dynamic/rotate",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer admin-secret"
          },
          body: JSON.stringify({
            valueHash:
              "a26fa50cba5c8fefa46af3f7d9fa9a00f01eea2bcf5e3db253aa7e6e39c4b388",
            overlapSeconds: 60
          })
        },
        bindings
      );

      expect(rotateResponse.status).toBe(200);
      const rotatePayload = await readJson(rotateResponse);

      expect(rotatePayload).toMatchObject({
        keyId: "key_dynamic",
        previousValueHash:
          "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16"
      });
      expect(isRecord(rotatePayload) && isRecord(rotatePayload.key)).toBe(true);

      if (!isRecord(rotatePayload) || !isRecord(rotatePayload.key)) {
        return;
      }

      expect(rotatePayload.key.id).toBe("key_dynamic");

      const oldSecretDuringOverlap = await app.request(
        "http://localhost/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer runtime-secret"
          },
          body: JSON.stringify({
            model: "gpt-4.1-mini",
            stream: false,
            messages: [{ role: "user", content: "old secret during overlap" }]
          })
        },
        bindings
      );

      expect(oldSecretDuringOverlap.status).toBe(200);

      const newSecretDuringOverlap = await app.request(
        "http://localhost/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer rotated-secret"
          },
          body: JSON.stringify({
            model: "gpt-4.1-mini",
            stream: false,
            messages: [{ role: "user", content: "new secret during overlap" }]
          })
        },
        bindings
      );

      expect(newSecretDuringOverlap.status).toBe(200);

      vi.setSystemTime(new Date("2026-05-13T02:21:01.000Z"));

      const oldSecretAfterOverlap = await app.request(
        "http://localhost/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer runtime-secret"
          },
          body: JSON.stringify({
            model: "gpt-4.1-mini",
            stream: false,
            messages: [{ role: "user", content: "old secret after overlap" }]
          })
        },
        bindings
      );

      expect(oldSecretAfterOverlap.status).toBe(401);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects rotating env-configured keys through the runtime rotation route", async () => {
    const app = createApp({ fetcher: vi.fn() });
    const bindings = {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
      AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
      AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace(),
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_env",
          label: "Configured Gateway Key",
          value: "gateway-secret",
          status: "active"
        }
      ])
    };

    const response = await app.request(
      "http://localhost/_airlock/keys/key_env/rotate",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret"
        },
        body: JSON.stringify({
          valueHash:
            "a26fa50cba5c8fefa46af3f7d9fa9a00f01eea2bcf5e3db253aa7e6e39c4b388"
        })
      },
      bindings
    );

    expect(response.status).toBe(409);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "gateway_key_not_registry_owned"
      }
    });
  });

  it("can finalize a staged registry-owned key rotation early", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-13T03:00:00.000Z"));

    try {
      const fetcher = vi.fn().mockImplementation(() => {
        return new Response(
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
                  content: "hello runtime"
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
      });
      const app = createApp({ fetcher });
      const bindings = {
        ...createBindings(),
        AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
        AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
        AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace(),
        AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
      };

      expect(
        (
          await app.request(
            "http://localhost/_airlock/keys",
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: "Bearer admin-secret"
              },
              body: JSON.stringify({
                id: "key_dynamic",
                label: "Dynamic Runtime Key",
                valueHash:
                  "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
                status: "active"
              })
            },
            bindings
          )
        ).status
      ).toBe(200);

      expect(
        (
          await app.request(
            "http://localhost/_airlock/keys/key_dynamic/rotate",
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: "Bearer admin-secret"
              },
              body: JSON.stringify({
                valueHash:
                  "a26fa50cba5c8fefa46af3f7d9fa9a00f01eea2bcf5e3db253aa7e6e39c4b388",
                overlapSeconds: 300,
                reason: "credential rollover"
              })
            },
            bindings
          )
        ).status
      ).toBe(200);

      const finalizeResponse = await app.request(
        "http://localhost/_airlock/keys/key_dynamic/rotate/finalize",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer admin-secret"
          },
          body: JSON.stringify({
            reason: "cutover complete",
            actor: "platform@example.com"
          })
        },
        bindings
      );

      expect(finalizeResponse.status).toBe(200);
      await expect(readJson(finalizeResponse)).resolves.toMatchObject({
        keyId: "key_dynamic",
        key: {
          id: "key_dynamic",
          valueHash:
            "a26fa50cba5c8fefa46af3f7d9fa9a00f01eea2bcf5e3db253aa7e6e39c4b388"
        }
      });

      const oldSecretAfterFinalize = await app.request(
        "http://localhost/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer runtime-secret"
          },
          body: JSON.stringify({
            model: "gpt-4.1-mini",
            stream: false,
            messages: [{ role: "user", content: "old secret after finalize" }]
          })
        },
        bindings
      );

      expect(oldSecretAfterFinalize.status).toBe(401);

      const newSecretAfterFinalize = await app.request(
        "http://localhost/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer rotated-secret"
          },
          body: JSON.stringify({
            model: "gpt-4.1-mini",
            stream: false,
            messages: [{ role: "user", content: "new secret after finalize" }]
          })
        },
        bindings
      );

      expect(newSecretAfterFinalize.status).toBe(200);

      const eventsResponse = await app.request(
        "http://localhost/_airlock/keys/key_dynamic/events",
        {
          method: "GET",
          headers: {
            authorization: "Bearer admin-secret"
          }
        },
        bindings
      );

      expect(eventsResponse.status).toBe(200);
      const eventsPayload = await readJson(eventsResponse);

      expect(isGatewayKeyEventsPayload(eventsPayload)).toBe(true);

      if (!isGatewayKeyEventsPayload(eventsPayload)) {
        return;
      }

      expect(eventsPayload.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            keyId: "key_dynamic",
            kind: "rotation_finalized",
            reason: "cutover complete",
            actor: "platform@example.com"
          })
        ])
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("can cancel a staged registry-owned key rotation during overlap", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-13T03:10:00.000Z"));

    try {
      const fetcher = vi.fn().mockImplementation(() => {
        return new Response(
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
                  content: "hello runtime"
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
      });
      const app = createApp({ fetcher });
      const bindings = {
        ...createBindings(),
        AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
        AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
        AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace(),
        AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
      };

      expect(
        (
          await app.request(
            "http://localhost/_airlock/keys",
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: "Bearer admin-secret"
              },
              body: JSON.stringify({
                id: "key_dynamic",
                label: "Dynamic Runtime Key",
                valueHash:
                  "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
                status: "active"
              })
            },
            bindings
          )
        ).status
      ).toBe(200);

      expect(
        (
          await app.request(
            "http://localhost/_airlock/keys/key_dynamic/rotate",
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: "Bearer admin-secret"
              },
              body: JSON.stringify({
                valueHash:
                  "a26fa50cba5c8fefa46af3f7d9fa9a00f01eea2bcf5e3db253aa7e6e39c4b388",
                overlapSeconds: 300
              })
            },
            bindings
          )
        ).status
      ).toBe(200);

      const cancelResponse = await app.request(
        "http://localhost/_airlock/keys/key_dynamic/rotate/cancel",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer admin-secret"
          },
          body: JSON.stringify({
            reason: "rollback requested"
          })
        },
        bindings
      );

      expect(cancelResponse.status).toBe(200);
      await expect(readJson(cancelResponse)).resolves.toMatchObject({
        keyId: "key_dynamic",
        key: {
          id: "key_dynamic",
          valueHash:
            "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16"
        }
      });

      const oldSecretAfterCancel = await app.request(
        "http://localhost/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer runtime-secret"
          },
          body: JSON.stringify({
            model: "gpt-4.1-mini",
            stream: false,
            messages: [{ role: "user", content: "old secret after cancel" }]
          })
        },
        bindings
      );

      expect(oldSecretAfterCancel.status).toBe(200);

      const newSecretAfterCancel = await app.request(
        "http://localhost/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer rotated-secret"
          },
          body: JSON.stringify({
            model: "gpt-4.1-mini",
            stream: false,
            messages: [{ role: "user", content: "new secret after cancel" }]
          })
        },
        bindings
      );

      expect(newSecretAfterCancel.status).toBe(401);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects canceling a staged registry-owned key rotation after overlap expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-13T03:20:00.000Z"));

    try {
      const app = createApp({ fetcher: vi.fn() });
      const bindings = {
        ...createBindings(),
        AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
        AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
        AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace(),
        AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
      };

      expect(
        (
          await app.request(
            "http://localhost/_airlock/keys",
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: "Bearer admin-secret"
              },
              body: JSON.stringify({
                id: "key_dynamic",
                label: "Dynamic Runtime Key",
                valueHash:
                  "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
                status: "active"
              })
            },
            bindings
          )
        ).status
      ).toBe(200);

      expect(
        (
          await app.request(
            "http://localhost/_airlock/keys/key_dynamic/rotate",
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: "Bearer admin-secret"
              },
              body: JSON.stringify({
                valueHash:
                  "a26fa50cba5c8fefa46af3f7d9fa9a00f01eea2bcf5e3db253aa7e6e39c4b388",
                overlapSeconds: 60
              })
            },
            bindings
          )
        ).status
      ).toBe(200);

      vi.setSystemTime(new Date("2026-05-13T03:21:01.000Z"));

      const cancelResponse = await app.request(
        "http://localhost/_airlock/keys/key_dynamic/rotate/cancel",
        {
          method: "POST",
          headers: {
            authorization: "Bearer admin-secret"
          }
        },
        bindings
      );

      expect(cancelResponse.status).toBe(409);
      await expect(readJson(cancelResponse)).resolves.toMatchObject({
        error: {
          code: "gateway_key_rotation_not_cancelable"
        }
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects finalizing a registry-owned key when no staged rotation is active", async () => {
    const app = createApp({ fetcher: vi.fn() });
    const bindings = {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
      AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
      AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace(),
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
    };

    expect(
      (
        await app.request(
          "http://localhost/_airlock/keys",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer admin-secret"
            },
            body: JSON.stringify({
              id: "key_dynamic",
              label: "Dynamic Runtime Key",
              valueHash:
                "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
              status: "active"
            })
          },
          bindings
        )
      ).status
    ).toBe(200);

    const finalizeResponse = await app.request(
      "http://localhost/_airlock/keys/key_dynamic/rotate/finalize",
      {
        method: "POST",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(finalizeResponse.status).toBe(409);
    await expect(readJson(finalizeResponse)).resolves.toMatchObject({
      error: {
        code: "gateway_key_rotation_not_staged"
      }
    });
  });

  it("returns merged audit history for a registry-owned key lifecycle", async () => {
    const app = createApp({ fetcher: vi.fn() });
    const bindings = {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
      AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
      AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace(),
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
    };

    expect(
      (
        await app.request(
          "http://localhost/_airlock/keys",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer admin-secret"
            },
            body: JSON.stringify({
              id: "key_dynamic",
              label: "Dynamic Runtime Key",
              valueHash:
                "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
              status: "active"
            })
          },
          bindings
        )
      ).status
    ).toBe(200);

    expect(
      (
        await app.request(
          "http://localhost/_airlock/keys/key_dynamic/revocation",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret"
            }
          },
          bindings
        )
      ).status
    ).toBe(200);

    expect(
      (
        await app.request(
          "http://localhost/_airlock/keys/key_dynamic/rotate",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer admin-secret"
            },
            body: JSON.stringify({
              valueHash:
                "a26fa50cba5c8fefa46af3f7d9fa9a00f01eea2bcf5e3db253aa7e6e39c4b388"
            })
          },
          bindings
        )
      ).status
    ).toBe(200);

    expect(
      (
        await app.request(
          "http://localhost/_airlock/keys/key_dynamic",
          {
            method: "DELETE",
            headers: {
              authorization: "Bearer admin-secret"
            }
          },
          bindings
        )
      ).status
    ).toBe(200);

    const response = await app.request(
      "http://localhost/_airlock/keys/key_dynamic/events",
      {
        method: "GET",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(response.status).toBe(200);
    const payload = await readJson(response);

    expect(isGatewayKeyEventsPayload(payload)).toBe(true);

    if (!isGatewayKeyEventsPayload(payload)) {
      return;
    }

    expect(payload.keyId).toBe("key_dynamic");
    expect(payload.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keyId: "key_dynamic",
          kind: "created",
          ownership: "registry"
        }),
        expect.objectContaining({
          keyId: "key_dynamic",
          kind: "revoked"
        }),
        expect.objectContaining({
          keyId: "key_dynamic",
          kind: "rotated",
          ownership: "registry"
        }),
        expect.objectContaining({
          keyId: "key_dynamic",
          kind: "deleted",
          ownership: "registry"
        })
      ])
    );
  });

  it("returns revocation history for a configured key", async () => {
    const app = createApp({ fetcher: vi.fn() });
    const bindings = {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
    };

    expect(
      (
        await app.request(
          "http://localhost/_airlock/keys/gak_1/revocation",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret"
            }
          },
          bindings
        )
      ).status
    ).toBe(200);

    expect(
      (
        await app.request(
          "http://localhost/_airlock/keys/gak_1/revocation",
          {
            method: "DELETE",
            headers: {
              authorization: "Bearer admin-secret"
            }
          },
          bindings
        )
      ).status
    ).toBe(200);

    const response = await app.request(
      "http://localhost/_airlock/keys/gak_1/events",
      {
        method: "GET",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(response.status).toBe(200);
    const payload = await readJson(response);

    expect(isGatewayKeyEventsPayload(payload)).toBe(true);

    if (!isGatewayKeyEventsPayload(payload)) {
      return;
    }

    expect(payload.keyId).toBe("gak_1");
    expect(payload.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keyId: "gak_1",
          kind: "revoked"
        }),
        expect.objectContaining({
          keyId: "gak_1",
          kind: "unrevoked"
        })
      ])
    );
  });

  it("records explicit reason metadata on lifecycle audit events", async () => {
    const app = createApp({ fetcher: vi.fn() });
    const bindings = {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
      AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
      AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace(),
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
    };

    expect(
      (
        await app.request(
          "http://localhost/_airlock/keys",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer admin-secret"
            },
            body: JSON.stringify({
              id: "key_dynamic",
              label: "Dynamic Runtime Key",
              valueHash:
                "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
              status: "active"
            })
          },
          bindings
        )
      ).status
    ).toBe(200);

    expect(
      (
        await app.request(
          "http://localhost/_airlock/keys/gak_1/revocation",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer admin-secret"
            },
            body: JSON.stringify({
              reason: "incident containment"
            })
          },
          bindings
        )
      ).status
    ).toBe(200);

    expect(
      (
        await app.request(
          "http://localhost/_airlock/keys/gak_1/revocation",
          {
            method: "DELETE",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer admin-secret"
            },
            body: JSON.stringify({
              reason: "incident resolved"
            })
          },
          bindings
        )
      ).status
    ).toBe(200);

    expect(
      (
        await app.request(
          "http://localhost/_airlock/keys/key_dynamic/rotate",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer admin-secret"
            },
            body: JSON.stringify({
              valueHash:
                "a26fa50cba5c8fefa46af3f7d9fa9a00f01eea2bcf5e3db253aa7e6e39c4b388",
              reason: "credential rollover"
            })
          },
          bindings
        )
      ).status
    ).toBe(200);

    expect(
      (
        await app.request(
          "http://localhost/_airlock/keys/key_dynamic",
          {
            method: "DELETE",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer admin-secret"
            },
            body: JSON.stringify({
              reason: "tenant deprovisioned"
            })
          },
          bindings
        )
      ).status
    ).toBe(200);

    const configuredEventsResponse = await app.request(
      "http://localhost/_airlock/keys/gak_1/events",
      {
        method: "GET",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(configuredEventsResponse.status).toBe(200);
    const configuredPayload = await readJson(configuredEventsResponse);

    expect(isGatewayKeyEventsPayload(configuredPayload)).toBe(true);

    if (!isGatewayKeyEventsPayload(configuredPayload)) {
      return;
    }

    expect(configuredPayload.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keyId: "gak_1",
          kind: "revoked",
          reason: "incident containment"
        }),
        expect.objectContaining({
          keyId: "gak_1",
          kind: "unrevoked",
          reason: "incident resolved"
        })
      ])
    );

    const registryEventsResponse = await app.request(
      "http://localhost/_airlock/keys/key_dynamic/events",
      {
        method: "GET",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(registryEventsResponse.status).toBe(200);
    const registryPayload = await readJson(registryEventsResponse);

    expect(isGatewayKeyEventsPayload(registryPayload)).toBe(true);

    if (!isGatewayKeyEventsPayload(registryPayload)) {
      return;
    }

    expect(registryPayload.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keyId: "key_dynamic",
          kind: "rotated",
          reason: "credential rollover"
        }),
        expect.objectContaining({
          keyId: "key_dynamic",
          kind: "deleted",
          reason: "tenant deprovisioned"
        })
      ])
    );
  });

  it("rejects invalid explicit reason metadata payloads", async () => {
    const app = createApp({ fetcher: vi.fn() });
    const bindings = {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
      AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
      AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace(),
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
    };

    const revokeResponse = await app.request(
      "http://localhost/_airlock/keys/gak_1/revocation",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret"
        },
        body: JSON.stringify({
          reason: "   "
        })
      },
      bindings
    );

    expect(revokeResponse.status).toBe(400);

    const rotateResponse = await app.request(
      "http://localhost/_airlock/keys/key_dynamic/rotate",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret"
        },
        body: JSON.stringify({
          valueHash:
            "a26fa50cba5c8fefa46af3f7d9fa9a00f01eea2bcf5e3db253aa7e6e39c4b388",
          reason: 42
        })
      },
      bindings
    );

    expect(rotateResponse.status).toBe(400);
  });

  it("records explicit actor metadata on lifecycle audit events", async () => {
    const app = createApp({ fetcher: vi.fn() });
    const bindings = {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
      AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
      AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace(),
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
    };

    expect(
      (
        await app.request(
          "http://localhost/_airlock/keys",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer admin-secret"
            },
            body: JSON.stringify({
              id: "key_dynamic",
              label: "Dynamic Runtime Key",
              valueHash:
                "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
              status: "active"
            })
          },
          bindings
        )
      ).status
    ).toBe(200);

    expect(
      (
        await app.request(
          "http://localhost/_airlock/keys/gak_1/revocation",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer admin-secret"
            },
            body: JSON.stringify({
              reason: "incident containment",
              actor: "oncall@example.com"
            })
          },
          bindings
        )
      ).status
    ).toBe(200);

    expect(
      (
        await app.request(
          "http://localhost/_airlock/keys/gak_1/revocation",
          {
            method: "DELETE",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer admin-secret"
            },
            body: JSON.stringify({
              reason: "incident resolved",
              actor: "sre@example.com"
            })
          },
          bindings
        )
      ).status
    ).toBe(200);

    expect(
      (
        await app.request(
          "http://localhost/_airlock/keys/key_dynamic/rotate",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer admin-secret"
            },
            body: JSON.stringify({
              valueHash:
                "a26fa50cba5c8fefa46af3f7d9fa9a00f01eea2bcf5e3db253aa7e6e39c4b388",
              reason: "credential rollover",
              actor: "platform@example.com"
            })
          },
          bindings
        )
      ).status
    ).toBe(200);

    expect(
      (
        await app.request(
          "http://localhost/_airlock/keys/key_dynamic",
          {
            method: "DELETE",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer admin-secret"
            },
            body: JSON.stringify({
              reason: "tenant deprovisioned",
              actor: "ops@example.com"
            })
          },
          bindings
        )
      ).status
    ).toBe(200);

    const configuredEventsResponse = await app.request(
      "http://localhost/_airlock/keys/gak_1/events",
      {
        method: "GET",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(configuredEventsResponse.status).toBe(200);
    const configuredPayload = await readJson(configuredEventsResponse);

    expect(isGatewayKeyEventsPayload(configuredPayload)).toBe(true);

    if (!isGatewayKeyEventsPayload(configuredPayload)) {
      return;
    }

    expect(configuredPayload.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keyId: "gak_1",
          kind: "revoked",
          actor: "oncall@example.com"
        }),
        expect.objectContaining({
          keyId: "gak_1",
          kind: "unrevoked",
          actor: "sre@example.com"
        })
      ])
    );

    const registryEventsResponse = await app.request(
      "http://localhost/_airlock/keys/key_dynamic/events",
      {
        method: "GET",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(registryEventsResponse.status).toBe(200);
    const registryPayload = await readJson(registryEventsResponse);

    expect(isGatewayKeyEventsPayload(registryPayload)).toBe(true);

    if (!isGatewayKeyEventsPayload(registryPayload)) {
      return;
    }

    expect(registryPayload.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keyId: "key_dynamic",
          kind: "rotated",
          actor: "platform@example.com"
        }),
        expect.objectContaining({
          keyId: "key_dynamic",
          kind: "deleted",
          actor: "ops@example.com"
        })
      ])
    );
  });

  it("rejects invalid explicit actor metadata payloads", async () => {
    const app = createApp({ fetcher: vi.fn() });
    const bindings = {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
      AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
      AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace(),
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
    };

    const revokeResponse = await app.request(
      "http://localhost/_airlock/keys/gak_1/revocation",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret"
        },
        body: JSON.stringify({
          actor: "   "
        })
      },
      bindings
    );

    expect(revokeResponse.status).toBe(400);

    const rotateResponse = await app.request(
      "http://localhost/_airlock/keys/key_dynamic/rotate",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret"
        },
        body: JSON.stringify({
          valueHash:
            "a26fa50cba5c8fefa46af3f7d9fa9a00f01eea2bcf5e3db253aa7e6e39c4b388",
          actor: 42
        })
      },
      bindings
    );

    expect(rotateResponse.status).toBe(400);
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

  it("lists configured gateway keys with effective current status from the internal admin inventory route", async () => {
    const app = createApp({ fetcher: vi.fn() });
    const bindings = {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_active",
          label: "Active Key",
          value: "gateway-secret",
          status: "active"
        },
        {
          id: "key_future",
          label: "Future Key",
          value: "future-secret",
          status: "active",
          notBefore: "2099-01-01T00:00:00.000Z"
        },
        {
          id: "key_expired",
          label: "Expired Key",
          value: "expired-secret",
          status: "active",
          expiresAt: "2000-01-01T00:00:00.000Z"
        }
      ])
    };

    const revokeResponse = await app.request(
      "http://localhost/_airlock/keys/key_active/revocation",
      {
        method: "POST",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(revokeResponse.status).toBe(200);

    const response = await app.request(
      "http://localhost/_airlock/keys",
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
      keys: [
        {
          keyId: "key_active",
          effectiveStatus: "revoked",
          acceptedNow: false
        },
        {
          keyId: "key_future",
          effectiveStatus: "not_yet_active",
          acceptedNow: false
        },
        {
          keyId: "key_expired",
          effectiveStatus: "expired",
          acceptedNow: false
        }
      ]
    });
  });

  it("filters the internal key inventory by acceptedNow", async () => {
    const app = createApp({ fetcher: vi.fn() });
    const bindings = {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_active",
          label: "Active Key",
          value: "gateway-secret",
          status: "active"
        },
        {
          id: "key_future",
          label: "Future Key",
          value: "future-secret",
          status: "active",
          notBefore: "2099-01-01T00:00:00.000Z"
        }
      ])
    };

    const response = await app.request(
      "http://localhost/_airlock/keys?acceptedNow=true",
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
      keys: [
        {
          keyId: "key_active",
          acceptedNow: true
        }
      ]
    });
  });

  it("filters the internal key inventory by effectiveStatus", async () => {
    const app = createApp({ fetcher: vi.fn() });
    const bindings = {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_active",
          label: "Active Key",
          value: "gateway-secret",
          status: "active"
        },
        {
          id: "key_future",
          label: "Future Key",
          value: "future-secret",
          status: "active",
          notBefore: "2099-01-01T00:00:00.000Z"
        }
      ])
    };

    const response = await app.request(
      "http://localhost/_airlock/keys?effectiveStatus=not_yet_active",
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
      keys: [
        {
          keyId: "key_future",
          effectiveStatus: "not_yet_active"
        }
      ]
    });
  });

  it("rejects missing admin auth on the internal key inventory route", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/_airlock/keys",
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

  it("returns not ready from /readyz when gateway key registry mode is enabled without a registry binding", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true"
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toEqual({
      ok: false,
      ready: false,
      code: "not_ready"
    });
  });

  it("rejects missing admin auth on internal key registry routes", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/_airlock/keys/key_1/registry",
      {
        method: "GET"
      },
      {
        ...createBindings(),
        AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
        AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
        AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace()
      }
    );

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "auth_invalid_admin_token"
      }
    });
  });

  it("supports reading, writing, and clearing gateway key registry metadata overrides", async () => {
    const app = createApp({ fetcher: vi.fn() });
    const bindings = {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
      AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
      AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace(),
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_1",
          label: "Gateway Key 1",
          value: "gateway-secret",
          status: "active"
        }
      ])
    };

    const writeResponse = await app.request(
      "http://localhost/_airlock/keys/key_1/registry",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret"
        },
        body: JSON.stringify({
          label: "Runtime Key 1",
          status: "revoked",
          policy: {
            tier: "prod"
          }
        })
      },
      bindings
    );

    expect(writeResponse.status).toBe(200);
    await expect(readJson(writeResponse)).resolves.toMatchObject({
      keyId: "key_1",
      override: {
        label: "Runtime Key 1",
        status: "revoked",
        policy: {
          tier: "prod"
        }
      }
    });

    const readResponse = await app.request(
      "http://localhost/_airlock/keys/key_1/registry",
      {
        method: "GET",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(readResponse.status).toBe(200);
    await expect(readJson(readResponse)).resolves.toMatchObject({
      keyId: "key_1",
      configured: {
        keyId: "key_1",
        label: "Gateway Key 1",
        configuredStatus: "active"
      },
      runtime: {
        keyId: "key_1",
        label: "Runtime Key 1",
        configuredStatus: "revoked"
      },
      override: {
        label: "Runtime Key 1",
        status: "revoked"
      }
    });

    const clearResponse = await app.request(
      "http://localhost/_airlock/keys/key_1/registry",
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
      keyId: "key_1",
      override: null
    });
  });

  it("rejects requests when a registry override revokes an otherwise valid key", async () => {
    const app = createApp({ fetcher: vi.fn() });
    const bindings = {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
      AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
      AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace(),
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_1",
          label: "Gateway Key 1",
          value: "gateway-secret",
          status: "active"
        }
      ])
    };

    const registryResponse = await app.request(
      "http://localhost/_airlock/keys/key_1/registry",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret"
        },
        body: JSON.stringify({
          status: "revoked"
        })
      },
      bindings
    );

    expect(registryResponse.status).toBe(200);

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

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "auth_invalid_api_key"
      }
    });
  });

  it("surfaces registry-aware runtime metadata from internal key status and inventory routes", async () => {
    const app = createApp({ fetcher: vi.fn() });
    const bindings = {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
      AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
      AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace(),
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_1",
          label: "Gateway Key 1",
          value: "gateway-secret",
          status: "active"
        }
      ])
    };

    const registryResponse = await app.request(
      "http://localhost/_airlock/keys/key_1/registry",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret"
        },
        body: JSON.stringify({
          label: "Runtime Key 1",
          notBefore: "2099-01-01T00:00:00.000Z",
          policy: {
            tier: "prod"
          }
        })
      },
      bindings
    );

    expect(registryResponse.status).toBe(200);

    const statusResponse = await app.request(
      "http://localhost/_airlock/keys/key_1/status",
      {
        method: "GET",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(statusResponse.status).toBe(200);
    await expect(readJson(statusResponse)).resolves.toMatchObject({
      keyId: "key_1",
      configured: {
        label: "Gateway Key 1",
        configuredStatus: "active"
      },
      runtime: {
        label: "Runtime Key 1",
        configuredStatus: "active",
        lifecycleStatus: "not_yet_active",
        acceptedNow: false
      },
      registryOverride: {
        label: "Runtime Key 1",
        notBefore: "2099-01-01T00:00:00.000Z"
      },
      registryOverrideApplied: true
    });

    const inventoryResponse = await app.request(
      "http://localhost/_airlock/keys",
      {
        method: "GET",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(inventoryResponse.status).toBe(200);
    await expect(readJson(inventoryResponse)).resolves.toMatchObject({
      keys: [
        {
          keyId: "key_1",
          configured: {
            label: "Gateway Key 1"
          },
          runtime: {
            label: "Runtime Key 1",
            lifecycleStatus: "not_yet_active",
            acceptedNow: false
          },
          registryOverrideApplied: true
        }
      ]
    });
  });

  it("supports creating, authenticating, listing, inspecting, and deleting dynamic hashed registry keys", async () => {
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
                content: "hello runtime"
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
      AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
      AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
      AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace(),
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_env",
          label: "Configured Gateway Key",
          value: "gateway-secret",
          status: "active"
        }
      ])
    };

    const createResponse = await app.request(
      "http://localhost/_airlock/keys",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret"
        },
        body: JSON.stringify({
          id: "key_dynamic",
          label: "Dynamic Runtime Key",
          valueHash:
            "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
          status: "active",
          policy: {
            tier: "runtime"
          }
        })
      },
      bindings
    );

    expect(createResponse.status).toBe(200);
    await expect(readJson(createResponse)).resolves.toMatchObject({
      keyId: "key_dynamic",
      ownership: "registry",
      key: {
        id: "key_dynamic",
        label: "Dynamic Runtime Key",
        valueHash:
          "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
        status: "active"
      }
    });

    const dynamicReadResponse = await app.request(
      "http://localhost/_airlock/keys/key_dynamic",
      {
        method: "GET",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(dynamicReadResponse.status).toBe(200);
    await expect(readJson(dynamicReadResponse)).resolves.toMatchObject({
      keyId: "key_dynamic",
      ownership: "registry",
      key: {
        id: "key_dynamic",
        label: "Dynamic Runtime Key",
        status: "active"
      }
    });

    const authResponse = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer runtime-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      bindings
    );

    expect(authResponse.status).toBe(200);
    await expect(readJson(authResponse)).resolves.toMatchObject({
      id: "chatcmpl_123"
    });

    const statusResponse = await app.request(
      "http://localhost/_airlock/keys/key_dynamic/status",
      {
        method: "GET",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(statusResponse.status).toBe(200);
    await expect(readJson(statusResponse)).resolves.toMatchObject({
      keyId: "key_dynamic",
      runtime: {
        label: "Dynamic Runtime Key",
        configuredStatus: "active",
        acceptedNow: true
      }
    });

    const inventoryResponse = await app.request(
      "http://localhost/_airlock/keys",
      {
        method: "GET",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(inventoryResponse.status).toBe(200);
    const inventoryPayload = (await readJson(inventoryResponse)) as {
      keys: Array<{
        keyId: string;
        runtime?: {
          label?: string;
          acceptedNow?: boolean;
        };
      }>;
    };

    const configuredEntry = inventoryPayload.keys.find((entry) => {
      return entry.keyId === "key_env";
    });
    const dynamicEntry = inventoryPayload.keys.find((entry) => {
      return entry.keyId === "key_dynamic";
    });

    expect(configuredEntry).toBeDefined();
    expect(dynamicEntry).toMatchObject({
      runtime: {
        label: "Dynamic Runtime Key",
        acceptedNow: true
      }
    });

    const deleteResponse = await app.request(
      "http://localhost/_airlock/keys/key_dynamic",
      {
        method: "DELETE",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(deleteResponse.status).toBe(200);
    await expect(readJson(deleteResponse)).resolves.toMatchObject({
      keyId: "key_dynamic",
      deleted: true
    });
  });

  it("rejects deleting env-configured keys through the dynamic registry delete route", async () => {
    const app = createApp({ fetcher: vi.fn() });
    const bindings = {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
      AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
      AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace(),
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_env",
          label: "Configured Gateway Key",
          value: "gateway-secret",
          status: "active"
        }
      ])
    };

    const response = await app.request(
      "http://localhost/_airlock/keys/key_env",
      {
        method: "DELETE",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(response.status).toBe(409);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "gateway_key_not_registry_owned"
      }
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
