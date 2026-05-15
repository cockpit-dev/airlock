import type { GatewayError } from "@airlock/shared";

import {
  computeFixedWindowStart,
  createRateLimitExceededError,
  createRateLimitHeaders,
  isRecord,
  parseRateLimitDecisionFields
} from "./gateway-key-quota-shared.js";

export interface ConsumeGatewayKeyQuotaRequest {
  limit: number;
  windowSeconds: number;
}

export interface ConsumeGatewayKeyQuotaDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: string;
  retryAfterSeconds: number;
}

export interface GatewayKeyQuotaStorage {
  windowStartedAt?: number;
  count?: number;
}

/**
 * Parses a raw value into a ConsumeGatewayKeyQuotaDecision, validating all fields.
 */
export function parseQuotaDecision(
  value: unknown
): ConsumeGatewayKeyQuotaDecision {
  if (!isRecord(value)) {
    throw new Error("Quota decision must be an object");
  }

  return parseRateLimitDecisionFields(value);
}

/**
 * Creates standard rate-limit HTTP headers from a request quota decision.
 */
export function createGatewayKeyQuotaHeaders(
  decision: ConsumeGatewayKeyQuotaDecision
): Record<string, string> {
  return createRateLimitHeaders(decision);
}

/**
 * Creates a 429 request-quota-exceeded error with standard rate-limit headers.
 */
export function createGatewayKeyQuotaExceededError(
  decision: ConsumeGatewayKeyQuotaDecision,
  requestId: string
): GatewayError {
  return createRateLimitExceededError(
    "Gateway API key request quota exceeded",
    "quota_requests_exceeded",
    decision,
    requestId
  );
}

/**
 * Pure computation: computes the request quota consume decision from current state.
 * Returns the decision and the next state, without performing any IO.
 */
export function computeRequestQuotaConsume(
  existing: GatewayKeyQuotaStorage | undefined,
  limit: number,
  windowSeconds: number,
  now: number
): {
  decision: ConsumeGatewayKeyQuotaDecision;
  nextState: GatewayKeyQuotaStorage;
} {
  const windowMs = windowSeconds * 1000;
  const windowStartedAt = computeFixedWindowStart(windowMs, now);
  const current =
    existing?.windowStartedAt === windowStartedAt
      ? {
          windowStartedAt,
          count: existing.count ?? 0
        }
      : {
          windowStartedAt,
          count: 0
        };
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
