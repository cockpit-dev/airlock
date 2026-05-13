import type { GatewayApiKeyMetadataOverride } from "@airlock/governance";
import { GatewayError } from "@airlock/shared";

import {
  parseOptionalPayloadActor,
  resolveAdminActorContext,
  stripAdminActorPayload
} from "./admin-actor.js";
import { resolveGatewayConfig } from "./config.js";
import type { GatewayBindings } from "./env.js";
import { sortGatewayKeyAuditEventsDescending } from "./gateway-key-audit.js";
import {
  cancelGatewayRegistryApiKeyRotation,
  clearGatewayKeyRegistryOverride,
  createGatewayRegistryApiKey,
  deleteGatewayRegistryApiKey,
  finalizeGatewayRegistryApiKeyRotation,
  rotateGatewayRegistryApiKey,
  getGatewayRegistryApiKey,
  getGatewayRegistryApiKeyEvents,
  upsertGatewayKeyRegistryOverride
} from "./gateway-key-registry.js";
import {
  clearGatewayKeyRevocationById,
  getGatewayApiKeyStatusSnapshot,
  getGatewayKeyRevocationEvents,
  getGatewayKeyRevocationStatusById,
  listGatewayApiKeyStatuses,
  resolveGatewayApiKeyById,
  resolveGatewayApiKeyByIdWithRegistry,
  revokeGatewayKeyById
} from "./gateway-key-revocation.js";

export async function listAdminGatewayKeys(
  env: GatewayBindings,
  request: Request,
  requestId: string,
  query: URLSearchParams
) {
  const config = resolveGatewayConfig(env);
  const acceptedNowParam = query.get("acceptedNow");
  const effectiveStatusParam = query.get("effectiveStatus");
  const acceptedNow =
    acceptedNowParam === null
      ? undefined
      : acceptedNowParam === "true"
        ? true
        : acceptedNowParam === "false"
          ? false
          : undefined;
  const effectiveStatus =
    effectiveStatusParam === "active" ||
    effectiveStatusParam === "revoked" ||
    effectiveStatusParam === "not_yet_active" ||
    effectiveStatusParam === "expired"
      ? effectiveStatusParam
      : undefined;

  return {
    keys: await listGatewayApiKeyStatuses(env, config.gatewayApiKeys, requestId, {
      ...(acceptedNow !== undefined ? { acceptedNow } : {}),
      ...(effectiveStatus !== undefined ? { effectiveStatus } : {})
    })
  };
}

export async function createAdminGatewayKey(
  env: GatewayBindings,
  request: Request,
  requestId: string,
  payload: unknown
) {
  const config = resolveGatewayConfig(env);
  const actorContext = resolveActorContext(
    request,
    env,
    payload,
    requestId,
    "Gateway dynamic key create payload is invalid"
  );

  return createGatewayRegistryApiKey(
    env,
    config.gatewayApiKeys,
    actorContext ? stripAdminActorPayload(payload) : payload,
    requestId,
    actorContext
  );
}

export async function getAdminGatewayKey(
  env: GatewayBindings,
  keyId: string,
  requestId: string
) {
  const key = await getGatewayRegistryApiKey(env, keyId, requestId);

  if (!key) {
    throw new GatewayError("Gateway API key not found", {
      code: "gateway_key_not_found",
      category: "governance",
      httpStatus: 404,
      retryable: false,
      requestId
    });
  }

  return key;
}

export async function deleteAdminGatewayKey(
  env: GatewayBindings,
  request: Request,
  keyId: string,
  requestId: string,
  payload: unknown
) {
  const config = resolveGatewayConfig(env);
  const actorContext = resolveActorContext(
    request,
    env,
    payload,
    requestId,
    "Gateway dynamic key delete payload is invalid"
  );

  await deleteGatewayRegistryApiKey(
    env,
    config.gatewayApiKeys,
    keyId,
    actorContext ? stripAdminActorPayload(payload) : payload,
    requestId,
    actorContext
  );

  return {
    keyId,
    deleted: true
  };
}

export async function rotateAdminGatewayKey(
  env: GatewayBindings,
  request: Request,
  keyId: string,
  requestId: string,
  payload: unknown
) {
  const config = resolveGatewayConfig(env);
  const actorContext = resolveActorContext(
    request,
    env,
    payload,
    requestId,
    "Gateway dynamic key rotation payload is invalid"
  );

  return rotateGatewayRegistryApiKey(
    env,
    config.gatewayApiKeys,
    keyId,
    actorContext ? stripAdminActorPayload(payload) : payload,
    requestId,
    actorContext
  );
}

export async function finalizeAdminGatewayKeyRotation(
  env: GatewayBindings,
  request: Request,
  keyId: string,
  requestId: string,
  payload: unknown
) {
  const config = resolveGatewayConfig(env);
  const actorContext = resolveActorContext(
    request,
    env,
    payload,
    requestId,
    "Gateway dynamic key rotation finalize payload is invalid"
  );

  return finalizeGatewayRegistryApiKeyRotation(
    env,
    config.gatewayApiKeys,
    keyId,
    actorContext ? stripAdminActorPayload(payload) : payload,
    requestId,
    actorContext
  );
}

export async function cancelAdminGatewayKeyRotation(
  env: GatewayBindings,
  request: Request,
  keyId: string,
  requestId: string,
  payload: unknown
) {
  const config = resolveGatewayConfig(env);
  const actorContext = resolveActorContext(
    request,
    env,
    payload,
    requestId,
    "Gateway dynamic key rotation cancel payload is invalid"
  );

  return cancelGatewayRegistryApiKeyRotation(
    env,
    config.gatewayApiKeys,
    keyId,
    actorContext ? stripAdminActorPayload(payload) : payload,
    requestId,
    actorContext
  );
}

export async function getAdminGatewayKeyRevocationStatus(
  env: GatewayBindings,
  keyId: string,
  requestId: string
) {
  const config = resolveGatewayConfig(env);
  return getGatewayKeyRevocationStatusById(
    env,
    config.gatewayApiKeys,
    keyId,
    requestId
  );
}

export async function getAdminGatewayKeyStatus(
  env: GatewayBindings,
  keyId: string,
  requestId: string
) {
  const config = resolveGatewayConfig(env);
  const { gatewayApiKey, ownership } = await resolveGatewayApiKeyByIdWithRegistry(
    env,
    config.gatewayApiKeys,
    keyId,
    requestId
  );

  return getGatewayApiKeyStatusSnapshot(env, gatewayApiKey, requestId, ownership);
}

export async function getAdminGatewayKeyEvents(
  env: GatewayBindings,
  keyId: string,
  requestId: string
) {
  const config = resolveGatewayConfig(env);
  const [registryEvents, revocationEvents] = await Promise.all([
    getGatewayRegistryApiKeyEvents(env, keyId, requestId),
    getGatewayKeyRevocationEvents(env, keyId, requestId)
  ]);

  if (registryEvents.length === 0 && revocationEvents.length === 0) {
    await resolveGatewayApiKeyByIdWithRegistry(
      env,
      config.gatewayApiKeys,
      keyId,
      requestId
    );
  }

  return {
    keyId,
    events: sortGatewayKeyAuditEventsDescending([
      ...registryEvents,
      ...revocationEvents
    ])
  };
}

export async function getAdminGatewayKeyRegistryView(
  env: GatewayBindings,
  keyId: string,
  requestId: string
): Promise<{
  keyId: string;
  configured: Awaited<
    ReturnType<typeof getGatewayApiKeyStatusSnapshot>
  >["configured"];
  runtime: Awaited<
    ReturnType<typeof getGatewayApiKeyStatusSnapshot>
  >["runtime"];
  override: GatewayApiKeyMetadataOverride & { updatedAt: string } | null;
  registryOverrideApplied: boolean;
  registryUpdatedAt?: string;
}> {
  const config = resolveGatewayConfig(env);
  const gatewayApiKey = resolveGatewayApiKeyById(
    config.gatewayApiKeys,
    keyId,
    requestId
  );
  const snapshot = await getGatewayApiKeyStatusSnapshot(
    env,
    gatewayApiKey,
    requestId
  );

  return {
    keyId: snapshot.keyId,
    configured: snapshot.configured,
    runtime: snapshot.runtime,
    override: snapshot.registryOverride,
    registryOverrideApplied: snapshot.registryOverrideApplied,
    ...(snapshot.registryUpdatedAt
      ? { registryUpdatedAt: snapshot.registryUpdatedAt }
      : {})
  };
}

export async function updateAdminGatewayKeyRegistryOverride(
  env: GatewayBindings,
  keyId: string,
  requestId: string,
  payload: unknown
): Promise<{
  keyId: string;
  override: GatewayApiKeyMetadataOverride & { updatedAt: string };
}> {
  const config = resolveGatewayConfig(env);
  const gatewayApiKey = resolveGatewayApiKeyById(
    config.gatewayApiKeys,
    keyId,
    requestId
  );
  const override = await upsertGatewayKeyRegistryOverride(
    env,
    gatewayApiKey,
    payload,
    requestId
  );

  return {
    keyId: gatewayApiKey.id,
    override
  };
}

export async function clearAdminGatewayKeyRegistryOverride(
  env: GatewayBindings,
  keyId: string,
  requestId: string
) {
  const config = resolveGatewayConfig(env);
  const gatewayApiKey = resolveGatewayApiKeyById(
    config.gatewayApiKeys,
    keyId,
    requestId
  );

  await clearGatewayKeyRegistryOverride(env, gatewayApiKey, requestId);

  return {
    keyId: gatewayApiKey.id,
    override: null
  };
}

export async function revokeAdminGatewayKey(
  env: GatewayBindings,
  request: Request,
  keyId: string,
  requestId: string,
  payload: unknown
) {
  const config = resolveGatewayConfig(env);
  const actorContext = resolveActorContext(
    request,
    env,
    payload,
    requestId,
    "Gateway key revocation payload is invalid"
  );

  return revokeGatewayKeyById(
    env,
    config.gatewayApiKeys,
    keyId,
    actorContext ? stripAdminActorPayload(payload) : payload,
    requestId,
    actorContext
  );
}

export async function clearAdminGatewayKeyRevocation(
  env: GatewayBindings,
  request: Request,
  keyId: string,
  requestId: string,
  payload: unknown
) {
  const config = resolveGatewayConfig(env);
  const actorContext = resolveActorContext(
    request,
    env,
    payload,
    requestId,
    "Gateway key revocation payload is invalid"
  );

  return clearGatewayKeyRevocationById(
    env,
    config.gatewayApiKeys,
    keyId,
    actorContext ? stripAdminActorPayload(payload) : payload,
    requestId,
    actorContext
  );
}

function resolveActorContext(
  request: Request,
  env: GatewayBindings,
  payload: unknown,
  requestId: string,
  message: string
) {
  return resolveAdminActorContext(
    request,
    env,
    parseOptionalPayloadActor(payload, message),
    requestId
  );
}
