import {
  createGatewayApiKeyRegistrySnapshot,
  deriveGatewayApiKeyStatusView,
  type GatewayApiKeyLifecycleStatus,
  type GatewayApiKeyMetadataOverride,
  type GatewayApiKeyOwnership,
  type GatewayApiKeyRecord,
  type GatewayApiKeyRegistrySnapshot,
  type GatewayApiKeyStatusView,
  type GatewayKeyRevocationOverlayState
} from "./gateway-auth.js";
import { resolveGatewayApiKeyByIdWithOwnership } from "./gateway-key-identity.js";
import type { GatewayKeyRegistryDynamicKeyView } from "./gateway-key-registry.js";

export interface GatewayKeyOverlayStateReadPort {
  readOverlayState(
    gatewayApiKey: GatewayApiKeyRecord
  ): Promise<GatewayKeyRevocationOverlayState>;
}

export interface GatewayKeyStatusByIdReadPort extends GatewayKeyOverlayStateReadPort {
  resolveKeyById(keyId: string): Promise<{
    gatewayApiKey: GatewayApiKeyRecord;
    ownership: GatewayApiKeyOwnership;
  }>;
}

export interface GatewayConfiguredRuntimeKeyResolutionPort {
  resolveRuntimeKey(gatewayApiKey: GatewayApiKeyRecord): Promise<{
    runtimeGatewayApiKey: GatewayApiKeyRecord;
    registryOverride:
      | (GatewayApiKeyMetadataOverride & { updatedAt: string })
      | null;
  }>;
}

export interface GatewayKeyStatusSnapshotPort
  extends
    GatewayKeyOverlayStateReadPort,
    Partial<GatewayConfiguredRuntimeKeyResolutionPort> {}

export interface GatewayKeyStatusInventoryPort
  extends
    GatewayKeyOverlayStateReadPort,
    GatewayConfiguredRuntimeKeyResolutionPort {
  listRegistryKeys(): Promise<GatewayKeyRegistryDynamicKeyView[]>;
}

export async function getGatewayKeyRevocationStatus(
  gatewayApiKey: GatewayApiKeyRecord,
  port: GatewayKeyOverlayStateReadPort
): Promise<{ keyId: string; revoked: boolean; updatedAt: string }> {
  const state = await port.readOverlayState(gatewayApiKey);

  return {
    keyId: gatewayApiKey.id,
    revoked: state.revoked,
    updatedAt: state.updatedAt
  };
}

export async function getGatewayKeyRevocationStatusById(
  keyId: string,
  port: GatewayKeyStatusByIdReadPort
): Promise<{ keyId: string; revoked: boolean; updatedAt: string }> {
  const { gatewayApiKey } = await port.resolveKeyById(keyId);
  return getGatewayKeyRevocationStatus(gatewayApiKey, port);
}

export async function getGatewayApiKeyStatus(
  gatewayApiKey: GatewayApiKeyRecord,
  port: GatewayKeyOverlayStateReadPort
): Promise<GatewayApiKeyStatusView> {
  return deriveGatewayApiKeyStatusView(
    gatewayApiKey,
    await port.readOverlayState(gatewayApiKey)
  );
}

export async function getGatewayApiKeyStatusSnapshot(
  gatewayApiKey: GatewayApiKeyRecord,
  ownership: GatewayApiKeyOwnership,
  port: GatewayKeyStatusSnapshotPort
): Promise<GatewayApiKeyRegistrySnapshot> {
  const configuredStatus = await getGatewayApiKeyStatus(gatewayApiKey, port);

  if (ownership === "registry") {
    return createGatewayApiKeyRegistrySnapshot({
      ownership,
      configuredKey: gatewayApiKey,
      configuredStatus
    });
  }

  if (!port.resolveRuntimeKey) {
    throw new Error("Configured key snapshots require a runtime-key resolver");
  }

  const { runtimeGatewayApiKey, registryOverride } =
    await port.resolveRuntimeKey(gatewayApiKey);
  const runtimeStatus = await getGatewayApiKeyStatus(
    runtimeGatewayApiKey,
    port
  );

  return createGatewayApiKeyRegistrySnapshot({
    ownership,
    configuredKey: gatewayApiKey,
    configuredStatus,
    runtimeKey: runtimeGatewayApiKey,
    runtimeStatus,
    registryOverride
  });
}

export async function listGatewayApiKeyStatuses(
  gatewayApiKeys: readonly GatewayApiKeyRecord[],
  port: GatewayKeyStatusInventoryPort,
  filters?: {
    acceptedNow?: boolean;
    effectiveStatus?: GatewayApiKeyLifecycleStatus;
    includeArchived?: boolean;
  }
): Promise<GatewayApiKeyRegistrySnapshot[]> {
  const configuredEntries = await Promise.all(
    gatewayApiKeys.map(async (gatewayApiKey) => {
      return getGatewayApiKeyStatusSnapshot(gatewayApiKey, "configured", port);
    })
  );
  const registryEntries = await Promise.all(
    (await port.listRegistryKeys()).map(async (entry) => {
      return getGatewayApiKeyStatusSnapshot(entry.key, "registry", port);
    })
  );

  return [...configuredEntries, ...registryEntries].filter((entry) => {
    if (
      entry.ownership === "registry" &&
      entry.runtime.effectiveStatus === "archived" &&
      filters?.includeArchived !== true
    ) {
      return false;
    }

    if (
      filters?.acceptedNow !== undefined &&
      entry.runtime.acceptedNow !== filters.acceptedNow
    ) {
      return false;
    }

    if (
      filters?.effectiveStatus !== undefined &&
      entry.runtime.effectiveStatus !== filters.effectiveStatus
    ) {
      return false;
    }

    return true;
  });
}

export function createGatewayKeyStatusByIdReadPort(
  gatewayApiKeys: readonly GatewayApiKeyRecord[],
  readOverlayState: (
    gatewayApiKey: GatewayApiKeyRecord
  ) => Promise<GatewayKeyRevocationOverlayState>,
  getRegistryKey: (
    keyId: string
  ) => Promise<GatewayKeyRegistryDynamicKeyView | null>,
  requestId: string
): GatewayKeyStatusByIdReadPort {
  return {
    readOverlayState,
    async resolveKeyById(keyId: string) {
      return resolveGatewayApiKeyByIdWithOwnership(
        gatewayApiKeys,
        keyId,
        requestId,
        {
          getRegistryKey
        }
      );
    }
  };
}
