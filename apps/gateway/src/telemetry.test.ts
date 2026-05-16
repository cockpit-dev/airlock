import { describe, expect, it, vi } from "vitest";

import type { GatewayRequestTelemetryEvent } from "@airlock/telemetry";

import {
  createGatewayTelemetrySink,
  processTelemetryQueueBatch
} from "./telemetry.js";

type GatewaySuccessTelemetryEvent = Extract<
  GatewayRequestTelemetryEvent,
  { outcome: "success" }
>;

function createSuccessEvent(
  overrides: Partial<GatewaySuccessTelemetryEvent> = {}
): GatewaySuccessTelemetryEvent {
  return {
    kind: "gateway_request",
    occurredAt: "2026-05-14T00:00:00.000Z",
    requestId: "req_123",
    mode: "free",
    routePath: "/v1/chat/completions",
    stream: false,
    durationMs: 20,
    statusCode: 200,
    outcome: "success",
    ...overrides
  };
}

describe("createGatewayTelemetrySink", () => {
  it("can sample out free-mode success events", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const sink = createGatewayTelemetrySink(
      { send },
      {
        freeSuccessSampleRate: 0,
        scaleSuccessSampleRate: 1
      }
    );

    await sink.emit(createSuccessEvent());

    expect(send).not.toHaveBeenCalled();
  });

  it("retains scale-mode success events", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const sink = createGatewayTelemetrySink(
      { send },
      {
        freeSuccessSampleRate: 0,
        scaleSuccessSampleRate: 1
      }
    );

    await sink.emit(
      createSuccessEvent({
        mode: "scale",
        requestId: "req_scale"
      })
    );

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("retains error events even when success sample rate is zero", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const sink = createGatewayTelemetrySink(
      { send },
      {
        freeSuccessSampleRate: 0,
        scaleSuccessSampleRate: 0
      }
    );

    await sink.emit({
      kind: "gateway_request",
      occurredAt: "2026-05-14T00:00:00.000Z",
      requestId: "req_error",
      mode: "free",
      routePath: "/v1/chat/completions",
      stream: false,
      durationMs: 20,
      statusCode: 429,
      outcome: "error",
      errorCode: "provider_upstream_error",
      errorCategory: "provider",
      retryable: true
    });

    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("processTelemetryQueueBatch", () => {
  it("acks successful messages after analytics-engine writes", async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    const writeDataPoint = vi.fn();

    await processTelemetryQueueBatch(
      {
        messages: [
          {
            body: createSuccessEvent(),
            ack,
            retry
          }
        ]
      },
      {
        writeDataPoint
      }
    );

    expect(writeDataPoint).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it("acks messages that include routing signal fields", async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    const writeDataPoint = vi.fn();

    await processTelemetryQueueBatch(
      {
        messages: [
          {
            body: createSuccessEvent({
              routingStrategy: "health_priority",
              attemptCount: 2,
              primaryTargetOpen: true
            }),
            ack,
            retry
          }
        ]
      },
      {
        writeDataPoint
      }
    );

    expect(writeDataPoint).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it("retries messages when analytics-engine writing fails", async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    const writeDataPoint = vi.fn().mockImplementation(() => {
      throw new Error("analytics failed");
    });

    await processTelemetryQueueBatch(
      {
        messages: [
          {
            body: createSuccessEvent(),
            ack,
            retry
          }
        ]
      },
      {
        writeDataPoint
      }
    );

    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
