interface AdminRateLimitBucket {
  windowStart: number;
  count: number;
}

export class AdminRateLimiter {
  private readonly buckets = new Map<string, AdminRateLimitBucket>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit = 30, windowMs = 60_000) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  check(ip: string, now: number): { allowed: boolean; remaining: number } {
    if (this.buckets.size > 10_000) {
      for (const [key, bucket] of this.buckets) {
        if (now - bucket.windowStart >= this.windowMs) {
          this.buckets.delete(key);
        }
      }
    }

    const bucket = this.buckets.get(ip);

    if (!bucket || now - bucket.windowStart >= this.windowMs) {
      this.buckets.set(ip, { windowStart: now, count: 1 });
      return { allowed: true, remaining: this.limit - 1 };
    }

    bucket.count++;
    const remaining = Math.max(0, this.limit - bucket.count);
    return { allowed: bucket.count <= this.limit, remaining };
  }

  reset(): void {
    this.buckets.clear();
  }
}

let limiter: AdminRateLimiter | undefined;

export function getAdminRateLimiter(): AdminRateLimiter {
  if (!limiter) {
    limiter = new AdminRateLimiter();
  }
  return limiter;
}

export function resetAdminRateLimiter(): void {
  limiter = undefined;
}

export function extractIp(request: {
  header(name: string): string | undefined;
}): string {
  const forwarded = request.header("cf-connecting-ip");
  if (forwarded) return forwarded;

  const xForwarded = request.header("x-forwarded-for");
  if (xForwarded) return xForwarded.split(",")[0]!.trim();

  return "unknown";
}
