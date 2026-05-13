import { GatewayError } from "@airlock/shared";

import {
  parseGatewayKeyRegistryBulkArchiveRequest,
  parseGatewayKeyRegistryBulkRestoreRequest,
  parseGatewayKeyRegistryLifecycleActionRequest,
  type GatewayKeyRegistryDynamicKeyView
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

function createGatewayKeyNotFoundError(requestId: string): GatewayError {
  return new GatewayError("Gateway API key not found", {
    code: "gateway_key_not_found",
    category: "governance",
    httpStatus: 404,
    retryable: false,
    requestId
  });
}

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

function assertRegistryOwnedKeyId(
  keyId: string,
  requestId: string,
  isConfiguredKey: (keyId: string) => boolean
) {
  if (isConfiguredKey(keyId)) {
    throw createGatewayKeyNotRegistryOwnedError(requestId);
  }
}

function assertRegistryOwnedKeyIds(
  keyIds: readonly string[],
  requestId: string,
  isConfiguredKey: (keyId: string) => boolean
) {
  for (const keyId of keyIds) {
    assertRegistryOwnedKeyId(keyId, requestId, isConfiguredKey);
  }
}

async function requireRegistryKey(
  keyId: string,
  requestId: string,
  getRegistryKey: (
    keyId: string
  ) => Promise<GatewayKeyRegistryDynamicKeyView | null>
) {
  const existingKey = await getRegistryKey(keyId);

  if (!existingKey) {
    throw createGatewayKeyNotFoundError(requestId);
  }

  return existingKey;
}

async function requireRegistryKeys(
  keyIds: readonly string[],
  requestId: string,
  getRegistryKeys: (
    keyIds: readonly string[]
  ) => Promise<Array<GatewayKeyRegistryDynamicKeyView | null>>
) {
  const keys = await getRegistryKeys(keyIds);

  if (keys.length !== keyIds.length) {
    throw new Error("Registry key batch response length mismatch");
  }

  for (const key of keys) {
    if (!key) {
      throw createGatewayKeyNotFoundError(requestId);
    }
  }

  return keys as GatewayKeyRegistryDynamicKeyView[];
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
