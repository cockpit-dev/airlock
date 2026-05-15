import { GatewayError } from "@airlock/shared";

import {
  parseGatewayKeyRegistryBulkArchiveRequest,
  parseGatewayKeyRegistryBulkRestoreRequest,
  parseGatewayKeyRegistryLifecycleActionRequest,
  type GatewayKeyRegistryDynamicKeyView
} from "./gateway-key-registry.js";
import {
  assertRegistryOwnedKeyId,
  assertRegistryOwnedKeyIds,
  requireRegistryKey,
  requireRegistryKeys
} from "./gateway-key-registry-validation.js";

function createGatewayKeyAlreadyArchivedError(requestId: string): GatewayError {
  return new GatewayError("Gateway API key is already archived", {
    code: "gateway_key_already_archived",
    category: "governance",
    httpStatus: 409,
    retryable: false,
    requestId
  });
}

function createGatewayKeyNotArchivedError(requestId: string): GatewayError {
  return new GatewayError("Gateway API key is not archived", {
    code: "gateway_key_not_archived",
    category: "governance",
    httpStatus: 409,
    retryable: false,
    requestId
  });
}

export interface ArchiveGatewayRegistryKeyPort {
  isConfiguredKey(keyId: string): boolean;
  getRegistryKey(keyId: string): Promise<GatewayKeyRegistryDynamicKeyView | null>;
  archiveRegistryKey(
    keyId: string,
    request: ReturnType<typeof parseGatewayKeyRegistryLifecycleActionRequest>
  ): Promise<GatewayKeyRegistryDynamicKeyView>;
}

export interface RestoreGatewayRegistryKeyPort {
  isConfiguredKey(keyId: string): boolean;
  getRegistryKey(keyId: string): Promise<GatewayKeyRegistryDynamicKeyView | null>;
  restoreRegistryKey(
    keyId: string,
    request: ReturnType<typeof parseGatewayKeyRegistryLifecycleActionRequest>
  ): Promise<GatewayKeyRegistryDynamicKeyView>;
}

export interface BulkArchiveGatewayRegistryKeysPort {
  isConfiguredKey(keyId: string): boolean;
  getRegistryKeys(
    keyIds: readonly string[]
  ): Promise<Array<GatewayKeyRegistryDynamicKeyView | null>>;
  bulkArchiveRegistryKeys(payload: {
    keyIds: string[];
    auditMetadata: ReturnType<
      typeof parseGatewayKeyRegistryBulkArchiveRequest
    >["auditMetadata"];
  }): Promise<{
    operationId?: string;
    keys: GatewayKeyRegistryDynamicKeyView[];
  }>;
}

export interface BulkRestoreGatewayRegistryKeysPort {
  isConfiguredKey(keyId: string): boolean;
  getRegistryKeys(
    keyIds: readonly string[]
  ): Promise<Array<GatewayKeyRegistryDynamicKeyView | null>>;
  bulkRestoreRegistryKeys(payload: {
    keyIds: string[];
    auditMetadata: ReturnType<
      typeof parseGatewayKeyRegistryBulkRestoreRequest
    >["auditMetadata"];
  }): Promise<{
    operationId?: string;
    keys: GatewayKeyRegistryDynamicKeyView[];
  }>;
}



function assertNotArchived(
  existingKey: GatewayKeyRegistryDynamicKeyView,
  requestId: string
) {
  if (existingKey.archivedAt) {
    throw createGatewayKeyAlreadyArchivedError(requestId);
  }
}

function assertArchived(
  existingKey: GatewayKeyRegistryDynamicKeyView,
  requestId: string
) {
  if (!existingKey.archivedAt) {
    throw createGatewayKeyNotArchivedError(requestId);
  }
}

export async function archiveGatewayRegistryKey(
  keyId: string,
  payload: unknown,
  requestId: string,
  port: ArchiveGatewayRegistryKeyPort
): Promise<GatewayKeyRegistryDynamicKeyView> {
  assertRegistryOwnedKeyId(keyId, requestId, (candidateKeyId) => {
    return port.isConfiguredKey(candidateKeyId);
  });

  const actionRequest = parseGatewayKeyRegistryLifecycleActionRequest(
    payload,
    "Gateway dynamic key archive payload is invalid"
  );
  const existingKey = await requireRegistryKey(
    keyId,
    requestId,
    async (candidateKeyId) => {
      return port.getRegistryKey(candidateKeyId);
    }
  );

  assertNotArchived(existingKey, requestId);

  return port.archiveRegistryKey(keyId, actionRequest);
}

export async function restoreGatewayRegistryKey(
  keyId: string,
  payload: unknown,
  requestId: string,
  port: RestoreGatewayRegistryKeyPort
): Promise<GatewayKeyRegistryDynamicKeyView> {
  assertRegistryOwnedKeyId(keyId, requestId, (candidateKeyId) => {
    return port.isConfiguredKey(candidateKeyId);
  });

  const actionRequest = parseGatewayKeyRegistryLifecycleActionRequest(
    payload,
    "Gateway dynamic key restore payload is invalid"
  );
  const existingKey = await requireRegistryKey(
    keyId,
    requestId,
    async (candidateKeyId) => {
      return port.getRegistryKey(candidateKeyId);
    }
  );

  assertArchived(existingKey, requestId);

  return port.restoreRegistryKey(keyId, actionRequest);
}

export async function bulkArchiveGatewayRegistryKeys(
  payload: unknown,
  requestId: string,
  port: BulkArchiveGatewayRegistryKeysPort
): Promise<{
  operationId?: string;
  keys: GatewayKeyRegistryDynamicKeyView[];
}> {
  const parsed = parseGatewayKeyRegistryBulkArchiveRequest(payload);

  assertRegistryOwnedKeyIds(parsed.keyIds, requestId, (candidateKeyId) => {
    return port.isConfiguredKey(candidateKeyId);
  });

  const existingKeys = await requireRegistryKeys(
    parsed.keyIds,
    requestId,
    async (keyIds) => {
      return port.getRegistryKeys(keyIds);
    }
  );

  for (const existingKey of existingKeys) {
    assertNotArchived(existingKey, requestId);
  }

  return port.bulkArchiveRegistryKeys(parsed);
}

export async function bulkRestoreGatewayRegistryKeys(
  payload: unknown,
  requestId: string,
  port: BulkRestoreGatewayRegistryKeysPort
): Promise<{
  operationId?: string;
  keys: GatewayKeyRegistryDynamicKeyView[];
}> {
  const parsed = parseGatewayKeyRegistryBulkRestoreRequest(payload);

  assertRegistryOwnedKeyIds(parsed.keyIds, requestId, (candidateKeyId) => {
    return port.isConfiguredKey(candidateKeyId);
  });

  const existingKeys = await requireRegistryKeys(
    parsed.keyIds,
    requestId,
    async (keyIds) => {
      return port.getRegistryKeys(keyIds);
    }
  );

  for (const existingKey of existingKeys) {
    assertArchived(existingKey, requestId);
  }

  return port.bulkRestoreRegistryKeys(parsed);
}
