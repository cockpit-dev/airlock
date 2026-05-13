import { GatewayError } from "@airlock/shared";

import type { GatewayApiKeyMetadataOverride } from "./gateway-auth.js";
import type { GatewayKeyAuditActorContext } from "./gateway-key-audit.js";
import type {
  GatewayKeyRegistryBulkArchiveRequest,
  GatewayKeyRegistryBulkDeleteRequest,
  GatewayKeyRegistryBulkRotateRequest,
  GatewayKeyRegistryBulkRestoreRequest,
  GatewayKeyRegistryBulkUpdateRequest,
  GatewayKeyRegistryDeleteResponse,
  GatewayKeyRegistryDynamicKeyView
} from "./gateway-key-registry.js";

function createGatewayKeyNotRegistryOwnedError(requestId: string): GatewayError {
  return new GatewayError("Gateway API key is not registry owned", {
    code: "gateway_key_not_registry_owned",
    category: "governance",
    httpStatus: 409,
    retryable: false,
    requestId
  });
}

export interface CreateGatewayAdminKeyPort {
  createRegistryKey(
    payload: unknown
  ): Promise<GatewayKeyRegistryDynamicKeyView>;
}

export interface DeleteGatewayAdminKeyPort {
  isConfiguredKey(keyId: string): boolean;
  deleteRegistryKey(keyId: string, payload: unknown): Promise<void>;
}

export interface RotateGatewayAdminKeyPort {
  isConfiguredKey(keyId: string): boolean;
  rotateRegistryKey(
    keyId: string,
    payload: unknown
  ): Promise<GatewayKeyRegistryDynamicKeyView>;
}

export interface ArchiveGatewayAdminKeyPort {
  isConfiguredKey(keyId: string): boolean;
  archiveRegistryKey(
    keyId: string,
    payload: unknown
  ): Promise<GatewayKeyRegistryDynamicKeyView>;
}

export interface RestoreGatewayAdminKeyPort {
  isConfiguredKey(keyId: string): boolean;
  restoreRegistryKey(
    keyId: string,
    payload: unknown
  ): Promise<GatewayKeyRegistryDynamicKeyView>;
}

export interface UpdateGatewayAdminKeyPort {
  isConfiguredKey(keyId: string): boolean;
  updateRegistryKey(
    keyId: string,
    payload: unknown
  ): Promise<GatewayKeyRegistryDynamicKeyView>;
}

export interface BulkUpdateGatewayAdminKeysPort {
  isConfiguredKey(keyId: string): boolean;
  bulkUpdateRegistryKeys(
    payload: GatewayKeyRegistryBulkUpdateRequest["auditMetadata"] & {
      updates: Array<{
        keyId: string;
        status?: "active" | "revoked";
        label?: string;
        notBefore?: string | null;
        expiresAt?: string | null;
        policy?: object | null;
      }>;
    }
  ): Promise<{ operationId?: string; keys: GatewayKeyRegistryDynamicKeyView[] }>;
}

export interface BulkCreateGatewayAdminKeysPort {
  bulkCreateRegistryKeys(
    payload: {
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
    }
  ): Promise<{ operationId?: string; keys: GatewayKeyRegistryDynamicKeyView[] }>;
}

export interface BulkDeleteGatewayAdminKeysPort {
  isConfiguredKey(keyId: string): boolean;
  bulkDeleteRegistryKeys(
    payload: GatewayKeyRegistryBulkDeleteRequest["auditMetadata"] & {
      keyIds: string[];
    }
  ): Promise<{ operationId?: string; keys: GatewayKeyRegistryDeleteResponse[] }>;
}

export interface BulkArchiveGatewayAdminKeysPort {
  isConfiguredKey(keyId: string): boolean;
  bulkArchiveRegistryKeys(
    payload: GatewayKeyRegistryBulkArchiveRequest["auditMetadata"] & {
      keyIds: string[];
    }
  ): Promise<{ operationId?: string; keys: GatewayKeyRegistryDynamicKeyView[] }>;
}

export interface BulkRestoreGatewayAdminKeysPort {
  isConfiguredKey(keyId: string): boolean;
  bulkRestoreRegistryKeys(
    payload: GatewayKeyRegistryBulkRestoreRequest["auditMetadata"] & {
      keyIds: string[];
    }
  ): Promise<{ operationId?: string; keys: GatewayKeyRegistryDynamicKeyView[] }>;
}

export interface BulkRotateGatewayAdminKeysPort {
  isConfiguredKey(keyId: string): boolean;
  bulkRotateRegistryKeys(
    payload: GatewayKeyRegistryBulkRotateRequest["auditMetadata"] & {
      rotations: Array<{
        keyId: string;
        valueHash: string;
        overlapSeconds?: number;
      }>;
    }
  ): Promise<{ operationId?: string; keys: GatewayKeyRegistryDynamicKeyView[] }>;
}

export interface BulkFinalizeGatewayAdminKeyRotationsPort {
  isConfiguredKey(keyId: string): boolean;
  bulkFinalizeRegistryKeyRotations(
    payload: {
      keyIds: string[];
      reason?: string;
      actor?: string;
      actorSource?: "payload" | "trusted_header" | "credential";
    }
  ): Promise<{ operationId?: string; keys: GatewayKeyRegistryDynamicKeyView[] }>;
}

export interface BulkCancelGatewayAdminKeyRotationsPort {
  isConfiguredKey(keyId: string): boolean;
  bulkCancelRegistryKeyRotations(
    payload: {
      keyIds: string[];
      reason?: string;
      actor?: string;
      actorSource?: "payload" | "trusted_header" | "credential";
    }
  ): Promise<{ operationId?: string; keys: GatewayKeyRegistryDynamicKeyView[] }>;
}

export interface FinalizeGatewayAdminKeyRotationPort {
  isConfiguredKey(keyId: string): boolean;
  finalizeRegistryKeyRotation(
    keyId: string,
    payload: unknown
  ): Promise<GatewayKeyRegistryDynamicKeyView>;
}

export interface CancelGatewayAdminKeyRotationPort {
  isConfiguredKey(keyId: string): boolean;
  cancelRegistryKeyRotation(
    keyId: string,
    payload: unknown
  ): Promise<GatewayKeyRegistryDynamicKeyView>;
}

export interface UpdateGatewayAdminKeyRegistryOverridePort {
  updateRegistryOverride(
    keyId: string,
    payload: unknown
  ): Promise<GatewayApiKeyMetadataOverride & { updatedAt: string }>;
}

export interface ClearGatewayAdminKeyRegistryOverridePort {
  clearRegistryOverride(keyId: string): Promise<void>;
}

export interface RevokeGatewayAdminKeyPort {
  revokeKey(
    keyId: string,
    payload: unknown
  ): Promise<{ keyId: string; revoked: boolean; updatedAt: string }>;
}

export interface ClearGatewayAdminKeyRevocationPort {
  clearKeyRevocation(
    keyId: string,
    payload: unknown
  ): Promise<{ keyId: string; revoked: boolean; updatedAt: string }>;
}

export async function createGatewayAdminKey(
  payload: unknown,
  port: CreateGatewayAdminKeyPort
): Promise<GatewayKeyRegistryDynamicKeyView> {
  return port.createRegistryKey(payload);
}

export async function bulkCreateGatewayAdminKeys(
  payload: {
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
  },
  port: BulkCreateGatewayAdminKeysPort
): Promise<{
  operationId?: string;
  keys: GatewayKeyRegistryDynamicKeyView[];
}> {
  return port.bulkCreateRegistryKeys(payload);
}

export async function deleteGatewayAdminKey(
  keyId: string,
  payload: unknown,
  requestId: string,
  port: DeleteGatewayAdminKeyPort
): Promise<{ keyId: string; deleted: true }> {
  if (port.isConfiguredKey(keyId)) {
    throw createGatewayKeyNotRegistryOwnedError(requestId);
  }

  await port.deleteRegistryKey(keyId, payload);

  return {
    keyId,
    deleted: true
  };
}

export async function rotateGatewayAdminKey(
  keyId: string,
  payload: unknown,
  requestId: string,
  port: RotateGatewayAdminKeyPort
): Promise<GatewayKeyRegistryDynamicKeyView> {
  if (port.isConfiguredKey(keyId)) {
    throw createGatewayKeyNotRegistryOwnedError(requestId);
  }

  return port.rotateRegistryKey(keyId, payload);
}

export async function archiveGatewayAdminKey(
  keyId: string,
  payload: unknown,
  requestId: string,
  port: ArchiveGatewayAdminKeyPort
): Promise<GatewayKeyRegistryDynamicKeyView> {
  if (port.isConfiguredKey(keyId)) {
    throw createGatewayKeyNotRegistryOwnedError(requestId);
  }

  return port.archiveRegistryKey(keyId, payload);
}

export async function restoreGatewayAdminKey(
  keyId: string,
  payload: unknown,
  requestId: string,
  port: RestoreGatewayAdminKeyPort
): Promise<GatewayKeyRegistryDynamicKeyView> {
  if (port.isConfiguredKey(keyId)) {
    throw createGatewayKeyNotRegistryOwnedError(requestId);
  }

  return port.restoreRegistryKey(keyId, payload);
}

export async function updateGatewayAdminKey(
  keyId: string,
  payload: unknown,
  requestId: string,
  port: UpdateGatewayAdminKeyPort
): Promise<GatewayKeyRegistryDynamicKeyView> {
  if (port.isConfiguredKey(keyId)) {
    throw createGatewayKeyNotRegistryOwnedError(requestId);
  }

  return port.updateRegistryKey(keyId, payload);
}

export async function bulkUpdateGatewayAdminKeys(
  payload: GatewayKeyRegistryBulkUpdateRequest["auditMetadata"] & {
    updates: Array<{
      keyId: string;
      status?: "active" | "revoked";
      label?: string;
      notBefore?: string | null;
      expiresAt?: string | null;
      policy?: object | null;
    }>;
  },
  requestId: string,
  port: BulkUpdateGatewayAdminKeysPort
): Promise<{
  operationId?: string;
  keys: GatewayKeyRegistryDynamicKeyView[];
}> {
  for (const entry of payload.updates) {
    if (port.isConfiguredKey(entry.keyId)) {
      throw createGatewayKeyNotRegistryOwnedError(requestId);
    }
  }

  return port.bulkUpdateRegistryKeys(payload);
}

export async function bulkDeleteGatewayAdminKeys(
  payload: GatewayKeyRegistryBulkDeleteRequest["auditMetadata"] & {
    keyIds: string[];
  },
  requestId: string,
  port: BulkDeleteGatewayAdminKeysPort
): Promise<{
  operationId?: string;
  keys: GatewayKeyRegistryDeleteResponse[];
}> {
  for (const keyId of payload.keyIds) {
    if (port.isConfiguredKey(keyId)) {
      throw createGatewayKeyNotRegistryOwnedError(requestId);
    }
  }

  return port.bulkDeleteRegistryKeys(payload);
}

export async function bulkRotateGatewayAdminKeys(
  payload: GatewayKeyRegistryBulkRotateRequest["auditMetadata"] & {
    rotations: Array<{
      keyId: string;
      valueHash: string;
      overlapSeconds?: number;
    }>;
  },
  requestId: string,
  port: BulkRotateGatewayAdminKeysPort
): Promise<{
  operationId?: string;
  keys: GatewayKeyRegistryDynamicKeyView[];
}> {
  for (const entry of payload.rotations) {
    if (port.isConfiguredKey(entry.keyId)) {
      throw createGatewayKeyNotRegistryOwnedError(requestId);
    }
  }

  return port.bulkRotateRegistryKeys(payload);
}

export async function bulkArchiveGatewayAdminKeys(
  payload: GatewayKeyRegistryBulkArchiveRequest["auditMetadata"] & {
    keyIds: string[];
  },
  requestId: string,
  port: BulkArchiveGatewayAdminKeysPort
): Promise<{
  operationId?: string;
  keys: GatewayKeyRegistryDynamicKeyView[];
}> {
  for (const keyId of payload.keyIds) {
    if (port.isConfiguredKey(keyId)) {
      throw createGatewayKeyNotRegistryOwnedError(requestId);
    }
  }

  return port.bulkArchiveRegistryKeys(payload);
}

export async function bulkRestoreGatewayAdminKeys(
  payload: GatewayKeyRegistryBulkRestoreRequest["auditMetadata"] & {
    keyIds: string[];
  },
  requestId: string,
  port: BulkRestoreGatewayAdminKeysPort
): Promise<{
  operationId?: string;
  keys: GatewayKeyRegistryDynamicKeyView[];
}> {
  for (const keyId of payload.keyIds) {
    if (port.isConfiguredKey(keyId)) {
      throw createGatewayKeyNotRegistryOwnedError(requestId);
    }
  }

  return port.bulkRestoreRegistryKeys(payload);
}

export async function bulkFinalizeGatewayAdminKeyRotations(
  payload: {
    keyIds: string[];
    reason?: string;
    actor?: string;
    actorSource?: "payload" | "trusted_header" | "credential";
  },
  requestId: string,
  port: BulkFinalizeGatewayAdminKeyRotationsPort
): Promise<{
  operationId?: string;
  keys: GatewayKeyRegistryDynamicKeyView[];
}> {
  for (const keyId of payload.keyIds) {
    if (port.isConfiguredKey(keyId)) {
      throw createGatewayKeyNotRegistryOwnedError(requestId);
    }
  }

  return port.bulkFinalizeRegistryKeyRotations(payload);
}

export async function bulkCancelGatewayAdminKeyRotations(
  payload: {
    keyIds: string[];
    reason?: string;
    actor?: string;
    actorSource?: "payload" | "trusted_header" | "credential";
  },
  requestId: string,
  port: BulkCancelGatewayAdminKeyRotationsPort
): Promise<{
  operationId?: string;
  keys: GatewayKeyRegistryDynamicKeyView[];
}> {
  for (const keyId of payload.keyIds) {
    if (port.isConfiguredKey(keyId)) {
      throw createGatewayKeyNotRegistryOwnedError(requestId);
    }
  }

  return port.bulkCancelRegistryKeyRotations(payload);
}

export async function finalizeGatewayAdminKeyRotation(
  keyId: string,
  payload: unknown,
  requestId: string,
  port: FinalizeGatewayAdminKeyRotationPort
): Promise<GatewayKeyRegistryDynamicKeyView> {
  if (port.isConfiguredKey(keyId)) {
    throw createGatewayKeyNotRegistryOwnedError(requestId);
  }

  return port.finalizeRegistryKeyRotation(keyId, payload);
}

export async function cancelGatewayAdminKeyRotation(
  keyId: string,
  payload: unknown,
  requestId: string,
  port: CancelGatewayAdminKeyRotationPort
): Promise<GatewayKeyRegistryDynamicKeyView> {
  if (port.isConfiguredKey(keyId)) {
    throw createGatewayKeyNotRegistryOwnedError(requestId);
  }

  return port.cancelRegistryKeyRotation(keyId, payload);
}

export async function updateGatewayAdminKeyRegistryOverride(
  keyId: string,
  payload: unknown,
  port: UpdateGatewayAdminKeyRegistryOverridePort
): Promise<{
  keyId: string;
  override: GatewayApiKeyMetadataOverride & { updatedAt: string };
}> {
  return {
    keyId,
    override: await port.updateRegistryOverride(keyId, payload)
  };
}

export async function clearGatewayAdminKeyRegistryOverride(
  keyId: string,
  port: ClearGatewayAdminKeyRegistryOverridePort
): Promise<{
  keyId: string;
  override: null;
}> {
  await port.clearRegistryOverride(keyId);

  return {
    keyId,
    override: null
  };
}

export async function revokeGatewayAdminKey(
  keyId: string,
  payload: unknown,
  port: RevokeGatewayAdminKeyPort
): Promise<{ keyId: string; revoked: boolean; updatedAt: string }> {
  return port.revokeKey(keyId, payload);
}

export async function clearGatewayAdminKeyRevocation(
  keyId: string,
  payload: unknown,
  port: ClearGatewayAdminKeyRevocationPort
): Promise<{ keyId: string; revoked: boolean; updatedAt: string }> {
  return port.clearKeyRevocation(keyId, payload);
}

export interface AdminMutationActorCommand {
  actorContext?: GatewayKeyAuditActorContext;
  payload: unknown;
}
