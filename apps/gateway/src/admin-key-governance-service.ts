import {
  getGatewayAdminKey as readGatewayAdminKey,
  getGatewayAdminKeyEvents as readGatewayAdminKeyEvents,
  getGatewayAdminKeyRegistryView as readGatewayAdminKeyRegistryView,
  getGatewayAdminKeyRevocationStatus as readGatewayAdminKeyRevocationStatus,
  getGatewayAdminKeyStatus as readGatewayAdminKeyStatus,
  listGatewayAdminKeys as readGatewayAdminKeys,
  type GatewayApiKeyMetadataOverride
} from "@airlock/governance";

import {
  parseOptionalPayloadActor,
  resolveAdminActorContext,
  stripAdminActorPayload
} from "./admin-actor.js";
import { resolveGatewayConfig } from "./config.js";
import type { GatewayBindings } from "./env.js";
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
  _request: Request,
  requestId: string,
  query: URLSearchParams
) {
  const config = resolveGatewayConfig(env);
  return readGatewayAdminKeys(query, {
    listKeySnapshots: (filters) => {
      return listGatewayApiKeyStatuses(
        env,
        config.gatewayApiKeys,
        requestId,
        filters
      );
    }
  });
}

export async function createAdminGatewayKey(
  env: GatewayBindings,
  request: Request,
  requestId: string,
  payload: unknown
) {
  const config = resolveGatewayConfig(env);
  const actorContext = await resolveActorContext(
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
  return readGatewayAdminKey(keyId, requestId, {
    getRegistryKey: (candidateKeyId) => {
      return getGatewayRegistryApiKey(env, candidateKeyId, requestId);
    }
  });
}

export async function deleteAdminGatewayKey(
  env: GatewayBindings,
  request: Request,
  keyId: string,
  requestId: string,
  payload: unknown
) {
  const config = resolveGatewayConfig(env);
  const actorContext = await resolveActorContext(
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
  const actorContext = await resolveActorContext(
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
  const actorContext = await resolveActorContext(
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
  const actorContext = await resolveActorContext(
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
  return readGatewayAdminKeyRevocationStatus(keyId, {
    getKeyRevocationStatus: (candidateKeyId) => {
      return getGatewayKeyRevocationStatusById(
        env,
        config.gatewayApiKeys,
        candidateKeyId,
        requestId
      );
    }
  });
}

export async function getAdminGatewayKeyStatus(
  env: GatewayBindings,
  keyId: string,
  requestId: string
) {
  const config = resolveGatewayConfig(env);
  return readGatewayAdminKeyStatus(keyId, {
    getKeyStatusSnapshot: async (candidateKeyId) => {
      const { gatewayApiKey, ownership } =
        await resolveGatewayApiKeyByIdWithRegistry(
          env,
          config.gatewayApiKeys,
          candidateKeyId,
          requestId
        );

      return getGatewayApiKeyStatusSnapshot(
        env,
        gatewayApiKey,
        requestId,
        ownership
      );
    }
  });
}

export async function getAdminGatewayKeyEvents(
  env: GatewayBindings,
  keyId: string,
  requestId: string
) {
  const config = resolveGatewayConfig(env);
  return readGatewayAdminKeyEvents(keyId, {
    getRegistryEvents: (candidateKeyId) => {
      return getGatewayRegistryApiKeyEvents(env, candidateKeyId, requestId);
    },
    getRevocationEvents: (candidateKeyId) => {
      return getGatewayKeyRevocationEvents(env, candidateKeyId, requestId);
    },
    assertKeyExists: async (candidateKeyId) => {
      await resolveGatewayApiKeyByIdWithRegistry(
        env,
        config.gatewayApiKeys,
        candidateKeyId,
        requestId
      );
    }
  });
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
  return readGatewayAdminKeyRegistryView(keyId, {
    getConfiguredKeyStatusSnapshot: async (candidateKeyId) => {
      const gatewayApiKey = resolveGatewayApiKeyById(
        config.gatewayApiKeys,
        candidateKeyId,
        requestId
      );

      return getGatewayApiKeyStatusSnapshot(env, gatewayApiKey, requestId);
    }
  });
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
  const actorContext = await resolveActorContext(
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
  const actorContext = await resolveActorContext(
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

async function resolveActorContext(
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
