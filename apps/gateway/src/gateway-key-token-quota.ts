import type {
  GatewayApiKeyRecord,
  GatewayApiKeyTokenQuotaPolicy
} from "@airlock/governance";
import { GatewayError } from "@airlock/shared";

import type { GatewayBindings } from "./env.js";

interface GatewayKeyTokenQuotaDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  used: number;
  resetAt: string;
  retryAfterSeconds: number;
}

interface GatewayKeyTokenQuotaPrecheckRequest {
  kind: "precheck";
  limit: number;
  windowSeconds: number;
}

interface GatewayKeyTokenQuotaChargeRequest {
  kind: "charge";
  limit: number;
  windowSeconds: number;
  tokens: number;
}

interface GatewayKeyTokenQuotaStorage {
  windowStartedAt?: number;
  usedTokens?: number;
}

interface DurableObjectStateLike {
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseTokenQuotaDecision(value: unknown): GatewayKeyTokenQuotaDecision {
  if (!isRecord(value)) {
    throw new Error("Token quota decision must be an object");
  }

  const { allowed, limit, remaining, used, resetAt, retryAfterSeconds } = value;

  if (
    typeof allowed !== "boolean" ||
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit <= 0 ||
    typeof remaining !== "number" ||
    !Number.isInteger(remaining) ||
    remaining < 0 ||
    typeof used !== "number" ||
    !Number.isInteger(used) ||
    used < 0 ||
    typeof resetAt !== "string" ||
    Number.isNaN(Date.parse(resetAt)) ||
    typeof retryAfterSeconds !== "number" ||
    !Number.isInteger(retryAfterSeconds) ||
    retryAfterSeconds < 0
  ) {
    throw new Error("Token quota decision is invalid");
  }

  return {
    allowed,
    limit,
    remaining,
    used,
    resetAt,
    retryAfterSeconds
  };
}

function createWindowState(
  existing: GatewayKeyTokenQuotaStorage | undefined,
  windowStartedAt: number
): {
  windowStartedAt: number;
  usedTokens: number;
} {
  return existing?.windowStartedAt === windowStartedAt
    ? {
        windowStartedAt,
        usedTokens: existing.usedTokens ?? 0
      }
    : {
        windowStartedAt,
        usedTokens: 0
      };
}

function createTokenQuotaDecision(
  policy: GatewayApiKeyTokenQuotaPolicy,
  usedTokens: number,
  now: number
): GatewayKeyTokenQuotaDecision {
  const windowMs = policy.windowSeconds * 1000;
  const windowStartedAt = now - (now % windowMs);
  const resetAtTimestamp = windowStartedAt + windowMs;

  return {
    allowed: usedTokens < policy.limit,
    limit: policy.limit,
    remaining: Math.max(0, policy.limit - usedTokens),
    used: usedTokens,
    resetAt: new Date(resetAtTimestamp).toISOString(),
    retryAfterSeconds: Math.max(
      0,
      Math.ceil((resetAtTimestamp - now) / 1000)
    )
  };
}

export class GatewayKeyTokenQuotaDurableObject {
  constructor(private readonly state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    const body = (await request.json()) as
      | GatewayKeyTokenQuotaPrecheckRequest
      | GatewayKeyTokenQuotaChargeRequest;

    if (body.kind === "precheck") {
      return Response.json(
        await precheckGatewayKeyTokenQuotaFromStorage(this.state.storage, body)
      );
    }

    return Response.json(
      await chargeGatewayKeyTokenQuotaFromStorage(this.state.storage, body)
    );
  }
}

async function callGatewayKeyTokenQuota(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string,
  body: GatewayKeyTokenQuotaPrecheckRequest | GatewayKeyTokenQuotaChargeRequest
): Promise<GatewayKeyTokenQuotaDecision> {
  const namespace = env.AIRLOCK_GATEWAY_KEY_TOKEN_QUOTA;

  if (!namespace) {
    throw new GatewayError("Gateway key token quota subsystem is unavailable", {
      code: "gateway_key_token_quota_unavailable",
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
      new Request("https://airlock.internal/gateway-key-token-quota", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body)
      })
    );
  } catch (cause) {
    throw new GatewayError("Gateway key token quota subsystem is unavailable", {
      code: "gateway_key_token_quota_unavailable",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId,
      cause
    });
  }

  if (!response.ok) {
    throw new GatewayError("Gateway key token quota subsystem is unavailable", {
      code: "gateway_key_token_quota_unavailable",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId
    });
  }

  try {
    return parseTokenQuotaDecision(await response.json());
  } catch (cause) {
    throw new GatewayError(
      "Gateway key token quota subsystem returned an invalid response",
      {
        code: "gateway_key_token_quota_invalid_response",
        category: "governance",
        httpStatus: 503,
        retryable: true,
        requestId,
        cause
      }
    );
  }
}

export async function enforceGatewayKeyTokenQuotaPrecheck(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string
): Promise<void> {
  const tokenQuota = gatewayApiKey.policy?.tokenQuota;

  if (!tokenQuota) {
    return;
  }

  const decision = await callGatewayKeyTokenQuota(env, gatewayApiKey, requestId, {
    kind: "precheck",
    limit: tokenQuota.limit,
    windowSeconds: tokenQuota.windowSeconds
  });

  if (decision.allowed) {
    return;
  }

  throw createGatewayKeyTokenQuotaExceededError(decision, requestId);
}

export async function chargeGatewayKeyTokenQuota(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string,
  tokens: number
): Promise<void> {
  const tokenQuota = gatewayApiKey.policy?.tokenQuota;

  if (!tokenQuota) {
    return;
  }

  if (!Number.isInteger(tokens) || tokens < 0) {
    throw new GatewayError("Gateway key token usage is invalid", {
      code: "gateway_key_token_quota_invalid_usage",
      category: "governance",
      httpStatus: 503,
      retryable: false,
      requestId
    });
  }

  await callGatewayKeyTokenQuota(env, gatewayApiKey, requestId, {
    kind: "charge",
    limit: tokenQuota.limit,
    windowSeconds: tokenQuota.windowSeconds,
    tokens
  });
}

export function assertGatewayKeyTokenUsageAvailable(
  gatewayApiKey: GatewayApiKeyRecord,
  usage:
    | {
        totalTokens: number;
      }
    | undefined,
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
    throw new GatewayError("Gateway key token quota requires upstream usage data", {
      code: "gateway_key_token_quota_usage_unavailable",
      category: "governance",
      httpStatus: 503,
      retryable: false,
      requestId
    });
  }
}

export function createGatewayKeyTokenQuotaHeaders(
  decision: GatewayKeyTokenQuotaDecision
): Record<string, string> {
  return {
    "retry-after": String(decision.retryAfterSeconds),
    "x-ratelimit-limit": String(decision.limit),
    "x-ratelimit-remaining": String(decision.remaining),
    "x-ratelimit-reset": decision.resetAt
  };
}

export function createGatewayKeyTokenQuotaExceededError(
  decision: GatewayKeyTokenQuotaDecision,
  requestId: string
): GatewayError {
  return new GatewayError("Gateway API key token quota exceeded", {
    code: "quota_tokens_exceeded",
    category: "rate_limit",
    httpStatus: 429,
    retryable: false,
    requestId,
    headers: createGatewayKeyTokenQuotaHeaders(decision)
  });
}

export async function precheckGatewayKeyTokenQuotaFromStorage(
  storage: DurableObjectStateLike["storage"],
  policy: GatewayApiKeyTokenQuotaPolicy,
  now = Date.now()
): Promise<GatewayKeyTokenQuotaDecision> {
  const windowMs = policy.windowSeconds * 1000;
  const windowStartedAt = now - (now % windowMs);
  const current = createWindowState(
    await storage.get<GatewayKeyTokenQuotaStorage>("token_quota"),
    windowStartedAt
  );

  return createTokenQuotaDecision(policy, current.usedTokens, now);
}

export async function chargeGatewayKeyTokenQuotaFromStorage(
  storage: DurableObjectStateLike["storage"],
  request: GatewayKeyTokenQuotaChargeRequest,
  now = Date.now()
): Promise<GatewayKeyTokenQuotaDecision> {
  const policy = {
    limit: request.limit,
    windowSeconds: request.windowSeconds
  } satisfies GatewayApiKeyTokenQuotaPolicy;
  const windowMs = policy.windowSeconds * 1000;
  const windowStartedAt = now - (now % windowMs);
  const current = createWindowState(
    await storage.get<GatewayKeyTokenQuotaStorage>("token_quota"),
    windowStartedAt
  );
  const usedTokens = current.usedTokens + request.tokens;

  await storage.put("token_quota", {
    windowStartedAt,
    usedTokens
  });

  return createTokenQuotaDecision(policy, usedTokens, now);
}
