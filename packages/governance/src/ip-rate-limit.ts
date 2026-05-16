/**
 * IP-based rate limiting — governance domain layer.
 *
 * Provides pure domain types, parsing, decision logic, and error construction
 * for per-IP fixed-window rate limiting on public AI endpoints.
 */
import type { GatewayError } from "@airlock/shared";

import {
  computeFixedWindowStart,
  createRateLimitExceededError,
  createRateLimitHeaders,
  isRecord,
  parseRateLimitDecisionFields
} from "./gateway-key-quota-shared.js";

// ── Configuration ──────────────────────────────────────────────────────

export interface IpRateLimitPolicy {
  /** Maximum requests per window per IP */
  limit: number;
  /** Fixed window duration in seconds */
  windowSeconds: number;
}

export function parseIpRateLimitPolicy(
  value: unknown
): IpRateLimitPolicy {
  if (!isRecord(value)) {
    throw new Error("IP rate limit policy must be an object");
  }

  const { limit, windowSeconds } = value;

  if (
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit <= 0
  ) {
    throw new Error(
      "IP rate limit policy limit must be a positive integer"
    );
  }

  if (
    typeof windowSeconds !== "number" ||
    !Number.isInteger(windowSeconds) ||
    windowSeconds <= 0
  ) {
    throw new Error(
      "IP rate limit policy windowSeconds must be a positive integer"
    );
  }

  return { limit, windowSeconds };
}

// ── Decision ───────────────────────────────────────────────────────────

export interface IpRateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: string;
  retryAfterSeconds: number;
}

export interface IpRateLimitStorage {
  windowStartedAt?: number;
  count?: number;
}

export function parseIpRateLimitDecision(
  value: unknown
): IpRateLimitDecision {
  if (!isRecord(value)) {
    throw new Error("IP rate limit decision must be an object");
  }

  return parseRateLimitDecisionFields(value);
}

// ── Pure computation ───────────────────────────────────────────────────

export function computeIpRateLimitConsume(
  existing: IpRateLimitStorage | undefined,
  limit: number,
  windowSeconds: number,
  now: number
): {
  decision: IpRateLimitDecision;
  nextState: IpRateLimitStorage;
} {
  const windowMs = windowSeconds * 1000;
  const windowStartedAt = computeFixedWindowStart(windowMs, now);
  const current =
    existing?.windowStartedAt === windowStartedAt
      ? { windowStartedAt, count: existing.count ?? 0 }
      : { windowStartedAt, count: 0 };
  const resetAtTimestamp = windowStartedAt + windowMs;
  const retryAfterSeconds = Math.max(
    0,
    Math.ceil((resetAtTimestamp - now) / 1000)
  );

  if (current.count >= limit) {
    return {
      decision: {
        allowed: false,
        limit,
        remaining: 0,
        resetAt: new Date(resetAtTimestamp).toISOString(),
        retryAfterSeconds
      },
      nextState: current
    };
  }

  const nextCount = current.count + 1;

  return {
    decision: {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - nextCount),
      resetAt: new Date(resetAtTimestamp).toISOString(),
      retryAfterSeconds
    },
    nextState: {
      windowStartedAt,
      count: nextCount
    }
  };
}

// ── Error & headers ────────────────────────────────────────────────────

export function createIpRateLimitExceededError(
  decision: IpRateLimitDecision,
  requestId: string
): GatewayError {
  return createRateLimitExceededError(
    "IP rate limit exceeded",
    "ip_rate_limit_exceeded",
    decision,
    requestId
  );
}

export function createIpRateLimitHeaders(
  decision: IpRateLimitDecision
): Record<string, string> {
  return createRateLimitHeaders(decision);
}

// ── Client IP extraction ───────────────────────────────────────────────

/**
 * Extract client IP from Cloudflare headers.
 * Prefers CF-Connecting-IP (set by Cloudflare edge), falls back to
 * X-Forwarded-For first entry, then X-Real-IP.
 * Returns "unknown" when no IP header is present (should not happen on CF).
 */
export function extractClientIp(headers: {
  get(name: string): string | undefined | null;
}): string {
  const cfIp = headers.get("cf-connecting-ip");
  if (cfIp && cfIp.trim().length > 0) {
    return cfIp.trim();
  }

  const xff = headers.get("x-forwarded-for");
  if (xff && xff.trim().length > 0) {
    const first = xff.split(",")[0]?.trim();
    if (first && first.length > 0) {
      return first;
    }
  }

  const realIp = headers.get("x-real-ip");
  if (realIp && realIp.trim().length > 0) {
    return realIp.trim();
  }

  return "unknown";
}
