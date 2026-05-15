import type {
  GatewayApiKeyRecord,
  GatewayApiKeyTokenQuotaPolicy
} from "@airlock/governance";
import { GatewayError } from "@airlock/shared";

import type { GatewayBindings } from "./env.js";
import type { DurableObjectStateLike } from "./durable-object-state.js";

interface GatewayKeyTokenQuotaDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  used: number;
  reserved: number;
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

interface GatewayKeyTokenQuotaReserveRequest {
  kind: "reserve";
  limit: number;
  windowSeconds: number;
  reservationId: string;
  tokens: number;
  ttlMs: number;
}

interface GatewayKeyTokenQuotaReleaseRequest {
  kind: "release";
  limit: number;
  windowSeconds: number;
  reservationId: string;
}

interface GatewayKeyTokenQuotaReconcileRequest {
  kind: "reconcile";
  limit: number;
  windowSeconds: number;
  reservationId: string;
  actualTokens: number;
}

interface GatewayKeyTokenQuotaReservation {
  reservationId: string;
  tokens: number;
  expiresAt: number;
}

interface GatewayKeyTokenQuotaStorage {
  windowStartedAt?: number;
  usedTokens?: number;
  reservations?: GatewayKeyTokenQuotaReservation[];
}



export interface GatewayKeyTokenReservationHandle {
  reservationId: string;
  reservedTokens: number;
}

type GatewayKeyTokenQuotaRequest =
  | GatewayKeyTokenQuotaPrecheckRequest
  | GatewayKeyTokenQuotaChargeRequest
  | GatewayKeyTokenQuotaReserveRequest
  | GatewayKeyTokenQuotaReleaseRequest
  | GatewayKeyTokenQuotaReconcileRequest;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseTokenQuotaDecision(value: unknown): GatewayKeyTokenQuotaDecision {
  if (!isRecord(value)) {
    throw new Error("Token quota decision must be an object");
  }

  const {
    allowed,
    limit,
    remaining,
    used,
    reserved,
    resetAt,
    retryAfterSeconds
  } = value;

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
    typeof reserved !== "number" ||
    !Number.isInteger(reserved) ||
    reserved < 0 ||
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
    reserved,
    resetAt,
    retryAfterSeconds
  };
}

function createWindowState(
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

function getReservedTokens(
  reservations: GatewayKeyTokenQuotaReservation[]
): number {
  return reservations.reduce((sum, reservation) => {
    return sum + reservation.tokens;
  }, 0);
}

function createTokenQuotaDecision(
  policy: GatewayApiKeyTokenQuotaPolicy,
  usedTokens: number,
  reservedTokens: number,
  now: number
): GatewayKeyTokenQuotaDecision {
  const windowMs = policy.windowSeconds * 1000;
  const windowStartedAt = now - (now % windowMs);
  const resetAtTimestamp = windowStartedAt + windowMs;
  const committedAndReserved = usedTokens + reservedTokens;

  return {
    allowed: committedAndReserved < policy.limit,
    limit: policy.limit,
    remaining: Math.max(0, policy.limit - committedAndReserved),
    used: usedTokens,
    reserved: reservedTokens,
    resetAt: new Date(resetAtTimestamp).toISOString(),
    retryAfterSeconds: Math.max(
      0,
      Math.ceil((resetAtTimestamp - now) / 1000)
    )
  };
}

function createTokenQuotaReservationId(requestId: string): string {
  return `tkq_${requestId}`;
}

export class GatewayKeyTokenQuotaDurableObject {
  constructor(private readonly state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    const body = (await request.json()) as GatewayKeyTokenQuotaRequest;

    switch (body.kind) {
      case "precheck":
        return Response.json(
          await precheckGatewayKeyTokenQuotaFromStorage(this.state.storage, body)
        );
      case "charge":
        return Response.json(
          await chargeGatewayKeyTokenQuotaFromStorage(this.state.storage, body)
        );
      case "reserve":
        return Response.json(
          await reserveGatewayKeyTokenQuotaFromStorage(this.state.storage, body)
        );
      case "release":
        return Response.json(
          await releaseGatewayKeyTokenQuotaReservationFromStorage(
            this.state.storage,
            body
          )
        );
      case "reconcile":
        return Response.json(
          await reconcileGatewayKeyTokenQuotaReservationFromStorage(
            this.state.storage,
            body
          )
        );
    }
  }
}

async function callGatewayKeyTokenQuota(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string,
  body: GatewayKeyTokenQuotaRequest
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

export async function reserveGatewayKeyTokenQuota(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string,
  tokens: number,
  ttlMs: number
): Promise<GatewayKeyTokenReservationHandle | undefined> {
  const tokenQuota = gatewayApiKey.policy?.tokenQuota;

  if (!tokenQuota) {
    return undefined;
  }

  if (!Number.isInteger(tokens) || tokens <= 0) {
    return undefined;
  }

  const reservationId = createTokenQuotaReservationId(requestId);
  const decision = await callGatewayKeyTokenQuota(env, gatewayApiKey, requestId, {
    kind: "reserve",
    limit: tokenQuota.limit,
    windowSeconds: tokenQuota.windowSeconds,
    reservationId,
    tokens,
    ttlMs
  });

  if (!decision.allowed) {
    throw createGatewayKeyTokenQuotaExceededError(decision, requestId);
  }

  return {
    reservationId,
    reservedTokens: tokens
  };
}

export async function releaseGatewayKeyTokenQuotaReservation(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string,
  reservation: GatewayKeyTokenReservationHandle | undefined
): Promise<void> {
  const tokenQuota = gatewayApiKey.policy?.tokenQuota;

  if (!tokenQuota || !reservation) {
    return;
  }

  await callGatewayKeyTokenQuota(env, gatewayApiKey, requestId, {
    kind: "release",
    limit: tokenQuota.limit,
    windowSeconds: tokenQuota.windowSeconds,
    reservationId: reservation.reservationId
  });
}

export async function reconcileGatewayKeyTokenQuotaReservation(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string,
  reservation: GatewayKeyTokenReservationHandle | undefined,
  actualTokens: number
): Promise<void> {
  const tokenQuota = gatewayApiKey.policy?.tokenQuota;

  if (!tokenQuota) {
    return;
  }

  if (!Number.isInteger(actualTokens) || actualTokens < 0) {
    throw new GatewayError("Gateway key token usage is invalid", {
      code: "gateway_key_token_quota_invalid_usage",
      category: "governance",
      httpStatus: 503,
      retryable: false,
      requestId
    });
  }

  if (!reservation) {
    await callGatewayKeyTokenQuota(env, gatewayApiKey, requestId, {
      kind: "charge",
      limit: tokenQuota.limit,
      windowSeconds: tokenQuota.windowSeconds,
      tokens: actualTokens
    });
    return;
  }

  await callGatewayKeyTokenQuota(env, gatewayApiKey, requestId, {
    kind: "reconcile",
    limit: tokenQuota.limit,
    windowSeconds: tokenQuota.windowSeconds,
    reservationId: reservation.reservationId,
    actualTokens
  });
}

export async function chargeGatewayKeyTokenQuota(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string,
  tokens: number
): Promise<void> {
  await reconcileGatewayKeyTokenQuotaReservation(
    env,
    gatewayApiKey,
    requestId,
    undefined,
    tokens
  );
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
    windowStartedAt,
    now
  );

  return createTokenQuotaDecision(
    policy,
    current.usedTokens,
    getReservedTokens(current.reservations),
    now
  );
}

export async function reserveGatewayKeyTokenQuotaFromStorage(
  storage: DurableObjectStateLike["storage"],
  request: GatewayKeyTokenQuotaReserveRequest,
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
    windowStartedAt,
    now
  );
  const nextReservations = [
    ...current.reservations.filter((reservation) => {
      return reservation.reservationId !== request.reservationId;
    }),
    {
      reservationId: request.reservationId,
      tokens: request.tokens,
      expiresAt: now + request.ttlMs
    }
  ];
  const reservedTokens = getReservedTokens(nextReservations);
  const decision = createTokenQuotaDecision(
    policy,
    current.usedTokens,
    reservedTokens,
    now
  );

  if (!decision.allowed) {
    return decision;
  }

  await storage.put("token_quota", {
    windowStartedAt,
    usedTokens: current.usedTokens,
    reservations: nextReservations
  });

  return decision;
}

export async function releaseGatewayKeyTokenQuotaReservationFromStorage(
  storage: DurableObjectStateLike["storage"],
  request: GatewayKeyTokenQuotaReleaseRequest,
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
    windowStartedAt,
    now
  );
  const nextReservations = current.reservations.filter((reservation) => {
    return reservation.reservationId !== request.reservationId;
  });

  await storage.put("token_quota", {
    windowStartedAt,
    usedTokens: current.usedTokens,
    reservations: nextReservations
  });

  return createTokenQuotaDecision(
    policy,
    current.usedTokens,
    getReservedTokens(nextReservations),
    now
  );
}

export async function reconcileGatewayKeyTokenQuotaReservationFromStorage(
  storage: DurableObjectStateLike["storage"],
  request: GatewayKeyTokenQuotaReconcileRequest,
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
    windowStartedAt,
    now
  );
  const reservation = current.reservations.find((candidate) => {
    return candidate.reservationId === request.reservationId;
  });
  const nextReservations = current.reservations.filter((candidate) => {
    return candidate.reservationId !== request.reservationId;
  });
  const nextUsedTokens =
    current.usedTokens + request.actualTokens - (reservation?.tokens ?? 0);

  await storage.put("token_quota", {
    windowStartedAt,
    usedTokens: Math.max(0, nextUsedTokens),
    reservations: nextReservations
  });

  return createTokenQuotaDecision(
    policy,
    Math.max(0, nextUsedTokens),
    getReservedTokens(nextReservations),
    now
  );
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
    windowStartedAt,
    now
  );
  const usedTokens = current.usedTokens + request.tokens;

  await storage.put("token_quota", {
    windowStartedAt,
    usedTokens,
    reservations: current.reservations
  });

  return createTokenQuotaDecision(
    policy,
    usedTokens,
    getReservedTokens(current.reservations),
    now
  );
}
