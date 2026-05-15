import type {
  GatewayApiKeyRecord,
  GatewayApiKeyRequestQuotaPolicy
} from "@airlock/governance";
import { GatewayError } from "@airlock/shared";

import type { GatewayBindings } from "./env.js";
import type { DurableObjectStateLike } from "./durable-object-state.js";

interface ConsumeGatewayKeyQuotaRequest {
  limit: number;
  windowSeconds: number;
}

interface ConsumeGatewayKeyQuotaDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: string;
  retryAfterSeconds: number;
}

interface GatewayKeyQuotaStorage {
  windowStartedAt?: number;
  count?: number;
}



function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseQuotaDecision(value: unknown): ConsumeGatewayKeyQuotaDecision {
  if (!isRecord(value)) {
    throw new Error("Quota decision must be an object");
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
    throw new Error("Quota decision is invalid");
  }

  return {
    allowed,
    limit,
    remaining,
    resetAt,
    retryAfterSeconds
  };
}

export class GatewayKeyQuotaDurableObject {
  constructor(private readonly state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    const body = (await request.json()) as ConsumeGatewayKeyQuotaRequest;
    const decision = await consumeGatewayKeyQuotaFromStorage(this.state.storage, body);

    return Response.json(decision);
  }
}

export async function enforceGatewayKeyRequestQuota(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string
): Promise<void> {
  const requestQuota = gatewayApiKey.policy?.requestQuota;

  if (!requestQuota) {
    return;
  }

  const namespace = env.AIRLOCK_GATEWAY_KEY_QUOTA;

  if (!namespace) {
    throw new GatewayError("Gateway key quota subsystem is unavailable", {
      code: "gateway_key_quota_unavailable",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId
    });
  }

  const stub = namespace.get(namespace.idFromName(gatewayApiKey.id));
  let response: Response;

  try {
    response = await stub.fetch(
      new Request("https://airlock.internal/gateway-key-quota/consume", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(requestQuota)
      })
    );
  } catch (cause) {
    throw new GatewayError("Gateway key quota subsystem is unavailable", {
      code: "gateway_key_quota_unavailable",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId,
      cause
    });
  }

  if (!response.ok) {
    throw new GatewayError("Gateway key quota subsystem is unavailable", {
      code: "gateway_key_quota_unavailable",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId
    });
  }

  let decision: ConsumeGatewayKeyQuotaDecision;

  try {
    decision = parseQuotaDecision(await response.json());
  } catch (cause) {
    throw new GatewayError("Gateway key quota subsystem returned an invalid response", {
      code: "gateway_key_quota_invalid_response",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId,
      cause
    });
  }

  if (decision.allowed) {
    return;
  }

  throw createGatewayKeyQuotaExceededError(decision, requestId);
}

export function createGatewayKeyQuotaExceededError(
  decision: ConsumeGatewayKeyQuotaDecision,
  requestId: string
): GatewayError {
  return new GatewayError("Gateway API key request quota exceeded", {
    code: "quota_requests_exceeded",
    category: "rate_limit",
    httpStatus: 429,
    retryable: false,
    requestId,
    headers: createGatewayKeyQuotaHeaders(decision)
  });
}

export function createGatewayKeyQuotaHeaders(
  decision: ConsumeGatewayKeyQuotaDecision
): Record<string, string> {
  return {
    "retry-after": String(decision.retryAfterSeconds),
    "x-ratelimit-limit": String(decision.limit),
    "x-ratelimit-remaining": String(decision.remaining),
    "x-ratelimit-reset": decision.resetAt
  };
}

export async function consumeGatewayKeyQuotaFromStorage(
  storage: DurableObjectStateLike["storage"],
  policy: GatewayApiKeyRequestQuotaPolicy,
  now = Date.now()
): Promise<ConsumeGatewayKeyQuotaDecision> {
  const windowMs = policy.windowSeconds * 1000;
  const windowStartedAt = now - (now % windowMs);
  const existing = await storage.get<GatewayKeyQuotaStorage>("request_quota");
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

  if (current.count >= policy.limit) {
    return {
      allowed: false,
      limit: policy.limit,
      remaining: 0,
      resetAt: new Date(resetAtTimestamp).toISOString(),
      retryAfterSeconds
    };
  }

  const nextCount = current.count + 1;
  await storage.put("request_quota", {
    windowStartedAt,
    count: nextCount
  });

  return {
    allowed: true,
    limit: policy.limit,
    remaining: Math.max(0, policy.limit - nextCount),
    resetAt: new Date(resetAtTimestamp).toISOString(),
    retryAfterSeconds
  };
}
