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
      blobs: ["success", "openai", "gpt-4.1-mini", "gpt-4.1-mini", "gak_1"],
      doubles: [42, 200, 0, 12, 8, 20]
    });
  });
});
