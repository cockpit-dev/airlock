import {
  type IpRateLimitPolicy,
  type IpRateLimitStorage,
  type IpRateLimitDecision,
  computeIpRateLimitConsume,
  createIpRateLimitExceededError,
  createIpRateLimitHeaders,
  extractClientIp,
  parseIpRateLimitDecision
} from "@airlock/governance";
import { GatewayError } from "@airlock/shared";

import type { GatewayBindings } from "./env.js";
import type { DurableObjectStateLike } from "./durable-object-state.js";

// Re-export for direct consumption by route handlers
export {
  extractClientIp,
  createIpRateLimitHeaders,
  type IpRateLimitDecision,
  type IpRateLimitPolicy
};

export class IpRateLimitDurableObject {
  constructor(private readonly state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    const policy = (await request.json()) as IpRateLimitPolicy;
    const decision = await consumeIpRateLimitFromStorage(
      this.state.storage,
      policy
    );

    return Response.json(decision);
  }
}

/**
 * Enforce IP rate limit for the current request.
 *
 * Returns the decision when allowed (for response headers) or throws a
 * 429 `GatewayError` when the IP has exceeded its quota.
 * Returns `undefined` when no IP rate limit policy is configured or the
 * DO binding is absent.
 */
export async function enforceIpRateLimit(
  env: GatewayBindings,
  policy: IpRateLimitPolicy | undefined,
  requestHeaders: {
    get(name: string): string | undefined | null;
  },
  requestId: string
): Promise<IpRateLimitDecision | undefined> {
  if (!policy) {
    return undefined;
  }

  const namespace = env.AIRLOCK_IP_RATE_LIMIT;

  if (!namespace) {
    throw new GatewayError("IP rate limit subsystem is unavailable", {
      code: "ip_rate_limit_unavailable",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId
    });
  }

  const clientIp = extractClientIp(requestHeaders);
  const stub = namespace.get(namespace.idFromName(clientIp));
  let response: Response;

  try {
    response = await stub.fetch(
      new Request("https://airlock.internal/ip-rate-limit/consume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(policy)
      })
    );
  } catch (cause) {
    throw new GatewayError("IP rate limit subsystem is unavailable", {
      code: "ip_rate_limit_unavailable",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId,
      cause
    });
  }

  if (!response.ok) {
    throw new GatewayError("IP rate limit subsystem is unavailable", {
      code: "ip_rate_limit_unavailable",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId
    });
  }

  let decision: IpRateLimitDecision;

  try {
    decision = parseIpRateLimitDecision(await response.json());
  } catch (cause) {
    throw new GatewayError(
      "IP rate limit subsystem returned an invalid response",
      {
        code: "ip_rate_limit_invalid_response",
        category: "governance",
        httpStatus: 503,
        retryable: true,
        requestId,
        cause
      }
    );
  }

  if (!decision.allowed) {
    throw createIpRateLimitExceededError(decision, requestId);
  }

  return decision;
}

export async function consumeIpRateLimitFromStorage(
  storage: DurableObjectStateLike["storage"],
  policy: IpRateLimitPolicy,
  now = Date.now()
): Promise<IpRateLimitDecision> {
  const existing = await storage.get<IpRateLimitStorage>("ip_rate_limit");
  const { decision, nextState } = computeIpRateLimitConsume(
    existing,
    policy.limit,
    policy.windowSeconds,
    now
  );

  if (decision.allowed) {
    await storage.put("ip_rate_limit", nextState);
  }

  return decision;
}
