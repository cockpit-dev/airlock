import {
  evaluateGatewayApiKeyLifecycle,
  type GatewayApiKeyLifecycleStatus,
  type GatewayApiKeyRecord
} from "@airlock/governance";
import { GatewayError } from "@airlock/shared";

import type { GatewayBindings } from "./env.js";
import {
  createGatewayApiKeyRegistrySnapshot,
  getGatewayRegistryApiKey,
  listGatewayRegistryApiKeys,
  type GatewayApiKeyRegistrySnapshot,
  type GatewayApiKeyStatusView
} from "./gateway-key-registry.js";

interface GatewayKeyRevocationState {
  revoked: boolean;
  updatedAt: string;
}

interface DurableObjectStateLike {
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
  };
}

const DEFAULT_REVOCATION_STATE: GatewayKeyRevocationState = {
  revoked: false,
  updatedAt: new Date(0).toISOString()
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseRevocationState(value: unknown): GatewayKeyRevocationState {
  if (!isRecord(value)) {
    throw new Error("Revocation state must be an object");
  }

  const { revoked, updatedAt } = value;

  if (
    typeof revoked !== "boolean" ||
    typeof updatedAt !== "string" ||
    Number.isNaN(Date.parse(updatedAt))
  ) {
    throw new Error("Revocation state is invalid");
  }

  return {
    revoked,
    updatedAt
  };
}

export class GatewayKeyRevocationDurableObject {
  constructor(private readonly state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    switch (request.method) {
      case "GET":
        return Response.json(
          await readGatewayKeyRevocationState(this.state.storage)
        );
      case "POST":
        return Response.json(
          await writeGatewayKeyRevocationState(this.state.storage, true)
        );
      case "DELETE":
        return Response.json(
          await writeGatewayKeyRevocationState(this.state.storage, false)
        );
      default:
        return new Response("Method not allowed", { status: 405 });
    }
  }
}

export async function assertGatewayKeyNotRevoked(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string
): Promise<void> {
  if (gatewayApiKey.status === "revoked") {
    throw createUnauthorizedGatewayKeyError(requestId);
  }

  const namespace = env.AIRLOCK_GATEWAY_KEY_REVOCATION;

  if (!namespace) {
    return;
  }

  const stub = namespace.get(namespace.idFromName(gatewayApiKey.id));
  let response: Response;

  try {
    response = await stub.fetch(
      new Request("https://airlock.internal/gateway-key-revocation", {
        method: "GET"
      })
    );
  } catch (cause) {
    throw new GatewayError("Gateway key revocation subsystem is unavailable", {
      code: "gateway_key_revocation_unavailable",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId,
      cause
    });
  }

  if (!response.ok) {
    throw new GatewayError("Gateway key revocation subsystem is unavailable", {
      code: "gateway_key_revocation_unavailable",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId
    });
  }

  let state: GatewayKeyRevocationState;

  try {
    state = parseRevocationState(await response.json());
  } catch (cause) {
    throw new GatewayError(
      "Gateway key revocation subsystem returned an invalid response",
      {
        code: "gateway_key_revocation_invalid_response",
        category: "governance",
        httpStatus: 503,
        retryable: true,
        requestId,
        cause
      }
    );
  }

  if (state.revoked) {
    throw createUnauthorizedGatewayKeyError(requestId);
  }
}

export function assertInternalAdminAuthorization(
  authorization: string | undefined,
  adminToken: string | undefined,
  requestId: string
) {
  if (!adminToken) {
    throw new GatewayError("Internal admin token is not configured", {
      code: "config_missing_internal_admin_token",
      category: "configuration",
      httpStatus: 500,
      retryable: false,
      requestId
    });
  }

  if (authorization !== `Bearer ${adminToken}`) {
    throw new GatewayError("Unauthorized", {
      code: "auth_invalid_admin_token",
      category: "authentication",
      httpStatus: 401,
      retryable: false,
      requestId
    });
  }
}

export function resolveGatewayApiKeyById(
  gatewayApiKeys: readonly GatewayApiKeyRecord[],
  keyId: string,
  requestId: string
): GatewayApiKeyRecord {
  const gatewayApiKey = gatewayApiKeys.find((candidate) => candidate.id === keyId);

  if (!gatewayApiKey) {
    throw new GatewayError("Gateway API key not found", {
      code: "gateway_key_not_found",
      category: "governance",
      httpStatus: 404,
      retryable: false,
      requestId
    });
  }

  return gatewayApiKey;
}

export async function resolveGatewayApiKeyByIdWithRegistry(
  env: GatewayBindings,
  gatewayApiKeys: readonly GatewayApiKeyRecord[],
  keyId: string,
  requestId: string
): Promise<{
  gatewayApiKey: GatewayApiKeyRecord;
  ownership: "configured" | "registry";
}> {
  const configuredGatewayApiKey = gatewayApiKeys.find((candidate) => {
    return candidate.id === keyId;
  });

  if (configuredGatewayApiKey) {
    return {
      gatewayApiKey: configuredGatewayApiKey,
      ownership: "configured"
    };
  }

  const registryGatewayApiKey = await getGatewayRegistryApiKey(
    env,
    keyId,
    requestId
  );

  if (registryGatewayApiKey) {
    return {
      gatewayApiKey: registryGatewayApiKey.key,
      ownership: "registry"
    };
  }

  throw new GatewayError("Gateway API key not found", {
    code: "gateway_key_not_found",
    category: "governance",
    httpStatus: 404,
    retryable: false,
    requestId
  });
}

export async function getGatewayKeyRevocationStatus(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string
): Promise<{ keyId: string; revoked: boolean; updatedAt: string }> {
  const state = await readGatewayKeyRevocationStateForKey(env, gatewayApiKey, requestId);

  return {
    keyId: gatewayApiKey.id,
    revoked: state.revoked,
    updatedAt: state.updatedAt
  };
}

export async function getGatewayKeyRevocationStatusById(
  env: GatewayBindings,
  gatewayApiKeys: readonly GatewayApiKeyRecord[],
  keyId: string,
  requestId: string
): Promise<{ keyId: string; revoked: boolean; updatedAt: string }> {
  const { gatewayApiKey } = await resolveGatewayApiKeyByIdWithRegistry(
    env,
    gatewayApiKeys,
    keyId,
    requestId
  );

  return getGatewayKeyRevocationStatus(env, gatewayApiKey, requestId);
}

export async function getGatewayApiKeyStatus(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string
): Promise<GatewayApiKeyStatusView> {
  const lifecycleStatus = evaluateGatewayApiKeyLifecycle(gatewayApiKey);
  const overlayState = env.AIRLOCK_GATEWAY_KEY_REVOCATION
    ? await readGatewayKeyRevocationStateForKey(env, gatewayApiKey, requestId)
    : DEFAULT_REVOCATION_STATE;
  const effectiveStatus =
    overlayState.revoked || lifecycleStatus === "revoked"
      ? "revoked"
      : lifecycleStatus;

  return {
    keyId: gatewayApiKey.id,
    label: gatewayApiKey.label,
    configuredStatus: gatewayApiKey.status,
    ...(gatewayApiKey.notBefore ? { notBefore: gatewayApiKey.notBefore } : {}),
    ...(gatewayApiKey.expiresAt ? { expiresAt: gatewayApiKey.expiresAt } : {}),
    lifecycleStatus,
    overlayRevoked: overlayState.revoked,
    overlayUpdatedAt: overlayState.updatedAt,
    effectiveStatus,
    acceptedNow: effectiveStatus === "active"
  };
}

export async function getGatewayApiKeyStatusSnapshot(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string,
  ownership: "configured" | "registry" = "configured"
): Promise<GatewayApiKeyRegistrySnapshot> {
  return createGatewayApiKeyRegistrySnapshot(
    env,
    gatewayApiKey,
    requestId,
    async (gatewayApiKeyRecord, nextRequestId) => {
      return getGatewayApiKeyStatus(env, gatewayApiKeyRecord, nextRequestId);
    },
    ownership
  );
}

export async function listGatewayApiKeyStatuses(
  env: GatewayBindings,
  gatewayApiKeys: readonly GatewayApiKeyRecord[],
  requestId: string,
  filters?: {
    acceptedNow?: boolean;
    effectiveStatus?: GatewayApiKeyLifecycleStatus;
  }
): Promise<
  Array<{
    keyId: string;
    configured: GatewayApiKeyStatusView;
    runtime: GatewayApiKeyStatusView;
    registryOverride: GatewayApiKeyRegistrySnapshot["registryOverride"];
    registryOverrideApplied: boolean;
    registryUpdatedAt?: string;
  }>
> {
  const configuredEntries = await Promise.all(
    gatewayApiKeys.map(async (gatewayApiKey) => {
      return getGatewayApiKeyStatusSnapshot(
        env,
        gatewayApiKey,
        requestId,
        "configured"
      );
    })
  );
  const registryEntries = await Promise.all(
    (await listGatewayRegistryApiKeys(env, requestId)).map(async (entry) => {
      return getGatewayApiKeyStatusSnapshot(
        env,
        entry.key,
        requestId,
        "registry"
      );
    })
  );
  const entries = [...configuredEntries, ...registryEntries];

  return entries.filter((entry) => {
    if (
      filters?.acceptedNow !== undefined &&
      entry.runtime.acceptedNow !== filters.acceptedNow
    ) {
      return false;
    }

    if (
      filters?.effectiveStatus !== undefined &&
      entry.runtime.effectiveStatus !== filters.effectiveStatus
    ) {
      return false;
    }

    return true;
  });
}

export async function revokeGatewayKey(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string
): Promise<{ keyId: string; revoked: boolean; updatedAt: string }> {
  const state = await writeGatewayKeyRevocationStateForKey(
    env,
    gatewayApiKey,
    true,
    requestId
  );

  return {
    keyId: gatewayApiKey.id,
    revoked: state.revoked,
    updatedAt: state.updatedAt
  };
}

export async function revokeGatewayKeyById(
  env: GatewayBindings,
  gatewayApiKeys: readonly GatewayApiKeyRecord[],
  keyId: string,
  requestId: string
): Promise<{ keyId: string; revoked: boolean; updatedAt: string }> {
  const { gatewayApiKey } = await resolveGatewayApiKeyByIdWithRegistry(
    env,
    gatewayApiKeys,
    keyId,
    requestId
  );

  return revokeGatewayKey(env, gatewayApiKey, requestId);
}

export async function clearGatewayKeyRevocation(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string
): Promise<{ keyId: string; revoked: boolean; updatedAt: string }> {
  const state = await writeGatewayKeyRevocationStateForKey(
    env,
    gatewayApiKey,
    false,
    requestId
  );

  return {
    keyId: gatewayApiKey.id,
    revoked: state.revoked,
    updatedAt: state.updatedAt
  };
}

export async function clearGatewayKeyRevocationById(
  env: GatewayBindings,
  gatewayApiKeys: readonly GatewayApiKeyRecord[],
  keyId: string,
  requestId: string
): Promise<{ keyId: string; revoked: boolean; updatedAt: string }> {
  const { gatewayApiKey } = await resolveGatewayApiKeyByIdWithRegistry(
    env,
    gatewayApiKeys,
    keyId,
    requestId
  );

  return clearGatewayKeyRevocation(env, gatewayApiKey, requestId);
}

export async function clearGatewayKeyRevocationOverlayState(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string
): Promise<void> {
  await writeGatewayKeyRevocationStateForKey(
    env,
    gatewayApiKey,
    false,
    requestId
  );
}

async function readGatewayKeyRevocationStateForKey(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string
): Promise<GatewayKeyRevocationState> {
  const namespace = requireGatewayKeyRevocationNamespace(env, requestId);
  const stub = namespace.get(namespace.idFromName(gatewayApiKey.id));
  let response: Response;

  try {
    response = await stub.fetch(
      new Request("https://airlock.internal/gateway-key-revocation", {
        method: "GET"
      })
    );
  } catch (cause) {
    throw new GatewayError("Gateway key revocation subsystem is unavailable", {
      code: "gateway_key_revocation_unavailable",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId,
      cause
    });
  }

  if (!response.ok) {
    throw new GatewayError("Gateway key revocation subsystem is unavailable", {
      code: "gateway_key_revocation_unavailable",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId
    });
  }

  return parseRevocationState(await response.json());
}

async function writeGatewayKeyRevocationStateForKey(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  revoked: boolean,
  requestId: string
): Promise<GatewayKeyRevocationState> {
  const namespace = requireGatewayKeyRevocationNamespace(env, requestId);
  const stub = namespace.get(namespace.idFromName(gatewayApiKey.id));
  let response: Response;

  try {
    response = await stub.fetch(
      new Request("https://airlock.internal/gateway-key-revocation", {
        method: revoked ? "POST" : "DELETE"
      })
    );
  } catch (cause) {
    throw new GatewayError("Gateway key revocation subsystem is unavailable", {
      code: "gateway_key_revocation_unavailable",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId,
      cause
    });
  }

  if (!response.ok) {
    throw new GatewayError("Gateway key revocation subsystem is unavailable", {
      code: "gateway_key_revocation_unavailable",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId
    });
  }

  return parseRevocationState(await response.json());
}

function requireGatewayKeyRevocationNamespace(
  env: GatewayBindings,
  requestId: string
) {
  const namespace = env.AIRLOCK_GATEWAY_KEY_REVOCATION;

  if (!namespace) {
    throw new GatewayError("Gateway key revocation subsystem is unavailable", {
      code: "gateway_key_revocation_unavailable",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId
    });
  }

  return namespace;
}

async function readGatewayKeyRevocationState(
  storage: DurableObjectStateLike["storage"]
): Promise<GatewayKeyRevocationState> {
  const state = await storage.get<GatewayKeyRevocationState>("revocation_state");
  return state ?? DEFAULT_REVOCATION_STATE;
}

async function writeGatewayKeyRevocationState(
  storage: DurableObjectStateLike["storage"],
  revoked: boolean,
  now = new Date().toISOString()
): Promise<GatewayKeyRevocationState> {
  const nextState = {
    revoked,
    updatedAt: now
  };

  await storage.put("revocation_state", nextState);
  return nextState;
}

function createUnauthorizedGatewayKeyError(requestId: string): GatewayError {
  return new GatewayError("Unauthorized", {
    code: "auth_invalid_api_key",
    category: "authentication",
    httpStatus: 401,
    retryable: false,
    requestId
  });
}
