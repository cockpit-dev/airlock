import { describe, expect, it, vi } from "vitest";

import {
  createAnalyticsEngineTelemetryDataPoint,
  createQueueTelemetrySink,
  emitTelemetryEvent,
  gatewayRequestTelemetryEventSchema,
  shouldEnqueueTelemetryEvent,
  type TelemetrySink
} from "./index.js";

describe("gatewayRequestTelemetryEventSchema", () => {
  it("accepts a success request event with usage metadata", () => {
    const parsed = gatewayRequestTelemetryEventSchema.parse({
      kind: "gateway_request",
      occurredAt: "2026-05-14T00:00:00.000Z",
      requestId: "req_123",
      mode: "free",
      routePath: "/v1/chat/completions",
      stream: false,
      durationMs: 123,
      statusCode: 200,
      gatewayKeyId: "key_prod",
      externalModel: "gpt-4.1-mini",
      provider: "openai",
      providerModel: "gpt-4.1-mini",
      fallbackUsed: false,
      outcome: "success",
      usage: {
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20
      }
    });

    expect(parsed.outcome).toBe("success");
    expect(parsed.usage?.totalTokens).toBe(20);
  });

  it("rejects error events that omit error metadata", () => {
    expect(() =>
      gatewayRequestTelemetryEventSchema.parse({
        kind: "gateway_request",
        occurredAt: "2026-05-14T00:00:00.000Z",
        requestId: "req_123",
        mode: "free",
        routePath: "/v1/chat/completions",
        stream: false,
        durationMs: 12,
        statusCode: 403,
        outcome: "error"
      })
    ).toThrow();
  });

  it("accepts optional routing signal fields on success events", () => {
    const parsed = gatewayRequestTelemetryEventSchema.parse({
      kind: "gateway_request",
      occurredAt: "2026-05-16T00:00:00.000Z",
      requestId: "req_routing",
      mode: "scale",
      routePath: "/v1/chat/completions",
      stream: false,
      durationMs: 200,
      statusCode: 200,
      outcome: "success",
      routingStrategy: "health_priority",
      attemptCount: 2,
      primaryTargetOpen: true
    });

    expect(parsed.outcome).toBe("success");
    if (parsed.outcome === "success") {
      expect(parsed.routingStrategy).toBe("health_priority");
      expect(parsed.attemptCount).toBe(2);
      expect(parsed.primaryTargetOpen).toBe(true);
    }
  });

  it("accepts optional routing signal fields on error events", () => {
    const parsed = gatewayRequestTelemetryEventSchema.parse({
      kind: "gateway_request",
      occurredAt: "2026-05-16T00:00:00.000Z",
      requestId: "req_routing_err",
      mode: "free",
      routePath: "/v1/responses",
      stream: false,
      durationMs: 50,
      statusCode: 429,
      outcome: "error",
      errorCode: "provider_upstream_error",
      errorCategory: "provider",
      retryable: true,
      routingStrategy: "weighted",
      attemptCount: 3,
      primaryTargetOpen: false
    });

    expect(parsed.outcome).toBe("error");
    if (parsed.outcome === "error") {
      expect(parsed.routingStrategy).toBe("weighted");
      expect(parsed.attemptCount).toBe(3);
      expect(parsed.primaryTargetOpen).toBe(false);
    }
  });

  it("rejects attemptCount below 1", () => {
    expect(() =>
      gatewayRequestTelemetryEventSchema.parse({
        kind: "gateway_request",
        occurredAt: "2026-05-16T00:00:00.000Z",
        requestId: "req_bad_attempt",
        mode: "free",
        routePath: "/v1/chat/completions",
        stream: false,
        durationMs: 10,
        statusCode: 200,
        outcome: "success",
        attemptCount: 0
      })
    ).toThrow();
  });

  it("rejects empty routingStrategy strings", () => {
    expect(() =>
      gatewayRequestTelemetryEventSchema.parse({
        kind: "gateway_request",
        occurredAt: "2026-05-16T00:00:00.000Z",
        requestId: "req_bad_strategy",
        mode: "free",
        routePath: "/v1/chat/completions",
        stream: false,
        durationMs: 10,
        statusCode: 200,
        outcome: "success",
        routingStrategy: ""
      })
    ).toThrow();
  });
});

describe("emitTelemetryEvent", () => {
  it("delivers valid events to the sink", async () => {
    const events: unknown[] = [];
    const sink: TelemetrySink = {
      async emit(event) {
        await Promise.resolve();
        events.push(event);
      }
    };

    await emitTelemetryEvent(sink, {
      kind: "gateway_request",
      occurredAt: "2026-05-14T00:00:00.000Z",
      requestId: "req_123",
      mode: "free",
      routePath: "/v1/responses",
      stream: false,
      durationMs: 55,
      statusCode: 200,
      outcome: "success"
    });

    expect(events).toHaveLength(1);
  });

  it("swallows sink failures", async () => {
    const sink: TelemetrySink = {
      emit: vi.fn().mockRejectedValue(new Error("sink failed"))
    };

    await expect(
      emitTelemetryEvent(sink, {
        kind: "gateway_request",
        occurredAt: "2026-05-14T00:00:00.000Z",
        requestId: "req_123",
        mode: "free",
        routePath: "/v1/messages",
        stream: true,
        durationMs: 88,
        statusCode: 200,
        outcome: "success"
      })
    ).resolves.toBeUndefined();
  });
});

describe("shouldEnqueueTelemetryEvent", () => {
  const successEvent = {
    kind: "gateway_request" as const,
    occurredAt: "2026-05-14T00:00:00.000Z",
    requestId: "req_123",
    mode: "free" as const,
    routePath: "/v1/chat/completions",
    stream: false,
    durationMs: 12,
    statusCode: 200,
    outcome: "success" as const
  };

  it("deterministically samples free-mode success events", () => {
    expect(
      shouldEnqueueTelemetryEvent(successEvent, {
        freeSuccessSampleRate: 0,
        scaleSuccessSampleRate: 1
      })
    ).toBe(false);
    expect(
      shouldEnqueueTelemetryEvent(successEvent, {
        freeSuccessSampleRate: 1,
        scaleSuccessSampleRate: 1
      })
    ).toBe(true);
  });

  it("never samples out error events", () => {
    expect(
      shouldEnqueueTelemetryEvent(
        {
          ...successEvent,
          outcome: "error",
          errorCode: "provider_upstream_error",
          errorCategory: "provider",
          retryable: true
        },
        {
          freeSuccessSampleRate: 0,
          scaleSuccessSampleRate: 0
        }
      )
    ).toBe(true);
  });
});

describe("createQueueTelemetrySink", () => {
  it("enqueues selected events to the queue producer", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const sink = createQueueTelemetrySink(
      {
        send
      },
      {
        freeSuccessSampleRate: 1,
        scaleSuccessSampleRate: 1
      }
    );

    await sink.emit({
      kind: "gateway_request",
      occurredAt: "2026-05-14T00:00:00.000Z",
      requestId: "req_123",
      mode: "free",
      routePath: "/v1/chat/completions",
      stream: false,
      durationMs: 20,
      statusCode: 200,
      outcome: "success"
    });

    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("createAnalyticsEngineTelemetryDataPoint", () => {
  it("maps telemetry events into analytics-engine-friendly datapoints", () => {
    expect(
      createAnalyticsEngineTelemetryDataPoint({
        kind: "gateway_request",
        occurredAt: "2026-05-14T00:00:00.000Z",
        requestId: "req_123",
        mode: "scale",
        routePath: "/v1/chat/completions",
        stream: false,
        durationMs: 42,
        statusCode: 200,
        provider: "openai",
        providerModel: "gpt-4.1-mini",
        externalModel: "gpt-4.1-mini",
        fallbackUsed: false,
        gatewayKeyId: "gak_1",
        outcome: "success",
        usage: {
          inputTokens: 12,
          outputTokens: 8,
          totalTokens: 20
        }
      })
    ).toMatchObject({
      indexes: ["gateway_request", "scale", "/v1/chat/completions"],
      blobs: ["success", "openai", "gpt-4.1-mini", "gpt-4.1-mini", "gak_1", ""],
      doubles: [42, 200, 0, 12, 8, 20, 0, 0, 0, 0]
    });
  });

  it("includes routing signal columns when present", () => {
    const dataPoint = createAnalyticsEngineTelemetryDataPoint({
      kind: "gateway_request",
      occurredAt: "2026-05-16T00:00:00.000Z",
      requestId: "req_routing_signals",
      mode: "scale",
      routePath: "/v1/responses",
      stream: false,
      durationMs: 150,
      statusCode: 200,
      provider: "anthropic",
      providerModel: "claude-haiku-4-5",
      externalModel: "assistant-default",
      fallbackUsed: true,
      gatewayKeyId: "gak_routing",
      outcome: "success",
      routingStrategy: "health_priority",
      attemptCount: 2,
      primaryTargetOpen: true,
      usage: {
        inputTokens: 50,
        outputTokens: 30,
        totalTokens: 80
      }
    });

    expect(dataPoint.blobs).toContain("health_priority");
    expect(dataPoint.doubles).toContain(2);
    expect(dataPoint.doubles).toContain(1);
  });

  it("uses defaults when routing signals are absent", () => {
    const dataPoint = createAnalyticsEngineTelemetryDataPoint({
      kind: "gateway_request",
      occurredAt: "2026-05-16T00:00:00.000Z",
      requestId: "req_no_routing",
      mode: "free",
      routePath: "/v1/chat/completions",
      stream: false,
      durationMs: 10,
      statusCode: 200,
      outcome: "success"
    });

    expect(dataPoint.blobs).toContain("");
    expect(dataPoint.doubles).toContain(0);
  });

  it("includes timeout budget columns when present", () => {
    const dataPoint = createAnalyticsEngineTelemetryDataPoint({
      kind: "gateway_request",
      occurredAt: "2026-05-16T00:00:00.000Z",
      requestId: "req_timeout_budget",
      mode: "scale",
      routePath: "/v1/chat/completions",
      stream: false,
      durationMs: 4500,
      statusCode: 200,
      outcome: "success",
      timeoutBudgetMs: 30000,
      timeoutBudgetRemainingMs: 25500
    });

    expect(dataPoint.doubles).toContain(30000);
    expect(dataPoint.doubles).toContain(25500);
  });
});
