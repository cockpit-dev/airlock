import { isConfiguredGatewayApiKeyId, type GatewayKeyAuditActorContext } from "@airlock/governance";

import { resolveGatewayConfig } from "./config.js";
import type { GatewayBindings } from "./env.js";
import {
  archiveGatewayRegistryApiKey,
  bulkArchiveGatewayRegistryApiKeys,
  bulkCancelGatewayRegistryApiKeyRotations,
  bulkCreateGatewayRegistryApiKeys,
  bulkDeleteGatewayRegistryApiKeys,
  bulkFinalizeGatewayRegistryApiKeyRotations,
  bulkRotateGatewayRegistryApiKeys,
  bulkRestoreGatewayRegistryApiKeys,
  bulkUpdateGatewayRegistryApiKeys,
  cancelGatewayRegistryApiKeyRotation,
  clearGatewayKeyRegistryOverride,
  createGatewayRegistryApiKey,
  deleteGatewayRegistryApiKey,
  finalizeGatewayRegistryApiKeyRotation,
  getGatewayRegistryApiKey,
  getGatewayRegistryApiKeyEvents,
  getGatewayRegistryOperationEvents,
  restoreGatewayRegistryApiKey,
  rotateGatewayRegistryApiKey,
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

export function createAdminKeyGovernanceRuntime(
  env: GatewayBindings,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
) {
  let cachedGatewayApiKeys:
    | ReturnType<typeof resolveGatewayConfig>["gatewayApiKeys"]
    | undefined;

  function getGatewayApiKeys() {
    if (!cachedGatewayApiKeys) {
      cachedGatewayApiKeys = resolveGatewayConfig(env).gatewayApiKeys;
    }

    return cachedGatewayApiKeys;
  }

  return {
    get gatewayApiKeys() {
      return getGatewayApiKeys();
    },
    isConfiguredKey(candidateKeyId: string) {
      return isConfiguredGatewayApiKeyId(getGatewayApiKeys(), candidateKeyId);
    },
    read: {
      listKeySnapshots(filters: {
        acceptedNow?: boolean;
        effectiveStatus?: "active" | "revoked" | "not_yet_active" | "expired" | "archived";
        includeArchived?: boolean;
      }) {
        return listGatewayApiKeyStatuses(
          env,
          getGatewayApiKeys(),
          requestId,
          filters
        );
      },
      getRegistryKey(candidateKeyId: string) {
        return getGatewayRegistryApiKey(env, candidateKeyId, requestId);
      },
      getRegistryEvents(candidateKeyId: string) {
        return getGatewayRegistryApiKeyEvents(env, candidateKeyId, requestId);
      },
      getRevocationEvents(candidateKeyId: string) {
        return getGatewayKeyRevocationEvents(env, candidateKeyId, requestId);
      },
      getOperationEvents(candidateOperationId: string) {
        return getGatewayRegistryOperationEvents(env, candidateOperationId, requestId);
      },
      getKeyRevocationStatus(candidateKeyId: string) {
        return getGatewayKeyRevocationStatusById(
          env,
          getGatewayApiKeys(),
          candidateKeyId,
          requestId
        );
      },
      async getKeyStatusSnapshot(candidateKeyId: string) {
        const { gatewayApiKey, ownership } =
          await resolveGatewayApiKeyByIdWithRegistry(
            env,
            getGatewayApiKeys(),
            candidateKeyId,
            requestId
          );

        return getGatewayApiKeyStatusSnapshot(
          env,
          gatewayApiKey,
          requestId,
          ownership
        );
      },
      async assertKeyExists(candidateKeyId: string) {
        await resolveGatewayApiKeyByIdWithRegistry(
          env,
          getGatewayApiKeys(),
          candidateKeyId,
          requestId
        );
      },
      async getConfiguredKeyStatusSnapshot(candidateKeyId: string) {
        const gatewayApiKey = resolveGatewayApiKeyById(
          getGatewayApiKeys(),
          candidateKeyId,
          requestId
        );

        return getGatewayApiKeyStatusSnapshot(env, gatewayApiKey, requestId);
      }
    },
    write: {
      isConfiguredKey(candidateKeyId: string) {
        return isConfiguredGatewayApiKeyId(getGatewayApiKeys(), candidateKeyId);
      },
      createRegistryKey(candidatePayload: unknown) {
        return createGatewayRegistryApiKey(
          env,
          getGatewayApiKeys(),
          candidatePayload,
          requestId,
          actorContext
        );
      },
      bulkCreateRegistryKeys(candidatePayload: {
        keys: Array<{
          id: string;
          label: string;
          valueHash: string;
          status: "active" | "revoked";
          notBefore?: string;
          expiresAt?: string;
          policy?: object;
        }>;
        actor?: string;
        actorSource?: "payload" | "trusted_header" | "credential";
      }) {
        return bulkCreateGatewayRegistryApiKeys(
          env,
          getGatewayApiKeys(),
          candidatePayload,
          requestId,
          actorContext
        );
      },
      bulkUpdateRegistryKeys(candidatePayload: {
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
      }) {
        return bulkUpdateGatewayRegistryApiKeys(
          env,
          getGatewayApiKeys(),
          candidatePayload,
          requestId,
          actorContext
        );
      },
      bulkDeleteRegistryKeys(candidatePayload: {
        keyIds: string[];
        reason?: string;
        actor?: string;
        actorSource?: "payload" | "trusted_header" | "credential";
      }) {
        return bulkDeleteGatewayRegistryApiKeys(
          env,
          getGatewayApiKeys(),
          candidatePayload,
          requestId,
          actorContext
        );
      },
      bulkRotateRegistryKeys(candidatePayload: {
        rotations: Array<{
          keyId: string;
          valueHash: string;
          overlapSeconds?: number;
        }>;
        reason?: string;
        actor?: string;
        actorSource?: "payload" | "trusted_header" | "credential";
      }) {
        return bulkRotateGatewayRegistryApiKeys(
          env,
          getGatewayApiKeys(),
          candidatePayload,
          requestId,
          actorContext
        );
      },
      bulkArchiveRegistryKeys(candidatePayload: {
        keyIds: string[];
        reason?: string;
        actor?: string;
        actorSource?: "payload" | "trusted_header" | "credential";
      }) {
        return bulkArchiveGatewayRegistryApiKeys(
          env,
          getGatewayApiKeys(),
          candidatePayload,
          requestId,
          actorContext
        );
      },
      bulkRestoreRegistryKeys(candidatePayload: {
        keyIds: string[];
        reason?: string;
        actor?: string;
        actorSource?: "payload" | "trusted_header" | "credential";
      }) {
        return bulkRestoreGatewayRegistryApiKeys(
          env,
          getGatewayApiKeys(),
          candidatePayload,
          requestId,
          actorContext
        );
      },
      bulkFinalizeRegistryKeyRotations(candidatePayload: {
        keyIds: string[];
        reason?: string;
        actor?: string;
        actorSource?: "payload" | "trusted_header" | "credential";
      }) {
        return bulkFinalizeGatewayRegistryApiKeyRotations(
          env,
          getGatewayApiKeys(),
          candidatePayload,
          requestId,
          actorContext
        );
      },
      bulkCancelRegistryKeyRotations(candidatePayload: {
        keyIds: string[];
        reason?: string;
        actor?: string;
        actorSource?: "payload" | "trusted_header" | "credential";
      }) {
        return bulkCancelGatewayRegistryApiKeyRotations(
          env,
          getGatewayApiKeys(),
          candidatePayload,
          requestId,
          actorContext
        );
      },
      updateRegistryKey(candidateKeyId: string, candidatePayload: unknown) {
        return updateGatewayRegistryApiKey(
          env,
          getGatewayApiKeys(),
          candidateKeyId,
          candidatePayload,
          requestId,
          actorContext
        );
      },
      deleteRegistryKey(candidateKeyId: string, candidatePayload: unknown) {
        return deleteGatewayRegistryApiKey(
          env,
          getGatewayApiKeys(),
          candidateKeyId,
          candidatePayload,
          requestId,
          actorContext
        );
      },
      rotateRegistryKey(candidateKeyId: string, candidatePayload: unknown) {
        return rotateGatewayRegistryApiKey(
          env,
          getGatewayApiKeys(),
          candidateKeyId,
          candidatePayload,
          requestId,
          actorContext
        );
      },
      archiveRegistryKey(candidateKeyId: string, candidatePayload: unknown) {
        return archiveGatewayRegistryApiKey(
          env,
          getGatewayApiKeys(),
          candidateKeyId,
          candidatePayload,
          requestId,
          actorContext
        );
      },
      restoreRegistryKey(candidateKeyId: string, candidatePayload: unknown) {
        return restoreGatewayRegistryApiKey(
          env,
          getGatewayApiKeys(),
          candidateKeyId,
          candidatePayload,
          requestId,
          actorContext
        );
      },
      finalizeRegistryKeyRotation(candidateKeyId: string, candidatePayload: unknown) {
        return finalizeGatewayRegistryApiKeyRotation(
          env,
          getGatewayApiKeys(),
          candidateKeyId,
          candidatePayload,
          requestId,
          actorContext
        );
      },
      cancelRegistryKeyRotation(candidateKeyId: string, candidatePayload: unknown) {
        return cancelGatewayRegistryApiKeyRotation(
          env,
          getGatewayApiKeys(),
          candidateKeyId,
          candidatePayload,
          requestId,
          actorContext
        );
      },
      async updateRegistryOverride(candidateKeyId: string, candidatePayload: unknown) {
        const gatewayApiKey = resolveGatewayApiKeyById(
          getGatewayApiKeys(),
          candidateKeyId,
          requestId
        );

        return upsertGatewayKeyRegistryOverride(
          env,
          gatewayApiKey,
          candidatePayload,
          requestId
        );
      },
      async clearRegistryOverride(candidateKeyId: string) {
        const gatewayApiKey = resolveGatewayApiKeyById(
          getGatewayApiKeys(),
          candidateKeyId,
          requestId
        );

        await clearGatewayKeyRegistryOverride(env, gatewayApiKey, requestId);
      },
      revokeKey(candidateKeyId: string, candidatePayload: unknown) {
        return revokeGatewayKeyById(
          env,
          getGatewayApiKeys(),
          candidateKeyId,
          candidatePayload,
          requestId,
          actorContext
        );
      },
      clearKeyRevocation(candidateKeyId: string, candidatePayload: unknown) {
        return clearGatewayKeyRevocationById(
          env,
          getGatewayApiKeys(),
          candidateKeyId,
          candidatePayload,
          requestId,
          actorContext
        );
      }
    }
  };
}
