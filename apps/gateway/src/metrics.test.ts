import { describe, it, expect } from "vitest";
import {
  GatewayMetricsCollector,
  GatewayMetricsDurableObject
} from "./metrics.js";
import type { DurableObjectStateLike } from "./durable-object-state.js";

function createMockState(): {
  state: DurableObjectStateLike;
  storage: Map<string, unknown>;
} {
  const storage = new Map<string, unknown>();
  const state: DurableObjectStateLike = {
    storage: {
      get<T>(key: string): Promise<T | undefined> {
        return Promise.resolve(storage.get(key) as T | undefined);
      },
      put<T>(key: string, value: T): Promise<void> {
        storage.set(key, value);
        return Promise.resolve();
      },
      delete(key: string): Promise<boolean | void> {
        storage.delete(key);
        return Promise.resolve(true);
      }
    }
  };
  return { state, storage };
}

function createRequest(method: string, path: string, body?: unknown): Request {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return new Request(`https://airlock.internal${path}`, init);
}

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
      durationMs: 150,
      protocol: "openai_chat",
      providerId: "glm",
      modelId: "glm-5.1",
      usage: {
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20
      }
    });

    const snapshot = collector.snapshot();
    expect(snapshot.requests).toBe(1);
    expect(snapshot.errors).toBe(0);
    expect(snapshot.errorRate).toBe(0);
    expect(snapshot.avgDurationMs).toBe(150);
    expect(snapshot.inputTokens).toBe(12);
    expect(snapshot.outputTokens).toBe(8);
    expect(snapshot.totalTokens).toBe(20);
    expect(snapshot.usageRequestCount).toBe(1);
    expect(snapshot.usageCoverage).toBe(1);
    expect(snapshot.statusCodes).toEqual({ 200: 1 });
    expect(snapshot.byRoute["/v1/chat/completions"]).toEqual({
      requests: 1,
      errors: 0,
      avgDurationMs: 150,
      streamCount: 0,
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
      usageRequestCount: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cachedInputTokens: 0
    });
    expect(snapshot.byProvider.glm?.totalTokens).toBe(20);
    expect(snapshot.byModel["glm-5.1"]?.totalTokens).toBe(20);
    expect(snapshot.byProtocol.openai_chat?.totalTokens).toBe(20);
  });

  it("counts 4xx and 5xx as errors", () => {
    const collector = new GatewayMetricsCollector(10_000, 10);
    collector.record({
      routePath: "/v1/chat/completions",
      statusCode: 200,
      durationMs: 100
    });
    collector.record({
      routePath: "/v1/chat/completions",
      statusCode: 400,
      durationMs: 50
    });
    collector.record({
      routePath: "/v1/chat/completions",
      statusCode: 500,
      durationMs: 200
    });

    const snapshot = collector.snapshot();
    expect(snapshot.requests).toBe(3);
    expect(snapshot.errors).toBe(2);
    expect(snapshot.errorRate).toBeCloseTo(0.6667, 3);
    expect(snapshot.avgDurationMs).toBe(117);
    expect(snapshot.statusCodes).toEqual({ 200: 1, 400: 1, 500: 1 });
  });

  it("aggregates metrics by route", () => {
    const collector = new GatewayMetricsCollector(10_000, 10);
    collector.record({
      routePath: "/v1/chat/completions",
      statusCode: 200,
      durationMs: 100
    });
    collector.record({
      routePath: "/v1/messages",
      statusCode: 200,
      durationMs: 200
    });
    collector.record({
      routePath: "/v1/responses",
      statusCode: 200,
      durationMs: 300
    });
    collector.record({
      routePath: "/v1/chat/completions",
      statusCode: 500,
      durationMs: 150
    });

    const snapshot = collector.snapshot();
    expect(snapshot.requests).toBe(4);
    expect(snapshot.byRoute["/v1/chat/completions"]).toEqual({
      requests: 2,
      errors: 1,
      avgDurationMs: 125,
      streamCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      usageRequestCount: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cachedInputTokens: 0
    });
    expect(snapshot.byRoute["/v1/messages"]).toEqual({
      requests: 1,
      errors: 0,
      avgDurationMs: 200,
      streamCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      usageRequestCount: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cachedInputTokens: 0
    });
    expect(snapshot.byRoute["/v1/responses"]).toEqual({
      requests: 1,
      errors: 0,
      avgDurationMs: 300,
      streamCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      usageRequestCount: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cachedInputTokens: 0
    });
  });

  it("aggregates usage by provider, model, and protocol", () => {
    const collector = new GatewayMetricsCollector(10_000, 10);

    collector.record({
      routePath: "/v1/chat/completions",
      statusCode: 200,
      durationMs: 120,
      protocol: "openai_chat",
      providerId: "glm",
      modelId: "glm-5.1",
      isStream: true,
      usage: {
        inputTokens: 30,
        outputTokens: 12,
        totalTokens: 42
      }
    });
    collector.record({
      routePath: "/v1/responses",
      statusCode: 200,
      durationMs: 180,
      protocol: "openai_responses",
      providerId: "glm",
      modelId: "glm-5.1",
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15
      }
    });

    const snapshot = collector.snapshot();
    expect(snapshot.totalTokens).toBe(57);
    expect(snapshot.byProvider.glm).toEqual({
      requests: 2,
      errors: 0,
      avgDurationMs: 150,
      streamCount: 1,
      inputTokens: 40,
      outputTokens: 17,
      totalTokens: 57,
      usageRequestCount: 2,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cachedInputTokens: 0
    });
    expect(snapshot.byModel["glm-5.1"]).toEqual({
      requests: 2,
      errors: 0,
      avgDurationMs: 150,
      streamCount: 1,
      inputTokens: 40,
      outputTokens: 17,
      totalTokens: 57,
      usageRequestCount: 2,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cachedInputTokens: 0
    });
    expect(snapshot.byProtocol.openai_chat).toEqual({
      requests: 1,
      errors: 0,
      avgDurationMs: 120,
      streamCount: 1,
      inputTokens: 30,
      outputTokens: 12,
      totalTokens: 42,
      usageRequestCount: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cachedInputTokens: 0
    });
    expect(snapshot.byProtocol.openai_responses).toEqual({
      requests: 1,
      errors: 0,
      avgDurationMs: 180,
      streamCount: 0,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      usageRequestCount: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cachedInputTokens: 0
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
    collector.record({
      routePath: "/v1/chat/completions",
      statusCode: 200,
      durationMs: 100
    });
    collector.record({
      routePath: "/v1/chat/completions",
      statusCode: 200,
      durationMs: 200
    });
    collector.record({
      routePath: "/v1/chat/completions",
      statusCode: 200,
      durationMs: 300
    });

    const snapshot = collector.snapshot();
    expect(snapshot.avgDurationMs).toBe(200);
  });

  it("reset clears all data", () => {
    const collector = new GatewayMetricsCollector(10_000, 10);
    collector.record({
      routePath: "/v1/chat/completions",
      statusCode: 200,
      durationMs: 100
    });
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

  it("aggregates per-key and key-model token usage with cache dimensions", () => {
    const collector = new GatewayMetricsCollector(10_000, 10);

    collector.record({
      routePath: "/v1/chat/completions",
      statusCode: 200,
      durationMs: 120,
      protocol: "openai_chat",
      providerId: "openai",
      modelId: "gpt-5.5",
      keyId: "key_a",
      usage: {
        inputTokens: 100,
        outputTokens: 40,
        totalTokens: 140,
        cacheReadTokens: 25,
        cacheWriteTokens: 10,
        cachedInputTokens: 25
      }
    });
    collector.record({
      routePath: "/v1/responses",
      statusCode: 200,
      durationMs: 180,
      protocol: "openai_responses",
      providerId: "openai",
      modelId: "gpt-5.4",
      keyId: "key_a",
      usage: {
        inputTokens: 80,
        outputTokens: 30,
        totalTokens: 110,
        cacheReadTokens: 5,
        cacheWriteTokens: 20,
        cachedInputTokens: 5
      }
    });

    const snapshot = collector.snapshot();
    expect(snapshot.cacheReadTokens).toBe(30);
    expect(snapshot.cacheWriteTokens).toBe(30);
    expect(snapshot.cachedInputTokens).toBe(30);
    expect(snapshot.byKey.key_a).toEqual({
      requests: 2,
      errors: 0,
      avgDurationMs: 150,
      streamCount: 0,
      inputTokens: 180,
      outputTokens: 70,
      totalTokens: 250,
      usageRequestCount: 2,
      cacheReadTokens: 30,
      cacheWriteTokens: 30,
      cachedInputTokens: 30
    });
    expect(snapshot.byKeyModel["key_a::gpt-5.5"]).toEqual({
      keyId: "key_a",
      modelId: "gpt-5.5",
      requests: 1,
      errors: 0,
      avgDurationMs: 120,
      streamCount: 0,
      inputTokens: 100,
      outputTokens: 40,
      totalTokens: 140,
      usageRequestCount: 1,
      cacheReadTokens: 25,
      cacheWriteTokens: 10,
      cachedInputTokens: 25
    });
    expect(snapshot.byKeyModel["key_a::gpt-5.4"]).toEqual({
      keyId: "key_a",
      modelId: "gpt-5.4",
      requests: 1,
      errors: 0,
      avgDurationMs: 180,
      streamCount: 0,
      inputTokens: 80,
      outputTokens: 30,
      totalTokens: 110,
      usageRequestCount: 1,
      cacheReadTokens: 5,
      cacheWriteTokens: 20,
      cachedInputTokens: 5
    });
  });
});

describe("GatewayMetricsDurableObject", () => {
  it("records metrics and returns a snapshot", async () => {
    const { state } = createMockState();
    const do_ = new GatewayMetricsDurableObject(state);

    const recordResponse = await do_.fetch(
      createRequest("POST", "/record", {
        record: {
          routePath: "/v1/chat/completions",
          statusCode: 200,
          durationMs: 123,
          protocol: "openai_chat",
          providerId: "glm",
          modelId: "glm/glm-5.1",
          usage: {
            inputTokens: 12,
            outputTokens: 8,
            totalTokens: 20
          }
        },
        now: 1_700_000_000_000
      })
    );

    expect(recordResponse.status).toBe(202);

    const snapshotResponse = await do_.fetch(
      createRequest("GET", "/snapshot?now=1700000000000")
    );
    expect(snapshotResponse.status).toBe(200);

    const snapshot = (await snapshotResponse.json()) as {
      requests: number;
      totalTokens: number;
      byRoute: Record<string, { totalTokens: number }>;
      byProvider: Record<string, { totalTokens: number }>;
      byModel: Record<string, { totalTokens: number }>;
      byProtocol: Record<string, { totalTokens: number }>;
    };

    expect(snapshot.requests).toBe(1);
    expect(snapshot.totalTokens).toBe(20);
    expect(snapshot.byRoute["/v1/chat/completions"]?.totalTokens).toBe(20);
    expect(snapshot.byProvider.glm?.totalTokens).toBe(20);
    expect(snapshot.byModel["glm/glm-5.1"]?.totalTokens).toBe(20);
    expect(snapshot.byProtocol.openai_chat?.totalTokens).toBe(20);
  });

  it("reloads persisted collector state across durable object instances", async () => {
    const { state } = createMockState();

    const first = new GatewayMetricsDurableObject(state);
    await first.fetch(
      createRequest("POST", "/record", {
        record: {
          routePath: "/v1/responses",
          statusCode: 200,
          durationMs: 40,
          protocol: "openai_responses"
        },
        now: 1_700_000_000_000
      })
    );

    const second = new GatewayMetricsDurableObject(state);
    const snapshotResponse = await second.fetch(
      createRequest("GET", "/snapshot?now=1700000000000")
    );
    expect(snapshotResponse.status).toBe(200);

    const snapshot = (await snapshotResponse.json()) as {
      requests: number;
      byRoute: Record<string, { requests: number }>;
    };

    expect(snapshot.requests).toBe(1);
    expect(snapshot.byRoute["/v1/responses"]?.requests).toBe(1);
  });

  it("normalizes persisted legacy collector state without cache fields", async () => {
    const { state, storage } = createMockState();

    storage.set("metrics_state", {
      windowMs: 60_000,
      bucketCount: 1,
      buckets: [
        {
          timestamp: Math.floor(1_700_000_000_000 / 60_000),
          requests: 1,
          errors: 0,
          totalDurationMs: 125,
          streamCount: 0,
          inputTokens: 7,
          outputTokens: 5,
          totalTokens: 12,
          usageRequestCount: 1,
          statusCodes: [[200, 1]],
          byRoute: [
            [
              "/v1/chat/completions",
              {
                requests: 1,
                errors: 0,
                totalDurationMs: 125,
                streamCount: 0,
                inputTokens: 7,
                outputTokens: 5,
                totalTokens: 12,
                usageRequestCount: 1
              }
            ]
          ],
          byProvider: [],
          byModel: [],
          byProtocol: [],
          byKey: [],
          byKeyModel: []
        }
      ]
    });

    const do_ = new GatewayMetricsDurableObject(state);
    const snapshotResponse = await do_.fetch(
      createRequest("GET", "/snapshot?now=1700000000000")
    );
    expect(snapshotResponse.status).toBe(200);

    const snapshot = (await snapshotResponse.json()) as {
      requests: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      cachedInputTokens: number;
      byRoute: Record<
        string,
        {
          cacheReadTokens: number;
          cacheWriteTokens: number;
          cachedInputTokens: number;
        }
      >;
    };

    expect(snapshot.requests).toBe(1);
    expect(snapshot.cacheReadTokens).toBe(0);
    expect(snapshot.cacheWriteTokens).toBe(0);
    expect(snapshot.cachedInputTokens).toBe(0);
    expect(snapshot.byRoute["/v1/chat/completions"]).toMatchObject({
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cachedInputTokens: 0
    });
  });
});
