import type {
  GatewayApiKeyRecord,
  GatewayApiKeyTokenQuotaPolicy,
  GatewayKeyTokenQuotaDecision,
  GatewayKeyTokenQuotaPrecheckRequest,
  GatewayKeyTokenQuotaChargeRequest,
  GatewayKeyTokenQuotaReserveRequest,
  GatewayKeyTokenQuotaReleaseRequest,
  GatewayKeyTokenQuotaReconcileRequest,
  GatewayKeyTokenQuotaRequest,
  GatewayKeyTokenQuotaReservation,
  GatewayKeyTokenQuotaStorage,
  GatewayKeyTokenReservationHandle
} from "@airlock/governance";
import {
  parseTokenQuotaDecision,
  createTokenQuotaWindowState,
  getReservedTokens,
  createTokenQuotaDecision,
  createTokenQuotaReservationId,
  assertGatewayKeyTokenUsageAvailable,
  createGatewayKeyTokenQuotaHeaders,
  createGatewayKeyTokenQuotaExceededError
} from "@airlock/governance";
import { GatewayError } from "@airlock/shared";

import type { GatewayBindings } from "./env.js";
import type { DurableObjectStateLike } from "./durable-object-state.js";

// Re-export governance types and functions consumed by route handlers
export {
  assertGatewayKeyTokenUsageAvailable,
  createGatewayKeyTokenQuotaHeaders,
  createGatewayKeyTokenQuotaExceededError,
  type GatewayKeyTokenReservationHandle
};

export class GatewayKeyTokenQuotaDurableObject {
  constructor(private readonly state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    const body = (await request.json()) as GatewayKeyTokenQuotaRequest;

    switch (body.kind) {
      case "precheck":
        return Response.json(
          await precheckGatewayKeyTokenQuotaFromStorage(
            this.state.storage,
            body
          )
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

  const decision = await callGatewayKeyTokenQuota(
    env,
    gatewayApiKey,
    requestId,
    {
      kind: "precheck",
      limit: tokenQuota.limit,
      windowSeconds: tokenQuota.windowSeconds
    }
  );

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
  const decision = await callGatewayKeyTokenQuota(
    env,
    gatewayApiKey,
    requestId,
    {
      kind: "reserve",
      limit: tokenQuota.limit,
      windowSeconds: tokenQuota.windowSeconds,
      reservationId,
      tokens,
      ttlMs
    }
  );

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

export async function precheckGatewayKeyTokenQuotaFromStorage(
  storage: DurableObjectStateLike["storage"],
  request: GatewayKeyTokenQuotaPrecheckRequest,
  now = Date.now()
): Promise<GatewayKeyTokenQuotaDecision> {
  const policy: GatewayApiKeyTokenQuotaPolicy = {
    limit: request.limit,
    windowSeconds: request.windowSeconds
  };
  const windowMs = policy.windowSeconds * 1000;
  const windowStartedAt = now - (now % windowMs);
  const current = createTokenQuotaWindowState(
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
  const policy: GatewayApiKeyTokenQuotaPolicy = {
    limit: request.limit,
    windowSeconds: request.windowSeconds
  };
  const windowMs = policy.windowSeconds * 1000;
  const windowStartedAt = now - (now % windowMs);
  const current = createTokenQuotaWindowState(
    await storage.get<GatewayKeyTokenQuotaStorage>("token_quota"),
    windowStartedAt,
    now
  );
  const nextReservations: GatewayKeyTokenQuotaReservation[] = [
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
  const policy: GatewayApiKeyTokenQuotaPolicy = {
    limit: request.limit,
    windowSeconds: request.windowSeconds
  };
  const windowMs = policy.windowSeconds * 1000;
  const windowStartedAt = now - (now % windowMs);
  const current = createTokenQuotaWindowState(
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
  const policy: GatewayApiKeyTokenQuotaPolicy = {
    limit: request.limit,
    windowSeconds: request.windowSeconds
  };
  const windowMs = policy.windowSeconds * 1000;
  const windowStartedAt = now - (now % windowMs);
  const current = createTokenQuotaWindowState(
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
  const policy: GatewayApiKeyTokenQuotaPolicy = {
    limit: request.limit,
    windowSeconds: request.windowSeconds
  };
  const windowMs = policy.windowSeconds * 1000;
  const windowStartedAt = now - (now % windowMs);
  const current = createTokenQuotaWindowState(
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
