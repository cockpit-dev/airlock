import type { DurableObjectStateLike } from "./durable-object-state.js";
import type { GatewayBindings } from "./env.js";

export interface MetricsRecord {
  routePath: string;
  statusCode: number;
  durationMs: number;
  keyId?: string;
  providerId?: string;
  modelId?: string;
  isStream?: boolean;
  protocol?: string;
  usageOnly?: boolean;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    cachedInputTokens?: number;
  };
}

export interface RouteMetricsSnapshot {
  requests: number;
  errors: number;
  avgDurationMs: number;
  streamCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usageRequestCount: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cachedInputTokens: number;
}

export interface ProviderMetricsSnapshot {
  requests: number;
  errors: number;
  avgDurationMs: number;
  streamCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usageRequestCount: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cachedInputTokens: number;
}

export interface ModelMetricsSnapshot {
  requests: number;
  errors: number;
  avgDurationMs: number;
  streamCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usageRequestCount: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cachedInputTokens: number;
}

export interface ProtocolMetricsSnapshot {
  requests: number;
  errors: number;
  avgDurationMs: number;
  streamCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usageRequestCount: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cachedInputTokens: number;
}

export interface KeyMetricsSnapshot {
  requests: number;
  errors: number;
  avgDurationMs: number;
  streamCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usageRequestCount: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cachedInputTokens: number;
}

export interface KeyModelMetricsSnapshot extends KeyMetricsSnapshot {
  keyId: string;
  modelId: string;
}

export interface MetricsSnapshot {
  window: {
    durationMs: number;
    collectedSince: string;
  };
  requests: number;
  errors: number;
  errorRate: number;
  avgDurationMs: number;
  streamCount: number;
  streamRatio: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usageRequestCount: number;
  usageCoverage: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cachedInputTokens: number;
  statusCodes: Record<number, number>;
  byRoute: Record<string, RouteMetricsSnapshot>;
  byProvider: Record<string, ProviderMetricsSnapshot>;
  byModel: Record<string, ModelMetricsSnapshot>;
  byProtocol: Record<string, ProtocolMetricsSnapshot>;
  byKey: Record<string, KeyMetricsSnapshot>;
  byKeyModel: Record<string, KeyModelMetricsSnapshot>;
}

interface SerializedBucket {
  timestamp: number;
  requests: number;
  errors: number;
  totalDurationMs: number;
  streamCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usageRequestCount: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cachedInputTokens?: number;
  statusCodes: Array<[number, number]>;
  byRoute?: Array<[string, SubMetrics]>;
  byProvider?: Array<[string, SubMetrics]>;
  byModel?: Array<[string, SubMetrics]>;
  byProtocol?: Array<[string, SubMetrics]>;
  byKey?: Array<[string, SubMetrics]>;
  byKeyModel?: Array<[string, SubMetrics]>;
}

interface SerializedCollectorState {
  windowMs: number;
  bucketCount: number;
  buckets: SerializedBucket[];
}

interface SubMetrics {
  requests: number;
  errors: number;
  totalDurationMs: number;
  streamCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usageRequestCount: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cachedInputTokens: number;
}

interface Bucket {
  timestamp: number;
  requests: number;
  errors: number;
  totalDurationMs: number;
  streamCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usageRequestCount: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cachedInputTokens: number;
  statusCodes: Map<number, number>;
  byRoute: Map<string, SubMetrics>;
  byProvider: Map<string, SubMetrics>;
  byModel: Map<string, SubMetrics>;
  byProtocol: Map<string, SubMetrics>;
  byKey: Map<string, SubMetrics>;
  byKeyModel: Map<string, SubMetrics>;
}

function createSubMetrics(): SubMetrics {
  return {
    requests: 0,
    errors: 0,
    totalDurationMs: 0,
    streamCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    usageRequestCount: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cachedInputTokens: 0
  };
}

function createBucket(): Bucket {
  return {
    timestamp: 0,
    requests: 0,
    errors: 0,
    totalDurationMs: 0,
    streamCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    usageRequestCount: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cachedInputTokens: 0,
    statusCodes: new Map(),
    byRoute: new Map(),
    byProvider: new Map(),
    byModel: new Map(),
    byProtocol: new Map(),
    byKey: new Map(),
    byKeyModel: new Map()
  };
}

function serializeBucket(bucket: Bucket): SerializedBucket {
  return {
    timestamp: bucket.timestamp,
    requests: bucket.requests,
    errors: bucket.errors,
    totalDurationMs: bucket.totalDurationMs,
    streamCount: bucket.streamCount,
    inputTokens: bucket.inputTokens,
    outputTokens: bucket.outputTokens,
    totalTokens: bucket.totalTokens,
    usageRequestCount: bucket.usageRequestCount,
    cacheReadTokens: bucket.cacheReadTokens,
    cacheWriteTokens: bucket.cacheWriteTokens,
    cachedInputTokens: bucket.cachedInputTokens,
    statusCodes: [...bucket.statusCodes.entries()],
    byRoute: [...bucket.byRoute.entries()],
    byProvider: [...bucket.byProvider.entries()],
    byModel: [...bucket.byModel.entries()],
    byProtocol: [...bucket.byProtocol.entries()],
    byKey: [...bucket.byKey.entries()],
    byKeyModel: [...bucket.byKeyModel.entries()]
  };
}

function normalizeSubMetrics(
  metrics: Partial<SubMetrics> | undefined
): SubMetrics {
  return {
    requests: metrics?.requests ?? 0,
    errors: metrics?.errors ?? 0,
    totalDurationMs: metrics?.totalDurationMs ?? 0,
    streamCount: metrics?.streamCount ?? 0,
    inputTokens: metrics?.inputTokens ?? 0,
    outputTokens: metrics?.outputTokens ?? 0,
    totalTokens: metrics?.totalTokens ?? 0,
    usageRequestCount: metrics?.usageRequestCount ?? 0,
    cacheReadTokens: metrics?.cacheReadTokens ?? 0,
    cacheWriteTokens: metrics?.cacheWriteTokens ?? 0,
    cachedInputTokens: metrics?.cachedInputTokens ?? 0
  };
}

function deserializeBucket(bucket: SerializedBucket): Bucket {
  return {
    timestamp: bucket.timestamp,
    requests: bucket.requests,
    errors: bucket.errors,
    totalDurationMs: bucket.totalDurationMs,
    streamCount: bucket.streamCount,
    inputTokens: bucket.inputTokens,
    outputTokens: bucket.outputTokens,
    totalTokens: bucket.totalTokens,
    usageRequestCount: bucket.usageRequestCount,
    cacheReadTokens: bucket.cacheReadTokens ?? 0,
    cacheWriteTokens: bucket.cacheWriteTokens ?? 0,
    cachedInputTokens: bucket.cachedInputTokens ?? 0,
    statusCodes: new Map(bucket.statusCodes),
    byRoute: new Map(
      (bucket.byRoute ?? []).map(([key, value]) => [key, normalizeSubMetrics(value)])
    ),
    byProvider: new Map(
      (bucket.byProvider ?? []).map(([key, value]) => [
        key,
        normalizeSubMetrics(value)
      ])
    ),
    byModel: new Map(
      (bucket.byModel ?? []).map(([key, value]) => [key, normalizeSubMetrics(value)])
    ),
    byProtocol: new Map(
      (bucket.byProtocol ?? []).map(([key, value]) => [
        key,
        normalizeSubMetrics(value)
      ])
    ),
    byKey: new Map(
      (bucket.byKey ?? []).map(([key, value]) => [key, normalizeSubMetrics(value)])
    ),
    byKeyModel: new Map(
      (bucket.byKeyModel ?? []).map(([key, value]) => [
        key,
        normalizeSubMetrics(value)
      ])
    )
  };
}

export class GatewayMetricsCollector {
  private readonly buckets: Bucket[];
  private readonly bucketDurationMs: number;
  private readonly windowMs: number;

  constructor(windowMs = 60_000, bucketCount = 12) {
    this.windowMs = windowMs;
    this.bucketDurationMs = Math.max(1, Math.floor(windowMs / bucketCount));
    this.buckets = Array.from({ length: bucketCount }, () => createBucket());
  }

  static fromJSON(state: SerializedCollectorState): GatewayMetricsCollector {
    const collector = new GatewayMetricsCollector(
      state.windowMs,
      state.bucketCount
    );
    for (const [index, bucket] of state.buckets.entries()) {
      collector.buckets[index] = deserializeBucket(bucket);
    }
    return collector;
  }

  record(record: MetricsRecord, now?: number): void {
    const currentTime = now ?? Date.now();
    const bucketTime = Math.floor(currentTime / this.bucketDurationMs);
    const index = bucketTime % this.buckets.length;
    const bucket = this.buckets[index]!;

    if (bucket.timestamp !== bucketTime) {
      bucket.timestamp = bucketTime;
      bucket.requests = 0;
      bucket.errors = 0;
      bucket.totalDurationMs = 0;
      bucket.streamCount = 0;
      bucket.inputTokens = 0;
      bucket.outputTokens = 0;
      bucket.totalTokens = 0;
      bucket.usageRequestCount = 0;
      bucket.cacheReadTokens = 0;
      bucket.cacheWriteTokens = 0;
      bucket.cachedInputTokens = 0;
      bucket.statusCodes.clear();
      bucket.byRoute.clear();
      bucket.byProvider.clear();
      bucket.byModel.clear();
      bucket.byProtocol.clear();
      bucket.byKey.clear();
      bucket.byKeyModel.clear();
    }

    const isError = record.statusCode >= 400;
    const isStream = record.isStream === true;
    const usageOnly = record.usageOnly === true;
    const usage = record.usage;
    if (!usageOnly) {
      bucket.requests++;
      if (isError) bucket.errors++;
      bucket.totalDurationMs += record.durationMs;
      if (isStream) bucket.streamCount++;
    }
    if (usage) {
      bucket.inputTokens += usage.inputTokens;
      bucket.outputTokens += usage.outputTokens;
      bucket.totalTokens += usage.totalTokens;
      bucket.usageRequestCount++;
      bucket.cacheReadTokens += usage.cacheReadTokens ?? 0;
      bucket.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
      bucket.cachedInputTokens += usage.cachedInputTokens ?? 0;
    }
    if (!usageOnly) {
      bucket.statusCodes.set(
        record.statusCode,
        (bucket.statusCodes.get(record.statusCode) ?? 0) + 1
      );
    }

    let route = bucket.byRoute.get(record.routePath);
    if (!route) {
      route = createSubMetrics();
      bucket.byRoute.set(record.routePath, route);
    }
    if (!usageOnly) {
      route.requests++;
      if (isError) route.errors++;
      route.totalDurationMs += record.durationMs;
      if (isStream) route.streamCount++;
    }
    if (usage) {
      route.inputTokens += usage.inputTokens;
      route.outputTokens += usage.outputTokens;
      route.totalTokens += usage.totalTokens;
      route.usageRequestCount++;
      route.cacheReadTokens += usage.cacheReadTokens ?? 0;
      route.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
      route.cachedInputTokens += usage.cachedInputTokens ?? 0;
    }

    if (record.providerId) {
      let provider = bucket.byProvider.get(record.providerId);
      if (!provider) {
        provider = createSubMetrics();
        bucket.byProvider.set(record.providerId, provider);
      }
      if (!usageOnly) {
        provider.requests++;
        if (isError) provider.errors++;
        provider.totalDurationMs += record.durationMs;
        if (isStream) provider.streamCount++;
      }
      if (usage) {
        provider.inputTokens += usage.inputTokens;
        provider.outputTokens += usage.outputTokens;
        provider.totalTokens += usage.totalTokens;
        provider.usageRequestCount++;
        provider.cacheReadTokens += usage.cacheReadTokens ?? 0;
        provider.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
        provider.cachedInputTokens += usage.cachedInputTokens ?? 0;
      }
    }

    if (record.modelId) {
      let model = bucket.byModel.get(record.modelId);
      if (!model) {
        model = createSubMetrics();
        bucket.byModel.set(record.modelId, model);
      }
      if (!usageOnly) {
        model.requests++;
        if (isError) model.errors++;
        model.totalDurationMs += record.durationMs;
        if (isStream) model.streamCount++;
      }
      if (usage) {
        model.inputTokens += usage.inputTokens;
        model.outputTokens += usage.outputTokens;
        model.totalTokens += usage.totalTokens;
        model.usageRequestCount++;
        model.cacheReadTokens += usage.cacheReadTokens ?? 0;
        model.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
        model.cachedInputTokens += usage.cachedInputTokens ?? 0;
      }
    }

    if (record.protocol) {
      let protocol = bucket.byProtocol.get(record.protocol);
      if (!protocol) {
        protocol = createSubMetrics();
        bucket.byProtocol.set(record.protocol, protocol);
      }
      if (!usageOnly) {
        protocol.requests++;
        if (isError) protocol.errors++;
        protocol.totalDurationMs += record.durationMs;
        if (isStream) protocol.streamCount++;
      }
      if (usage) {
        protocol.inputTokens += usage.inputTokens;
        protocol.outputTokens += usage.outputTokens;
        protocol.totalTokens += usage.totalTokens;
        protocol.usageRequestCount++;
        protocol.cacheReadTokens += usage.cacheReadTokens ?? 0;
        protocol.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
        protocol.cachedInputTokens += usage.cachedInputTokens ?? 0;
      }
    }

    if (record.keyId) {
      let key = bucket.byKey.get(record.keyId);
      if (!key) {
        key = createSubMetrics();
        bucket.byKey.set(record.keyId, key);
      }
      if (!usageOnly) {
        key.requests++;
        if (isError) key.errors++;
        key.totalDurationMs += record.durationMs;
        if (isStream) key.streamCount++;
      }
      if (usage) {
        key.inputTokens += usage.inputTokens;
        key.outputTokens += usage.outputTokens;
        key.totalTokens += usage.totalTokens;
        key.usageRequestCount++;
        key.cacheReadTokens += usage.cacheReadTokens ?? 0;
        key.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
        key.cachedInputTokens += usage.cachedInputTokens ?? 0;
      }
    }

    if (record.keyId && record.modelId) {
      const compositeKey = `${record.keyId}::${record.modelId}`;
      let keyModel = bucket.byKeyModel.get(compositeKey);
      if (!keyModel) {
        keyModel = createSubMetrics();
        bucket.byKeyModel.set(compositeKey, keyModel);
      }
      if (!usageOnly) {
        keyModel.requests++;
        if (isError) keyModel.errors++;
        keyModel.totalDurationMs += record.durationMs;
        if (isStream) keyModel.streamCount++;
      }
      if (usage) {
        keyModel.inputTokens += usage.inputTokens;
        keyModel.outputTokens += usage.outputTokens;
        keyModel.totalTokens += usage.totalTokens;
        keyModel.usageRequestCount++;
        keyModel.cacheReadTokens += usage.cacheReadTokens ?? 0;
        keyModel.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
        keyModel.cachedInputTokens += usage.cachedInputTokens ?? 0;
      }
    }
  }

  snapshot(now?: number): MetricsSnapshot {
    const currentTime = now ?? Date.now();
    const cutoffBucketTime = Math.floor(
      (currentTime - this.windowMs) / this.bucketDurationMs
    );

    let requests = 0;
    let errors = 0;
    let totalDurationMs = 0;
    let streamCount = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let usageRequestCount = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let cachedInputTokens = 0;
    let earliestBucketTime = Infinity;
    const statusCodes = new Map<number, number>();
    const byRoute = new Map<string, SubMetrics>();
    const byProvider = new Map<string, SubMetrics>();
    const byModel = new Map<string, SubMetrics>();
    const byProtocol = new Map<string, SubMetrics>();
    const byKey = new Map<string, SubMetrics>();
    const byKeyModel = new Map<string, SubMetrics>();

    for (const bucket of this.buckets) {
      if (bucket.timestamp === 0 || bucket.timestamp <= cutoffBucketTime) {
        continue;
      }
      if (bucket.timestamp < earliestBucketTime) {
        earliestBucketTime = bucket.timestamp;
      }

      requests += bucket.requests;
      errors += bucket.errors;
      totalDurationMs += bucket.totalDurationMs;
      streamCount += bucket.streamCount;
      inputTokens += bucket.inputTokens;
      outputTokens += bucket.outputTokens;
      totalTokens += bucket.totalTokens;
      usageRequestCount += bucket.usageRequestCount;
      cacheReadTokens += bucket.cacheReadTokens;
      cacheWriteTokens += bucket.cacheWriteTokens;
      cachedInputTokens += bucket.cachedInputTokens;

      for (const [code, count] of bucket.statusCodes) {
        statusCodes.set(code, (statusCodes.get(code) ?? 0) + count);
      }

      for (const [route, data] of bucket.byRoute) {
        let r = byRoute.get(route);
        if (!r) {
          r = createSubMetrics();
          byRoute.set(route, r);
        }
        r.requests += data.requests;
        r.errors += data.errors;
        r.totalDurationMs += data.totalDurationMs;
        r.streamCount += data.streamCount;
        r.inputTokens += data.inputTokens;
        r.outputTokens += data.outputTokens;
        r.totalTokens += data.totalTokens;
        r.usageRequestCount += data.usageRequestCount;
        r.cacheReadTokens += data.cacheReadTokens;
        r.cacheWriteTokens += data.cacheWriteTokens;
        r.cachedInputTokens += data.cachedInputTokens;
      }

      for (const [provider, data] of bucket.byProvider) {
        let p = byProvider.get(provider);
        if (!p) {
          p = createSubMetrics();
          byProvider.set(provider, p);
        }
        p.requests += data.requests;
        p.errors += data.errors;
        p.totalDurationMs += data.totalDurationMs;
        p.streamCount += data.streamCount;
        p.inputTokens += data.inputTokens;
        p.outputTokens += data.outputTokens;
        p.totalTokens += data.totalTokens;
        p.usageRequestCount += data.usageRequestCount;
        p.cacheReadTokens += data.cacheReadTokens;
        p.cacheWriteTokens += data.cacheWriteTokens;
        p.cachedInputTokens += data.cachedInputTokens;
      }

      for (const [model, data] of bucket.byModel) {
        let m = byModel.get(model);
        if (!m) {
          m = createSubMetrics();
          byModel.set(model, m);
        }
        m.requests += data.requests;
        m.errors += data.errors;
        m.totalDurationMs += data.totalDurationMs;
        m.streamCount += data.streamCount;
        m.inputTokens += data.inputTokens;
        m.outputTokens += data.outputTokens;
        m.totalTokens += data.totalTokens;
        m.usageRequestCount += data.usageRequestCount;
        m.cacheReadTokens += data.cacheReadTokens;
        m.cacheWriteTokens += data.cacheWriteTokens;
        m.cachedInputTokens += data.cachedInputTokens;
      }

      for (const [protocol, data] of bucket.byProtocol) {
        let p = byProtocol.get(protocol);
        if (!p) {
          p = createSubMetrics();
          byProtocol.set(protocol, p);
        }
        p.requests += data.requests;
        p.errors += data.errors;
        p.totalDurationMs += data.totalDurationMs;
        p.streamCount += data.streamCount;
        p.inputTokens += data.inputTokens;
        p.outputTokens += data.outputTokens;
        p.totalTokens += data.totalTokens;
        p.usageRequestCount += data.usageRequestCount;
        p.cacheReadTokens += data.cacheReadTokens;
        p.cacheWriteTokens += data.cacheWriteTokens;
        p.cachedInputTokens += data.cachedInputTokens;
      }

      for (const [keyId, data] of bucket.byKey) {
        let key = byKey.get(keyId);
        if (!key) {
          key = createSubMetrics();
          byKey.set(keyId, key);
        }
        key.requests += data.requests;
        key.errors += data.errors;
        key.totalDurationMs += data.totalDurationMs;
        key.streamCount += data.streamCount;
        key.inputTokens += data.inputTokens;
        key.outputTokens += data.outputTokens;
        key.totalTokens += data.totalTokens;
        key.usageRequestCount += data.usageRequestCount;
        key.cacheReadTokens += data.cacheReadTokens;
        key.cacheWriteTokens += data.cacheWriteTokens;
        key.cachedInputTokens += data.cachedInputTokens;
      }

      for (const [keyModelId, data] of bucket.byKeyModel) {
        let keyModel = byKeyModel.get(keyModelId);
        if (!keyModel) {
          keyModel = createSubMetrics();
          byKeyModel.set(keyModelId, keyModel);
        }
        keyModel.requests += data.requests;
        keyModel.errors += data.errors;
        keyModel.totalDurationMs += data.totalDurationMs;
        keyModel.streamCount += data.streamCount;
        keyModel.inputTokens += data.inputTokens;
        keyModel.outputTokens += data.outputTokens;
        keyModel.totalTokens += data.totalTokens;
        keyModel.usageRequestCount += data.usageRequestCount;
        keyModel.cacheReadTokens += data.cacheReadTokens;
        keyModel.cacheWriteTokens += data.cacheWriteTokens;
        keyModel.cachedInputTokens += data.cachedInputTokens;
      }
    }

    const collectedSince =
      earliestBucketTime === Infinity
        ? new Date(currentTime).toISOString()
        : new Date(earliestBucketTime * this.bucketDurationMs).toISOString();

    return {
      window: {
        durationMs: this.windowMs,
        collectedSince
      },
      requests,
      errors,
      errorRate:
        requests > 0 ? Math.round((errors / requests) * 10000) / 10000 : 0,
      avgDurationMs: requests > 0 ? Math.round(totalDurationMs / requests) : 0,
      streamCount,
      streamRatio:
        requests > 0 ? Math.round((streamCount / requests) * 10000) / 10000 : 0,
      inputTokens,
      outputTokens,
      totalTokens,
      usageRequestCount,
      cacheReadTokens,
      cacheWriteTokens,
      cachedInputTokens,
      usageCoverage:
        requests > 0
          ? Math.round((usageRequestCount / requests) * 10000) / 10000
          : 0,
      statusCodes: Object.fromEntries(
        [...statusCodes.entries()].sort(([a], [b]) => a - b)
      ),
      byRoute: serializeRouteMetrics(byRoute),
      byProvider: serializeProviderMetrics(byProvider),
      byModel: serializeSubMetrics(byModel),
      byProtocol: serializeSubMetrics(byProtocol),
      byKey: serializeSubMetrics(byKey),
      byKeyModel: serializeKeyModelMetrics(byKeyModel)
    };
  }

  reset(): void {
    for (const bucket of this.buckets) {
      bucket.timestamp = 0;
      bucket.requests = 0;
      bucket.errors = 0;
      bucket.totalDurationMs = 0;
      bucket.streamCount = 0;
      bucket.inputTokens = 0;
      bucket.outputTokens = 0;
      bucket.totalTokens = 0;
      bucket.usageRequestCount = 0;
      bucket.cacheReadTokens = 0;
      bucket.cacheWriteTokens = 0;
      bucket.cachedInputTokens = 0;
      bucket.statusCodes.clear();
      bucket.byRoute.clear();
      bucket.byProvider.clear();
      bucket.byModel.clear();
      bucket.byProtocol.clear();
      bucket.byKey.clear();
      bucket.byKeyModel.clear();
    }
  }

  toJSON(): SerializedCollectorState {
    return {
      windowMs: this.windowMs,
      bucketCount: this.buckets.length,
      buckets: this.buckets.map(serializeBucket)
    };
  }
}

function serializeRouteMetrics(
  map: Map<string, SubMetrics>
): Record<string, RouteMetricsSnapshot> {
  const result: Record<string, RouteMetricsSnapshot> = {};
  for (const [key, data] of map) {
    result[key] = {
      requests: data.requests,
      errors: data.errors,
      avgDurationMs:
        data.requests > 0 ? Math.round(data.totalDurationMs / data.requests) : 0,
      streamCount: data.streamCount,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      totalTokens: data.totalTokens,
      usageRequestCount: data.usageRequestCount,
      cacheReadTokens: data.cacheReadTokens,
      cacheWriteTokens: data.cacheWriteTokens,
      cachedInputTokens: data.cachedInputTokens
    };
  }
  return result;
}

function serializeProviderMetrics(
  map: Map<string, SubMetrics>
): Record<string, ProviderMetricsSnapshot> {
  const result: Record<string, ProviderMetricsSnapshot> = {};
  for (const [key, data] of map) {
    result[key] = {
      requests: data.requests,
      errors: data.errors,
      avgDurationMs:
        data.requests > 0
          ? Math.round(data.totalDurationMs / data.requests)
          : 0,
      streamCount: data.streamCount,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      totalTokens: data.totalTokens,
      usageRequestCount: data.usageRequestCount,
      cacheReadTokens: data.cacheReadTokens,
      cacheWriteTokens: data.cacheWriteTokens,
      cachedInputTokens: data.cachedInputTokens
    };
  }
  return result;
}

function serializeSubMetrics<T extends ModelMetricsSnapshot | ProtocolMetricsSnapshot>(
  map: Map<string, SubMetrics>
): Record<string, T> {
  const result: Record<string, T> = {};
  for (const [key, data] of map) {
    result[key] = {
      requests: data.requests,
      errors: data.errors,
      avgDurationMs:
        data.requests > 0
          ? Math.round(data.totalDurationMs / data.requests)
          : 0,
      streamCount: data.streamCount,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      totalTokens: data.totalTokens,
      usageRequestCount: data.usageRequestCount,
      cacheReadTokens: data.cacheReadTokens,
      cacheWriteTokens: data.cacheWriteTokens,
      cachedInputTokens: data.cachedInputTokens
    } as T;
  }
  return result;
}

function serializeKeyModelMetrics(
  map: Map<string, SubMetrics>
): Record<string, KeyModelMetricsSnapshot> {
  const result: Record<string, KeyModelMetricsSnapshot> = {};
  for (const [key, data] of map) {
    const separatorIndex = key.indexOf("::");
    const keyId = separatorIndex >= 0 ? key.slice(0, separatorIndex) : key;
    const modelId = separatorIndex >= 0 ? key.slice(separatorIndex + 2) : "";
    result[key] = {
      keyId,
      modelId,
      requests: data.requests,
      errors: data.errors,
      avgDurationMs:
        data.requests > 0
          ? Math.round(data.totalDurationMs / data.requests)
          : 0,
      streamCount: data.streamCount,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      totalTokens: data.totalTokens,
      usageRequestCount: data.usageRequestCount,
      cacheReadTokens: data.cacheReadTokens,
      cacheWriteTokens: data.cacheWriteTokens,
      cachedInputTokens: data.cachedInputTokens
    };
  }
  return result;
}

let collector: GatewayMetricsCollector | undefined;

export function getMetricsCollector(): GatewayMetricsCollector {
  if (!collector) {
    collector = new GatewayMetricsCollector();
  }
  return collector;
}

export function resetMetricsCollector(): void {
  collector = undefined;
}

const METRICS_OBJECT_NAME = "global";
const METRICS_STORAGE_KEY = "metrics_state";

async function loadCollectorFromState(
  state: DurableObjectStateLike["storage"]
): Promise<GatewayMetricsCollector> {
  const stored =
    await state.get<SerializedCollectorState>(METRICS_STORAGE_KEY);
  return stored
    ? GatewayMetricsCollector.fromJSON(stored)
    : new GatewayMetricsCollector();
}

export class GatewayMetricsDurableObject {
  constructor(private readonly state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/record") {
      const body = (await request.json()) as {
        record?: MetricsRecord;
        now?: number;
      };

      if (!body.record) {
        return Response.json(
          { error: "Missing metrics record" },
          { status: 400 }
        );
      }

      const collector = await loadCollectorFromState(this.state.storage);
      collector.record(body.record, body.now);
      await this.state.storage.put(METRICS_STORAGE_KEY, collector.toJSON());
      return new Response(null, { status: 202 });
    }

    if (request.method === "GET" && url.pathname === "/snapshot") {
      const collector = await loadCollectorFromState(this.state.storage);
      const nowParam = url.searchParams.get("now");
      const now =
        nowParam !== null && Number.isFinite(Number(nowParam))
          ? Number(nowParam)
          : undefined;
      return Response.json(collector.snapshot(now));
    }

    if (request.method === "POST" && url.pathname === "/reset") {
      await this.state.storage.delete(METRICS_STORAGE_KEY);
      return new Response(null, { status: 204 });
    }

    return new Response("Method not allowed", { status: 405 });
  }
}

function getMetricsNamespace(env: GatewayBindings) {
  return env.AIRLOCK_GATEWAY_METRICS;
}

export async function recordGatewayMetrics(
  env: GatewayBindings,
  record: MetricsRecord,
  now?: number
): Promise<void> {
  const namespace = getMetricsNamespace(env);

  if (!namespace) {
    getMetricsCollector().record(record, now);
    return;
  }

  const stub = namespace.get(namespace.idFromName(METRICS_OBJECT_NAME));
  const response = await stub.fetch(
    new Request("https://airlock.internal/record", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ record, now })
    })
  );

  if (!response.ok) {
    throw new Error("Failed to persist gateway metrics record");
  }
}

export async function fetchGatewayMetricsSnapshot(
  env: GatewayBindings,
  now?: number
): Promise<MetricsSnapshot> {
  const namespace = getMetricsNamespace(env);

  if (!namespace) {
    return getMetricsCollector().snapshot(now);
  }

  const stub = namespace.get(namespace.idFromName(METRICS_OBJECT_NAME));
  const url = new URL("https://airlock.internal/snapshot");
  if (now !== undefined) {
    url.searchParams.set("now", String(now));
  }
  const response = await stub.fetch(new Request(url.toString(), { method: "GET" }));

  if (!response.ok) {
    throw new Error("Failed to read gateway metrics snapshot");
  }

  return (await response.json()) as MetricsSnapshot;
}

export function dispatchBackgroundTask(task: Promise<void>, context: {
  executionCtx?: {
    waitUntil(promise: Promise<void>): void;
  };
}): void {
  try {
    context.executionCtx?.waitUntil(task);
  } catch {
    void task.catch(() => {});
  }
}
