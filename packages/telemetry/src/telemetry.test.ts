import { describe, expect, it, vi } from "vitest";

import {
  emitTelemetryEvent,
  gatewayRequestTelemetryEventSchema,
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
