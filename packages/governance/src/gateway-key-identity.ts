import { createGatewayKeyNotFoundError } from "./gateway-key-registry-validation.js";

import {
  sha256Hex,
  type GatewayApiKeyOwnership,
  type GatewayApiKeyRecord
} from "./gateway-auth.js";
import type { GatewayKeyRegistryDynamicKeyView } from "./gateway-key-registry.js";

export interface GatewayApiKeyOwnershipResolutionPort {
  getRegistryKey(
    keyId: string
  ): Promise<GatewayKeyRegistryDynamicKeyView | null>;
}

export function isConfiguredGatewayApiKeyId(
  gatewayApiKeys: readonly GatewayApiKeyRecord[],
  keyId: string
): boolean {
  return gatewayApiKeys.some((gatewayApiKey) => gatewayApiKey.id === keyId);
}

export function findConfiguredGatewayApiKeyById(
  gatewayApiKeys: readonly GatewayApiKeyRecord[],
  keyId: string
): GatewayApiKeyRecord | undefined {
  return gatewayApiKeys.find((gatewayApiKey) => gatewayApiKey.id === keyId);
}

export function requireConfiguredGatewayApiKeyById(
  gatewayApiKeys: readonly GatewayApiKeyRecord[],
  keyId: string,
  requestId: string
): GatewayApiKeyRecord {
  const gatewayApiKey = findConfiguredGatewayApiKeyById(gatewayApiKeys, keyId);

  if (!gatewayApiKey) {
    throw createGatewayKeyNotFoundError(requestId);
  }

  return gatewayApiKey;
}

export async function resolveGatewayApiKeyByIdWithOwnership(
  gatewayApiKeys: readonly GatewayApiKeyRecord[],
  keyId: string,
  requestId: string,
  port: GatewayApiKeyOwnershipResolutionPort
): Promise<{
  gatewayApiKey: GatewayApiKeyRecord;
  ownership: GatewayApiKeyOwnership;
}> {
  const configuredGatewayApiKey = findConfiguredGatewayApiKeyById(
    gatewayApiKeys,
    keyId
  );

  if (configuredGatewayApiKey) {
    return {
      gatewayApiKey: configuredGatewayApiKey,
      ownership: "configured"
    };
  }

  const registryGatewayApiKey = await port.getRegistryKey(keyId);

  if (registryGatewayApiKey) {
    return {
      gatewayApiKey: registryGatewayApiKey.key,
      ownership: "registry"
    };
  }

  throw createGatewayKeyNotFoundError(requestId);
}

export async function toDynamicUniquenessComparableGatewayApiKeys(
  gatewayApiKeys: readonly GatewayApiKeyRecord[]
): Promise<GatewayApiKeyRecord[]> {
  return Promise.all(
    gatewayApiKeys.map(async (entry) => {
      if (entry.valueHash) {
        return entry;
      }

      if (!entry.value) {
        return entry;
      }

      const rest = { ...entry };
      delete rest.value;

      return {
        ...rest,
        valueHash: await sha256Hex(entry.value)
      };
    })
  );
}
