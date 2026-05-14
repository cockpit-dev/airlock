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

function computeEffectiveTestCooldownMs(
  cooldownMs: number,
  halfOpenRetryableFailureCount: number | undefined
): number {
  const halfOpenFailures = Math.max(0, halfOpenRetryableFailureCount ?? 0);
  return cooldownMs * Math.min(4, 2 ** halfOpenFailures);
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

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every((entry) => isRecord(entry));
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
    actorSource?: string;
    changes?: Array<{
      field: string;
      before?: unknown;
      after?: unknown;
    }>;
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
        (event.actor === undefined || typeof event.actor === "string") &&
        (event.actorSource === undefined || typeof event.actorSource === "string") &&
        (event.changes === undefined ||
          (Array.isArray(event.changes) &&
            event.changes.every((change) => {
              return (
                isRecord(change) &&
                typeof change.field === "string" &&
                (change.before === undefined || true) &&
                (change.after === undefined || true)
              );
            })))
      );
    })
  );
}

function isGatewayKeyOperationEventsPayload(
  value: unknown
): value is {
  operationId: string;
  events: Array<{
    keyId: string;
    kind: string;
    operationId?: string;
    occurredAt?: string;
  }>;
} {
  return (
    isRecord(value) &&
    typeof value.operationId === "string" &&
    Array.isArray(value.events) &&
    value.events.every((event) => {
      return (
        isRecord(event) &&
        typeof event.keyId === "string" &&
        typeof event.kind === "string" &&
        (event.operationId === undefined ||
          typeof event.operationId === "string") &&
        (event.occurredAt === undefined || typeof event.occurredAt === "string")
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
        actorSource?: "payload" | "trusted_header";
        operationId?: string;
      }>;
    }
  >();
  const operationEvents = new Map<
    string,
    Array<{
      keyId: string;
      kind: "revoked" | "unrevoked";
      ownership: "configured" | "registry";
      occurredAt: string;
      reason?: string;
      actor?: string;
      actorSource?: "payload" | "trusted_header";
      operationId?: string;
    }>
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

          if (url.searchParams.get("kind") === "operation_events") {
            if (method === "GET") {
              const operationId = url.searchParams.get("operationId");

              if (!operationId) {
                return new Response("Missing operationId", { status: 400 });
              }

              const events = operationEvents.get(operationId) ?? [];

              if (events.length === 0) {
                return new Response("Not found", { status: 404 });
              }

              return Response.json({
                operationId,
                events
              });
            }

            if (method === "POST") {
              const body = (await request.json()) as {
                keyId: string;
                kind: "revoked" | "unrevoked";
                ownership: "configured" | "registry";
                occurredAt: string;
                reason?: string;
                actor?: string;
                actorSource?: "payload" | "trusted_header";
                operationId?: string;
              };

              if (body.operationId) {
                operationEvents.set(body.operationId, [
                  ...(operationEvents.get(body.operationId) ?? []),
                  body
                ]);
              }

              return new Response(null, { status: 204 });
            }

            return new Response("Method not allowed", { status: 405 });
          }

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
              operationId?: string;
              ownership?: "configured" | "registry";
              reason?: string;
              actor?: string;
              actorSource?: "payload" | "trusted_header";
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
                        ...(body.operationId ? { operationId: body.operationId } : {}),
                        ...(body.reason ? { reason: body.reason } : {}),
                        ...(body.actor ? { actor: body.actor } : {}),
                        ...(body.actorSource ? { actorSource: body.actorSource } : {})
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
              operationId?: string;
              ownership?: "configured" | "registry";
              reason?: string;
              actor?: string;
              actorSource?: "payload" | "trusted_header";
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
                        ...(body.operationId ? { operationId: body.operationId } : {}),
                        ...(body.reason ? { reason: body.reason } : {}),
                        ...(body.actor ? { actor: body.actor } : {}),
                        ...(body.actorSource ? { actorSource: body.actorSource } : {})
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
      probeStartedAt?: number;
      halfOpenRetryableFailureCount?: number;
      lastSuccessLatencyMs?: number;
      smoothedSuccessLatencyMs?: number;
      lastSuccessAt?: number;
      lastFailureAt?: number;
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
              kind: "success" | "retryable_failure" | "claim_half_open_probe";
              threshold?: number;
              cooldownMs?: number;
              latencyMs?: number;
              smoothedLatencyMs?: number;
              now?: number;
            };

            if (body.kind === "success") {
              const nextSmoothedLatencyMs =
                body.latencyMs !== undefined
                  ? current.smoothedSuccessLatencyMs !== undefined
                    ? Math.round(
                        current.smoothedSuccessLatencyMs * 0.7 +
                          body.latencyMs * 0.3
                      )
                    : body.latencyMs
                  : body.smoothedLatencyMs;
              const next = {
                consecutiveRetryableFailures: 0,
                halfOpenRetryableFailureCount: 0,
                ...(body.latencyMs !== undefined
                  ? { lastSuccessLatencyMs: body.latencyMs }
                  : {}),
                ...(nextSmoothedLatencyMs !== undefined
                  ? { smoothedSuccessLatencyMs: nextSmoothedLatencyMs }
                  : {}),
                ...(body.now !== undefined ? { lastSuccessAt: body.now } : {}),
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
              lastSuccessAt?: number;
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
              ...(current.lastSuccessAt !== undefined
                ? { lastSuccessAt: current.lastSuccessAt }
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

  return {
    ...namespace,
    seedSuccess(targetKey: string, latencyMs: number, now: number) {
      const current = state.get(targetKey);

      state.set(targetKey, {
        consecutiveRetryableFailures: 0,
        lastSuccessLatencyMs: latencyMs,
        smoothedSuccessLatencyMs:
          current?.smoothedSuccessLatencyMs !== undefined
            ? Math.round(current.smoothedSuccessLatencyMs * 0.7 + latencyMs * 0.3)
            : latencyMs,
        lastSuccessAt: now,
        ...(current?.lastFailureAt !== undefined
          ? { lastFailureAt: current.lastFailureAt }
          : {})
      });
    },
    seedFailure(targetKey: string, now: number, threshold = 3) {
      const current = state.get(targetKey) ?? {
        consecutiveRetryableFailures: 0
      };

      state.set(targetKey, {
        ...current,
        consecutiveRetryableFailures: current.consecutiveRetryableFailures + 1,
        ...(current.consecutiveRetryableFailures + 1 >= threshold
          ? { openedAt: now }
          : {}),
        lastFailureAt: now
      });
    }
  };
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

  it("returns not ready from /readyz when structured internal admin credentials are malformed", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_CREDENTIALS: "{not-json",
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when structured internal admin credential scopes are invalid", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_CREDENTIALS: JSON.stringify([
        {
          id: "ops_primary",
          tokenHash: gatewaySecretHash,
          actor: "ops@example.com",
          scopes: ["keys.admin"]
        }
      ]),
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
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

  it("returns not ready from /readyz when request signing secret json is malformed", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_REQUEST_SIGNING_SECRETS: "{not-json"
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

  it("accepts structured internal admin credentials on governance routes", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/_airlock/keys/gak_1/revocation",
      {
        method: "GET",
        headers: {
          authorization: "Bearer gateway-secret"
        }
      },
      {
        ...createBindings(),
        AIRLOCK_INTERNAL_ADMIN_CREDENTIALS: JSON.stringify([
          {
            id: "ops_primary",
            tokenHash: gatewaySecretHash,
            actor: "ops@example.com"
          }
        ]),
        AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
      }
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toMatchObject({
      keyId: "gak_1",
      revoked: false
    });
  });

  it("allows a keys.read scoped credential to access governance read routes", async () => {
    const app = createApp({ fetcher: vi.fn() });
    const bindings = {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_CREDENTIALS: JSON.stringify([
        {
          id: "ops_reader",
          tokenHash: gatewaySecretHash,
          actor: "reader@example.com",
          scopes: ["keys.read"]
        }
      ]),
      AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
      AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace(),
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
    };

    const inventoryResponse = await app.request(
      "http://localhost/_airlock/keys",
      {
        method: "GET",
        headers: {
          authorization: "Bearer gateway-secret"
        }
      },
      bindings
    );

    expect(inventoryResponse.status).toBe(200);

    const statusResponse = await app.request(
      "http://localhost/_airlock/keys/gak_1/status",
      {
        method: "GET",
        headers: {
          authorization: "Bearer gateway-secret"
        }
      },
      {
        ...bindings,
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "gak_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active"
          }
        ])
      }
    );

    expect(statusResponse.status).toBe(200);
  });

  it("rejects a keys.read scoped credential on governance write routes", async () => {
    const app = createApp({ fetcher: vi.fn() });
    const bindings = {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_CREDENTIALS: JSON.stringify([
        {
          id: "ops_reader",
          tokenHash: gatewaySecretHash,
          actor: "reader@example.com",
          scopes: ["keys.read"]
        }
      ]),
      AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
      AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace(),
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
    };

    const response = await app.request(
      "http://localhost/_airlock/keys",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
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

    expect(response.status).toBe(403);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "auth_admin_scope_denied"
      }
    });
  });

  it("allows a keys.write scoped credential to mutate governance state", async () => {
    const app = createApp({ fetcher: vi.fn() });
    const bindings = {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_CREDENTIALS: JSON.stringify([
        {
          id: "ops_writer",
          tokenHash: gatewaySecretHash,
          actor: "writer@example.com",
          scopes: ["keys.write"]
        }
      ]),
      AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
      AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace(),
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
    };

    const response = await app.request(
      "http://localhost/_airlock/keys",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
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

    expect(response.status).toBe(200);
  });

  it("does not fall back to the legacy admin token when structured credentials are explicitly configured as empty", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
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
      {
        ...createBindings(),
        AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
        AIRLOCK_INTERNAL_ADMIN_CREDENTIALS: "[]",
        AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
        AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace(),
        AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
      }
    );

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "auth_invalid_api_key"
      }
    });
  });

  it("prefers structured internal admin credentials over the legacy admin token when both are configured", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
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
      {
        ...createBindings(),
        AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
        AIRLOCK_INTERNAL_ADMIN_CREDENTIALS: JSON.stringify([
          {
            id: "ops_writer",
            tokenHash: gatewaySecretHash,
            actor: "writer@example.com",
            scopes: ["keys.write"]
          }
        ]),
        AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
        AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace(),
        AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
      }
    );

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "auth_invalid_api_key"
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

  it("returns an empty event list for an existing configured key with no lifecycle history", async () => {
    const app = createApp({ fetcher: vi.fn() });
    const bindings = {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
    };

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
    await expect(readJson(response)).resolves.toEqual({
      keyId: "gak_1",
      events: []
    });
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
          actor: "platform@example.com",
          actorSource: "payload"
        }),
        expect.objectContaining({
          keyId: "key_dynamic",
          kind: "deleted",
          actor: "ops@example.com",
          actorSource: "payload"
        })
      ])
    );
  });

  it("prefers a trusted admin actor header over body actor metadata", async () => {
    const app = createApp({ fetcher: vi.fn() });
    const bindings = {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
      AIRLOCK_INTERNAL_ADMIN_ACTOR_HEADER: "cf-access-authenticated-user-email",
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
              authorization: "Bearer admin-secret",
              "cf-access-authenticated-user-email": "trusted@example.com"
            },
            body: JSON.stringify({
              id: "key_dynamic",
              label: "Dynamic Runtime Key",
              valueHash:
                "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
              status: "active",
              actor: "spoofed@example.com"
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
              "content-type": "application/json",
              authorization: "Bearer admin-secret",
              "cf-access-authenticated-user-email": "trusted@example.com"
            },
            body: JSON.stringify({
              reason: "incident containment",
              actor: "spoofed@example.com"
            })
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
          authorization: "Bearer admin-secret",
          "cf-access-authenticated-user-email": "trusted@example.com"
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

    expect(payload.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keyId: "key_dynamic",
          kind: "created",
          actor: "trusted@example.com",
          actorSource: "trusted_header"
        }),
        expect.objectContaining({
          keyId: "key_dynamic",
          kind: "revoked",
          actor: "trusted@example.com",
          actorSource: "trusted_header"
        })
      ])
    );
  });

  it("prefers credential-bound admin actor identity over trusted header and payload actor metadata", async () => {
    const app = createApp({ fetcher: vi.fn() });
    const bindings = {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_CREDENTIALS: JSON.stringify([
        {
          id: "ops_primary",
          tokenHash: gatewaySecretHash,
          actor: "credential@example.com"
        }
      ]),
      AIRLOCK_INTERNAL_ADMIN_ACTOR_HEADER: "cf-access-authenticated-user-email",
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
              authorization: "Bearer gateway-secret",
              "cf-access-authenticated-user-email": "header@example.com"
            },
            body: JSON.stringify({
              id: "key_dynamic",
              label: "Dynamic Runtime Key",
              valueHash:
                "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
              status: "active",
              actor: "payload@example.com"
            })
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
          authorization: "Bearer gateway-secret"
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

    expect(payload.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keyId: "key_dynamic",
          kind: "created",
          actor: "credential@example.com",
          actorSource: "credential"
        })
      ])
    );
  });

  it("satisfies required actor metadata through structured internal admin credentials alone", async () => {
    const app = createApp({ fetcher: vi.fn() });
    const bindings = {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_CREDENTIALS: JSON.stringify([
        {
          id: "ops_primary",
          tokenHash: gatewaySecretHash,
          actor: "credential@example.com"
        }
      ]),
      AIRLOCK_INTERNAL_ADMIN_ACTOR_REQUIRED: "true",
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
          authorization: "Bearer gateway-secret"
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
  });

  it("rejects explicit admin mutations when actor is required but unavailable", async () => {
    const app = createApp({ fetcher: vi.fn() });
    const bindings = {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
      AIRLOCK_INTERNAL_ADMIN_ACTOR_REQUIRED: "true",
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

    expect(createResponse.status).toBe(400);
    await expect(readJson(createResponse)).resolves.toMatchObject({
      error: {
        code: "auth_admin_actor_required"
      }
    });
  });

  it("records actor metadata for dynamic key creation when available", async () => {
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
              status: "active",
              actor: "creator@example.com"
            })
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

    expect(payload.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keyId: "key_dynamic",
          kind: "created",
          actor: "creator@example.com",
          actorSource: "payload"
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

  it("returns not found when reading a missing dynamic registry key through the admin route", async () => {
    const app = createApp({ fetcher: vi.fn() });
    const bindings = {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
      AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
      AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace(),
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
    };

    const response = await app.request(
      "http://localhost/_airlock/keys/missing-key",
      {
        method: "GET",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(response.status).toBe(404);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "gateway_key_not_found"
      }
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

  it("can update registry-owned dynamic key metadata and apply it immediately at runtime", async () => {
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

    const updateResponse = await app.request(
      "http://localhost/_airlock/keys/key_dynamic",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret"
        },
        body: JSON.stringify({
          label: "Runtime Key (Paused)",
          status: "revoked",
          notBefore: "2099-01-01T00:00:00.000Z",
          policy: {
            tier: "runtime-paused"
          },
          reason: "paused for maintenance",
          actor: "ops@example.com"
        })
      },
      bindings
    );

    expect(updateResponse.status).toBe(200);
    await expect(readJson(updateResponse)).resolves.toMatchObject({
      keyId: "key_dynamic",
      ownership: "registry",
      key: {
        id: "key_dynamic",
        label: "Runtime Key (Paused)",
        status: "revoked",
        notBefore: "2099-01-01T00:00:00.000Z",
        policy: {
          tier: "runtime-paused"
        }
      }
    });

    const readResponse = await app.request(
      "http://localhost/_airlock/keys/key_dynamic",
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
      keyId: "key_dynamic",
      key: {
        label: "Runtime Key (Paused)",
        status: "revoked",
        notBefore: "2099-01-01T00:00:00.000Z",
        policy: {
          tier: "runtime-paused"
        }
      }
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
      configured: {
        label: "Runtime Key (Paused)",
        configuredStatus: "revoked",
        notBefore: "2099-01-01T00:00:00.000Z"
      },
      runtime: {
        label: "Runtime Key (Paused)",
        configuredStatus: "revoked",
        lifecycleStatus: "revoked",
        acceptedNow: false
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
    const inventoryPayload = await readJson(inventoryResponse);
    expect(isRecord(inventoryPayload)).toBe(true);

    if (!isRecord(inventoryPayload) || !isRecordArray(inventoryPayload.keys)) {
      return;
    }

    const dynamicEntry = inventoryPayload.keys.find((entry) => {
      return entry.keyId === "key_dynamic";
    });

    expect(dynamicEntry).toMatchObject({
      keyId: "key_dynamic",
      runtime: {
        label: "Runtime Key (Paused)",
        effectiveStatus: "revoked",
        acceptedNow: false
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

    expect(authResponse.status).toBe(401);
    await expect(readJson(authResponse)).resolves.toMatchObject({
      error: {
        code: "auth_invalid_api_key"
      }
    });

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
          kind: "updated",
          reason: "paused for maintenance",
          actor: "ops@example.com",
          actorSource: "payload"
        })
      ])
    );
  });

  it("rejects updating env-configured keys through the dynamic registry update route", async () => {
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
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret"
        },
        body: JSON.stringify({
          label: "Nope"
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

  it("rejects invalid dynamic registry update payloads", async () => {
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

    const response = await app.request(
      "http://localhost/_airlock/keys/key_dynamic",
      {
        method: "PUT",
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

    expect(response.status).toBe(400);
  });

  it("can bulk update registry-owned dynamic key metadata", async () => {
    const app = createApp({ fetcher: vi.fn() });
    const bindings = {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
      AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
      AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace(),
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
    };

    for (const payload of [
      {
        id: "key_dynamic_a",
        label: "Dynamic Key A",
        valueHash:
          "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
        status: "active"
      },
      {
        id: "key_dynamic_b",
        label: "Dynamic Key B",
        valueHash:
          "a26fa50cba5c8fefa46af3f7d9fa9a00f01eea2bcf5e3db253aa7e6e39c4b388",
        status: "active"
      }
    ]) {
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
              body: JSON.stringify(payload)
            },
            bindings
          )
        ).status
      ).toBe(200);
    }

    const bulkResponse = await app.request(
      "http://localhost/_airlock/keys",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret"
        },
        body: JSON.stringify({
          updates: [
            {
              keyId: "key_dynamic_a",
              status: "revoked"
            },
            {
              keyId: "key_dynamic_b",
              label: "Tenant B Key",
              notBefore: "2099-01-01T00:00:00.000Z"
            }
          ],
          reason: "maintenance window",
          actor: "ops@example.com"
        })
      },
      bindings
    );

    expect(bulkResponse.status).toBe(200);
    await expect(readJson(bulkResponse)).resolves.toMatchObject({
      keys: [
        {
          keyId: "key_dynamic_a",
          key: {
            status: "revoked"
          }
        },
        {
          keyId: "key_dynamic_b",
          key: {
            label: "Tenant B Key",
            notBefore: "2099-01-01T00:00:00.000Z"
          }
        }
      ]
    });

    const listResponse = await app.request(
      "http://localhost/_airlock/keys",
      {
        method: "GET",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(listResponse.status).toBe(200);
    const listPayload = await readJson(listResponse);
    expect(isRecord(listPayload)).toBe(true);

    if (!isRecord(listPayload) || !isRecordArray(listPayload.keys)) {
      return;
    }

    expect(
      listPayload.keys.find((entry) => entry.keyId === "key_dynamic_a")
    ).toMatchObject({
      runtime: {
        effectiveStatus: "revoked",
        acceptedNow: false
      }
    });
    expect(
      listPayload.keys.find((entry) => entry.keyId === "key_dynamic_b")
    ).toMatchObject({
      runtime: {
        label: "Tenant B Key",
        lifecycleStatus: "not_yet_active",
        acceptedNow: false
      }
    });
  });

  it("rejects mixed configured and registry-owned bulk updates atomically", async () => {
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
              id: "key_dynamic_a",
              label: "Dynamic Key A",
              valueHash:
                "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
              status: "active"
            })
          },
          bindings
        )
      ).status
    ).toBe(200);

    const bulkResponse = await app.request(
      "http://localhost/_airlock/keys",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret"
        },
        body: JSON.stringify({
          updates: [
            {
              keyId: "key_dynamic_a",
              status: "revoked"
            },
            {
              keyId: "key_env",
              status: "revoked"
            }
          ]
        })
      },
      bindings
    );

    expect(bulkResponse.status).toBe(409);
    await expect(readJson(bulkResponse)).resolves.toMatchObject({
      error: {
        code: "gateway_key_not_registry_owned"
      }
    });

    const readResponse = await app.request(
      "http://localhost/_airlock/keys/key_dynamic_a",
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
      key: {
        status: "active"
      }
    });
  });

  it("can bulk delete registry-owned dynamic keys atomically and clear runtime access", async () => {
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

    for (const payload of [
      {
        id: "key_dynamic_a",
        label: "Dynamic Key A",
        valueHash:
          "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
        status: "active"
      },
      {
        id: "key_dynamic_b",
        label: "Dynamic Key B",
        valueHash:
          "a26fa50cba5c8fefa46af3f7d9fa9a00f01eea2bcf5e3db253aa7e6e39c4b388",
        status: "active"
      }
    ]) {
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
              body: JSON.stringify(payload)
            },
            bindings
          )
        ).status
      ).toBe(200);
    }

    expect(
      (
        await app.request(
          "http://localhost/_airlock/keys/key_dynamic_b/revocation",
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

    const bulkDeleteResponse = await app.request(
      "http://localhost/_airlock/keys/bulk-delete",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret"
        },
        body: JSON.stringify({
          keyIds: ["key_dynamic_a", "key_dynamic_b"],
          reason: "tenant offboarding",
          actor: "ops@example.com"
        })
      },
      bindings
    );

    expect(bulkDeleteResponse.status).toBe(200);
    await expect(readJson(bulkDeleteResponse)).resolves.toMatchObject({
      keys: [
        {
          keyId: "key_dynamic_a",
          deleted: true
        },
        {
          keyId: "key_dynamic_b",
          deleted: true
        }
      ]
    });

    const listResponse = await app.request(
      "http://localhost/_airlock/keys",
      {
        method: "GET",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(listResponse.status).toBe(200);
    const listPayload = await readJson(listResponse);
    expect(isRecord(listPayload)).toBe(true);

    if (!isRecord(listPayload) || !isRecordArray(listPayload.keys)) {
      return;
    }

    expect(
      listPayload.keys.some((entry) => entry.keyId === "key_dynamic_a")
    ).toBe(false);
    expect(
      listPayload.keys.some((entry) => entry.keyId === "key_dynamic_b")
    ).toBe(false);

    for (const token of ["runtime-secret", "rotated-secret"]) {
      const authResponse = await app.request(
        "http://localhost/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            model: "gpt-4.1-mini",
            stream: false,
            messages: [{ role: "user", content: "hi" }]
          })
        },
        bindings
      );

      expect(authResponse.status).toBe(401);
      await expect(readJson(authResponse)).resolves.toMatchObject({
        error: {
          code: "auth_invalid_api_key"
        }
      });
    }

    const eventsResponse = await app.request(
      "http://localhost/_airlock/keys/key_dynamic_b/events",
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
          keyId: "key_dynamic_b",
          kind: "deleted",
          reason: "tenant offboarding",
          actor: "ops@example.com",
          actorSource: "payload"
        })
      ])
    );
  });

  it("rejects mixed configured and registry-owned bulk deletes atomically", async () => {
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
              id: "key_dynamic_a",
              label: "Dynamic Key A",
              valueHash:
                "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
              status: "active"
            })
          },
          bindings
        )
      ).status
    ).toBe(200);

    const bulkDeleteResponse = await app.request(
      "http://localhost/_airlock/keys/bulk-delete",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret"
        },
        body: JSON.stringify({
          keyIds: ["key_dynamic_a", "key_env"]
        })
      },
      bindings
    );

    expect(bulkDeleteResponse.status).toBe(409);
    await expect(readJson(bulkDeleteResponse)).resolves.toMatchObject({
      error: {
        code: "gateway_key_not_registry_owned"
      }
    });

    const readResponse = await app.request(
      "http://localhost/_airlock/keys/key_dynamic_a",
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
      keyId: "key_dynamic_a",
      ownership: "registry"
    });
  });

  it("can bulk create registry-owned dynamic keys and authenticate them immediately", async () => {
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

    const bulkCreateResponse = await app.request(
      "http://localhost/_airlock/keys/bulk-create",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret"
        },
        body: JSON.stringify({
          keys: [
            {
              id: "key_dynamic_a",
              label: "Dynamic Key A",
              valueHash:
                "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
              status: "active"
            },
            {
              id: "key_dynamic_b",
              label: "Dynamic Key B",
              valueHash:
                "a26fa50cba5c8fefa46af3f7d9fa9a00f01eea2bcf5e3db253aa7e6e39c4b388",
              status: "revoked"
            }
          ],
          actor: "ops@example.com"
        })
      },
      bindings
    );

    expect(bulkCreateResponse.status).toBe(200);
    await expect(readJson(bulkCreateResponse)).resolves.toMatchObject({
      keys: [
        {
          keyId: "key_dynamic_a",
          key: {
            id: "key_dynamic_a",
            label: "Dynamic Key A",
            status: "active"
          }
        },
        {
          keyId: "key_dynamic_b",
          key: {
            id: "key_dynamic_b",
            label: "Dynamic Key B",
            status: "revoked"
          }
        }
      ]
    });

    const authAllowed = await app.request(
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
          messages: [{ role: "user", content: "hi key a" }]
        })
      },
      bindings
    );

    expect(authAllowed.status).toBe(200);

    const authBlocked = await app.request(
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
          messages: [{ role: "user", content: "hi key b" }]
        })
      },
      bindings
    );

    expect(authBlocked.status).toBe(401);

    const listResponse = await app.request(
      "http://localhost/_airlock/keys",
      {
        method: "GET",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(listResponse.status).toBe(200);
    const listPayload = await readJson(listResponse);
    expect(isRecord(listPayload)).toBe(true);

    if (!isRecord(listPayload) || !isRecordArray(listPayload.keys)) {
      return;
    }

    expect(
      listPayload.keys.find((entry) => entry.keyId === "key_dynamic_a")
    ).toMatchObject({
      runtime: {
        acceptedNow: true
      }
    });
    expect(
      listPayload.keys.find((entry) => entry.keyId === "key_dynamic_b")
    ).toMatchObject({
      runtime: {
        effectiveStatus: "revoked",
        acceptedNow: false
      }
    });

    const eventsResponse = await app.request(
      "http://localhost/_airlock/keys/key_dynamic_a/events",
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
          keyId: "key_dynamic_a",
          kind: "created",
          actor: "ops@example.com",
          actorSource: "payload"
        })
      ])
    );
  });

  it("rejects invalid bulk creates atomically when a key conflicts with configured identity", async () => {
    const app = createApp({ fetcher: vi.fn() });
    const bindings = {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
      AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
      AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace(),
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_dynamic_b",
          label: "Configured Gateway Key",
          value: "gateway-secret",
          status: "active"
        }
      ])
    };

    const bulkCreateResponse = await app.request(
      "http://localhost/_airlock/keys/bulk-create",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret"
        },
        body: JSON.stringify({
          keys: [
            {
              id: "key_dynamic_a",
              label: "Dynamic Key A",
              valueHash:
                "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
              status: "active"
            },
            {
              id: "key_dynamic_b",
              label: "Dynamic Key B",
              valueHash:
                "a26fa50cba5c8fefa46af3f7d9fa9a00f01eea2bcf5e3db253aa7e6e39c4b388",
              status: "active"
            }
          ]
        })
      },
      bindings
    );

    expect(bulkCreateResponse.status).toBe(400);

    const listResponse = await app.request(
      "http://localhost/_airlock/keys",
      {
        method: "GET",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(listResponse.status).toBe(200);
    const listPayload = await readJson(listResponse);
    expect(isRecord(listPayload)).toBe(true);

    if (!isRecord(listPayload) || !isRecordArray(listPayload.keys)) {
      return;
    }

    expect(
      listPayload.keys.some((entry) => entry.keyId === "key_dynamic_a")
    ).toBe(false);
  });

  it("can bulk rotate registry-owned dynamic keys with staged overlap semantics", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T02:00:00.000Z"));

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

      for (const payload of [
        {
          id: "key_dynamic_a",
          label: "Dynamic Key A",
          valueHash:
            "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
          status: "active"
        },
        {
          id: "key_dynamic_b",
          label: "Dynamic Key B",
          valueHash:
            "a26fa50cba5c8fefa46af3f7d9fa9a00f01eea2bcf5e3db253aa7e6e39c4b388",
          status: "active"
        }
      ]) {
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
                body: JSON.stringify(payload)
              },
              bindings
            )
          ).status
        ).toBe(200);
      }

      expect(
        (
          await app.request(
            "http://localhost/_airlock/keys/key_dynamic_b/revocation",
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

      const bulkRotateResponse = await app.request(
        "http://localhost/_airlock/keys/bulk-rotate",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer admin-secret"
          },
          body: JSON.stringify({
            rotations: [
            {
              keyId: "key_dynamic_a",
              valueHash:
                  "1d017ea45be35d4491906be88a88483fbfc9552d44c79deef909e9dec1dcd908",
                overlapSeconds: 60
            },
            {
              keyId: "key_dynamic_b",
              valueHash:
                  "95ee2bd51ba5315db6299c44e85afdb11ab03757d25d6b1e7bc9df2a5b0ba8c2"
            }
            ],
            reason: "fleet rollover",
            actor: "ops@example.com"
          })
        },
        bindings
      );

      expect(bulkRotateResponse.status).toBe(200);
      await expect(readJson(bulkRotateResponse)).resolves.toMatchObject({
        keys: [
          {
            keyId: "key_dynamic_a",
            previousValueHash:
              "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16"
          },
          {
            keyId: "key_dynamic_b",
            key: {
              valueHash:
                "95ee2bd51ba5315db6299c44e85afdb11ab03757d25d6b1e7bc9df2a5b0ba8c2"
            }
          }
        ]
      });

      const oldAOverlap = await app.request(
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
            messages: [{ role: "user", content: "old a during overlap" }]
          })
        },
        bindings
      );
      expect(oldAOverlap.status).toBe(200);

      const newAOverlap = await app.request(
        "http://localhost/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer bulk-rotated-a"
          },
          body: JSON.stringify({
            model: "gpt-4.1-mini",
            stream: false,
            messages: [{ role: "user", content: "new a during overlap" }]
          })
        },
        bindings
      );
      expect(newAOverlap.status).toBe(200);

      const oldBImmediate = await app.request(
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
            messages: [{ role: "user", content: "old b after rotate" }]
          })
        },
        bindings
      );
      expect(oldBImmediate.status).toBe(401);

      const newBImmediate = await app.request(
        "http://localhost/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer bulk-rotated-b"
          },
          body: JSON.stringify({
            model: "gpt-4.1-mini",
            stream: false,
            messages: [{ role: "user", content: "new b after rotate" }]
          })
        },
        bindings
      );
      expect(newBImmediate.status).toBe(200);

      const revocationStatus = await app.request(
        "http://localhost/_airlock/keys/key_dynamic_b/revocation",
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
        keyId: "key_dynamic_b",
        revoked: false
      });

      vi.setSystemTime(new Date("2026-05-14T02:01:01.000Z"));

      const oldAAfterOverlap = await app.request(
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
            messages: [{ role: "user", content: "old a after overlap" }]
          })
        },
        bindings
      );
      expect(oldAAfterOverlap.status).toBe(401);
    } finally {
      vi.useRealTimers();
    }
  });

  it("can archive and restore a registry-owned dynamic key", async () => {
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
              messages: [{ role: "user", content: "before archive" }]
            })
          },
          bindings
        )
      ).status
    ).toBe(200);

    const archiveResponse = await app.request(
      "http://localhost/_airlock/keys/key_dynamic/archive",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret"
        },
        body: JSON.stringify({
          reason: "tenant paused",
          actor: "ops@example.com"
        })
      },
      bindings
    );

    expect(archiveResponse.status).toBe(200);
    const archivePayload = await readJson(archiveResponse);
    expect(isRecord(archivePayload)).toBe(true);

    if (!isRecord(archivePayload)) {
      return;
    }

    expect(archivePayload.keyId).toBe("key_dynamic");
    expect(typeof archivePayload.archivedAt).toBe("string");

    const archivedReadResponse = await app.request(
      "http://localhost/_airlock/keys/key_dynamic",
      {
        method: "GET",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(archivedReadResponse.status).toBe(200);
    const archivedReadPayload = await readJson(archivedReadResponse);
    expect(isRecord(archivedReadPayload)).toBe(true);

    if (!isRecord(archivedReadPayload)) {
      return;
    }

    expect(archivedReadPayload.keyId).toBe("key_dynamic");
    expect(typeof archivedReadPayload.archivedAt).toBe("string");

    const archivedStatusResponse = await app.request(
      "http://localhost/_airlock/keys/key_dynamic/status",
      {
        method: "GET",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(archivedStatusResponse.status).toBe(200);
    await expect(readJson(archivedStatusResponse)).resolves.toMatchObject({
      keyId: "key_dynamic",
      runtime: {
        lifecycleStatus: "archived",
        effectiveStatus: "archived",
        acceptedNow: false
      }
    });

    expect(
      (
        await app.request(
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
              messages: [{ role: "user", content: "after archive" }]
            })
          },
          bindings
        )
      ).status
    ).toBe(401);

    const restoreResponse = await app.request(
      "http://localhost/_airlock/keys/key_dynamic/restore",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret"
        },
        body: JSON.stringify({
          reason: "tenant resumed",
          actor: "ops@example.com"
        })
      },
      bindings
    );

    expect(restoreResponse.status).toBe(200);
    await expect(readJson(restoreResponse)).resolves.toMatchObject({
      keyId: "key_dynamic"
    });

    expect(
      (
        await app.request(
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
              messages: [{ role: "user", content: "after restore" }]
            })
          },
          bindings
        )
      ).status
    ).toBe(200);

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
          kind: "archived",
          actor: "ops@example.com"
        }),
        expect.objectContaining({
          keyId: "key_dynamic",
          kind: "restored",
          actor: "ops@example.com"
        })
      ])
    );
  });

  it("hides archived registry keys from default inventory but can include them explicitly", async () => {
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
          "http://localhost/_airlock/keys/key_dynamic/archive",
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

    const defaultInventoryResponse = await app.request(
      "http://localhost/_airlock/keys",
      {
        method: "GET",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(defaultInventoryResponse.status).toBe(200);
    const defaultInventoryPayload = await readJson(defaultInventoryResponse);
    expect(isRecord(defaultInventoryPayload)).toBe(true);

    if (
      !isRecord(defaultInventoryPayload) ||
      !isRecordArray(defaultInventoryPayload.keys)
    ) {
      return;
    }

    expect(
      defaultInventoryPayload.keys.some((entry) => entry.keyId === "key_dynamic")
    ).toBe(false);

    const archivedInventoryResponse = await app.request(
      "http://localhost/_airlock/keys?includeArchived=true&effectiveStatus=archived",
      {
        method: "GET",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(archivedInventoryResponse.status).toBe(200);
    const archivedInventoryPayload = await readJson(archivedInventoryResponse);
    expect(isRecord(archivedInventoryPayload)).toBe(true);

    if (
      !isRecord(archivedInventoryPayload) ||
      !isRecordArray(archivedInventoryPayload.keys)
    ) {
      return;
    }

    expect(
      archivedInventoryPayload.keys.find((entry) => entry.keyId === "key_dynamic")
    ).toMatchObject({
      runtime: {
        effectiveStatus: "archived",
        acceptedNow: false
      }
    });
  });

  it("rejects invalid archive and restore lifecycle transitions", async () => {
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

    const configuredArchiveResponse = await app.request(
      "http://localhost/_airlock/keys/key_env/archive",
      {
        method: "POST",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(configuredArchiveResponse.status).toBe(409);
    await expect(readJson(configuredArchiveResponse)).resolves.toMatchObject({
      error: {
        code: "gateway_key_not_registry_owned"
      }
    });

    const restoreNotArchivedResponse = await app.request(
      "http://localhost/_airlock/keys/key_dynamic/restore",
      {
        method: "POST",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(restoreNotArchivedResponse.status).toBe(409);
    await expect(readJson(restoreNotArchivedResponse)).resolves.toMatchObject({
      error: {
        code: "gateway_key_not_archived"
      }
    });

    expect(
      (
        await app.request(
          "http://localhost/_airlock/keys/key_dynamic/archive",
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

    const archiveAgainResponse = await app.request(
      "http://localhost/_airlock/keys/key_dynamic/archive",
      {
        method: "POST",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(archiveAgainResponse.status).toBe(409);
    await expect(readJson(archiveAgainResponse)).resolves.toMatchObject({
      error: {
        code: "gateway_key_already_archived"
      }
    });
  });

  it("can bulk archive and restore registry-owned dynamic keys atomically", async () => {
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

    for (const payload of [
      {
        id: "key_dynamic_a",
        label: "Dynamic Key A",
        valueHash:
          "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
        status: "active"
      },
      {
        id: "key_dynamic_b",
        label: "Dynamic Key B",
        valueHash:
          "a26fa50cba5c8fefa46af3f7d9fa9a00f01eea2bcf5e3db253aa7e6e39c4b388",
        status: "active"
      }
    ]) {
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
              body: JSON.stringify(payload)
            },
            bindings
          )
        ).status
      ).toBe(200);
    }

    const bulkArchiveResponse = await app.request(
      "http://localhost/_airlock/keys/bulk-archive",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret"
        },
        body: JSON.stringify({
          keyIds: ["key_dynamic_a", "key_dynamic_b"],
          reason: "tenant paused",
          actor: "ops@example.com"
        })
      },
      bindings
    );

    expect(bulkArchiveResponse.status).toBe(200);
    await expect(readJson(bulkArchiveResponse)).resolves.toMatchObject({
      keys: [
        {
          keyId: "key_dynamic_a"
        },
        {
          keyId: "key_dynamic_b"
        }
      ]
    });

    const defaultInventoryResponse = await app.request(
      "http://localhost/_airlock/keys",
      {
        method: "GET",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(defaultInventoryResponse.status).toBe(200);
    const defaultInventoryPayload = await readJson(defaultInventoryResponse);
    expect(isRecord(defaultInventoryPayload)).toBe(true);

    if (
      !isRecord(defaultInventoryPayload) ||
      !isRecordArray(defaultInventoryPayload.keys)
    ) {
      return;
    }

    expect(
      defaultInventoryPayload.keys.some((entry) => entry.keyId === "key_dynamic_a")
    ).toBe(false);
    expect(
      defaultInventoryPayload.keys.some((entry) => entry.keyId === "key_dynamic_b")
    ).toBe(false);

    for (const token of ["runtime-secret", "rotated-secret"]) {
      const authResponse = await app.request(
        "http://localhost/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            model: "gpt-4.1-mini",
            stream: false,
            messages: [{ role: "user", content: "after bulk archive" }]
          })
        },
        bindings
      );

      expect(authResponse.status).toBe(401);
    }

    const archivedInventoryResponse = await app.request(
      "http://localhost/_airlock/keys?includeArchived=true&effectiveStatus=archived",
      {
        method: "GET",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(archivedInventoryResponse.status).toBe(200);
    const archivedInventoryPayload = await readJson(archivedInventoryResponse);
    expect(isRecord(archivedInventoryPayload)).toBe(true);

    if (
      !isRecord(archivedInventoryPayload) ||
      !isRecordArray(archivedInventoryPayload.keys)
    ) {
      return;
    }

    expect(
      archivedInventoryPayload.keys.find((entry) => entry.keyId === "key_dynamic_a")
    ).toMatchObject({
      runtime: {
        effectiveStatus: "archived",
        acceptedNow: false
      }
    });
    expect(
      archivedInventoryPayload.keys.find((entry) => entry.keyId === "key_dynamic_b")
    ).toMatchObject({
      runtime: {
        effectiveStatus: "archived",
        acceptedNow: false
      }
    });

    const bulkRestoreResponse = await app.request(
      "http://localhost/_airlock/keys/bulk-restore",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret"
        },
        body: JSON.stringify({
          keyIds: ["key_dynamic_a", "key_dynamic_b"],
          reason: "tenant resumed",
          actor: "ops@example.com"
        })
      },
      bindings
    );

    expect(bulkRestoreResponse.status).toBe(200);
    await expect(readJson(bulkRestoreResponse)).resolves.toMatchObject({
      keys: [
        {
          keyId: "key_dynamic_a"
        },
        {
          keyId: "key_dynamic_b"
        }
      ]
    });

    for (const token of ["runtime-secret", "rotated-secret"]) {
      const authResponse = await app.request(
        "http://localhost/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            model: "gpt-4.1-mini",
            stream: false,
            messages: [{ role: "user", content: "after bulk restore" }]
          })
        },
        bindings
      );

      expect(authResponse.status).toBe(200);
    }

    const eventsResponse = await app.request(
      "http://localhost/_airlock/keys/key_dynamic_a/events",
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
          keyId: "key_dynamic_a",
          kind: "archived",
          reason: "tenant paused",
          actor: "ops@example.com"
        }),
        expect.objectContaining({
          keyId: "key_dynamic_a",
          kind: "restored",
          reason: "tenant resumed",
          actor: "ops@example.com"
        })
      ])
    );
  });

  it("can bulk finalize staged registry-owned key rotations atomically", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T04:00:00.000Z"));

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

      for (const payload of [
        {
          id: "key_dynamic_a",
          label: "Dynamic Key A",
          valueHash:
            "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
          status: "active"
        },
        {
          id: "key_dynamic_b",
          label: "Dynamic Key B",
          valueHash:
            "a26fa50cba5c8fefa46af3f7d9fa9a00f01eea2bcf5e3db253aa7e6e39c4b388",
          status: "active"
        }
      ]) {
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
                body: JSON.stringify(payload)
              },
              bindings
            )
          ).status
        ).toBe(200);
      }

      expect(
        (
          await app.request(
            "http://localhost/_airlock/keys/bulk-rotate",
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: "Bearer admin-secret"
              },
              body: JSON.stringify({
                rotations: [
                  {
                    keyId: "key_dynamic_a",
                    valueHash:
                      "1d017ea45be35d4491906be88a88483fbfc9552d44c79deef909e9dec1dcd908",
                    overlapSeconds: 300
                  },
                  {
                    keyId: "key_dynamic_b",
                    valueHash:
                      "95ee2bd51ba5315db6299c44e85afdb11ab03757d25d6b1e7bc9df2a5b0ba8c2",
                    overlapSeconds: 300
                  }
                ]
              })
            },
            bindings
          )
        ).status
      ).toBe(200);

      const finalizeResponse = await app.request(
        "http://localhost/_airlock/keys/bulk-rotate/finalize",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer admin-secret"
          },
          body: JSON.stringify({
            keyIds: ["key_dynamic_a", "key_dynamic_b"],
            reason: "cutover complete",
            actor: "ops@example.com"
          })
        },
        bindings
      );

      expect(finalizeResponse.status).toBe(200);
      await expect(readJson(finalizeResponse)).resolves.toMatchObject({
        keys: [
          {
            keyId: "key_dynamic_a",
            key: {
              valueHash:
                "1d017ea45be35d4491906be88a88483fbfc9552d44c79deef909e9dec1dcd908"
            }
          },
          {
            keyId: "key_dynamic_b",
            key: {
              valueHash:
                "95ee2bd51ba5315db6299c44e85afdb11ab03757d25d6b1e7bc9df2a5b0ba8c2"
            }
          }
        ]
      });

      for (const token of ["runtime-secret", "rotated-secret"]) {
        const oldSecretResponse = await app.request(
          "http://localhost/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
              model: "gpt-4.1-mini",
              stream: false,
              messages: [{ role: "user", content: "old secret after bulk finalize" }]
            })
          },
          bindings
        );

        expect(oldSecretResponse.status).toBe(401);
      }

      for (const token of ["bulk-rotated-a", "bulk-rotated-b"]) {
        const newSecretResponse = await app.request(
          "http://localhost/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
              model: "gpt-4.1-mini",
              stream: false,
              messages: [{ role: "user", content: "new secret after bulk finalize" }]
            })
          },
          bindings
        );

        expect(newSecretResponse.status).toBe(200);
      }

      const eventsResponse = await app.request(
        "http://localhost/_airlock/keys/key_dynamic_a/events",
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
            keyId: "key_dynamic_a",
            kind: "rotation_finalized",
            reason: "cutover complete",
            actor: "ops@example.com"
          })
        ])
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("can bulk cancel staged registry-owned key rotations atomically", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T04:10:00.000Z"));

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

      for (const payload of [
        {
          id: "key_dynamic_a",
          label: "Dynamic Key A",
          valueHash:
            "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
          status: "active"
        },
        {
          id: "key_dynamic_b",
          label: "Dynamic Key B",
          valueHash:
            "a26fa50cba5c8fefa46af3f7d9fa9a00f01eea2bcf5e3db253aa7e6e39c4b388",
          status: "active"
        }
      ]) {
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
                body: JSON.stringify(payload)
              },
              bindings
            )
          ).status
        ).toBe(200);
      }

      expect(
        (
          await app.request(
            "http://localhost/_airlock/keys/bulk-rotate",
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: "Bearer admin-secret"
              },
              body: JSON.stringify({
                rotations: [
                  {
                    keyId: "key_dynamic_a",
                    valueHash:
                      "1d017ea45be35d4491906be88a88483fbfc9552d44c79deef909e9dec1dcd908",
                    overlapSeconds: 300
                  },
                  {
                    keyId: "key_dynamic_b",
                    valueHash:
                      "95ee2bd51ba5315db6299c44e85afdb11ab03757d25d6b1e7bc9df2a5b0ba8c2",
                    overlapSeconds: 300
                  }
                ]
              })
            },
            bindings
          )
        ).status
      ).toBe(200);

      const cancelResponse = await app.request(
        "http://localhost/_airlock/keys/bulk-rotate/cancel",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer admin-secret"
          },
          body: JSON.stringify({
            keyIds: ["key_dynamic_a", "key_dynamic_b"],
            reason: "rollback requested"
          })
        },
        bindings
      );

      expect(cancelResponse.status).toBe(200);
      await expect(readJson(cancelResponse)).resolves.toMatchObject({
        keys: [
          {
            keyId: "key_dynamic_a",
            key: {
              valueHash:
                "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16"
            }
          },
          {
            keyId: "key_dynamic_b",
            key: {
              valueHash:
                "a26fa50cba5c8fefa46af3f7d9fa9a00f01eea2bcf5e3db253aa7e6e39c4b388"
            }
          }
        ]
      });

      for (const token of ["runtime-secret", "rotated-secret"]) {
        const oldSecretResponse = await app.request(
          "http://localhost/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
              model: "gpt-4.1-mini",
              stream: false,
              messages: [{ role: "user", content: "old secret after bulk cancel" }]
            })
          },
          bindings
        );

        expect(oldSecretResponse.status).toBe(200);
      }

      for (const token of ["bulk-rotated-a", "bulk-rotated-b"]) {
        const newSecretResponse = await app.request(
          "http://localhost/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
              model: "gpt-4.1-mini",
              stream: false,
              messages: [{ role: "user", content: "new secret after bulk cancel" }]
            })
          },
          bindings
        );

        expect(newSecretResponse.status).toBe(401);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects invalid bulk staged rotation lifecycle transitions atomically", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T04:20:00.000Z"));

    try {
      const app = createApp({ fetcher: vi.fn() });
      const bindings = {
        ...createBindings(),
        AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
        AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
        AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace(),
        AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
      };

      for (const payload of [
        {
          id: "key_dynamic_a",
          label: "Dynamic Key A",
          valueHash:
            "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
          status: "active"
        },
        {
          id: "key_dynamic_b",
          label: "Dynamic Key B",
          valueHash:
            "a26fa50cba5c8fefa46af3f7d9fa9a00f01eea2bcf5e3db253aa7e6e39c4b388",
          status: "active"
        }
      ]) {
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
                body: JSON.stringify(payload)
              },
              bindings
            )
          ).status
        ).toBe(200);
      }

      expect(
        (
          await app.request(
            "http://localhost/_airlock/keys/key_dynamic_a/rotate",
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: "Bearer admin-secret"
              },
              body: JSON.stringify({
                valueHash:
                  "1d017ea45be35d4491906be88a88483fbfc9552d44c79deef909e9dec1dcd908",
                overlapSeconds: 300
              })
            },
            bindings
          )
        ).status
      ).toBe(200);

      const finalizeResponse = await app.request(
        "http://localhost/_airlock/keys/bulk-rotate/finalize",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer admin-secret"
          },
          body: JSON.stringify({
            keyIds: ["key_dynamic_a", "key_dynamic_b"]
          })
        },
        bindings
      );

      expect(finalizeResponse.status).toBe(409);
      await expect(readJson(finalizeResponse)).resolves.toMatchObject({
        error: {
          code: "gateway_key_rotation_not_staged"
        }
      });

      const readAfterFinalizeFailure = await app.request(
        "http://localhost/_airlock/keys/key_dynamic_a",
        {
          method: "GET",
          headers: {
            authorization: "Bearer admin-secret"
          }
        },
        bindings
      );

      expect(readAfterFinalizeFailure.status).toBe(200);
      await expect(readJson(readAfterFinalizeFailure)).resolves.toMatchObject({
        previousValueHash:
          "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16"
      });

      expect(
        (
          await app.request(
            "http://localhost/_airlock/keys/key_dynamic_b/rotate",
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: "Bearer admin-secret"
              },
              body: JSON.stringify({
                valueHash:
                  "95ee2bd51ba5315db6299c44e85afdb11ab03757d25d6b1e7bc9df2a5b0ba8c2",
                overlapSeconds: 60
              })
            },
            bindings
          )
        ).status
      ).toBe(200);

      vi.setSystemTime(new Date("2026-05-14T04:21:01.000Z"));

      const cancelResponse = await app.request(
        "http://localhost/_airlock/keys/bulk-rotate/cancel",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer admin-secret"
          },
          body: JSON.stringify({
            keyIds: ["key_dynamic_a", "key_dynamic_b"]
          })
        },
        bindings
      );

      expect(cancelResponse.status).toBe(409);
      await expect(readJson(cancelResponse)).resolves.toMatchObject({
        error: {
          code: "gateway_key_rotation_not_cancelable"
        }
      });

      const readAfterCancelFailure = await app.request(
        "http://localhost/_airlock/keys/key_dynamic_a",
        {
          method: "GET",
          headers: {
            authorization: "Bearer admin-secret"
          }
        },
        bindings
      );

      expect(readAfterCancelFailure.status).toBe(200);
      await expect(readJson(readAfterCancelFailure)).resolves.toMatchObject({
        previousValueHash:
          "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16"
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects mixed configured and registry-owned bulk archives atomically", async () => {
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
              id: "key_dynamic_a",
              label: "Dynamic Key A",
              valueHash:
                "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
              status: "active"
            })
          },
          bindings
        )
      ).status
    ).toBe(200);

    const bulkArchiveResponse = await app.request(
      "http://localhost/_airlock/keys/bulk-archive",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret"
        },
        body: JSON.stringify({
          keyIds: ["key_dynamic_a", "key_env"]
        })
      },
      bindings
    );

    expect(bulkArchiveResponse.status).toBe(409);
    await expect(readJson(bulkArchiveResponse)).resolves.toMatchObject({
      error: {
        code: "gateway_key_not_registry_owned"
      }
    });

    const readResponse = await app.request(
      "http://localhost/_airlock/keys/key_dynamic_a",
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
      keyId: "key_dynamic_a",
      ownership: "registry"
    });
  });

  it("rejects invalid bulk archive and restore lifecycle transitions atomically", async () => {
    const app = createApp({ fetcher: vi.fn() });
    const bindings = {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
      AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
      AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace(),
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
    };

    for (const payload of [
      {
        id: "key_dynamic_a",
        label: "Dynamic Key A",
        valueHash:
          "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
        status: "active"
      },
      {
        id: "key_dynamic_b",
        label: "Dynamic Key B",
        valueHash:
          "a26fa50cba5c8fefa46af3f7d9fa9a00f01eea2bcf5e3db253aa7e6e39c4b388",
        status: "active"
      }
    ]) {
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
              body: JSON.stringify(payload)
            },
            bindings
          )
        ).status
      ).toBe(200);
    }

    const restoreNotArchivedResponse = await app.request(
      "http://localhost/_airlock/keys/bulk-restore",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret"
        },
        body: JSON.stringify({
          keyIds: ["key_dynamic_a", "key_dynamic_b"]
        })
      },
      bindings
    );

    expect(restoreNotArchivedResponse.status).toBe(409);
    await expect(readJson(restoreNotArchivedResponse)).resolves.toMatchObject({
      error: {
        code: "gateway_key_not_archived"
      }
    });

    expect(
      (
        await app.request(
          "http://localhost/_airlock/keys/key_dynamic_b/archive",
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

    const archiveMixedStateResponse = await app.request(
      "http://localhost/_airlock/keys/bulk-archive",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret"
        },
        body: JSON.stringify({
          keyIds: ["key_dynamic_a", "key_dynamic_b"]
        })
      },
      bindings
    );

    expect(archiveMixedStateResponse.status).toBe(409);
    await expect(readJson(archiveMixedStateResponse)).resolves.toMatchObject({
      error: {
        code: "gateway_key_already_archived"
      }
    });

    const readResponse = await app.request(
      "http://localhost/_airlock/keys/key_dynamic_a",
      {
        method: "GET",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(readResponse.status).toBe(200);
    const readPayload = await readJson(readResponse);
    expect(isRecord(readPayload)).toBe(true);

    if (!isRecord(readPayload)) {
      return;
    }

    expect(readPayload.keyId).toBe("key_dynamic_a");
    expect("archivedAt" in readPayload).toBe(false);
  });

  it("records field-level diff audit metadata on registry lifecycle events", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T02:00:00.000Z"));

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
            "http://localhost/_airlock/keys/key_dynamic",
            {
              method: "PUT",
              headers: {
                "content-type": "application/json",
                authorization: "Bearer admin-secret"
              },
              body: JSON.stringify({
                label: "Renamed Runtime Key",
                status: "revoked",
                reason: "paused for maintenance"
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
                overlapSeconds: 60,
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
            "http://localhost/_airlock/keys/key_dynamic/rotate/finalize",
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
            "http://localhost/_airlock/keys/key_dynamic/archive",
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
            "http://localhost/_airlock/keys/key_dynamic/restore",
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
                  "95ee2bd51ba5315db6299c44e85afdb11ab03757d25d6b1e7bc9df2a5b0ba8c2",
                overlapSeconds: 60
              })
            },
            bindings
          )
        ).status
      ).toBe(200);

      expect(
        (
          await app.request(
            "http://localhost/_airlock/keys/key_dynamic/rotate/cancel",
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

      const updatedEvent = eventsPayload.events.find((event) => {
        return event.kind === "updated";
      });
      const rotatedEvent = eventsPayload.events.find((event) => {
        return event.kind === "rotated" && event.reason === "credential rollover";
      });
      const finalizedEvent = eventsPayload.events.find((event) => {
        return event.kind === "rotation_finalized";
      });
      const archivedEvent = eventsPayload.events.find((event) => {
        return event.kind === "archived";
      });
      const restoredEvent = eventsPayload.events.find((event) => {
        return event.kind === "restored";
      });
      const canceledEvent = eventsPayload.events.find((event) => {
        return event.kind === "rotation_canceled";
      });

      expect(isRecord(updatedEvent)).toBe(true);
      expect(isRecord(rotatedEvent)).toBe(true);
      expect(isRecord(finalizedEvent)).toBe(true);
      expect(isRecord(archivedEvent)).toBe(true);
      expect(isRecord(restoredEvent)).toBe(true);
      expect(isRecord(canceledEvent)).toBe(true);

      if (
        !isRecord(updatedEvent) ||
        !isRecord(rotatedEvent) ||
        !isRecord(finalizedEvent) ||
        !isRecord(archivedEvent) ||
        !isRecord(restoredEvent) ||
        !isRecord(canceledEvent)
      ) {
        return;
      }

      const updatedChanges = updatedEvent.changes;
      const rotatedChanges = rotatedEvent.changes;
      const finalizedChanges = finalizedEvent.changes;
      const archivedChanges = archivedEvent.changes;
      const restoredChanges = restoredEvent.changes;
      const canceledChanges = canceledEvent.changes;

      expect(Array.isArray(updatedChanges)).toBe(true);
      expect(Array.isArray(rotatedChanges)).toBe(true);
      expect(Array.isArray(finalizedChanges)).toBe(true);
      expect(Array.isArray(archivedChanges)).toBe(true);
      expect(Array.isArray(restoredChanges)).toBe(true);
      expect(Array.isArray(canceledChanges)).toBe(true);

      if (
        !Array.isArray(updatedChanges) ||
        !Array.isArray(rotatedChanges) ||
        !Array.isArray(finalizedChanges) ||
        !Array.isArray(archivedChanges) ||
        !Array.isArray(restoredChanges) ||
        !Array.isArray(canceledChanges)
      ) {
        return;
      }

      expect(updatedChanges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: "label",
            before: "Dynamic Runtime Key",
            after: "Renamed Runtime Key"
          }),
          expect.objectContaining({
            field: "status",
            before: "active",
            after: "revoked"
          })
        ])
      );
      expect(rotatedChanges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: "valueHash",
            before:
              "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
            after:
              "a26fa50cba5c8fefa46af3f7d9fa9a00f01eea2bcf5e3db253aa7e6e39c4b388"
          }),
          expect.objectContaining({
            field: "previousValueHash",
            before: null,
            after:
              "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16"
          })
        ])
      );
      expect(finalizedChanges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: "previousValueHash",
            before:
              "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
            after: null
          })
        ])
      );
      expect(archivedChanges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: "archivedAt",
            before: null
          })
        ])
      );
      expect(restoredChanges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: "archivedAt",
            after: null
          })
        ])
      );
      expect(canceledChanges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: "valueHash",
            before:
              "95ee2bd51ba5315db6299c44e85afdb11ab03757d25d6b1e7bc9df2a5b0ba8c2",
            after:
              "a26fa50cba5c8fefa46af3f7d9fa9a00f01eea2bcf5e3db253aa7e6e39c4b388"
          }),
          expect.objectContaining({
            field: "previousValueHash",
            before:
              "a26fa50cba5c8fefa46af3f7d9fa9a00f01eea2bcf5e3db253aa7e6e39c4b388",
            after: null
          })
        ])
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns operation-level key audit correlation for bulk governance actions", async () => {
    const app = createApp({ fetcher: vi.fn() });
    const bindings = {
      ...createBindings(),
      AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret",
      AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true",
      AIRLOCK_GATEWAY_KEY_REGISTRY: createRegistryNamespace(),
      AIRLOCK_GATEWAY_KEY_REVOCATION: createRevocationNamespace()
    };

    const bulkCreateResponse = await app.request(
      "http://localhost/_airlock/keys/bulk-create",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret"
        },
        body: JSON.stringify({
          keys: [
            {
              id: "key_dynamic_a",
              label: "Dynamic Key A",
              valueHash:
                "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
              status: "active"
            },
            {
              id: "key_dynamic_b",
              label: "Dynamic Key B",
              valueHash:
                "a26fa50cba5c8fefa46af3f7d9fa9a00f01eea2bcf5e3db253aa7e6e39c4b388",
              status: "active"
            }
          ],
          actor: "ops@example.com"
        })
      },
      bindings
    );

    expect(bulkCreateResponse.status).toBe(200);
    const bulkCreatePayload = await readJson(bulkCreateResponse);
    expect(isRecord(bulkCreatePayload)).toBe(true);

    if (
      !isRecord(bulkCreatePayload) ||
      typeof bulkCreatePayload.operationId !== "string"
    ) {
      throw new Error("bulk create response did not expose operationId");
    }

    const bulkDeleteResponse = await app.request(
      "http://localhost/_airlock/keys/bulk-delete",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret"
        },
        body: JSON.stringify({
          keyIds: ["key_dynamic_a", "key_dynamic_b"],
          reason: "tenant sunset"
        })
      },
      bindings
    );

    expect(bulkDeleteResponse.status).toBe(200);
    const bulkDeletePayload = await readJson(bulkDeleteResponse);
    expect(isRecord(bulkDeletePayload)).toBe(true);

    if (
      !isRecord(bulkDeletePayload) ||
      typeof bulkDeletePayload.operationId !== "string"
    ) {
      throw new Error("bulk delete response did not expose operationId");
    }

    const operationEventsResponse = await app.request(
      `http://localhost/_airlock/keys/operations/${bulkDeletePayload.operationId}/events`,
      {
        method: "GET",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(operationEventsResponse.status).toBe(200);
    const operationEventsPayload = await readJson(operationEventsResponse);
    expect(isGatewayKeyOperationEventsPayload(operationEventsPayload)).toBe(true);

    if (!isGatewayKeyOperationEventsPayload(operationEventsPayload)) {
      throw new Error("operation events response shape was invalid");
    }

    expect(operationEventsPayload.operationId).toBe(bulkDeletePayload.operationId);
    expect(operationEventsPayload).toMatchObject({
      summary: {
        operationId: bulkDeletePayload.operationId,
        keyIds: ["key_dynamic_a", "key_dynamic_b"],
        keyCount: 2,
        eventKinds: ["deleted"],
        ownerships: ["registry"],
        reason: "tenant sunset"
      }
    });
    expect(operationEventsPayload.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keyId: "key_dynamic_a",
          kind: "deleted",
          operationId: bulkDeletePayload.operationId
        }),
        expect.objectContaining({
          keyId: "key_dynamic_b",
          kind: "deleted",
          operationId: bulkDeletePayload.operationId
        })
      ])
    );
  });

  it("returns not found for operation-level audit reads when registry support is disabled", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/_airlock/keys/operations/req_bulk_missing/events",
      {
        method: "GET",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      {
        ...createBindings(),
        AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-secret"
      }
    );

    expect(response.status).toBe(404);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "gateway_key_not_found"
      }
    });
  });

  it("exposes single-key revocation operations through operation-level audit reads", async () => {
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
          reason: "incident containment",
          actor: "ops@example.com"
        })
      },
      bindings
    );

    expect(revokeResponse.status).toBe(200);
    const operationId =
      revokeResponse.headers.get("x-request-id") ??
      revokeResponse.headers.get("request-id");

    expect(operationId).toBeTruthy();

    const operationEventsResponse = await app.request(
      `http://localhost/_airlock/keys/operations/${operationId}/events`,
      {
        method: "GET",
        headers: {
          authorization: "Bearer admin-secret"
        }
      },
      bindings
    );

    expect(operationEventsResponse.status).toBe(200);
    const operationEventsPayload = await readJson(operationEventsResponse);
    expect(isGatewayKeyOperationEventsPayload(operationEventsPayload)).toBe(true);

    if (!isGatewayKeyOperationEventsPayload(operationEventsPayload)) {
      throw new Error("operation events response shape was invalid");
    }

    expect(operationEventsPayload.operationId).toBe(operationId);
    expect(operationEventsPayload.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keyId: "gak_1",
          kind: "revoked",
          operationId
        })
      ])
    );
  });

  it("rejects mixed configured and registry-owned bulk rotates atomically", async () => {
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
              id: "key_dynamic_a",
              label: "Dynamic Key A",
              valueHash:
                "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
              status: "active"
            })
          },
          bindings
        )
      ).status
    ).toBe(200);

    const bulkRotateResponse = await app.request(
      "http://localhost/_airlock/keys/bulk-rotate",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret"
        },
        body: JSON.stringify({
          rotations: [
            {
              keyId: "key_dynamic_a",
              valueHash:
                "1d017ea45be35d4491906be88a88483fbfc9552d44c79deef909e9dec1dcd908"
            },
            {
              keyId: "key_env",
              valueHash:
                "95ee2bd51ba5315db6299c44e85afdb11ab03757d25d6b1e7bc9df2a5b0ba8c2"
            }
          ]
        })
      },
      bindings
    );

    expect(bulkRotateResponse.status).toBe(409);
    await expect(readJson(bulkRotateResponse)).resolves.toMatchObject({
      error: {
        code: "gateway_key_not_registry_owned"
      }
    });

    const readResponse = await app.request(
      "http://localhost/_airlock/keys/key_dynamic_a",
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
      key: {
        valueHash:
          "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16"
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
        AIRLOCK_REQUEST_SIGNING_SECRETS: JSON.stringify({
          "openai-signing-secret": "signing-secret"
        }),
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
            },
            signing: {
              type: "hmac_sha256_header",
              headerName: "x-airlock-signature",
              prefix: "sha256=",
              secret: {
                secretRef: "openai-signing-secret"
              },
              components: ["method", "path", "query"]
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
      "openai-beta": "responses=v1",
      "x-airlock-signature":
        "sha256=3cfdb030ea88f177756399b431f674bb5c7ffd8f798ad18a02c758b374ce64a7"
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

  it("accepts chat completion text-part input and flattens it for upstream execution", async () => {
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
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "hello"
                },
                {
                  type: "text",
                  text: "there"
                }
              ]
            }
          ]
        })
      },
      createBindings()
    );

    expect(response.status).toBe(200);
    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      messages: [{ role: "user", content: "hello\nthere" }]
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

  it("returns timeout before starting a streaming attempt when the shared budget is already exhausted", async () => {
    const encoder = new TextEncoder();
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                [
                  'data: {"id":"chatcmpl_stream_timeout","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
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

    const nowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(5)
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
            stream: true,
            messages: [{ role: "user", content: "hi" }]
          })
        },
        {
          ...createBindings(),
          AIRLOCK_PROVIDER_TIMEOUT_MS: "1"
        }
      );

      expect(response.status).toBe(504);
      expect(fetcher).toHaveBeenCalledTimes(0);
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

  it("releases a streaming concurrency lease even when preflight cleanup fails", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "chatcmpl_after_cleanup_failure",
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
    const baseTokenQuotaNamespace = createTokenQuotaNamespace();
    const failingReleaseTokenQuotaNamespace: DurableObjectNamespaceLike = {
      idFromName(name: string) {
        return baseTokenQuotaNamespace.idFromName(name);
      },
      get(id: { name: string }) {
        const stub = baseTokenQuotaNamespace.get(id);

        return {
          async fetch(request: Request) {
            if (request.method === "POST") {
              const body = (await request.clone().json()) as { kind?: string };

              if (body.kind === "release") {
                return new Response("token release failed", { status: 500 });
              }
            }

            return stub.fetch(request);
          }
        };
      }
    };
    const app = createApp({
      fetcher,
      now: vi
        .fn<() => number>()
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(5)
        .mockReturnValueOnce(5)
        .mockReturnValue(5)
    });
    const bindings = {
      ...createBindings(),
      AIRLOCK_PROVIDER_TIMEOUT_MS: "1",
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_stream_cleanup_failure",
          label: "Stream Cleanup Failure Key",
          value: "gateway-secret",
          status: "active",
          policy: {
            concurrencyQuota: {
              limit: 1
            },
            tokenQuota: {
              limit: 1000,
              windowSeconds: 60
            }
          }
        }
      ]),
      AIRLOCK_GATEWAY_KEY_CONCURRENCY: createConcurrencyNamespace(),
      AIRLOCK_GATEWAY_KEY_TOKEN_QUOTA: failingReleaseTokenQuotaNamespace
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
          max_tokens: 16,
          messages: [{ role: "user", content: "first stream" }]
        })
      },
      bindings
    );

    expect(firstResponse.status).toBe(503);
    await expect(readJson(firstResponse)).resolves.toMatchObject({
      error: {
        code: "gateway_key_token_quota_unavailable"
      }
    });

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
          messages: [{ role: "user", content: "second request" }]
        })
      },
      bindings
    );

    expect(secondResponse.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
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

  it("reopens the circuit after a failed half-open probe and skips the target again", async () => {
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
    let currentNow = 1000;
    const app = createApp({
      fetcher,
      now: () => currentNow
    });
    const request = {
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
    };
    const bindings = {
      ...createBindings(),
      AIRLOCK_PROVIDER_CIRCUIT_BREAKER_PERSISTENT: "true",
      AIRLOCK_PROVIDER_CIRCUIT_BREAKER_THRESHOLD: "1",
      AIRLOCK_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS: "100",
      AIRLOCK_PROVIDER_CIRCUIT_BREAKER: createPersistentBreakerNamespace(),
      AIRLOCK_MODEL_ALIASES:
        "assistant-default=openai:gpt-4.1-mini,claude-haiku-4-5=anthropic:claude-haiku-4-5",
      AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
        "assistant-default": ["anthropic:claude-haiku-4-5"]
      })
    };

    const firstResponse = await app.request(
      "http://localhost/v1/chat/completions",
      request,
      bindings
    );

    expect(firstResponse.status).toBe(200);

    currentNow = 1200;
    const secondResponse = await app.request(
      "http://localhost/v1/chat/completions",
      request,
      bindings
    );

    expect(secondResponse.status).toBe(200);

    currentNow = 1250;
    const thirdResponse = await app.request(
      "http://localhost/v1/chat/completions",
      request,
      bindings
    );

    expect(thirdResponse.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(fetcher.mock.calls[2]?.[0]).toBe(
      "https://api.openai.com/v1/chat/completions"
    );
    expect(fetcher.mock.calls[3]?.[0]).toBe(
      "https://api.anthropic.com/v1/messages"
    );
    expect(fetcher.mock.calls[4]?.[0]).toBe(
      "https://api.anthropic.com/v1/messages"
    );
    expect(openAIAttempts).toBe(2);
    expect(anthropicAttempts).toBe(3);
  });

  it("backs off the next app-level half-open probe after repeated failed recovery probes", async () => {
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
    let currentNow = 1000;
    const app = createApp({
      fetcher,
      now: () => currentNow
    });
    const request = {
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
    };
    const bindings = {
      ...createBindings(),
      AIRLOCK_PROVIDER_CIRCUIT_BREAKER_PERSISTENT: "true",
      AIRLOCK_PROVIDER_CIRCUIT_BREAKER_THRESHOLD: "1",
      AIRLOCK_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS: "100",
      AIRLOCK_PROVIDER_CIRCUIT_BREAKER: createPersistentBreakerNamespace(),
      AIRLOCK_MODEL_ALIASES:
        "assistant-default=openai:gpt-4.1-mini,claude-haiku-4-5=anthropic:claude-haiku-4-5",
      AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
        "assistant-default": ["anthropic:claude-haiku-4-5"]
      })
    };

    const firstResponse = await app.request(
      "http://localhost/v1/chat/completions",
      request,
      bindings
    );

    expect(firstResponse.status).toBe(200);

    currentNow = 1200;
    const secondResponse = await app.request(
      "http://localhost/v1/chat/completions",
      request,
      bindings
    );

    expect(secondResponse.status).toBe(200);

    currentNow = 1350;
    const thirdResponse = await app.request(
      "http://localhost/v1/chat/completions",
      request,
      bindings
    );

    expect(thirdResponse.status).toBe(200);
    await expect(readJson(thirdResponse)).resolves.toMatchObject({
      model: "claude-haiku-4-5"
    });
    expect(openAIAttempts).toBe(2);

    currentNow = 1450;
    const fourthResponse = await app.request(
      "http://localhost/v1/chat/completions",
      request,
      bindings
    );

    expect(fourthResponse.status).toBe(200);
    await expect(readJson(fourthResponse)).resolves.toMatchObject({
      model: "claude-haiku-4-5"
    });
    expect(openAIAttempts).toBe(3);
    expect(anthropicAttempts).toBe(4);
  });

  it("still probes one half-open target even when a closed peer exists", async () => {
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
            id: "chatcmpl_half_open_recovered",
            object: "chat.completion",
            created: 1,
            model: "gpt-4.1-mini",
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: "half-open probe recovered"
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
          id: `msg_closed_peer_${anthropicAttempts}`,
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5",
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: `closed peer ${anthropicAttempts}`
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
    let currentNow = 1000;
    const app = createApp({
      fetcher,
      now: () => currentNow
    });
    const request = {
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
    };
    const bindings = {
      ...createBindings(),
      AIRLOCK_PROVIDER_CIRCUIT_BREAKER_PERSISTENT: "true",
      AIRLOCK_PROVIDER_CIRCUIT_BREAKER_THRESHOLD: "1",
      AIRLOCK_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS: "100",
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
      request,
      bindings
    );

    expect(firstResponse.status).toBe(200);

    currentNow = 1200;
    const secondResponse = await app.request(
      "http://localhost/v1/chat/completions",
      request,
      bindings
    );

    expect(secondResponse.status).toBe(200);
    await expect(readJson(secondResponse)).resolves.toMatchObject({
      model: "gpt-4.1-mini"
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[2]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(openAIAttempts).toBe(2);
    expect(anthropicAttempts).toBe(1);
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
    const body = await readText(response);
    expect(body).toContain('"usage":{"prompt_tokens":12,"completion_tokens":8,"total_tokens":20}');
    expect(body).toContain("data: [DONE]");
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

  it("allows shaped cross-provider fallback when target-scoped shaping is configured", async () => {
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
            id: "msg_fallback",
            model: "claude-haiku-4-5",
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
        ANTHROPIC_API_KEY: "anthropic-secret",
        ANTHROPIC_BASE_URL: "https://api.anthropic.com/v1",
        AIRLOCK_REQUEST_SIGNING_SECRETS: JSON.stringify({
          "openai-signing-secret": "signing-secret",
          "anthropic-signing-secret": "signing-secret"
        }),
        AIRLOCK_MODEL_ALIASES: "assistant-default=openai:gpt-4.1-mini",
        AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
          "assistant-default": ["anthropic:claude-haiku-4-5"]
        }),
        AIRLOCK_MODEL_SHAPING: JSON.stringify({
          "assistant-default": {
            targets: {
              "openai:gpt-4.1-mini": {
                headers: {
                  "openai-beta": "responses=v1"
                },
                signing: {
                  type: "hmac_sha256_header",
                  headerName: "x-airlock-signature",
                  prefix: "sha256=",
                  secret: {
                    secretRef: "openai-signing-secret"
                  },
                  components: ["method", "path"]
                }
              },
              "anthropic:claude-haiku-4-5": {
                query: {
                  trace: "1"
                },
                signing: {
                  type: "hmac_sha256_header",
                  headerName: "x-airlock-signature",
                  prefix: "sha256=",
                  secret: {
                    secretRef: "anthropic-signing-secret"
                  },
                  components: ["method", "path", "query"]
                }
              }
            }
          }
        })
      }
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [, firstInit] = fetcher.mock.calls[0] as [string, RequestInit];
    const [, secondInit] = fetcher.mock.calls[1] as [string, RequestInit];
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://api.openai.com/v1/chat/completions"
    );
    expect(firstInit.headers).toMatchObject({
      "x-airlock-signature":
        "sha256=ec942afb045990b5e307f228067416ad70401b555da003a1f26cf86dc54e736a"
    });
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "https://api.anthropic.com/v1/messages?trace=1"
    );
    expect(secondInit.headers).toMatchObject({
      "x-airlock-signature":
        "sha256=d3ebed076d6ad0fe8756d9c0f422cc9f34d06532a12f16a19f3681d2559e221b"
    });
  });

  it("inherits shared target-scoped shaping defaults across provider attempts", async () => {
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
            id: "msg_fallback",
            model: "claude-haiku-4-5",
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
        ANTHROPIC_API_KEY: "anthropic-secret",
        ANTHROPIC_BASE_URL: "https://api.anthropic.com/v1",
        AIRLOCK_REQUEST_SIGNING_SECRETS: JSON.stringify({
          "shared-signing-secret": "signing-secret",
          "anthropic-signing-secret": "signing-secret"
        }),
        AIRLOCK_MODEL_ALIASES: "assistant-default=openai:gpt-4.1-mini",
        AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
          "assistant-default": ["anthropic:claude-haiku-4-5"]
        }),
        AIRLOCK_MODEL_SHAPING: JSON.stringify({
          "assistant-default": {
            defaults: {
              query: {
                trace: "shared"
              },
              signing: {
                type: "hmac_sha256_header",
                headerName: "x-airlock-signature",
                prefix: "sha256=",
                secret: {
                  secretRef: "shared-signing-secret"
                },
                components: ["method", "path", "query"]
              }
            },
            targets: {
              "openai:gpt-4.1-mini": {
                headers: {
                  "openai-beta": "responses=v1"
                }
              },
              "anthropic:claude-haiku-4-5": {
                query: {
                  provider: "anthropic"
                },
                signing: {
                  type: "hmac_sha256_header",
                  headerName: "x-airlock-signature",
                  prefix: "sha256=",
                  secret: {
                    secretRef: "anthropic-signing-secret"
                  },
                  components: ["method", "path", "query"]
                }
              }
            }
          }
        })
      }
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [, firstInit] = fetcher.mock.calls[0] as [string, RequestInit];
    const [, secondInit] = fetcher.mock.calls[1] as [string, RequestInit];
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://api.openai.com/v1/chat/completions?trace=shared"
    );
    expect(firstInit.headers).toMatchObject({
      "openai-beta": "responses=v1",
      "x-airlock-signature":
        "sha256=4d432e4aa3d36e0e91faa4b0ebb003ec287f8f9bd7fe4f431fb7a4828ba37018"
    });
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "https://api.anthropic.com/v1/messages?trace=shared&provider=anthropic"
    );
    expect(secondInit.headers).toMatchObject({
      "x-airlock-signature":
        "sha256=f408bb0a683e842baa465257a10d1e30231f6c0cacd925fbad5824f51cfe5cd7"
    });
  });

  it("rejects cross-provider fallback at request time when request-scoped shaping lacks a target-scoped shaping contract", async () => {
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
          messages: [{ role: "user", content: "hi" }],
          airlock: {
            requestShaping: {
              headers: {
                "openai-beta": "responses=v2"
              }
            }
          }
        })
      },
      {
        ...createBindings(),
        ANTHROPIC_API_KEY: "anthropic-secret",
        ANTHROPIC_BASE_URL: "https://api.anthropic.com/v1",
        AIRLOCK_MODEL_ALIASES: "assistant-default=openai:gpt-4.1-mini",
        AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
          "assistant-default": ["anthropic:claude-haiku-4-5"]
        })
      }
    );

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "request_invalid_request_shaping"
      }
    });
    expect(fetcher).toHaveBeenCalledTimes(0);
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

  it("routes to a healthy in-slo target when priority target selection is configured", async () => {
    const currentTime = Date.now();
    const routeFetcher = vi.fn().mockResolvedValueOnce(
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
    const breakerNamespace = createPersistentBreakerNamespace();
    breakerNamespace.seedSuccess("openai:gpt-4.1-mini", 200, currentTime - 1_000);
    breakerNamespace.seedSuccess(
      "anthropic:claude-haiku-4-5",
      5,
      currentTime - 1_000
    );

    const bindings = {
      ...createBindings(),
      ANTHROPIC_API_KEY: "anthropic-secret",
      ANTHROPIC_BASE_URL: "https://api.anthropic.com/v1",
      AIRLOCK_PROVIDER_CIRCUIT_BREAKER_PERSISTENT: "true",
      AIRLOCK_PROVIDER_CIRCUIT_BREAKER_THRESHOLD: "3",
      AIRLOCK_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS: "60000",
      AIRLOCK_PROVIDER_CIRCUIT_BREAKER: breakerNamespace,
      AIRLOCK_MODEL_ALIASES:
        "assistant-default=openai:gpt-4.1-mini,claude-haiku-4-5=anthropic:claude-haiku-4-5",
      AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
        "assistant-default": ["anthropic:claude-haiku-4-5"]
      }),
      AIRLOCK_MODEL_TARGET_SELECTION: JSON.stringify({
        "assistant-default": {
          strategy: "priority",
          latencySloMs: {
            "openai:gpt-4.1-mini": 300,
            "anthropic:claude-haiku-4-5": 1
          },
          costs: {
            "openai:gpt-4.1-mini": 10,
            "anthropic:claude-haiku-4-5": 3
          }
        }
      })
    };

    const app = createApp({ fetcher: routeFetcher });

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
          messages: [{ role: "user", content: "hi again" }]
        })
      },
      bindings
    );

    expect(response.status).toBe(200);
    expect(routeFetcher).toHaveBeenCalledTimes(1);
    expect(routeFetcher.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    await expect(readJson(response)).resolves.toMatchObject({
      model: "gpt-4.1-mini"
    });
  });

  it("keeps a recently failed recovering target behind a stable peer for priority routing", async () => {
    const currentTime = Date.now();
    const routeFetcher = vi.fn().mockResolvedValueOnce(
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
    const breakerNamespace = createPersistentBreakerNamespace();
    breakerNamespace.seedSuccess("openai:gpt-4.1-mini", 200, currentTime - 2_000);
    breakerNamespace.seedFailure("openai:gpt-4.1-mini", currentTime - 1_500);
    breakerNamespace.seedSuccess("openai:gpt-4.1-mini", 220, currentTime - 1_000);
    breakerNamespace.seedSuccess(
      "anthropic:claude-haiku-4-5",
      220,
      currentTime - 1_000
    );

    const app = createApp({ fetcher: routeFetcher });

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
          messages: [{ role: "user", content: "recover carefully" }]
        })
      },
      {
        ...createBindings(),
        ANTHROPIC_API_KEY: "anthropic-secret",
        ANTHROPIC_BASE_URL: "https://api.anthropic.com/v1",
        AIRLOCK_PROVIDER_CIRCUIT_BREAKER_PERSISTENT: "true",
        AIRLOCK_PROVIDER_CIRCUIT_BREAKER_THRESHOLD: "3",
        AIRLOCK_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS: "60000",
        AIRLOCK_PROVIDER_CIRCUIT_BREAKER: breakerNamespace,
        AIRLOCK_MODEL_ALIASES:
          "assistant-default=openai:gpt-4.1-mini,claude-haiku-4-5=anthropic:claude-haiku-4-5",
        AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
          "assistant-default": ["anthropic:claude-haiku-4-5"]
        }),
        AIRLOCK_MODEL_TARGET_SELECTION: JSON.stringify({
          "assistant-default": {
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
        })
      }
    );

    expect(response.status).toBe(200);
    expect(routeFetcher).toHaveBeenCalledTimes(1);
    expect(routeFetcher.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/messages");
    await expect(readJson(response)).resolves.toMatchObject({
      model: "claude-haiku-4-5"
    });
  });

  it("treats stale latency memory as neutral when applying priority routing in the app", async () => {
    const currentTime = Date.now();
    const routeFetcher = vi.fn().mockResolvedValueOnce(
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
    const breakerNamespace = createPersistentBreakerNamespace();
    breakerNamespace.seedSuccess(
      "openai:gpt-4.1-mini",
      120,
      currentTime - 60_000
    );
    breakerNamespace.seedSuccess(
      "anthropic:claude-haiku-4-5",
      200,
      currentTime - 1_000
    );

    const app = createApp({ fetcher: routeFetcher });

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
          messages: [{ role: "user", content: "prefer fresh latency" }]
        })
      },
      {
        ...createBindings(),
        ANTHROPIC_API_KEY: "anthropic-secret",
        ANTHROPIC_BASE_URL: "https://api.anthropic.com/v1",
        AIRLOCK_PROVIDER_CIRCUIT_BREAKER_PERSISTENT: "true",
        AIRLOCK_PROVIDER_CIRCUIT_BREAKER_THRESHOLD: "3",
        AIRLOCK_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS: "60000",
        AIRLOCK_PROVIDER_CIRCUIT_BREAKER: breakerNamespace,
        AIRLOCK_MODEL_ALIASES:
          "assistant-default=openai:gpt-4.1-mini,claude-haiku-4-5=anthropic:claude-haiku-4-5",
        AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
          "assistant-default": ["anthropic:claude-haiku-4-5"]
        }),
        AIRLOCK_MODEL_TARGET_SELECTION: JSON.stringify({
          "assistant-default": {
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
        })
      }
    );

    expect(response.status).toBe(200);
    expect(routeFetcher).toHaveBeenCalledTimes(1);
    expect(routeFetcher.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/messages");
    await expect(readJson(response)).resolves.toMatchObject({
      model: "claude-haiku-4-5"
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
      output_text: "hello there",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "hello there"
            }
          ]
        }
      ],
      usage: {
        input_tokens: 12,
        output_tokens: 8,
        total_tokens: 20
      }
    });
  });

  it("accepts openai responses text-block input and flattens it for upstream chat execution", async () => {
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
          stream: false,
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: "hello"
                },
                {
                  type: "input_text",
                  text: "there"
                }
              ]
            }
          ]
        })
      },
      createBindings()
    );

    expect(response.status).toBe(200);
    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      messages: [{ role: "user", content: "hello\nthere" }]
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
          stop_sequence: null,
          usage: {
            input_tokens: 12,
            output_tokens: 8
          },
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
      stop_sequence: null,
      usage: {
        input_tokens: 12,
        output_tokens: 8
      },
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
                  'event: message_delta\ndata: {"delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"input_tokens":12,"output_tokens":8}}\n\n',
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
    expect(body).toContain("event: message_delta");
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
