import {
  buildGatewayKeyRevocationStateTransition,
  createGatewayApiKeyRegistrySnapshot,
  createGatewayKeyAuditEvent,
  DEFAULT_GATEWAY_KEY_REVOCATION_STATE,
  deriveGatewayApiKeyStatusView,
  MAX_GATEWAY_KEY_AUDIT_EVENTS,
  parseExplicitGatewayKeyRevocationMetadataPayload,
  parseGatewayKeyRevocationState,
  parseGatewayKeyRevocationWriteRequest,
  parseGatewayKeyAuditEventsResponse,
  toGatewayKeyRevocationActorContextRecord,
  type GatewayApiKeyRegistrySnapshot,
  type GatewayApiKeyStatusView,
  type GatewayApiKeyLifecycleStatus,
  type GatewayKeyRevocationOverlayState,
  type GatewayKeyRevocationState,
  type GatewayKeyRevocationWriteRequest,
  type GatewayKeyAuditActorContext,
  type GatewayKeyAuditEvent,
  type GatewayKeyAuditEventsResponse,
  type GatewayKeyAuditOwnership,
  type GatewayApiKeyRecord
} from "@airlock/governance";
import { GatewayError } from "@airlock/shared";

import type { GatewayBindings } from "./env.js";
import {
  getGatewayRegistryApiKey,
  listGatewayRegistryApiKeys,
  resolveGatewayRuntimeApiKey
} from "./gateway-key-registry.js";

interface DurableObjectStateLike {
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
  };
}
const REVOCATION_EVENTS_KEY = "revocation_events";

export class GatewayKeyRevocationDurableObject {
  constructor(private readonly state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.searchParams.get("kind") === "events") {
      const keyId = url.searchParams.get("keyId");

      if (!keyId) {
        return new Response("Missing keyId", { status: 400 });
      }

      return Response.json({
        keyId,
        events: await readGatewayKeyRevocationEvents(this.state.storage, keyId)
      } satisfies GatewayKeyAuditEventsResponse);
    }

    switch (request.method) {
      case "GET":
        return Response.json(
          await readGatewayKeyRevocationState(this.state.storage)
        );
      case "POST": {
        const body = await readGatewayKeyRevocationWriteRequest(request);
        return Response.json(
          await writeGatewayKeyRevocationState(this.state.storage, true, body)
        );
      }
      case "DELETE": {
        const body = await readGatewayKeyRevocationWriteRequest(request);
        return Response.json(
          await writeGatewayKeyRevocationState(this.state.storage, false, body)
        );
      }
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
    state = parseGatewayKeyRevocationState(await response.json());
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
  const overlayState = env.AIRLOCK_GATEWAY_KEY_REVOCATION
    ? await readGatewayKeyRevocationStateForKey(env, gatewayApiKey, requestId)
    : DEFAULT_GATEWAY_KEY_REVOCATION_STATE;

  return deriveGatewayApiKeyStatusView(
    gatewayApiKey,
    overlayState satisfies GatewayKeyRevocationOverlayState
  );
}

export async function getGatewayApiKeyStatusSnapshot(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string,
  ownership: "configured" | "registry" = "configured"
): Promise<GatewayApiKeyRegistrySnapshot> {
  const configuredStatus = await getGatewayApiKeyStatus(env, gatewayApiKey, requestId);

  if (ownership === "registry") {
    return createGatewayApiKeyRegistrySnapshot({
      ownership,
      configuredKey: gatewayApiKey,
      configuredStatus
    });
  }

  const { runtimeGatewayApiKey, registryOverride } =
    await resolveGatewayRuntimeApiKey(env, gatewayApiKey, requestId);
  const runtimeStatus = await getGatewayApiKeyStatus(
    env,
    runtimeGatewayApiKey,
    requestId
  );

  return createGatewayApiKeyRegistrySnapshot({
    ownership,
    configuredKey: gatewayApiKey,
    configuredStatus,
    runtimeKey: runtimeGatewayApiKey,
    runtimeStatus,
    registryOverride
  });
}

export async function listGatewayApiKeyStatuses(
  env: GatewayBindings,
  gatewayApiKeys: readonly GatewayApiKeyRecord[],
  requestId: string,
  filters?: {
    acceptedNow?: boolean;
    effectiveStatus?: GatewayApiKeyLifecycleStatus;
  }
): Promise<GatewayApiKeyRegistrySnapshot[]> {
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
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<{ keyId: string; revoked: boolean; updatedAt: string }> {
  const { gatewayApiKey, ownership } = await resolveGatewayApiKeyByIdWithRegistry(
    env,
    gatewayApiKeys,
    keyId,
    requestId
  );

  const state = await writeGatewayKeyRevocationStateForKey(
    env,
    gatewayApiKey,
    true,
    requestId,
    {
      keyId,
      ownership,
      ...(actorContext
        ? toGatewayKeyRevocationActorContextRecord(actorContext)
        : {}),
      ...parseExplicitGatewayKeyRevocationMetadataPayload(
        payload,
        "Gateway key revocation payload is invalid"
      )
    }
  );

  return {
    keyId: gatewayApiKey.id,
    revoked: state.revoked,
    updatedAt: state.updatedAt
  };
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
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<{ keyId: string; revoked: boolean; updatedAt: string }> {
  const { gatewayApiKey, ownership } = await resolveGatewayApiKeyByIdWithRegistry(
    env,
    gatewayApiKeys,
    keyId,
    requestId
  );

  const state = await writeGatewayKeyRevocationStateForKey(
    env,
    gatewayApiKey,
    false,
    requestId,
    {
      keyId,
      ownership,
      ...(actorContext
        ? toGatewayKeyRevocationActorContextRecord(actorContext)
        : {}),
      ...parseExplicitGatewayKeyRevocationMetadataPayload(
        payload,
        "Gateway key revocation payload is invalid"
      )
    }
  );

  return {
    keyId: gatewayApiKey.id,
    revoked: state.revoked,
    updatedAt: state.updatedAt
  };
}

export async function clearGatewayKeyRevocationOverlayState(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string
): Promise<void> {
  await writeGatewayKeyRevocationStateForKey(env, gatewayApiKey, false, requestId, {
    keyId: gatewayApiKey.id,
    recordEvent: false
  });
}

export async function getGatewayKeyRevocationEvents(
  env: GatewayBindings,
  keyId: string,
  requestId: string
): Promise<GatewayKeyAuditEvent[]> {
  const namespace = requireGatewayKeyRevocationNamespace(env, requestId);
  const stub = namespace.get(namespace.idFromName(keyId));
  let response: Response;

  try {
    response = await stub.fetch(
      buildGatewayKeyRevocationEventsRequest(keyId)
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

  try {
    return parseGatewayKeyAuditEventsResponse(await response.json()).events;
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

  return parseGatewayKeyRevocationState(await response.json());
}

async function writeGatewayKeyRevocationStateForKey(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  revoked: boolean,
  requestId: string,
  options?: GatewayKeyRevocationWriteRequest
): Promise<GatewayKeyRevocationState> {
  const namespace = requireGatewayKeyRevocationNamespace(env, requestId);
  const stub = namespace.get(namespace.idFromName(gatewayApiKey.id));
  let response: Response;

  try {
    response = await stub.fetch(
      new Request("https://airlock.internal/gateway-key-revocation", {
        method: revoked ? "POST" : "DELETE",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          keyId: gatewayApiKey.id,
          recordEvent: options?.recordEvent ?? true,
          ...(options?.reason ? { reason: options.reason } : {}),
          ...(options?.actor ? { actor: options.actor } : {}),
          ...(options?.actorSource ? { actorSource: options.actorSource } : {}),
          ...((options?.recordEvent ?? true)
            ? {
                ownership:
                  options?.ownership ??
                  (await resolveGatewayKeyAuditOwnership(
                    env,
                    gatewayApiKey,
                    requestId
                  ))
              }
            : {})
        } satisfies GatewayKeyRevocationWriteRequest)
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

  return parseGatewayKeyRevocationState(await response.json());
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
  return state ?? DEFAULT_GATEWAY_KEY_REVOCATION_STATE;
}

async function writeGatewayKeyRevocationState(
  storage: DurableObjectStateLike["storage"],
  revoked: boolean,
  request: GatewayKeyRevocationWriteRequest = {},
  now = new Date().toISOString()
): Promise<GatewayKeyRevocationState> {
  const transition = buildGatewayKeyRevocationStateTransition(
    revoked,
    request,
    now
  );

  await storage.put("revocation_state", transition.nextState);

  if (transition.auditEvent) {
    await appendGatewayKeyRevocationEvent(
      storage,
      transition.auditEvent
    );
  }

  return transition.nextState;
}

async function readGatewayKeyRevocationEvents(
  storage: DurableObjectStateLike["storage"],
  keyId: string
): Promise<GatewayKeyAuditEvent[]> {
  const value = await storage.get<unknown>(REVOCATION_EVENTS_KEY);

  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("Revocation events are invalid");
  }

  return value.map((event) => {
    const parsedEvent = parseGatewayKeyAuditEventsResponse({
      keyId,
      events: [event]
    }).events[0];

    if (!parsedEvent) {
      throw new Error("Revocation event is missing");
    }

    return createGatewayKeyAuditEvent(parsedEvent);
  });
}

async function appendGatewayKeyRevocationEvent(
  storage: DurableObjectStateLike["storage"],
  event: GatewayKeyAuditEvent
): Promise<void> {
  const events = await readGatewayKeyRevocationEvents(storage, event.keyId);

  await storage.put(REVOCATION_EVENTS_KEY, [
    ...events,
    createGatewayKeyAuditEvent(event)
  ].slice(-MAX_GATEWAY_KEY_AUDIT_EVENTS));
}

async function readGatewayKeyRevocationWriteRequest(
  request: Request
): Promise<GatewayKeyRevocationWriteRequest> {
  const contentType = request.headers.get("content-type");

  if (!contentType?.includes("application/json")) {
    return {};
  }

  return parseGatewayKeyRevocationWriteRequest(await request.json());
}

function buildGatewayKeyRevocationEventsRequest(keyId: string): Request {
  const url = new URL("https://airlock.internal/gateway-key-revocation");
  url.searchParams.set("kind", "events");
  url.searchParams.set("keyId", keyId);

  return new Request(url, {
    method: "GET"
  });
}

async function resolveGatewayKeyAuditOwnership(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string
): Promise<GatewayKeyAuditOwnership> {
  const registryKey = await getGatewayRegistryApiKey(
    env,
    gatewayApiKey.id,
    requestId
  );

  return registryKey ? "registry" : "configured";
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
