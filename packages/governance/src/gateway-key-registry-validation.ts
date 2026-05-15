import { GatewayError } from "@airlock/shared";

import type { GatewayKeyRegistryDynamicKeyView } from "./gateway-key-registry.js";

export function createGatewayKeyNotRegistryOwnedError(
  requestId: string
): GatewayError {
  return new GatewayError("Gateway API key is not registry owned", {
    code: "gateway_key_not_registry_owned",
    category: "governance",
    httpStatus: 409,
    retryable: false,
    requestId
  });
}

export function createGatewayKeyNotFoundError(requestId: string): GatewayError {
  return new GatewayError("Gateway API key not found", {
    code: "gateway_key_not_found",
    category: "governance",
    httpStatus: 404,
    retryable: false,
    requestId
  });
}

export function createGatewayKeyRotationNotStagedError(
  requestId: string
): GatewayError {
  return new GatewayError(
    "Gateway API key does not have an active staged rotation",
    {
      code: "gateway_key_rotation_not_staged",
      category: "governance",
      httpStatus: 409,
      retryable: false,
      requestId
    }
  );
}

export function createGatewayKeyRotationNotCancelableError(
  requestId: string
): GatewayError {
  return new GatewayError(
    "Gateway API key staged rotation can no longer be canceled",
    {
      code: "gateway_key_rotation_not_cancelable",
      category: "governance",
      httpStatus: 409,
      retryable: false,
      requestId
    }
  );
}

export function createGatewayKeyAlreadyArchivedError(
  requestId: string
): GatewayError {
  return new GatewayError("Gateway API key is already archived", {
    code: "gateway_key_already_archived",
    category: "governance",
    httpStatus: 409,
    retryable: false,
    requestId
  });
}

export function createGatewayKeyNotArchivedError(
  requestId: string
): GatewayError {
  return new GatewayError("Gateway API key is not archived", {
    code: "gateway_key_not_archived",
    category: "governance",
    httpStatus: 409,
    retryable: false,
    requestId
  });
}

export function assertRegistryOwnedKeyId(
  keyId: string,
  requestId: string,
  isConfiguredKey: (keyId: string) => boolean
) {
  if (isConfiguredKey(keyId)) {
    throw createGatewayKeyNotRegistryOwnedError(requestId);
  }
}

export function assertRegistryOwnedKeyIds(
  keyIds: readonly string[],
  requestId: string,
  isConfiguredKey: (keyId: string) => boolean
) {
  for (const keyId of keyIds) {
    assertRegistryOwnedKeyId(keyId, requestId, isConfiguredKey);
  }
}

export async function requireRegistryKey(
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

export async function requireRegistryKeys(
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
