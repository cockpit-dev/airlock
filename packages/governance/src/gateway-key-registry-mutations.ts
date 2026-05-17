import {
  applyGatewayApiKeyMetadataOverride,
  type GatewayApiKeyMetadataOverride,
  type GatewayApiKeyRecord
} from "./gateway-auth.js";
import {
  parseGatewayKeyRegistryBulkCreateRequest,
  parseGatewayKeyRegistryBulkDeleteRequest,
  parseGatewayKeyRegistryBulkUpdateRequest,
  parseGatewayKeyRegistryCreateRequest,
  parseGatewayKeyRegistryDeleteRequest,
  parseGatewayKeyRegistryUpdateRequest,
  type GatewayKeyRegistryBulkCreateRequest,
  type GatewayKeyRegistryBulkDeleteRequest,
  type GatewayKeyRegistryBulkUpdateRequest,
  type GatewayKeyRegistryDeleteResponse,
  type GatewayKeyRegistryDynamicKeyView
} from "./gateway-key-registry.js";
import {
  assertRegistryOwnedKeyId,
  assertRegistryOwnedKeyIds,
  createGatewayKeyNotFoundError,
  requireRegistryKey,
  requireRegistryKeys
} from "./gateway-key-registry-validation.js";

export interface CreateGatewayRegistryKeyPort {
  listComparableKeysForCreate(): Promise<GatewayApiKeyRecord[]>;
  validateRuntimeDependencies(key: GatewayApiKeyRecord): void;
  createRegistryKey(
    request: ReturnType<typeof parseGatewayKeyRegistryCreateRequest>
  ): Promise<GatewayKeyRegistryDynamicKeyView>;
}

export interface BulkCreateGatewayRegistryKeysPort {
  listComparableKeysForCreate(): Promise<GatewayApiKeyRecord[]>;
  validateRuntimeDependencies(key: GatewayApiKeyRecord): void;
  bulkCreateRegistryKeys(
    request: GatewayKeyRegistryBulkCreateRequest
  ): Promise<{
    operationId?: string;
    keys: GatewayKeyRegistryDynamicKeyView[];
  }>;
}

export interface UpdateGatewayRegistryKeyPort {
  isConfiguredKey(keyId: string): boolean;
  getRegistryKey(
    keyId: string
  ): Promise<GatewayKeyRegistryDynamicKeyView | null>;
  applyUpdate(
    existingKey: GatewayApiKeyRecord,
    update: GatewayApiKeyMetadataOverride
  ): GatewayApiKeyRecord;
  validateRuntimeDependencies(key: GatewayApiKeyRecord): void;
  updateRegistryKey(request: {
    keyId: string;
    update: GatewayApiKeyMetadataOverride;
    auditMetadata: ReturnType<
      typeof parseGatewayKeyRegistryUpdateRequest
    >["auditMetadata"];
  }): Promise<GatewayKeyRegistryDynamicKeyView>;
}

export interface BulkUpdateGatewayRegistryKeysPort {
  isConfiguredKey(keyId: string): boolean;
  getRegistryKeys(
    keyIds: readonly string[]
  ): Promise<Array<GatewayKeyRegistryDynamicKeyView | null>>;
  applyUpdate(
    existingKey: GatewayApiKeyRecord,
    update: GatewayApiKeyMetadataOverride
  ): GatewayApiKeyRecord;
  validateRuntimeDependencies(key: GatewayApiKeyRecord): void;
  bulkUpdateRegistryKeys(
    request: GatewayKeyRegistryBulkUpdateRequest
  ): Promise<{
    operationId?: string;
    keys: GatewayKeyRegistryDynamicKeyView[];
  }>;
}

export interface DeleteGatewayRegistryKeyPort {
  isConfiguredKey(keyId: string): boolean;
  getRegistryKey(
    keyId: string
  ): Promise<GatewayKeyRegistryDynamicKeyView | null>;
  clearRevocationOverlay(key: GatewayKeyRegistryDynamicKeyView): Promise<void>;
  deleteRegistryKey(
    keyId: string,
    request: ReturnType<typeof parseGatewayKeyRegistryDeleteRequest>
  ): Promise<void>;
}

export interface BulkDeleteGatewayRegistryKeysPort {
  isConfiguredKey(keyId: string): boolean;
  getRegistryKeys(
    keyIds: readonly string[]
  ): Promise<Array<GatewayKeyRegistryDynamicKeyView | null>>;
  clearRevocationOverlay(key: GatewayKeyRegistryDynamicKeyView): Promise<void>;
  bulkDeleteRegistryKeys(
    request: GatewayKeyRegistryBulkDeleteRequest
  ): Promise<{
    operationId?: string;
    keys: GatewayKeyRegistryDeleteResponse[];
  }>;
}

export async function createGatewayRegistryKey(
  payload: unknown,
  requestId: string,
  port: CreateGatewayRegistryKeyPort
): Promise<GatewayKeyRegistryDynamicKeyView> {
  const request = parseGatewayKeyRegistryCreateRequest(
    payload,
    await port.listComparableKeysForCreate()
  );

  port.validateRuntimeDependencies(request.key);

  return port.createRegistryKey(request);
}

export async function bulkCreateGatewayRegistryKeys(
  payload: unknown,
  requestId: string,
  port: BulkCreateGatewayRegistryKeysPort
): Promise<{
  operationId?: string;
  keys: GatewayKeyRegistryDynamicKeyView[];
}> {
  const request = parseGatewayKeyRegistryBulkCreateRequest(
    payload,
    await port.listComparableKeysForCreate()
  );

  for (const key of request.keys) {
    port.validateRuntimeDependencies(key);
  }

  return port.bulkCreateRegistryKeys(request);
}

export async function updateGatewayRegistryKey(
  keyId: string,
  payload: unknown,
  requestId: string,
  port: UpdateGatewayRegistryKeyPort
): Promise<GatewayKeyRegistryDynamicKeyView> {
  assertRegistryOwnedKeyId(keyId, requestId, (candidateKeyId) => {
    return port.isConfiguredKey(candidateKeyId);
  });

  const request = parseGatewayKeyRegistryUpdateRequest(payload);
  const existingKey = await requireRegistryKey(
    keyId,
    requestId,
    async (candidateKeyId) => {
      return port.getRegistryKey(candidateKeyId);
    }
  );

  port.validateRuntimeDependencies(
    port.applyUpdate(existingKey.key, request.update)
  );

  return port.updateRegistryKey({
    keyId,
    update: request.update,
    auditMetadata: request.auditMetadata
  });
}

export async function bulkUpdateGatewayRegistryKeys(
  payload: unknown,
  requestId: string,
  port: BulkUpdateGatewayRegistryKeysPort
): Promise<{
  operationId?: string;
  keys: GatewayKeyRegistryDynamicKeyView[];
}> {
  const request = parseGatewayKeyRegistryBulkUpdateRequest(payload);

  assertRegistryOwnedKeyIds(
    request.updates.map((entry) => entry.keyId),
    requestId,
    (candidateKeyId) => {
      return port.isConfiguredKey(candidateKeyId);
    }
  );

  const existingKeys = await requireRegistryKeys(
    request.updates.map((entry) => entry.keyId),
    requestId,
    async (keyIds) => {
      return port.getRegistryKeys(keyIds);
    }
  );
  const existingKeysById = new Map(
    existingKeys.map((key) => [key.keyId, key] as const)
  );

  for (const entry of request.updates) {
    const existingKey = existingKeysById.get(entry.keyId);

    if (!existingKey) {
      throw createGatewayKeyNotFoundError(requestId);
    }

    port.validateRuntimeDependencies(
      port.applyUpdate(existingKey.key, entry.update)
    );
  }

  return port.bulkUpdateRegistryKeys(request);
}

export async function deleteGatewayRegistryKey(
  keyId: string,
  payload: unknown,
  requestId: string,
  port: DeleteGatewayRegistryKeyPort
): Promise<{ keyId: string; deleted: true }> {
  assertRegistryOwnedKeyId(keyId, requestId, (candidateKeyId) => {
    return port.isConfiguredKey(candidateKeyId);
  });

  const existingKey = await requireRegistryKey(
    keyId,
    requestId,
    async (candidateKeyId) => {
      return port.getRegistryKey(candidateKeyId);
    }
  );
  const request = parseGatewayKeyRegistryDeleteRequest(payload);

  await port.clearRevocationOverlay(existingKey);
  await port.deleteRegistryKey(keyId, request);

  return {
    keyId,
    deleted: true
  };
}

export async function bulkDeleteGatewayRegistryKeys(
  payload: unknown,
  requestId: string,
  port: BulkDeleteGatewayRegistryKeysPort
): Promise<{
  operationId?: string;
  keys: GatewayKeyRegistryDeleteResponse[];
}> {
  const request = parseGatewayKeyRegistryBulkDeleteRequest(payload);

  assertRegistryOwnedKeyIds(request.keyIds, requestId, (candidateKeyId) => {
    return port.isConfiguredKey(candidateKeyId);
  });

  const existingKeys = await requireRegistryKeys(
    request.keyIds,
    requestId,
    async (keyIds) => {
      return port.getRegistryKeys(keyIds);
    }
  );

  for (const existingKey of existingKeys) {
    await port.clearRevocationOverlay(existingKey);
  }

  return port.bulkDeleteRegistryKeys(request);
}

export { applyGatewayApiKeyMetadataOverride };
