import {
  createRateLimitHeaders,
  type RateLimitDecision
} from "@airlock/governance";

export { createRateLimitHeaders, type RateLimitDecision };

export function collectRateLimitHeaders(
  ...decisions: (RateLimitDecision | undefined)[]
): Record<string, string> {
  const defined = decisions.filter(
    (d): d is RateLimitDecision => d !== undefined
  );
  if (defined.length === 0) {
    return {};
  }

  const mostRestrictive: RateLimitDecision = {
    allowed: true,
    limit: Math.min(...defined.map((d) => d.limit)),
    remaining: Math.min(...defined.map((d) => d.remaining)),
    resetAt: defined.map((d) => d.resetAt).sort()[0]!,
    retryAfterSeconds: 0
  };

  return createRateLimitHeaders(mostRestrictive);
}
