export interface MetricsRecord {
  routePath: string;
  statusCode: number;
  durationMs: number;
}

export interface RouteMetricsSnapshot {
  requests: number;
  errors: number;
  avgDurationMs: number;
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
  statusCodes: Record<number, number>;
  byRoute: Record<string, RouteMetricsSnapshot>;
}

interface SubMetrics {
  requests: number;
  errors: number;
  totalDurationMs: number;
}

interface Bucket {
  timestamp: number;
  requests: number;
  errors: number;
  totalDurationMs: number;
  statusCodes: Map<number, number>;
  byRoute: Map<string, SubMetrics>;
}

function createBucket(): Bucket {
  return {
    timestamp: 0,
    requests: 0,
    errors: 0,
    totalDurationMs: 0,
    statusCodes: new Map(),
    byRoute: new Map()
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
      bucket.statusCodes.clear();
      bucket.byRoute.clear();
    }

    const isError = record.statusCode >= 400;
    bucket.requests++;
    if (isError) bucket.errors++;
    bucket.totalDurationMs += record.durationMs;
    bucket.statusCodes.set(
      record.statusCode,
      (bucket.statusCodes.get(record.statusCode) ?? 0) + 1
    );

    let route = bucket.byRoute.get(record.routePath);
    if (!route) {
      route = { requests: 0, errors: 0, totalDurationMs: 0 };
      bucket.byRoute.set(record.routePath, route);
    }
    route.requests++;
    if (isError) route.errors++;
    route.totalDurationMs += record.durationMs;
  }

  snapshot(now?: number): MetricsSnapshot {
    const currentTime = now ?? Date.now();
    const cutoffBucketTime = Math.floor(
      (currentTime - this.windowMs) / this.bucketDurationMs
    );

    let requests = 0;
    let errors = 0;
    let totalDurationMs = 0;
    let earliestBucketTime = Infinity;
    const statusCodes = new Map<number, number>();
    const byRoute = new Map<string, SubMetrics>();

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

      for (const [code, count] of bucket.statusCodes) {
        statusCodes.set(code, (statusCodes.get(code) ?? 0) + count);
      }

      for (const [route, data] of bucket.byRoute) {
        let r = byRoute.get(route);
        if (!r) {
          r = { requests: 0, errors: 0, totalDurationMs: 0 };
          byRoute.set(route, r);
        }
        r.requests += data.requests;
        r.errors += data.errors;
        r.totalDurationMs += data.totalDurationMs;
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
      statusCodes: Object.fromEntries(
        [...statusCodes.entries()].sort(([a], [b]) => a - b)
      ),
      byRoute: serializeRouteMetrics(byRoute)
    };
  }

  reset(): void {
    for (const bucket of this.buckets) {
      bucket.timestamp = 0;
      bucket.requests = 0;
      bucket.errors = 0;
      bucket.totalDurationMs = 0;
      bucket.statusCodes.clear();
      bucket.byRoute.clear();
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
