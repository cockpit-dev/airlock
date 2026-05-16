import type {
  GatewayApiKeyRecord,
  GatewayApiKeyRequestQuotaPolicy,
  ConsumeGatewayKeyQuotaRequest,
  ConsumeGatewayKeyQuotaDecision,
  GatewayKeyQuotaStorage
} from "@airlock/governance";
import {
  parseQuotaDecision,
  computeRequestQuotaConsume,
  createGatewayKeyQuotaExceededError,
  createGatewayKeyQuotaHeaders
} from "@airlock/governance";
import { GatewayError } from "@airlock/shared";

import type { GatewayBindings } from "./env.js";
import type { DurableObjectStateLike } from "./durable-object-state.js";

// Re-export governance functions consumed by route handlers
export { createGatewayKeyQuotaExceededError, createGatewayKeyQuotaHeaders };

export class GatewayKeyQuotaDurableObject {
  constructor(private readonly state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    const body = (await request.json()) as ConsumeGatewayKeyQuotaRequest;
    const decision = await consumeGatewayKeyQuotaFromStorage(
      this.state.storage,
      body
    );

    return Response.json(decision);
  }
}

export async function enforceGatewayKeyRequestQuota(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string
): Promise<ConsumeGatewayKeyQuotaDecision | undefined> {
  const requestQuota = gatewayApiKey.policy?.requestQuota;

  if (!requestQuota) {
    return undefined;
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
    throw new GatewayError(
      "Gateway key quota subsystem returned an invalid response",
      {
        code: "gateway_key_quota_invalid_response",
        category: "governance",
        httpStatus: 503,
        retryable: true,
        requestId,
        cause
      }
    );
  }

  if (!decision.allowed) {
    throw createGatewayKeyQuotaExceededError(decision, requestId);
  }

  return decision;
}

export async function consumeGatewayKeyQuotaFromStorage(
  storage: DurableObjectStateLike["storage"],
  policy: GatewayApiKeyRequestQuotaPolicy,
  now = Date.now()
): Promise<ConsumeGatewayKeyQuotaDecision> {
  const existing = await storage.get<GatewayKeyQuotaStorage>("request_quota");
  const { decision, nextState } = computeRequestQuotaConsume(
    existing,
    policy.limit,
    policy.windowSeconds,
    now
  );

  if (decision.allowed) {
    await storage.put("request_quota", nextState);
  }

  return decision;
}
