import type {
  GatewayApiKeyConcurrencyQuotaPolicy,
  GatewayApiKeyRecord,
  GatewayKeyConcurrencyAcquireRequest,
  GatewayKeyConcurrencyDecision,
  GatewayKeyConcurrencyLease,
  GatewayKeyConcurrencyReleaseRequest
} from "@airlock/governance";
import {
  isGatewayKeyConcurrencyLease,
  parseConcurrencyDecision,
  getConcurrencyLeaseTtlMs,
  createConcurrencyDecision,
  createGatewayKeyConcurrencyExceededError,
  createGatewayKeyConcurrencyHeaders
} from "@airlock/governance";
import { GatewayError } from "@airlock/shared";

import type { GatewayBindings } from "./env.js";
import type { DurableObjectStateLike } from "./durable-object-state.js";

// Re-export governance functions consumed by route handlers
export {
  createGatewayKeyConcurrencyExceededError,
  createGatewayKeyConcurrencyHeaders
};

export class GatewayKeyConcurrencyDurableObject {
  constructor(private readonly state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method === "POST") {
      const body =
        (await request.json()) as GatewayKeyConcurrencyAcquireRequest;
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
      const body =
        (await request.json()) as GatewayKeyConcurrencyReleaseRequest;
      await releaseGatewayKeyConcurrencyLeaseFromStorage(
        this.state.storage,
        body.leaseId
      );
      return new Response(null, { status: 204 });
    }

    return new Response("Method not allowed", { status: 405 });
  }
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

async function acquireGatewayKeyConcurrencyLeaseFromStorage(
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

  const nextLeases: GatewayKeyConcurrencyLease[] = [
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

async function releaseGatewayKeyConcurrencyLeaseFromStorage(
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
