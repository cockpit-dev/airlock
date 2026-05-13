import {
  applyGatewayApiKeyMetadataOverride,
  parseGatewayApiKeyMetadataOverride,
  type GatewayApiKeyMetadataOverride,
  type GatewayApiKeyRecord
} from "./gateway-auth.js";
import { requireConfiguredGatewayApiKeyById } from "./gateway-key-identity.js";
import type { GatewayKeyRegistryStoredOverride } from "./gateway-key-registry.js";
import {
  getGatewayApiKeyStatusSnapshot,
  type GatewayKeyStatusSnapshotPort
} from "./gateway-key-status.js";

export interface ConfiguredGatewayApiKeyRuntimePort {
  readRegistryOverride(
    gatewayApiKey: GatewayApiKeyRecord
  ): Promise<GatewayKeyRegistryStoredOverride | null>;
}

export interface UpdateConfiguredGatewayKeyRegistryOverridePort {
  writeRegistryOverride(
    gatewayApiKey: GatewayApiKeyRecord,
    override: ReturnType<typeof parseGatewayApiKeyMetadataOverride>
  ): Promise<GatewayKeyRegistryStoredOverride>;
}

export interface ClearConfiguredGatewayKeyRegistryOverridePort {
  clearRegistryOverride(gatewayApiKey: GatewayApiKeyRecord): Promise<void>;
}

export interface ConfiguredGatewayApiKeyStatusSnapshotPort
  extends GatewayKeyStatusSnapshotPort {
  gatewayApiKeys: readonly GatewayApiKeyRecord[];
}

export async function resolveConfiguredGatewayApiKeyRuntime(
  gatewayApiKey: GatewayApiKeyRecord,
  port: ConfiguredGatewayApiKeyRuntimePort
): Promise<{
  runtimeGatewayApiKey: GatewayApiKeyRecord;
  registryOverride: GatewayKeyRegistryStoredOverride | null;
}> {
  const registryOverride = await port.readRegistryOverride(gatewayApiKey);

  return {
    runtimeGatewayApiKey: applyGatewayApiKeyMetadataOverride(
      gatewayApiKey,
      registryOverride ?? undefined
    ),
    registryOverride
  };
}

export async function updateConfiguredGatewayKeyRegistryOverride(
  gatewayApiKeys: readonly GatewayApiKeyRecord[],
  keyId: string,
  payload: unknown,
  requestId: string,
  port: UpdateConfiguredGatewayKeyRegistryOverridePort
): Promise<{
  keyId: string;
  override: GatewayKeyRegistryStoredOverride;
}> {
  const gatewayApiKey = requireConfiguredGatewayApiKeyById(
    gatewayApiKeys,
    keyId,
    requestId
  );
  const override = parseGatewayApiKeyMetadataOverride(payload);

  return {
    keyId: gatewayApiKey.id,
    override: await port.writeRegistryOverride(gatewayApiKey, override)
  };
}

export async function clearConfiguredGatewayKeyRegistryOverride(
  gatewayApiKeys: readonly GatewayApiKeyRecord[],
  keyId: string,
  requestId: string,
  port: ClearConfiguredGatewayKeyRegistryOverridePort
): Promise<{
  keyId: string;
  override: null;
}> {
  const gatewayApiKey = requireConfiguredGatewayApiKeyById(
    gatewayApiKeys,
    keyId,
    requestId
  );

  await port.clearRegistryOverride(gatewayApiKey);

  return {
    keyId: gatewayApiKey.id,
    override: null
  };
}

export async function getConfiguredGatewayApiKeyStatusSnapshot(
  keyId: string,
  requestId: string,
  port: ConfiguredGatewayApiKeyStatusSnapshotPort
) {
  return getGatewayApiKeyStatusSnapshot(
    requireConfiguredGatewayApiKeyById(port.gatewayApiKeys, keyId, requestId),
    "configured",
    port
  );
}

export type {
  GatewayApiKeyMetadataOverride
};
