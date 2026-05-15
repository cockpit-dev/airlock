import type { GatewayError } from "@airlock/shared";

import {
  createRateLimitExceededError,
  createRateLimitHeaders,
  isRecord,
  parseRateLimitDecisionFields
} from "./gateway-key-quota-shared.js";

export interface GatewayKeyConcurrencyAcquireRequest {
  kind: "acquire";
  limit: number;
  leaseId: string;
  ttlMs: number;
}

export interface GatewayKeyConcurrencyReleaseRequest {
  leaseId: string;
}

export interface GatewayKeyConcurrencyLease {
  leaseId: string;
  expiresAt: number;
}

export interface GatewayKeyConcurrencyDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: string;
  retryAfterSeconds: number;
}

/**
 * Type guard for GatewayKeyConcurrencyLease.
 */
export function isGatewayKeyConcurrencyLease(
  value: unknown
): value is GatewayKeyConcurrencyLease {
  return (
    isRecord(value) &&
    typeof value.leaseId === "string" &&
    typeof value.expiresAt === "number" &&
    Number.isInteger(value.expiresAt)
  );
}

/**
 * Parses a raw value into a GatewayKeyConcurrencyDecision, validating all fields.
 */
export function parseConcurrencyDecision(
  value: unknown
): GatewayKeyConcurrencyDecision {
  if (!isRecord(value)) {
    throw new Error("Concurrency decision must be an object");
  }

  return parseRateLimitDecisionFields(value);
}

/**
 * Computes the TTL for a concurrency lease, ensuring a minimum of 1 second.
 */
export function getConcurrencyLeaseTtlMs(providerTimeoutMs: number): number {
  return Math.max(1000, providerTimeoutMs);
}

/**
 * Core concurrency decision: allowed when activeLeases < limit.
 */
export function createConcurrencyDecision(
  limit: number,
  activeLeases: GatewayKeyConcurrencyLease[],
  ttlMs: number,
  now = Date.now()
): GatewayKeyConcurrencyDecision {
  const nextResetAt =
    activeLeases.length > 0
      ? activeLeases.reduce((min, lease) => {
          return Math.min(min, lease.expiresAt);
        }, Number.POSITIVE_INFINITY)
      : now + ttlMs;
  const resetAtTimestamp = Number.isFinite(nextResetAt)
    ? nextResetAt
    : now + ttlMs;

  return {
    allowed: activeLeases.length < limit,
    limit,
    remaining: Math.max(0, limit - activeLeases.length),
    resetAt: new Date(resetAtTimestamp).toISOString(),
    retryAfterSeconds: Math.max(0, Math.ceil((resetAtTimestamp - now) / 1000))
  };
}

/**
 * Creates standard rate-limit HTTP headers from a concurrency decision.
 */
export function createGatewayKeyConcurrencyHeaders(
  decision: GatewayKeyConcurrencyDecision
): Record<string, string> {
  return createRateLimitHeaders(decision);
}

/**
 * Creates a 429 concurrency-quota-exceeded error with standard rate-limit headers.
 */
export function createGatewayKeyConcurrencyExceededError(
  decision: GatewayKeyConcurrencyDecision,
  requestId: string
): GatewayError {
  return createRateLimitExceededError(
    "Gateway API key concurrency quota exceeded",
    "quota_concurrency_exceeded",
    decision,
    requestId
  );
}
