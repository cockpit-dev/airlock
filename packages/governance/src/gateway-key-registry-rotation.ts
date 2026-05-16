import {
  parseGatewayDynamicApiKeyRecord,
  type GatewayApiKeyRecord
} from "./gateway-auth.js";
import {
  parseGatewayKeyRegistryBulkRotateRequest,
  parseGatewayKeyRegistryBulkRotationActionRequest,
  parseGatewayKeyRegistryRotateRequest,
  parseGatewayKeyRegistryRotationActionRequest,
  type GatewayKeyRegistryDynamicKeyView
} from "./gateway-key-registry.js";
import {
  assertRegistryOwnedKeyId,
  assertRegistryOwnedKeyIds,
  createGatewayKeyNotFoundError,
  createGatewayKeyRotationNotCancelableError,
  createGatewayKeyRotationNotStagedError,
  requireRegistryKey,
  requireRegistryKeys
} from "./gateway-key-registry-validation.js";

export interface RotateGatewayRegistryKeyPort {
  isConfiguredKey(keyId: string): boolean;
  getRegistryKey(
    keyId: string
  ): Promise<GatewayKeyRegistryDynamicKeyView | null>;
  listComparableKeysForRotation(keyId: string): Promise<GatewayApiKeyRecord[]>;
  validateRotatedKey(
    existingKey: GatewayKeyRegistryDynamicKeyView,
    valueHash: string,
    comparableKeys: readonly GatewayApiKeyRecord[]
  ): GatewayApiKeyRecord;
  clearRevocationOverlay(key: GatewayKeyRegistryDynamicKeyView): Promise<void>;
  rotateRegistryKey(
    keyId: string,
    request: ReturnType<typeof parseGatewayKeyRegistryRotateRequest>
  ): Promise<GatewayKeyRegistryDynamicKeyView>;
}

export interface FinalizeGatewayRegistryKeyRotationPort {
  isConfiguredKey(keyId: string): boolean;
  getRegistryKey(
    keyId: string
  ): Promise<GatewayKeyRegistryDynamicKeyView | null>;
  finalizeRegistryKeyRotation(
    keyId: string,
    request: ReturnType<typeof parseGatewayKeyRegistryRotationActionRequest>
  ): Promise<GatewayKeyRegistryDynamicKeyView>;
}

export interface CancelGatewayRegistryKeyRotationPort {
  isConfiguredKey(keyId: string): boolean;
  getRegistryKey(
    keyId: string
  ): Promise<GatewayKeyRegistryDynamicKeyView | null>;
  cancelRegistryKeyRotation(
    keyId: string,
    request: ReturnType<typeof parseGatewayKeyRegistryRotationActionRequest>
  ): Promise<GatewayKeyRegistryDynamicKeyView>;
}

export interface BulkRotateGatewayRegistryKeysPort {
  isConfiguredKey(keyId: string): boolean;
  getRegistryKeys(
    keyIds: readonly string[]
  ): Promise<Array<GatewayKeyRegistryDynamicKeyView | null>>;
  listComparableKeysForRotation(): Promise<GatewayApiKeyRecord[]>;
  validateRotatedKey(
    existingKey: GatewayKeyRegistryDynamicKeyView,
    valueHash: string,
    comparableKeys: readonly GatewayApiKeyRecord[]
  ): GatewayApiKeyRecord;
  clearRevocationOverlay(key: GatewayKeyRegistryDynamicKeyView): Promise<void>;
  bulkRotateRegistryKeys(
    payload: ReturnType<typeof parseGatewayKeyRegistryBulkRotateRequest>
  ): Promise<{
    operationId?: string;
    keys: GatewayKeyRegistryDynamicKeyView[];
  }>;
}

export interface BulkFinalizeGatewayRegistryKeyRotationsPort {
  isConfiguredKey(keyId: string): boolean;
  getRegistryKeys(
    keyIds: readonly string[]
  ): Promise<Array<GatewayKeyRegistryDynamicKeyView | null>>;
  bulkFinalizeRegistryKeyRotations(payload: {
    keyIds: string[];
    auditMetadata: ReturnType<
      typeof parseGatewayKeyRegistryBulkRotationActionRequest
    >["auditMetadata"];
  }): Promise<{
    operationId?: string;
    keys: GatewayKeyRegistryDynamicKeyView[];
  }>;
}

export interface BulkCancelGatewayRegistryKeyRotationsPort {
  isConfiguredKey(keyId: string): boolean;
  getRegistryKeys(
    keyIds: readonly string[]
  ): Promise<Array<GatewayKeyRegistryDynamicKeyView | null>>;
  bulkCancelRegistryKeyRotations(payload: {
    keyIds: string[];
    auditMetadata: ReturnType<
      typeof parseGatewayKeyRegistryBulkRotationActionRequest
    >["auditMetadata"];
  }): Promise<{
    operationId?: string;
    keys: GatewayKeyRegistryDynamicKeyView[];
  }>;
}

export interface RotationStagedKey {
  previousValueHash?: string;
  previousValueHashExpiresAt?: string;
}

export function assertStagedRotation(
  key: RotationStagedKey,
  requestId: string
) {
  if (!key.previousValueHash || !key.previousValueHashExpiresAt) {
    throw createGatewayKeyRotationNotStagedError(requestId);
  }
}

export function assertRotationIsCancelable(
  key: RotationStagedKey,
  requestId: string,
  now = Date.now()
) {
  if (now >= Date.parse(key.previousValueHashExpiresAt!)) {
    throw createGatewayKeyRotationNotCancelableError(requestId);
  }
}

export async function rotateGatewayRegistryKey(
  keyId: string,
  payload: unknown,
  requestId: string,
  port: RotateGatewayRegistryKeyPort
): Promise<GatewayKeyRegistryDynamicKeyView> {
  assertRegistryOwnedKeyId(keyId, requestId, (candidateKeyId) => {
    return port.isConfiguredKey(candidateKeyId);
  });

  const rotateRequest = parseGatewayKeyRegistryRotateRequest(payload);
  const existingKey = await requireRegistryKey(
    keyId,
    requestId,
    async (candidateKeyId) => {
      return port.getRegistryKey(candidateKeyId);
    }
  );
  const comparableKeys = await port.listComparableKeysForRotation(keyId);

  port.validateRotatedKey(existingKey, rotateRequest.valueHash, comparableKeys);
  await port.clearRevocationOverlay(existingKey);

  return port.rotateRegistryKey(keyId, rotateRequest);
}

export async function finalizeGatewayRegistryKeyRotation(
  keyId: string,
  payload: unknown,
  requestId: string,
  port: FinalizeGatewayRegistryKeyRotationPort
): Promise<GatewayKeyRegistryDynamicKeyView> {
  assertRegistryOwnedKeyId(keyId, requestId, (candidateKeyId) => {
    return port.isConfiguredKey(candidateKeyId);
  });

  const actionRequest = parseGatewayKeyRegistryRotationActionRequest(
    payload,
    "Gateway dynamic key rotation finalize payload is invalid"
  );
  const existingKey = await requireRegistryKey(
    keyId,
    requestId,
    async (candidateKeyId) => {
      return port.getRegistryKey(candidateKeyId);
    }
  );

  assertStagedRotation(existingKey, requestId);

  return port.finalizeRegistryKeyRotation(keyId, actionRequest);
}

export async function cancelGatewayRegistryKeyRotation(
  keyId: string,
  payload: unknown,
  requestId: string,
  port: CancelGatewayRegistryKeyRotationPort,
  now = Date.now()
): Promise<GatewayKeyRegistryDynamicKeyView> {
  assertRegistryOwnedKeyId(keyId, requestId, (candidateKeyId) => {
    return port.isConfiguredKey(candidateKeyId);
  });

  const actionRequest = parseGatewayKeyRegistryRotationActionRequest(
    payload,
    "Gateway dynamic key rotation cancel payload is invalid"
  );
  const existingKey = await requireRegistryKey(
    keyId,
    requestId,
    async (candidateKeyId) => {
      return port.getRegistryKey(candidateKeyId);
    }
  );

  assertStagedRotation(existingKey, requestId);
  assertRotationIsCancelable(existingKey, requestId, now);

  return port.cancelRegistryKeyRotation(keyId, actionRequest);
}

export function validateGatewayRegistryRotatedKeyCandidate(
  existingKey: GatewayKeyRegistryDynamicKeyView,
  valueHash: string,
  comparableKeys: readonly GatewayApiKeyRecord[]
): GatewayApiKeyRecord {
  return parseGatewayDynamicApiKeyRecord(
    {
      ...existingKey.key,
      valueHash
    },
    comparableKeys
  );
}

export async function bulkRotateGatewayRegistryKeys(
  payload: unknown,
  requestId: string,
  port: BulkRotateGatewayRegistryKeysPort
): Promise<{
  operationId?: string;
  keys: GatewayKeyRegistryDynamicKeyView[];
}> {
  const parsed = parseGatewayKeyRegistryBulkRotateRequest(payload);

  assertRegistryOwnedKeyIds(
    parsed.rotations.map((entry) => entry.keyId),
    requestId,
    (candidateKeyId) => {
      return port.isConfiguredKey(candidateKeyId);
    }
  );

  const existingKeys = await requireRegistryKeys(
    parsed.rotations.map((entry) => entry.keyId),
    requestId,
    async (keyIds) => {
      return port.getRegistryKeys(keyIds);
    }
  );
  let simulatedKeys = await port.listComparableKeysForRotation();

  for (const entry of parsed.rotations) {
    const existingKey = existingKeys.find((key) => key.keyId === entry.keyId);

    if (!existingKey) {
      throw createGatewayKeyNotFoundError(requestId);
    }

    const rotatedGatewayApiKey = port.validateRotatedKey(
      existingKey,
      entry.valueHash,
      simulatedKeys.filter((candidate) => candidate.id !== entry.keyId)
    );

    simulatedKeys = simulatedKeys
      .filter((candidate) => candidate.id !== entry.keyId)
      .concat(rotatedGatewayApiKey);
  }

  for (const existingKey of existingKeys) {
    await port.clearRevocationOverlay(existingKey);
  }

  return port.bulkRotateRegistryKeys(parsed);
}

export async function bulkFinalizeGatewayRegistryKeyRotations(
  payload: unknown,
  requestId: string,
  port: BulkFinalizeGatewayRegistryKeyRotationsPort
): Promise<{
  operationId?: string;
  keys: GatewayKeyRegistryDynamicKeyView[];
}> {
  const parsed = parseGatewayKeyRegistryBulkRotationActionRequest(
    payload,
    "Gateway dynamic key bulk rotation finalize payload is invalid"
  );

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
    assertStagedRotation(existingKey, requestId);
  }

  return port.bulkFinalizeRegistryKeyRotations(parsed);
}

export async function bulkCancelGatewayRegistryKeyRotations(
  payload: unknown,
  requestId: string,
  port: BulkCancelGatewayRegistryKeyRotationsPort,
  now = Date.now()
): Promise<{
  operationId?: string;
  keys: GatewayKeyRegistryDynamicKeyView[];
}> {
  const parsed = parseGatewayKeyRegistryBulkRotationActionRequest(
    payload,
    "Gateway dynamic key bulk rotation cancel payload is invalid"
  );

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
    assertStagedRotation(existingKey, requestId);
    assertRotationIsCancelable(existingKey, requestId, now);
  }

  return port.bulkCancelRegistryKeyRotations(parsed);
}
