import {
  clearGatewayKeyRevocationOverlayState as clearGatewayKeyRevocationOverlayStateUseCase,
  createGatewayKeyStatusByIdReadPort,
  clearGatewayKeyRevocationById as clearGatewayKeyRevocationByIdUseCase,
  clearGatewayKeyRevocationRuntime as clearGatewayKeyRevocationRuntimeUseCase,
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
  revokeGatewayKeyRuntime as revokeGatewayKeyRuntimeUseCase,
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
import {
  REVOCATION_OPERATION_LOG_OBJECT_NAME,
  buildGatewayKeyRevocationEventsRequest,
  buildGatewayKeyRevocationOperationEventAppendRequest,
  buildGatewayKeyRevocationOperationEventsRequest,
  buildGatewayKeyRevocationStateRequest,
  fetchParsedRevocationResponse,
  isGatewayKeyRevocationEnabled,
  requireGatewayKeyRevocationNamespace
} from "./gateway-key-revocation-transport.js";
import type { DurableObjectStateLike } from "./durable-object-state.js";


const REVOCATION_EVENTS_KEY = "revocation_events";
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

  if (!isGatewayKeyRevocationEnabled(env)) {
    return;
  }

  const state = await fetchParsedRevocationResponse(
    () => {
      return env.AIRLOCK_GATEWAY_KEY_REVOCATION!.get(
        env.AIRLOCK_GATEWAY_KEY_REVOCATION!.idFromName(gatewayApiKey.id)
      );
    },
    buildGatewayKeyRevocationStateRequest(requestId, {
        method: "GET"
      }),
    requestId,
    {
      parse: async (response) => {
        return parseGatewayKeyRevocationState(await response.json());
      }
    }
  );

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
  return revokeGatewayKeyRuntimeUseCase(
    gatewayApiKey,
    requestId,
    undefined,
    createGatewayKeyRevocationRuntimeWritePort(env, requestId)
  );
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
  return clearGatewayKeyRevocationRuntimeUseCase(
    gatewayApiKey,
    requestId,
    undefined,
    createGatewayKeyRevocationRuntimeWritePort(env, requestId)
  );
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
  await clearGatewayKeyRevocationOverlayStateUseCase(
    gatewayApiKey,
    requestId,
    createGatewayKeyRevocationRuntimeWritePort(env, requestId)
  );
}

export async function getGatewayKeyRevocationEvents(
  env: GatewayBindings,
  keyId: string,
  requestId: string
): Promise<GatewayKeyAuditEvent[]> {
  const namespace = requireGatewayKeyRevocationNamespace(env, requestId);
  return fetchParsedRevocationResponse(
    () => namespace.get(namespace.idFromName(keyId)),
    buildGatewayKeyRevocationEventsRequest(requestId, keyId),
    requestId,
    {
      parse: async (response) => {
        return parseGatewayKeyAuditEventsResponse(await response.json()).events;
      }
    }
  );
}

export async function getGatewayKeyRevocationOperationEvents(
  env: GatewayBindings,
  operationId: string,
  requestId: string
): Promise<GatewayKeyAuditEvent[]> {
  if (!isGatewayKeyRevocationEnabled(env)) {
    return [];
  }

  return fetchParsedRevocationResponse(
    () => {
      return env.AIRLOCK_GATEWAY_KEY_REVOCATION!.get(
        env.AIRLOCK_GATEWAY_KEY_REVOCATION!.idFromName(
          REVOCATION_OPERATION_LOG_OBJECT_NAME
        )
      );
    },
    buildGatewayKeyRevocationOperationEventsRequest(requestId, operationId),
    requestId,
    {
      parse: async (response) => {
        return parseGatewayKeyOperationEventsResponse(await response.json()).events;
      },
      handleStatus: (response) => {
        if (response.status === 404) {
          return [];
        }

        return undefined;
      }
    }
  );
}

async function readGatewayKeyRevocationStateForKey(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string
): Promise<GatewayKeyRevocationState> {
  const namespace = requireGatewayKeyRevocationNamespace(env, requestId);
  return fetchParsedRevocationResponse(
    () => namespace.get(namespace.idFromName(gatewayApiKey.id)),
    buildGatewayKeyRevocationStateRequest(requestId, {
        method: "GET"
      }),
    requestId,
    {
      parse: async (response) => {
        return parseGatewayKeyRevocationState(await response.json());
      }
    }
  );
}

async function writeGatewayKeyRevocationStateForKey(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  revoked: boolean,
  requestId: string,
  options?: GatewayKeyRevocationWriteRequest
): Promise<GatewayKeyRevocationState> {
  const namespace = requireGatewayKeyRevocationNamespace(env, requestId);
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
  const state = await fetchParsedRevocationResponse(
    () => namespace.get(namespace.idFromName(gatewayApiKey.id)),
    buildGatewayKeyRevocationStateRequest(requestId, {
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
      }),
    requestId,
    {
      parse: async (response) => {
        return parseGatewayKeyRevocationState(await response.json());
      }
    }
  );

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

function createGatewayKeyRevocationRuntimeWritePort(
  env: GatewayBindings,
  requestId: string
) {
  return {
    writeKeyRevocationState: async (
      gatewayApiKey: GatewayApiKeyRecord,
      revoked: boolean,
      request: GatewayKeyRevocationWriteRequest
    ) => {
      return writeGatewayKeyRevocationStateForKey(
        env,
        gatewayApiKey,
        revoked,
        requestId,
        request
      );
    },
    appendOperationEvent: async (event: GatewayKeyAuditEvent) => {
      await appendGatewayKeyRevocationOperationEventForKey(
        env,
        event,
        requestId
      );
    },
    resolveOwnership: async (gatewayApiKey: GatewayApiKeyRecord) => {
      return resolveGatewayKeyAuditOwnership(env, gatewayApiKey, requestId);
    }
  };
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
  await fetchParsedRevocationResponse(
    () => namespace.get(namespace.idFromName(REVOCATION_OPERATION_LOG_OBJECT_NAME)),
    buildGatewayKeyRevocationOperationEventAppendRequest(requestId, event),
    requestId,
    {
      parse: () => null
    }
  );
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
