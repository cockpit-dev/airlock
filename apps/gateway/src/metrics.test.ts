import { describe, it, expect } from "vitest";
import { GatewayMetricsCollector } from "./metrics.js";

describe("GatewayMetricsCollector", () => {
  it("returns empty snapshot when no data recorded", () => {
    const collector = new GatewayMetricsCollector(10_000, 10);
    const snapshot = collector.snapshot();

    expect(snapshot.requests).toBe(0);
    expect(snapshot.errors).toBe(0);
    expect(snapshot.errorRate).toBe(0);
    expect(snapshot.avgDurationMs).toBe(0);
    expect(snapshot.statusCodes).toEqual({});
    expect(snapshot.byRoute).toEqual({});
  });

  it("records a single request", () => {
    const collector = new GatewayMetricsCollector(10_000, 10);
    collector.record({
      routePath: "/v1/chat/completions",
      statusCode: 200,
      durationMs: 150
    });

    const snapshot = collector.snapshot();
    expect(snapshot.requests).toBe(1);
    expect(snapshot.errors).toBe(0);
    expect(snapshot.errorRate).toBe(0);
    expect(snapshot.avgDurationMs).toBe(150);
    expect(snapshot.statusCodes).toEqual({ 200: 1 });
    expect(snapshot.byRoute["/v1/chat/completions"]).toEqual({
      requests: 1,
      errors: 0,
      avgDurationMs: 150
    });
  });

  it("counts 4xx and 5xx as errors", () => {
    const collector = new GatewayMetricsCollector(10_000, 10);
    collector.record({ routePath: "/v1/chat/completions", statusCode: 200, durationMs: 100 });
    collector.record({ routePath: "/v1/chat/completions", statusCode: 400, durationMs: 50 });
    collector.record({ routePath: "/v1/chat/completions", statusCode: 500, durationMs: 200 });

    const snapshot = collector.snapshot();
    expect(snapshot.requests).toBe(3);
    expect(snapshot.errors).toBe(2);
    expect(snapshot.errorRate).toBeCloseTo(0.6667, 3);
    expect(snapshot.avgDurationMs).toBe(117);
    expect(snapshot.statusCodes).toEqual({ 200: 1, 400: 1, 500: 1 });
  });

  it("aggregates metrics by route", () => {
    const collector = new GatewayMetricsCollector(10_000, 10);
    collector.record({ routePath: "/v1/chat/completions", statusCode: 200, durationMs: 100 });
    collector.record({ routePath: "/v1/messages", statusCode: 200, durationMs: 200 });
    collector.record({ routePath: "/v1/responses", statusCode: 200, durationMs: 300 });
    collector.record({ routePath: "/v1/chat/completions", statusCode: 500, durationMs: 150 });

    const snapshot = collector.snapshot();
    expect(snapshot.requests).toBe(4);
    expect(snapshot.byRoute["/v1/chat/completions"]).toEqual({
      requests: 2,
      errors: 1,
      avgDurationMs: 125
    });
    expect(snapshot.byRoute["/v1/messages"]).toEqual({
      requests: 1,
      errors: 0,
      avgDurationMs: 200
    });
    expect(snapshot.byRoute["/v1/responses"]).toEqual({
      requests: 1,
      errors: 0,
      avgDurationMs: 300
    });
  });

  it("expires data outside the window", () => {
    const collector = new GatewayMetricsCollector(10_000, 10);
    const now = Date.now();

    collector.record(
      { routePath: "/v1/chat/completions", statusCode: 200, durationMs: 100 },
      now
    );

    // Within window
    const withinWindow = collector.snapshot(now + 5_000);
    expect(withinWindow.requests).toBe(1);

    // Past window
    const pastWindow = collector.snapshot(now + 15_000);
    expect(pastWindow.requests).toBe(0);
    expect(pastWindow.errors).toBe(0);
  });

  it("handles partial window overlap", () => {
    const collector = new GatewayMetricsCollector(10_000, 10);
    const now = Date.now();

    collector.record(
      { routePath: "/v1/chat/completions", statusCode: 200, durationMs: 100 },
      now
    );
    collector.record(
      { routePath: "/v1/messages", statusCode: 200, durationMs: 200 },
      now + 6_000
    );

    // First request expired, second still visible
    const snapshot = collector.snapshot(now + 12_000);
    expect(snapshot.requests).toBe(1);
    expect(snapshot.byRoute["/v1/messages"]).toBeDefined();
    expect(snapshot.byRoute["/v1/chat/completions"]).toBeUndefined();
  });

  it("overwrites stale buckets on new writes", () => {
    const collector = new GatewayMetricsCollector(10_000, 10);
    const now = Date.now();

    collector.record(
      { routePath: "/v1/chat/completions", statusCode: 200, durationMs: 100 },
      now
    );

    // Write to the same bucket index after a full cycle
    collector.record(
      { routePath: "/v1/messages", statusCode: 200, durationMs: 200 },
      now + 10_000
    );

    const snapshot = collector.snapshot(now + 10_500);
    expect(snapshot.requests).toBe(1);
    expect(snapshot.byRoute["/v1/messages"]).toBeDefined();
  });

  it("computes average duration correctly", () => {
    const collector = new GatewayMetricsCollector(10_000, 10);
    collector.record({ routePath: "/v1/chat/completions", statusCode: 200, durationMs: 100 });
    collector.record({ routePath: "/v1/chat/completions", statusCode: 200, durationMs: 200 });
    collector.record({ routePath: "/v1/chat/completions", statusCode: 200, durationMs: 300 });

    const snapshot = collector.snapshot();
    expect(snapshot.avgDurationMs).toBe(200);
  });

  it("reset clears all data", () => {
    const collector = new GatewayMetricsCollector(10_000, 10);
    collector.record({ routePath: "/v1/chat/completions", statusCode: 200, durationMs: 100 });
    collector.reset();

    const snapshot = collector.snapshot();
    expect(snapshot.requests).toBe(0);
    expect(snapshot.errors).toBe(0);
    expect(snapshot.statusCodes).toEqual({});
    expect(snapshot.byRoute).toEqual({});
  });

  it("includes window metadata in snapshot", () => {
    const collector = new GatewayMetricsCollector(60_000, 12);
    const snapshot = collector.snapshot();

    expect(snapshot.window.durationMs).toBe(60_000);
    expect(snapshot.window.collectedSince).toBeDefined();
  });
});
