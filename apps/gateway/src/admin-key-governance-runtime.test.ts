import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GatewayBindings } from "./env.js";

const runtimeMocks = vi.hoisted(() => ({
  resolveGatewayConfig: vi.fn(),
  listGatewayApiKeyStatuses: vi.fn(),
  createGatewayRegistryApiKey: vi.fn(),
  bulkCreateGatewayRegistryApiKeys: vi.fn(),
  bulkUpdateGatewayRegistryApiKeys: vi.fn(),
  bulkDeleteGatewayRegistryApiKeys: vi.fn(),
  bulkRotateGatewayRegistryApiKeys: vi.fn(),
  bulkArchiveGatewayRegistryApiKeys: vi.fn(),
  bulkRestoreGatewayRegistryApiKeys: vi.fn(),
  bulkFinalizeGatewayRegistryApiKeyRotations: vi.fn(),
  bulkCancelGatewayRegistryApiKeyRotations: vi.fn(),
  getGatewayRegistryApiKey: vi.fn(),
  getGatewayRegistryApiKeyEvents: vi.fn(),
  getGatewayRegistryOperationEvents: vi.fn(),
  updateGatewayRegistryApiKey: vi.fn(),
  deleteGatewayRegistryApiKey: vi.fn(),
  rotateGatewayRegistryApiKey: vi.fn(),
  archiveGatewayRegistryApiKey: vi.fn(),
  restoreGatewayRegistryApiKey: vi.fn(),
  finalizeGatewayRegistryApiKeyRotation: vi.fn(),
  cancelGatewayRegistryApiKeyRotation: vi.fn(),
  upsertGatewayKeyRegistryOverride: vi.fn(),
  clearGatewayKeyRegistryOverride: vi.fn(),
  getGatewayKeyRevocationStatusById: vi.fn(),
  getGatewayApiKeyStatusSnapshot: vi.fn(),
  getGatewayKeyRevocationEvents: vi.fn(),
  resolveGatewayApiKeyByIdWithRegistry: vi.fn(),
  resolveGatewayApiKeyById: vi.fn(),
  revokeGatewayKeyById: vi.fn(),
  clearGatewayKeyRevocationById: vi.fn()
}));

vi.mock("./config.js", () => ({
  resolveGatewayConfig: runtimeMocks.resolveGatewayConfig
}));

vi.mock("./gateway-key-registry.js", () => ({
  createGatewayRegistryApiKey: runtimeMocks.createGatewayRegistryApiKey,
  bulkCreateGatewayRegistryApiKeys:
    runtimeMocks.bulkCreateGatewayRegistryApiKeys,
  bulkUpdateGatewayRegistryApiKeys:
    runtimeMocks.bulkUpdateGatewayRegistryApiKeys,
  bulkDeleteGatewayRegistryApiKeys:
    runtimeMocks.bulkDeleteGatewayRegistryApiKeys,
  bulkRotateGatewayRegistryApiKeys:
    runtimeMocks.bulkRotateGatewayRegistryApiKeys,
  bulkArchiveGatewayRegistryApiKeys:
    runtimeMocks.bulkArchiveGatewayRegistryApiKeys,
  bulkRestoreGatewayRegistryApiKeys:
    runtimeMocks.bulkRestoreGatewayRegistryApiKeys,
  bulkFinalizeGatewayRegistryApiKeyRotations:
    runtimeMocks.bulkFinalizeGatewayRegistryApiKeyRotations,
  bulkCancelGatewayRegistryApiKeyRotations:
    runtimeMocks.bulkCancelGatewayRegistryApiKeyRotations,
  getGatewayRegistryApiKey: runtimeMocks.getGatewayRegistryApiKey,
  getGatewayRegistryApiKeyEvents: runtimeMocks.getGatewayRegistryApiKeyEvents,
  getGatewayRegistryOperationEvents:
    runtimeMocks.getGatewayRegistryOperationEvents,
  updateGatewayRegistryApiKey: runtimeMocks.updateGatewayRegistryApiKey,
  deleteGatewayRegistryApiKey: runtimeMocks.deleteGatewayRegistryApiKey,
  rotateGatewayRegistryApiKey: runtimeMocks.rotateGatewayRegistryApiKey,
  archiveGatewayRegistryApiKey: runtimeMocks.archiveGatewayRegistryApiKey,
  restoreGatewayRegistryApiKey: runtimeMocks.restoreGatewayRegistryApiKey,
  finalizeGatewayRegistryApiKeyRotation:
    runtimeMocks.finalizeGatewayRegistryApiKeyRotation,
  cancelGatewayRegistryApiKeyRotation:
    runtimeMocks.cancelGatewayRegistryApiKeyRotation,
  upsertGatewayKeyRegistryOverride:
    runtimeMocks.upsertGatewayKeyRegistryOverride,
  clearGatewayKeyRegistryOverride: runtimeMocks.clearGatewayKeyRegistryOverride
}));

vi.mock("./gateway-key-revocation.js", () => ({
  listGatewayApiKeyStatuses: runtimeMocks.listGatewayApiKeyStatuses,
  getGatewayKeyRevocationStatusById:
    runtimeMocks.getGatewayKeyRevocationStatusById,
  getGatewayApiKeyStatusSnapshot: runtimeMocks.getGatewayApiKeyStatusSnapshot,
  getGatewayKeyRevocationEvents: runtimeMocks.getGatewayKeyRevocationEvents,
  resolveGatewayApiKeyByIdWithRegistry:
    runtimeMocks.resolveGatewayApiKeyByIdWithRegistry,
  resolveGatewayApiKeyById: runtimeMocks.resolveGatewayApiKeyById,
  revokeGatewayKeyById: runtimeMocks.revokeGatewayKeyById,
  clearGatewayKeyRevocationById: runtimeMocks.clearGatewayKeyRevocationById
}));

import {
  createAdminKeyGovernanceRuntime
} from "./admin-key-governance-runtime.js";

const gatewaySecretHash =
  "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6";

function createEnv(): GatewayBindings {
  return {
    AIRLOCK_MODE: "free",
    AIRLOCK_TELEMETRY_SUCCESS_SAMPLE_RATE_FREE: 0.1,
    AIRLOCK_TELEMETRY_SUCCESS_SAMPLE_RATE_SCALE: 1,
    AIRLOCK_GATEWAY_API_KEYS: "gateway-secret",
    AIRLOCK_PROVIDER_TIMEOUT_MS: 1000,
    AIRLOCK_PROVIDER_MAX_RETRIES: 0,
    AIRLOCK_PROVIDER_RETRY_BACKOFF_MS: 0,
    AIRLOCK_PROVIDER_CIRCUIT_BREAKER_THRESHOLD: 3,
    AIRLOCK_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS: 30000,
    AIRLOCK_PROVIDER_CIRCUIT_BREAKER_PERSISTENT: false,
    AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: false,
    AIRLOCK_INTERNAL_ADMIN_ACTOR_REQUIRED: false,
    OPENAI_API_KEY: "openai-secret",
    OPENAI_BASE_URL: "https://api.openai.com/v1",
    OPENAI_DEFAULT_MODEL: "gpt-4.1-mini"
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  runtimeMocks.resolveGatewayConfig.mockReturnValue({
    gatewayApiKeys: [
      {
        id: "key_configured",
        label: "Configured Key",
        valueHash: gatewaySecretHash,
        status: "active"
      }
    ]
  });
});

describe("createAdminKeyGovernanceRuntime", () => {
  it("exposes a configured-key membership checker and read ports", async () => {
    const env = createEnv();
    runtimeMocks.listGatewayApiKeyStatuses.mockResolvedValue([
      { keyId: "key_configured" }
    ]);
    runtimeMocks.getGatewayKeyRevocationStatusById.mockResolvedValue({
      keyId: "key_configured",
      revoked: false,
      updatedAt: "2026-05-14T00:00:00.000Z"
    });

    const runtime = createAdminKeyGovernanceRuntime(
      env,
      "req_123"
    );

    expect(runtime.gatewayApiKeys).toHaveLength(1);
    expect(runtime.isConfiguredKey("key_configured")).toBe(true);
    expect(runtime.isConfiguredKey("key_registry")).toBe(false);

    await runtime.read.listKeySnapshots({ acceptedNow: true });
    expect(runtimeMocks.listGatewayApiKeyStatuses).toHaveBeenCalledWith(
      env,
      runtime.gatewayApiKeys,
      "req_123",
      { acceptedNow: true }
    );

    await runtime.read.getKeyRevocationStatus("key_configured");
    expect(runtimeMocks.getGatewayKeyRevocationStatusById).toHaveBeenCalledWith(
      env,
      runtime.gatewayApiKeys,
      "key_configured",
      "req_123"
    );
  });

  it("forwards registry mutation ports with requestId and actor context", async () => {
    const env = createEnv();
    const actorContext = {
      actor: "ops@example.com",
      actorSource: "credential" as const
    };

    const runtime = createAdminKeyGovernanceRuntime(
      env,
      "req_123",
      actorContext
    );

    await runtime.write.bulkRotateRegistryKeys({
      rotations: [
        {
          keyId: "key_registry",
          valueHash: gatewaySecretHash
        }
      ]
    });

    expect(runtimeMocks.bulkRotateGatewayRegistryApiKeys).toHaveBeenCalledWith(
      env,
      runtime.gatewayApiKeys,
      {
        rotations: [
          {
            keyId: "key_registry",
            valueHash: gatewaySecretHash
          }
        ]
      },
      "req_123",
      actorContext
    );

    await runtime.write.rotateRegistryKey("key_registry", {
      valueHash: gatewaySecretHash
    });

    expect(runtimeMocks.rotateGatewayRegistryApiKey).toHaveBeenCalledWith(
      env,
      runtime.gatewayApiKeys,
      "key_registry",
      {
        valueHash: gatewaySecretHash
      },
      "req_123",
      actorContext
    );
  });

  it("forwards ownership-resolution and override ports through existing runtime modules", async () => {
    const env = createEnv();
    runtimeMocks.resolveGatewayApiKeyByIdWithRegistry.mockResolvedValue({
      gatewayApiKey: {
        id: "key_registry",
        label: "Registry Key",
        valueHash: gatewaySecretHash,
        status: "active"
      },
      ownership: "registry"
    });
    runtimeMocks.resolveGatewayApiKeyById.mockReturnValue({
      id: "key_configured",
      label: "Configured Key",
      valueHash: gatewaySecretHash,
      status: "active"
    });
    runtimeMocks.getGatewayApiKeyStatusSnapshot.mockResolvedValue({
      keyId: "key_registry"
    });
    runtimeMocks.upsertGatewayKeyRegistryOverride.mockResolvedValue({
      label: "Updated",
      updatedAt: "2026-05-14T00:00:00.000Z"
    });
    runtimeMocks.revokeGatewayKeyById.mockResolvedValue({
      keyId: "key_registry",
      revoked: true,
      updatedAt: "2026-05-14T00:00:00.000Z"
    });

    const runtime = createAdminKeyGovernanceRuntime(
      env,
      "req_123"
    );

    await runtime.read.getKeyStatusSnapshot("key_registry");
    expect(runtimeMocks.resolveGatewayApiKeyByIdWithRegistry).toHaveBeenCalledWith(
      env,
      runtime.gatewayApiKeys,
      "key_registry",
      "req_123"
    );
    expect(runtimeMocks.getGatewayApiKeyStatusSnapshot).toHaveBeenCalled();

    await runtime.read.getConfiguredKeyStatusSnapshot("key_configured");
    expect(runtimeMocks.resolveGatewayApiKeyById).toHaveBeenCalledWith(
      runtime.gatewayApiKeys,
      "key_configured",
      "req_123"
    );

    await runtime.write.updateRegistryOverride("key_configured", {
      label: "Updated"
    });
    expect(runtimeMocks.upsertGatewayKeyRegistryOverride).toHaveBeenCalled();

    await runtime.write.revokeKey("key_registry", {
      reason: "incident"
    });
    expect(runtimeMocks.revokeGatewayKeyById).toHaveBeenCalledWith(
      env,
      runtime.gatewayApiKeys,
      "key_registry",
      {
        reason: "incident"
      },
      "req_123",
      undefined
    );
  });

  it("returns an empty operation event list when registry support is disabled", async () => {
    const env = createEnv();
    const runtime = createAdminKeyGovernanceRuntime(
      env,
      "req_123"
    );

    runtimeMocks.getGatewayRegistryOperationEvents.mockResolvedValue([]);

    await expect(
      runtime.read.getOperationEvents("req_bulk_missing")
    ).resolves.toEqual([]);
  });
});
