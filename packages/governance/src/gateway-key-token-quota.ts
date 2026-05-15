import { GatewayError } from "@airlock/shared";

import type { GatewayApiKeyTokenQuotaPolicy } from "./gateway-auth.js";
import {
  computeFixedWindowStart,
  createRateLimitExceededError,
  createRateLimitHeaders,
  isRecord,
  parseRateLimitDecisionFields
} from "./gateway-key-quota-shared.js";

export interface GatewayKeyTokenQuotaDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  used: number;
  reserved: number;
  resetAt: string;
  retryAfterSeconds: number;
}

export interface GatewayKeyTokenQuotaPrecheckRequest {
  kind: "precheck";
  limit: number;
  windowSeconds: number;
}

export interface GatewayKeyTokenQuotaChargeRequest {
  kind: "charge";
  limit: number;
  windowSeconds: number;
  tokens: number;
}

export interface GatewayKeyTokenQuotaReserveRequest {
  kind: "reserve";
  limit: number;
  windowSeconds: number;
  reservationId: string;
  tokens: number;
  ttlMs: number;
}

export interface GatewayKeyTokenQuotaReleaseRequest {
  kind: "release";
  limit: number;
  windowSeconds: number;
  reservationId: string;
}

export interface GatewayKeyTokenQuotaReconcileRequest {
  kind: "reconcile";
  limit: number;
  windowSeconds: number;
  reservationId: string;
  actualTokens: number;
}

export interface GatewayKeyTokenQuotaReservation {
  reservationId: string;
  tokens: number;
  expiresAt: number;
}

export interface GatewayKeyTokenQuotaStorage {
  windowStartedAt?: number;
  usedTokens?: number;
  reservations?: GatewayKeyTokenQuotaReservation[];
}

export type GatewayKeyTokenQuotaRequest =
  | GatewayKeyTokenQuotaPrecheckRequest
  | GatewayKeyTokenQuotaChargeRequest
  | GatewayKeyTokenQuotaReserveRequest
  | GatewayKeyTokenQuotaReleaseRequest
  | GatewayKeyTokenQuotaReconcileRequest;

export interface GatewayKeyTokenReservationHandle {
  reservationId: string;
  reservedTokens: number;
}

/**
 * Parses a raw value into a GatewayKeyTokenQuotaDecision, validating all fields.
 */
export function parseTokenQuotaDecision(
  value: unknown
): GatewayKeyTokenQuotaDecision {
  if (!isRecord(value)) {
    throw new Error("Token quota decision must be an object");
  }

  const base = parseRateLimitDecisionFields(value);
  const { used, reserved } = value;

  if (
    typeof used !== "number" ||
    !Number.isInteger(used) ||
    used < 0 ||
    typeof reserved !== "number" ||
    !Number.isInteger(reserved) ||
    reserved < 0
  ) {
    throw new Error("Token quota decision is invalid");
  }

  return {
    ...base,
    used,
    reserved
  };
}

/**
 * Creates a window state from existing storage, expiring stale reservations.
 */
export function createTokenQuotaWindowState(
  existing: GatewayKeyTokenQuotaStorage | undefined,
  windowStartedAt: number,
  now: number
): {
  windowStartedAt: number;
  usedTokens: number;
  reservations: GatewayKeyTokenQuotaReservation[];
} {
  if (existing?.windowStartedAt !== windowStartedAt) {
    return {
      windowStartedAt,
      usedTokens: 0,
      reservations: []
    };
  }

  return {
    windowStartedAt,
    usedTokens: existing.usedTokens ?? 0,
    reservations: (existing.reservations ?? []).filter((reservation) => {
      return reservation.expiresAt > now;
    })
  };
}

/**
 * Sums the token counts of all active reservations.
 */
export function getReservedTokens(
  reservations: GatewayKeyTokenQuotaReservation[]
): number {
  return reservations.reduce((sum, reservation) => {
    return sum + reservation.tokens;
  }, 0);
}

/**
 * Core token quota decision: allowed when used + reserved < limit.
 */
export function createTokenQuotaDecision(
  policy: GatewayApiKeyTokenQuotaPolicy,
  usedTokens: number,
  reservedTokens: number,
  now: number
): GatewayKeyTokenQuotaDecision {
  const windowMs = policy.windowSeconds * 1000;
  const windowStartedAt = computeFixedWindowStart(windowMs, now);
  const resetAtTimestamp = windowStartedAt + windowMs;
  const committedAndReserved = usedTokens + reservedTokens;

  return {
    allowed: committedAndReserved < policy.limit,
    limit: policy.limit,
    remaining: Math.max(0, policy.limit - committedAndReserved),
    used: usedTokens,
    reserved: reservedTokens,
    resetAt: new Date(resetAtTimestamp).toISOString(),
    retryAfterSeconds: Math.max(0, Math.ceil((resetAtTimestamp - now) / 1000))
  };
}

/**
 * Generates a token quota reservation ID from a request ID.
 */
export function createTokenQuotaReservationId(requestId: string): string {
  return `tkq_${requestId}`;
}

/**
 * Asserts that upstream usage data is available when token quota is configured.
 */
export function assertGatewayKeyTokenUsageAvailable(
  gatewayApiKey: { policy?: { tokenQuota?: GatewayApiKeyTokenQuotaPolicy } },
  usage: { totalTokens: number } | undefined,
  requestId: string
): void {
  if (!gatewayApiKey.policy?.tokenQuota) {
    return;
  }

  if (
    usage === undefined ||
    typeof usage.totalTokens !== "number" ||
    !Number.isInteger(usage.totalTokens) ||
    usage.totalTokens < 0
  ) {
    throw new GatewayError(
      "Gateway key token quota requires upstream usage data",
      {
        code: "gateway_key_token_quota_usage_unavailable",
        category: "governance",
        httpStatus: 503,
        retryable: false,
        requestId
      }
    );
  }
}

/**
 * Creates standard rate-limit HTTP headers from a token quota decision.
 */
export function createGatewayKeyTokenQuotaHeaders(
  decision: GatewayKeyTokenQuotaDecision
): Record<string, string> {
  return createRateLimitHeaders(decision);
}

/**
 * Creates a 429 token-quota-exceeded error with standard rate-limit headers.
 */
export function createGatewayKeyTokenQuotaExceededError(
  decision: GatewayKeyTokenQuotaDecision,
  requestId: string
): GatewayError {
  return createRateLimitExceededError(
    "Gateway API key token quota exceeded",
    "quota_tokens_exceeded",
    decision,
    requestId
  );
}
