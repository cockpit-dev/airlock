import {
  bulkDeleteGatewayAdminKeys as writeGatewayAdminKeyBulkDelete,
  cancelGatewayAdminKeyRotation as writeGatewayAdminKeyRotationCancel,
  clearGatewayAdminKeyRegistryOverride as writeGatewayAdminKeyRegistryOverrideClear,
  clearGatewayAdminKeyRevocation as writeGatewayAdminKeyRevocationClear,
  createGatewayAdminKey as writeGatewayAdminKeyCreate,
  deleteGatewayAdminKey as writeGatewayAdminKeyDelete,
  finalizeGatewayAdminKeyRotation as writeGatewayAdminKeyRotationFinalize,
  bulkUpdateGatewayAdminKeys as writeGatewayAdminKeyBulkUpdate,
  getGatewayAdminKey as readGatewayAdminKey,
  getGatewayAdminKeyEvents as readGatewayAdminKeyEvents,
  getGatewayAdminKeyRegistryView as readGatewayAdminKeyRegistryView,
  getGatewayAdminKeyRevocationStatus as readGatewayAdminKeyRevocationStatus,
  getGatewayAdminKeyStatus as readGatewayAdminKeyStatus,
  listGatewayAdminKeys as readGatewayAdminKeys,
  revokeGatewayAdminKey as writeGatewayAdminKeyRevoke,
  rotateGatewayAdminKey as writeGatewayAdminKeyRotate,
  updateGatewayAdminKey as writeGatewayAdminKeyUpdate,
  updateGatewayAdminKeyRegistryOverride as writeGatewayAdminKeyRegistryOverrideUpdate,
  type GatewayApiKeyMetadataOverride
} from "@airlock/governance";

import {
  resolveAdminMutationActorCommand
} from "./admin-actor.js";
import { resolveGatewayConfig } from "./config.js";
import type { GatewayBindings } from "./env.js";
import {
  bulkDeleteGatewayRegistryApiKeys,
  cancelGatewayRegistryApiKeyRotation,
  bulkUpdateGatewayRegistryApiKeys,
  clearGatewayKeyRegistryOverride,
  createGatewayRegistryApiKey,
  deleteGatewayRegistryApiKey,
  finalizeGatewayRegistryApiKeyRotation,
  rotateGatewayRegistryApiKey,
  getGatewayRegistryApiKey,
  getGatewayRegistryApiKeyEvents,
  updateGatewayRegistryApiKey,
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
  const mutation = await resolveAdminMutationActorCommand(
    request,
    env,
    payload,
    requestId,
    "Gateway dynamic key create payload is invalid"
  );

  return writeGatewayAdminKeyCreate(mutation.payload, {
    createRegistryKey: (candidatePayload) => {
      return createGatewayRegistryApiKey(
        env,
        config.gatewayApiKeys,
        candidatePayload,
        requestId,
        mutation.actorContext
      );
    }
  });
}

export async function bulkUpdateAdminGatewayKeys(
  env: GatewayBindings,
  request: Request,
  requestId: string,
  payload: unknown
) {
  const config = resolveGatewayConfig(env);
  const mutation = await resolveAdminMutationActorCommand(
    request,
    env,
    payload,
    requestId,
    "Gateway dynamic key bulk update payload is invalid"
  );

  return writeGatewayAdminKeyBulkUpdate(
    mutation.payload as {
      updates: Array<{
        keyId: string;
        status?: "active" | "revoked";
        label?: string;
        notBefore?: string | null;
        expiresAt?: string | null;
        policy?: object | null;
      }>;
      reason?: string;
      actor?: string;
      actorSource?: "payload" | "trusted_header" | "credential";
    },
    requestId,
    {
      isConfiguredKey: (candidateKeyId) => {
        return config.gatewayApiKeys.some((gatewayApiKey) => {
          return gatewayApiKey.id === candidateKeyId;
        });
      },
      bulkUpdateRegistryKeys: (candidatePayload) => {
        return bulkUpdateGatewayRegistryApiKeys(
          env,
          config.gatewayApiKeys,
          candidatePayload,
          requestId,
          mutation.actorContext
        );
      }
    }
  );
}

export async function bulkDeleteAdminGatewayKeys(
  env: GatewayBindings,
  request: Request,
  requestId: string,
  payload: unknown
) {
  const config = resolveGatewayConfig(env);
  const mutation = await resolveAdminMutationActorCommand(
    request,
    env,
    payload,
    requestId,
    "Gateway dynamic key bulk delete payload is invalid"
  );

  return writeGatewayAdminKeyBulkDelete(
    mutation.payload as {
      keyIds: string[];
      reason?: string;
      actor?: string;
      actorSource?: "payload" | "trusted_header" | "credential";
    },
    requestId,
    {
      isConfiguredKey: (candidateKeyId) => {
        return config.gatewayApiKeys.some((gatewayApiKey) => {
          return gatewayApiKey.id === candidateKeyId;
        });
      },
      bulkDeleteRegistryKeys: (candidatePayload) => {
        return bulkDeleteGatewayRegistryApiKeys(
          env,
          config.gatewayApiKeys,
          candidatePayload,
          requestId,
          mutation.actorContext
        );
      }
    }
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

export async function updateAdminGatewayKey(
  env: GatewayBindings,
  request: Request,
  keyId: string,
  requestId: string,
  payload: unknown
) {
  const config = resolveGatewayConfig(env);
  const mutation = await resolveAdminMutationActorCommand(
    request,
    env,
    payload,
    requestId,
    "Gateway dynamic key update payload is invalid"
  );

  return writeGatewayAdminKeyUpdate(
    keyId,
    mutation.payload,
    requestId,
    {
      isConfiguredKey: (candidateKeyId) => {
        return config.gatewayApiKeys.some((gatewayApiKey) => {
          return gatewayApiKey.id === candidateKeyId;
        });
      },
      updateRegistryKey: (candidateKeyId, candidatePayload) => {
        return updateGatewayRegistryApiKey(
          env,
          config.gatewayApiKeys,
          candidateKeyId,
          candidatePayload,
          requestId,
          mutation.actorContext
        );
      }
    }
  );
}

export async function deleteAdminGatewayKey(
  env: GatewayBindings,
  request: Request,
  keyId: string,
  requestId: string,
  payload: unknown
) {
  const config = resolveGatewayConfig(env);
  const mutation = await resolveAdminMutationActorCommand(
    request,
    env,
    payload,
    requestId,
    "Gateway dynamic key delete payload is invalid"
  );

  return writeGatewayAdminKeyDelete(
    keyId,
    mutation.payload,
    requestId,
    {
      isConfiguredKey: (candidateKeyId) => {
        return config.gatewayApiKeys.some((gatewayApiKey) => {
          return gatewayApiKey.id === candidateKeyId;
        });
      },
      deleteRegistryKey: (candidateKeyId, candidatePayload) => {
        return deleteGatewayRegistryApiKey(
          env,
          config.gatewayApiKeys,
          candidateKeyId,
          candidatePayload,
          requestId,
          mutation.actorContext
        );
      }
    }
  );
}

export async function rotateAdminGatewayKey(
  env: GatewayBindings,
  request: Request,
  keyId: string,
  requestId: string,
  payload: unknown
) {
  const config = resolveGatewayConfig(env);
  const mutation = await resolveAdminMutationActorCommand(
    request,
    env,
    payload,
    requestId,
    "Gateway dynamic key rotation payload is invalid"
  );

  return writeGatewayAdminKeyRotate(
    keyId,
    mutation.payload,
    requestId,
    {
      isConfiguredKey: (candidateKeyId) => {
        return config.gatewayApiKeys.some((gatewayApiKey) => {
          return gatewayApiKey.id === candidateKeyId;
        });
      },
      rotateRegistryKey: (candidateKeyId, candidatePayload) => {
        return rotateGatewayRegistryApiKey(
          env,
          config.gatewayApiKeys,
          candidateKeyId,
          candidatePayload,
          requestId,
          mutation.actorContext
        );
      }
    }
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
  const mutation = await resolveAdminMutationActorCommand(
    request,
    env,
    payload,
    requestId,
    "Gateway dynamic key rotation finalize payload is invalid"
  );

  return writeGatewayAdminKeyRotationFinalize(
    keyId,
    mutation.payload,
    requestId,
    {
      isConfiguredKey: (candidateKeyId) => {
        return config.gatewayApiKeys.some((gatewayApiKey) => {
          return gatewayApiKey.id === candidateKeyId;
        });
      },
      finalizeRegistryKeyRotation: (candidateKeyId, candidatePayload) => {
        return finalizeGatewayRegistryApiKeyRotation(
          env,
          config.gatewayApiKeys,
          candidateKeyId,
          candidatePayload,
          requestId,
          mutation.actorContext
        );
      }
    }
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
  const mutation = await resolveAdminMutationActorCommand(
    request,
    env,
    payload,
    requestId,
    "Gateway dynamic key rotation cancel payload is invalid"
  );

  return writeGatewayAdminKeyRotationCancel(
    keyId,
    mutation.payload,
    requestId,
    {
      isConfiguredKey: (candidateKeyId) => {
        return config.gatewayApiKeys.some((gatewayApiKey) => {
          return gatewayApiKey.id === candidateKeyId;
        });
      },
      cancelRegistryKeyRotation: (candidateKeyId, candidatePayload) => {
        return cancelGatewayRegistryApiKeyRotation(
          env,
          config.gatewayApiKeys,
          candidateKeyId,
          candidatePayload,
          requestId,
          mutation.actorContext
        );
      }
    }
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
  return writeGatewayAdminKeyRegistryOverrideUpdate(keyId, payload, {
    updateRegistryOverride: async (candidateKeyId, candidatePayload) => {
      const gatewayApiKey = resolveGatewayApiKeyById(
        config.gatewayApiKeys,
        candidateKeyId,
        requestId
      );

      return upsertGatewayKeyRegistryOverride(
        env,
        gatewayApiKey,
        candidatePayload,
        requestId
      );
    }
  });
}

export async function clearAdminGatewayKeyRegistryOverride(
  env: GatewayBindings,
  keyId: string,
  requestId: string
) {
  const config = resolveGatewayConfig(env);
  return writeGatewayAdminKeyRegistryOverrideClear(keyId, {
    clearRegistryOverride: async (candidateKeyId) => {
      const gatewayApiKey = resolveGatewayApiKeyById(
        config.gatewayApiKeys,
        candidateKeyId,
        requestId
      );

      await clearGatewayKeyRegistryOverride(env, gatewayApiKey, requestId);
    }
  });
}

export async function revokeAdminGatewayKey(
  env: GatewayBindings,
  request: Request,
  keyId: string,
  requestId: string,
  payload: unknown
) {
  const config = resolveGatewayConfig(env);
  const mutation = await resolveAdminMutationActorCommand(
    request,
    env,
    payload,
    requestId,
    "Gateway key revocation payload is invalid"
  );

  return writeGatewayAdminKeyRevoke(
    keyId,
    mutation.payload,
    {
      revokeKey: (candidateKeyId, candidatePayload) => {
        return revokeGatewayKeyById(
          env,
          config.gatewayApiKeys,
          candidateKeyId,
          candidatePayload,
          requestId,
          mutation.actorContext
        );
      }
    }
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
  const mutation = await resolveAdminMutationActorCommand(
    request,
    env,
    payload,
    requestId,
    "Gateway key revocation payload is invalid"
  );

  return writeGatewayAdminKeyRevocationClear(
    keyId,
    mutation.payload,
    {
      clearKeyRevocation: (candidateKeyId, candidatePayload) => {
        return clearGatewayKeyRevocationById(
          env,
          config.gatewayApiKeys,
          candidateKeyId,
          candidatePayload,
          requestId,
          mutation.actorContext
        );
      }
    }
  );
}
