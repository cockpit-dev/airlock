export interface MetricsRecord {
  routePath: string;
  statusCode: number;
  durationMs: number;
  providerId?: string;
  modelId?: string;
  isStream?: boolean;
}

export interface RouteMetricsSnapshot {
  requests: number;
  errors: number;
  avgDurationMs: number;
}

export interface ProviderMetricsSnapshot {
  requests: number;
  errors: number;
  avgDurationMs: number;
  streamCount: number;
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
  statusCodes: Record<number, number>;
  byRoute: Record<string, RouteMetricsSnapshot>;
  byProvider: Record<string, ProviderMetricsSnapshot>;
}

interface SubMetrics {
  requests: number;
  errors: number;
  totalDurationMs: number;
  streamCount: number;
}

interface Bucket {
  timestamp: number;
  requests: number;
  errors: number;
  totalDurationMs: number;
  streamCount: number;
  statusCodes: Map<number, number>;
  byRoute: Map<string, SubMetrics>;
  byProvider: Map<string, SubMetrics>;
}

function createSubMetrics(): SubMetrics {
  return { requests: 0, errors: 0, totalDurationMs: 0, streamCount: 0 };
}

function createBucket(): Bucket {
  return {
    timestamp: 0,
    requests: 0,
    errors: 0,
    totalDurationMs: 0,
    streamCount: 0,
    statusCodes: new Map(),
    byRoute: new Map(),
    byProvider: new Map()
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
      bucket.statusCodes.clear();
      bucket.byRoute.clear();
      bucket.byProvider.clear();
    }

    const isError = record.statusCode >= 400;
    const isStream = record.isStream === true;
    bucket.requests++;
    if (isError) bucket.errors++;
    bucket.totalDurationMs += record.durationMs;
    if (isStream) bucket.streamCount++;
    bucket.statusCodes.set(
      record.statusCode,
      (bucket.statusCodes.get(record.statusCode) ?? 0) + 1
    );

    let route = bucket.byRoute.get(record.routePath);
    if (!route) {
      route = createSubMetrics();
      bucket.byRoute.set(record.routePath, route);
    }
    route.requests++;
    if (isError) route.errors++;
    route.totalDurationMs += record.durationMs;
    if (isStream) route.streamCount++;

    if (record.providerId) {
      let provider = bucket.byProvider.get(record.providerId);
      if (!provider) {
        provider = createSubMetrics();
        bucket.byProvider.set(record.providerId, provider);
      }
      provider.requests++;
      if (isError) provider.errors++;
      provider.totalDurationMs += record.durationMs;
      if (isStream) provider.streamCount++;
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
    let earliestBucketTime = Infinity;
    const statusCodes = new Map<number, number>();
    const byRoute = new Map<string, SubMetrics>();
    const byProvider = new Map<string, SubMetrics>();

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
      statusCodes: Object.fromEntries(
        [...statusCodes.entries()].sort(([a], [b]) => a - b)
      ),
      byRoute: serializeRouteMetrics(byRoute),
      byProvider: serializeProviderMetrics(byProvider)
    };
  }

  reset(): void {
    for (const bucket of this.buckets) {
      bucket.timestamp = 0;
      bucket.requests = 0;
      bucket.errors = 0;
      bucket.totalDurationMs = 0;
      bucket.streamCount = 0;
      bucket.statusCodes.clear();
      bucket.byRoute.clear();
      bucket.byProvider.clear();
    }
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
        data.requests > 0 ? Math.round(data.totalDurationMs / data.requests) : 0
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
      streamCount: data.streamCount
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
