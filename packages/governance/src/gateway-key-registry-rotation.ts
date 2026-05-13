import { GatewayError } from "@airlock/shared";

import { parseGatewayDynamicApiKeyRecord, type GatewayApiKeyRecord } from "./gateway-auth.js";
import {
  parseGatewayKeyRegistryRotateRequest,
  parseGatewayKeyRegistryRotationActionRequest,
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

function createGatewayKeyRotationNotStagedError(requestId: string): GatewayError {
  return new GatewayError("Gateway API key does not have an active staged rotation", {
    code: "gateway_key_rotation_not_staged",
    category: "governance",
    httpStatus: 409,
    retryable: false,
    requestId
  });
}

function createGatewayKeyRotationNotCancelableError(
  requestId: string
): GatewayError {
  return new GatewayError("Gateway API key staged rotation can no longer be canceled", {
    code: "gateway_key_rotation_not_cancelable",
    category: "governance",
    httpStatus: 409,
    retryable: false,
    requestId
  });
}

export interface RotateGatewayRegistryKeyPort {
  isConfiguredKey(keyId: string): boolean;
  getRegistryKey(keyId: string): Promise<GatewayKeyRegistryDynamicKeyView | null>;
  listComparableKeysForRotation(
    keyId: string
  ): Promise<GatewayApiKeyRecord[]>;
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
  getRegistryKey(keyId: string): Promise<GatewayKeyRegistryDynamicKeyView | null>;
  finalizeRegistryKeyRotation(
    keyId: string,
    request: ReturnType<typeof parseGatewayKeyRegistryRotationActionRequest>
  ): Promise<GatewayKeyRegistryDynamicKeyView>;
}

export interface CancelGatewayRegistryKeyRotationPort {
  isConfiguredKey(keyId: string): boolean;
  getRegistryKey(keyId: string): Promise<GatewayKeyRegistryDynamicKeyView | null>;
  cancelRegistryKeyRotation(
    keyId: string,
    request: ReturnType<typeof parseGatewayKeyRegistryRotationActionRequest>
  ): Promise<GatewayKeyRegistryDynamicKeyView>;
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

function assertStagedRotation(
  key: GatewayKeyRegistryDynamicKeyView,
  requestId: string
) {
  if (!key.previousValueHash || !key.previousValueHashExpiresAt) {
    throw createGatewayKeyRotationNotStagedError(requestId);
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

  if (now >= Date.parse(existingKey.previousValueHashExpiresAt!)) {
    throw createGatewayKeyRotationNotCancelableError(requestId);
  }

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
