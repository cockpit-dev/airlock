import { GatewayError } from "@airlock/shared";

/**
 * Common rate-limit decision fields shared by all quota subsystems.
 */
export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: string;
  retryAfterSeconds: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Validates the common rate-limit decision fields from a raw value.
 * Returns the parsed common fields or throws on invalid input.
 */
export function parseRateLimitDecisionFields(
  value: unknown
): Pick<
  RateLimitDecision,
  "allowed" | "limit" | "remaining" | "resetAt" | "retryAfterSeconds"
> {
  if (!isRecord(value)) {
    throw new Error("Rate limit decision must be an object");
  }

  const { allowed, limit, remaining, resetAt, retryAfterSeconds } = value;

  if (
    typeof allowed !== "boolean" ||
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit <= 0 ||
    typeof remaining !== "number" ||
    !Number.isInteger(remaining) ||
    remaining < 0 ||
    typeof resetAt !== "string" ||
    Number.isNaN(Date.parse(resetAt)) ||
    typeof retryAfterSeconds !== "number" ||
    !Number.isInteger(retryAfterSeconds) ||
    retryAfterSeconds < 0
  ) {
    throw new Error("Rate limit decision is invalid");
  }

  return { allowed, limit, remaining, resetAt, retryAfterSeconds };
}

/**
 * Creates standard rate-limit HTTP headers from a rate-limit decision.
 */
export function createRateLimitHeaders(
  decision: RateLimitDecision
): Record<string, string> {
  return {
    "retry-after": String(decision.retryAfterSeconds),
    "x-ratelimit-limit": String(decision.limit),
    "x-ratelimit-remaining": String(decision.remaining),
    "x-ratelimit-reset": decision.resetAt
  };
}

/**
 * Creates a 429 rate-limit-exceeded error with standard headers.
 */
export function createRateLimitExceededError(
  message: string,
  code: string,
  decision: RateLimitDecision,
  requestId: string
): GatewayError {
  return new GatewayError(message, {
    code,
    category: "rate_limit",
    httpStatus: 429,
    retryable: false,
    requestId,
    headers: createRateLimitHeaders(decision)
  });
}

/**
 * Computes the fixed-window start timestamp for a given window size and current time.
 */
export function computeFixedWindowStart(windowMs: number, now: number): number {
  return now - (now % windowMs);
}

/**
 * Shared `isRecord` utility for quota decision parsing.
 */
export { isRecord };
