import type {
  GatewayApiKeyConcurrencyQuotaPolicy,
  GatewayApiKeyRecord
} from "@airlock/governance";
import { GatewayError } from "@airlock/shared";

import type { GatewayBindings } from "./env.js";

interface GatewayKeyConcurrencyAcquireRequest {
  kind: "acquire";
  limit: number;
  leaseId: string;
  ttlMs: number;
}

interface GatewayKeyConcurrencyReleaseRequest {
  leaseId: string;
}

interface GatewayKeyConcurrencyLease {
  leaseId: string;
  expiresAt: number;
}

interface GatewayKeyConcurrencyDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: string;
  retryAfterSeconds: number;
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

function parseConcurrencyDecision(value: unknown): GatewayKeyConcurrencyDecision {
  if (!isRecord(value)) {
    throw new Error("Concurrency decision must be an object");
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
    throw new Error("Concurrency decision is invalid");
  }

  return {
    allowed,
    limit,
    remaining,
    resetAt,
    retryAfterSeconds
  };
}

function isGatewayKeyConcurrencyLease(
  value: unknown
): value is GatewayKeyConcurrencyLease {
  return (
    isRecord(value) &&
    typeof value.leaseId === "string" &&
    typeof value.expiresAt === "number" &&
    Number.isInteger(value.expiresAt)
  );
}

export class GatewayKeyConcurrencyDurableObject {
  constructor(private readonly state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method === "POST") {
      const body = (await request.json()) as GatewayKeyConcurrencyAcquireRequest;
      const decision = await acquireGatewayKeyConcurrencyLeaseFromStorage(
        this.state.storage,
        {
          limit: body.limit
        },
        body.leaseId,
        body.ttlMs
      );

      return Response.json(decision);
    }

    if (request.method === "DELETE") {
      const body = (await request.json()) as GatewayKeyConcurrencyReleaseRequest;
      await releaseGatewayKeyConcurrencyLeaseFromStorage(
        this.state.storage,
        body.leaseId
      );
      return new Response(null, { status: 204 });
    }

    return new Response("Method not allowed", { status: 405 });
  }
}

function getConcurrencyLeaseTtlMs(providerTimeoutMs: number): number {
  return Math.max(1000, providerTimeoutMs);
}

async function readActiveLeases(
  storage: DurableObjectStateLike["storage"],
  now = Date.now()
): Promise<GatewayKeyConcurrencyLease[]> {
  const stored = await storage.get<unknown>("leases");
  const leases = Array.isArray(stored)
    ? stored.filter(isGatewayKeyConcurrencyLease)
    : [];
  const activeLeases = leases.filter((lease) => {
    return lease.expiresAt > now;
  });

  if (activeLeases.length !== leases.length) {
    await storage.put("leases", activeLeases);
  }

  return activeLeases;
}

function createConcurrencyDecision(
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
  const resetAtTimestamp = Number.isFinite(nextResetAt) ? nextResetAt : now + ttlMs;

  return {
    allowed: activeLeases.length < limit,
    limit,
    remaining: Math.max(0, limit - activeLeases.length),
    resetAt: new Date(resetAtTimestamp).toISOString(),
    retryAfterSeconds: Math.max(
      0,
      Math.ceil((resetAtTimestamp - now) / 1000)
    )
  };
}

export async function acquireGatewayKeyConcurrencyLeaseFromStorage(
  storage: DurableObjectStateLike["storage"],
  policy: GatewayApiKeyConcurrencyQuotaPolicy,
  leaseId: string,
  ttlMs: number,
  now = Date.now()
): Promise<GatewayKeyConcurrencyDecision> {
  const activeLeases = await readActiveLeases(storage, now);

  if (activeLeases.length >= policy.limit) {
    return {
      ...createConcurrencyDecision(policy.limit, activeLeases, ttlMs, now),
      allowed: false
    };
  }

  const nextLeases = [
    ...activeLeases,
    {
      leaseId,
      expiresAt: now + ttlMs
    }
  ];
  await storage.put("leases", nextLeases);

  return {
    ...createConcurrencyDecision(policy.limit, nextLeases, ttlMs, now),
    allowed: true
  };
}

export async function releaseGatewayKeyConcurrencyLeaseFromStorage(
  storage: DurableObjectStateLike["storage"],
  leaseId: string,
  now = Date.now()
): Promise<void> {
  const activeLeases = await readActiveLeases(storage, now);
  await storage.put(
    "leases",
    activeLeases.filter((lease) => {
      return lease.leaseId !== leaseId;
    })
  );
}

export async function acquireGatewayKeyConcurrencyLease(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string,
  providerTimeoutMs: number
): Promise<string | undefined> {
  const concurrencyQuota = gatewayApiKey.policy?.concurrencyQuota;

  if (!concurrencyQuota) {
    return undefined;
  }

  const namespace = env.AIRLOCK_GATEWAY_KEY_CONCURRENCY;

  if (!namespace) {
    throw new GatewayError("Gateway key concurrency subsystem is unavailable", {
      code: "gateway_key_concurrency_unavailable",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId
    });
  }

  const leaseId = crypto.randomUUID();
  const ttlMs = getConcurrencyLeaseTtlMs(providerTimeoutMs);
  const stub = namespace.get(namespace.idFromName(gatewayApiKey.id));
  let response: Response;

  try {
    response = await stub.fetch(
      new Request("https://airlock.internal/gateway-key-concurrency/acquire", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          kind: "acquire",
          limit: concurrencyQuota.limit,
          leaseId,
          ttlMs
        } satisfies GatewayKeyConcurrencyAcquireRequest)
      })
    );
  } catch (cause) {
    throw new GatewayError("Gateway key concurrency subsystem is unavailable", {
      code: "gateway_key_concurrency_unavailable",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId,
      cause
    });
  }

  if (!response.ok) {
    throw new GatewayError("Gateway key concurrency subsystem is unavailable", {
      code: "gateway_key_concurrency_unavailable",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId
    });
  }

  let decision: GatewayKeyConcurrencyDecision;

  try {
    decision = parseConcurrencyDecision(await response.json());
  } catch (cause) {
    throw new GatewayError(
      "Gateway key concurrency subsystem returned an invalid response",
      {
        code: "gateway_key_concurrency_invalid_response",
        category: "governance",
        httpStatus: 503,
        retryable: true,
        requestId,
        cause
      }
    );
  }

  if (decision.allowed) {
    return leaseId;
  }

  throw createGatewayKeyConcurrencyExceededError(decision, requestId);
}

export async function releaseGatewayKeyConcurrencyLease(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  leaseId: string | undefined,
  requestId: string
): Promise<void> {
  if (!leaseId) {
    return;
  }

  const namespace = env.AIRLOCK_GATEWAY_KEY_CONCURRENCY;

  if (!namespace) {
    throw new GatewayError("Gateway key concurrency subsystem is unavailable", {
      code: "gateway_key_concurrency_unavailable",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId
    });
  }

  const stub = namespace.get(namespace.idFromName(gatewayApiKey.id));

  try {
    const response = await stub.fetch(
      new Request("https://airlock.internal/gateway-key-concurrency/release", {
        method: "DELETE",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          leaseId
        } satisfies GatewayKeyConcurrencyReleaseRequest)
      })
    );

    if (!response.ok && response.status !== 204) {
      throw new Error("Unexpected concurrency release response");
    }
  } catch (cause) {
    throw new GatewayError("Gateway key concurrency subsystem is unavailable", {
      code: "gateway_key_concurrency_unavailable",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId,
      cause
    });
  }
}

export function createGatewayKeyConcurrencyExceededError(
  decision: GatewayKeyConcurrencyDecision,
  requestId: string
): GatewayError {
  return new GatewayError("Gateway API key concurrency quota exceeded", {
    code: "quota_concurrency_exceeded",
    category: "rate_limit",
    httpStatus: 429,
    retryable: false,
    requestId,
    headers: createGatewayKeyConcurrencyHeaders(decision)
  });
}

export function createGatewayKeyConcurrencyHeaders(
  decision: GatewayKeyConcurrencyDecision
): Record<string, string> {
  return {
    "retry-after": String(decision.retryAfterSeconds),
    "x-ratelimit-limit": String(decision.limit),
    "x-ratelimit-remaining": String(decision.remaining),
    "x-ratelimit-reset": decision.resetAt
  };
}
