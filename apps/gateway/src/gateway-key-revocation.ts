import {
  createGatewayKeyStatusByIdReadPort,
  clearGatewayKeyRevocationById as clearGatewayKeyRevocationByIdUseCase,
  createGatewayKeyAuditEvent,
  buildGatewayKeyRevocationStateTransition,
  DEFAULT_GATEWAY_KEY_REVOCATION_STATE,
  getGatewayApiKeyStatus as getGatewayApiKeyStatusUseCase,
  getGatewayApiKeyStatusSnapshot as getGatewayApiKeyStatusSnapshotUseCase,
  getGatewayKeyRevocationStatus as getGatewayKeyRevocationStatusUseCase,
  getGatewayKeyRevocationStatusById as getGatewayKeyRevocationStatusByIdUseCase,
  listGatewayApiKeyStatuses as listGatewayApiKeyStatusesUseCase,
  requireConfiguredGatewayApiKeyById,
  resolveGatewayApiKeyByIdWithOwnership,
  MAX_GATEWAY_KEY_AUDIT_EVENTS,
  parseGatewayKeyOperationEventsResponse,
  parseGatewayKeyRevocationState,
  parseGatewayKeyRevocationWriteRequest,
  parseGatewayKeyAuditEventsResponse,
  revokeGatewayKeyById as revokeGatewayKeyByIdUseCase,
  type GatewayApiKeyRegistrySnapshot,
  type GatewayApiKeyStatusView,
  type GatewayApiKeyLifecycleStatus,
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
const REVOCATION_OPERATION_LOG_OBJECT_NAME = "gateway-key-revocation-operations";
const REVOCATION_OPERATION_EVENTS_PREFIX = "revocation_operation:";

export class GatewayKeyRevocationDurableObject {
  constructor(private readonly state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.searchParams.get("kind") === "operation_events") {
      if (request.method === "GET") {
        const operationId = url.searchParams.get("operationId");

        if (!operationId) {
          return new Response("Missing operationId", { status: 400 });
        }

        const events = await readGatewayKeyRevocationOperationEvents(
          this.state.storage,
          operationId
        );

        if (events.length === 0) {
          return new Response("Not found", { status: 404 });
        }

        return Response.json({
          operationId,
          events
        });
      }

      if (request.method === "POST") {
        await appendGatewayKeyRevocationOperationEvent(
          this.state.storage,
          createGatewayKeyAuditEvent(await request.json() as GatewayKeyAuditEvent)
        );
        return new Response(null, { status: 204 });
      }

      return new Response("Method not allowed", { status: 405 });
    }

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
  return requireConfiguredGatewayApiKeyById(gatewayApiKeys, keyId, requestId);
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
  return resolveGatewayApiKeyByIdWithOwnership(
    gatewayApiKeys,
    keyId,
    requestId,
    {
      getRegistryKey: async (candidateKeyId) => {
        return getGatewayRegistryApiKey(env, candidateKeyId, requestId);
      }
    }
  );
}

export async function getGatewayKeyRevocationStatus(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string
): Promise<{ keyId: string; revoked: boolean; updatedAt: string }> {
  return getGatewayKeyRevocationStatusUseCase(gatewayApiKey, {
    readOverlayState: async (candidateGatewayApiKey) => {
      return readGatewayKeyRevocationStateForKey(
        env,
        candidateGatewayApiKey,
        requestId
      );
    }
  });
}

export async function getGatewayKeyRevocationStatusById(
  env: GatewayBindings,
  gatewayApiKeys: readonly GatewayApiKeyRecord[],
  keyId: string,
  requestId: string
): Promise<{ keyId: string; revoked: boolean; updatedAt: string }> {
  return getGatewayKeyRevocationStatusByIdUseCase(keyId, createGatewayKeyStatusByIdReadPort(
    gatewayApiKeys,
    async (candidateGatewayApiKey) => {
      return readGatewayKeyRevocationStateForKey(
        env,
        candidateGatewayApiKey,
        requestId
      );
    },
    async (candidateKeyId) => {
      return getGatewayRegistryApiKey(env, candidateKeyId, requestId);
    },
    requestId
  ));
}

export async function getGatewayApiKeyStatus(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string
): Promise<GatewayApiKeyStatusView> {
  return getGatewayApiKeyStatusUseCase(gatewayApiKey, {
    readOverlayState: async (candidateGatewayApiKey) => {
      return env.AIRLOCK_GATEWAY_KEY_REVOCATION
        ? readGatewayKeyRevocationStateForKey(
            env,
            candidateGatewayApiKey,
            requestId
          )
        : DEFAULT_GATEWAY_KEY_REVOCATION_STATE;
    }
  });
}

export async function getGatewayApiKeyStatusSnapshot(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string,
  ownership: "configured" | "registry" = "configured"
): Promise<GatewayApiKeyRegistrySnapshot> {
  return getGatewayApiKeyStatusSnapshotUseCase(
    gatewayApiKey,
    ownership,
    {
      readOverlayState: async (candidateGatewayApiKey) => {
        return env.AIRLOCK_GATEWAY_KEY_REVOCATION
          ? readGatewayKeyRevocationStateForKey(
              env,
              candidateGatewayApiKey,
              requestId
            )
          : DEFAULT_GATEWAY_KEY_REVOCATION_STATE;
      },
      resolveRuntimeKey: async (candidateGatewayApiKey) => {
        return resolveGatewayRuntimeApiKey(env, candidateGatewayApiKey, requestId);
      }
    }
  );
}

export async function listGatewayApiKeyStatuses(
  env: GatewayBindings,
  gatewayApiKeys: readonly GatewayApiKeyRecord[],
  requestId: string,
  filters?: {
    acceptedNow?: boolean;
    effectiveStatus?: GatewayApiKeyLifecycleStatus;
    includeArchived?: boolean;
  }
): Promise<GatewayApiKeyRegistrySnapshot[]> {
  return listGatewayApiKeyStatusesUseCase(
    gatewayApiKeys,
    {
      listRegistryKeys: async () => {
        return listGatewayRegistryApiKeys(env, requestId);
      },
      readOverlayState: async (candidateGatewayApiKey) => {
        return env.AIRLOCK_GATEWAY_KEY_REVOCATION
          ? readGatewayKeyRevocationStateForKey(
              env,
              candidateGatewayApiKey,
              requestId
            )
          : DEFAULT_GATEWAY_KEY_REVOCATION_STATE;
      },
      resolveRuntimeKey: async (candidateGatewayApiKey) => {
        return resolveGatewayRuntimeApiKey(env, candidateGatewayApiKey, requestId);
      }
    },
    filters
  );
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
  return revokeGatewayKeyByIdUseCase(
    keyId,
    payload,
    "Gateway key revocation payload is invalid",
    actorContext,
    {
      resolveKeyById: async (candidateKeyId) => {
        return resolveGatewayApiKeyByIdWithRegistry(
          env,
          gatewayApiKeys,
          candidateKeyId,
          requestId
        );
      },
      writeKeyRevocationState: async (
        gatewayApiKey,
        revoked,
        request
      ) => {
        return writeGatewayKeyRevocationStateForKey(
          env,
          gatewayApiKey,
          revoked,
          requestId,
          request
        );
      }
    }
  );
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
  return clearGatewayKeyRevocationByIdUseCase(
    keyId,
    payload,
    "Gateway key revocation payload is invalid",
    actorContext,
    {
      resolveKeyById: async (candidateKeyId) => {
        return resolveGatewayApiKeyByIdWithRegistry(
          env,
          gatewayApiKeys,
          candidateKeyId,
          requestId
        );
      },
      writeKeyRevocationState: async (
        gatewayApiKey,
        revoked,
        request
      ) => {
        return writeGatewayKeyRevocationStateForKey(
          env,
          gatewayApiKey,
          revoked,
          requestId,
          request
        );
      }
    }
  );
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

export async function getGatewayKeyRevocationOperationEvents(
  env: GatewayBindings,
  operationId: string,
  requestId: string
): Promise<GatewayKeyAuditEvent[]> {
  const namespace = env.AIRLOCK_GATEWAY_KEY_REVOCATION;

  if (!namespace) {
    return [];
  }

  const stub = namespace.get(namespace.idFromName(REVOCATION_OPERATION_LOG_OBJECT_NAME));
  let response: Response;

  try {
    response = await stub.fetch(
      buildGatewayKeyRevocationOperationEventsRequest(operationId)
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

  if (response.status === 404) {
    return [];
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
    return parseGatewayKeyOperationEventsResponse(await response.json()).events;
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
  const recordEvent = options?.recordEvent ?? true;
  const ownership = recordEvent
    ? options?.ownership ??
      (await resolveGatewayKeyAuditOwnership(
        env,
        gatewayApiKey,
        requestId
      ))
    : undefined;
  const operationId = recordEvent ? options?.operationId ?? requestId : undefined;
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
          recordEvent,
          ...(operationId ? { operationId } : {}),
          ...(options?.reason ? { reason: options.reason } : {}),
          ...(options?.actor ? { actor: options.actor } : {}),
          ...(options?.actorSource ? { actorSource: options.actorSource } : {}),
          ...(ownership ? { ownership } : {})
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

  const state = parseGatewayKeyRevocationState(await response.json());

  if (recordEvent && ownership && operationId) {
    await appendGatewayKeyRevocationOperationEventForKey(
      env,
      createGatewayKeyAuditEvent({
        keyId: gatewayApiKey.id,
        kind: revoked ? "revoked" : "unrevoked",
        ownership,
        occurredAt: state.updatedAt,
        operationId,
        ...(options?.reason ? { reason: options.reason } : {}),
        ...(options?.actor ? { actor: options.actor } : {}),
        ...(options?.actorSource ? { actorSource: options.actorSource } : {})
      }),
      requestId
    );
  }

  return state;
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

async function readGatewayKeyRevocationOperationEvents(
  storage: DurableObjectStateLike["storage"],
  operationId: string
): Promise<GatewayKeyAuditEvent[]> {
  const value = await storage.get<unknown>(
    `${REVOCATION_OPERATION_EVENTS_PREFIX}${operationId}`
  );

  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("Revocation operation events are invalid");
  }

  return value.map((event) => {
    const parsedEvent = parseGatewayKeyOperationEventsResponse({
      operationId,
      events: [event]
    }).events[0];

    if (!parsedEvent) {
      throw new Error("Revocation operation event is missing");
    }

    return createGatewayKeyAuditEvent(parsedEvent);
  });
}

async function appendGatewayKeyRevocationOperationEvent(
  storage: DurableObjectStateLike["storage"],
  event: GatewayKeyAuditEvent
): Promise<void> {
  if (!event.operationId) {
    return;
  }

  const events = await readGatewayKeyRevocationOperationEvents(
    storage,
    event.operationId
  );

  await storage.put(
    `${REVOCATION_OPERATION_EVENTS_PREFIX}${event.operationId}`,
    [...events, createGatewayKeyAuditEvent(event)].slice(-MAX_GATEWAY_KEY_AUDIT_EVENTS)
  );
}

async function appendGatewayKeyRevocationOperationEventForKey(
  env: GatewayBindings,
  event: GatewayKeyAuditEvent,
  requestId: string
): Promise<void> {
  if (!event.operationId) {
    return;
  }

  const namespace = requireGatewayKeyRevocationNamespace(env, requestId);
  const stub = namespace.get(namespace.idFromName(REVOCATION_OPERATION_LOG_OBJECT_NAME));

  try {
    const response = await stub.fetch(
      buildGatewayKeyRevocationOperationEventAppendRequest(event)
    );

    if (!response.ok) {
      throw new GatewayError("Gateway key revocation subsystem is unavailable", {
        code: "gateway_key_revocation_unavailable",
        category: "governance",
        httpStatus: 503,
        retryable: true,
        requestId
      });
    }
  } catch (cause) {
    if (cause instanceof GatewayError) {
      throw cause;
    }

    throw new GatewayError("Gateway key revocation subsystem is unavailable", {
      code: "gateway_key_revocation_unavailable",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId,
      cause
    });
  }
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

function buildGatewayKeyRevocationOperationEventsRequest(
  operationId: string
): Request {
  const url = new URL("https://airlock.internal/gateway-key-revocation");
  url.searchParams.set("kind", "operation_events");
  url.searchParams.set("operationId", operationId);

  return new Request(url, {
    method: "GET"
  });
}

function buildGatewayKeyRevocationOperationEventAppendRequest(
  event: GatewayKeyAuditEvent
): Request {
  const url = new URL("https://airlock.internal/gateway-key-revocation");
  url.searchParams.set("kind", "operation_events");

  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(event)
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
