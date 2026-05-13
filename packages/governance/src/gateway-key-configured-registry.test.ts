import { describe, expect, it, vi } from "vitest";

import {
  clearConfiguredGatewayKeyRegistryOverride,
  getConfiguredGatewayApiKeyStatusSnapshot,
  resolveConfiguredGatewayApiKeyRuntime,
  updateConfiguredGatewayKeyRegistryOverride
} from "./gateway-key-configured-registry.js";
import type { GatewayApiKeyRecord } from "./gateway-auth.js";

const gatewaySecretHash =
  "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6";

function createConfiguredKey(
  overrides: Partial<GatewayApiKeyRecord> = {}
): GatewayApiKeyRecord {
  return {
    id: "key_configured",
    label: "Configured Key",
    valueHash: gatewaySecretHash,
    status: "active",
    ...overrides
  };
}

describe("resolveConfiguredGatewayApiKeyRuntime", () => {
  it("applies an optional registry override onto a configured key", async () => {
    const readRegistryOverride = vi.fn().mockResolvedValue({
      label: "Runtime Key",
      status: "revoked",
      updatedAt: "2026-05-14T00:00:00.000Z"
    });

    await expect(
      resolveConfiguredGatewayApiKeyRuntime(createConfiguredKey(), {
        readRegistryOverride
      })
    ).resolves.toEqual({
      runtimeGatewayApiKey: {
        id: "key_configured",
        label: "Runtime Key",
        valueHash: gatewaySecretHash,
        status: "revoked"
      },
      registryOverride: {
        label: "Runtime Key",
        status: "revoked",
        updatedAt: "2026-05-14T00:00:00.000Z"
      }
    });

    expect(readRegistryOverride).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "key_configured"
      })
    );
  });

  it("returns the configured key unchanged when no override exists", async () => {
    await expect(
      resolveConfiguredGatewayApiKeyRuntime(createConfiguredKey(), {
        readRegistryOverride: vi.fn().mockResolvedValue(null)
      })
    ).resolves.toEqual({
      runtimeGatewayApiKey: createConfiguredKey(),
      registryOverride: null
    });
  });
});

describe("updateConfiguredGatewayKeyRegistryOverride", () => {
  it("requires a configured key and persists the parsed override", async () => {
    const writeRegistryOverride = vi.fn().mockResolvedValue({
      label: "Runtime Key",
      status: "revoked",
      updatedAt: "2026-05-14T01:00:00.000Z"
    });

    await expect(
      updateConfiguredGatewayKeyRegistryOverride(
        [createConfiguredKey()],
        "key_configured",
        {
          label: "Runtime Key",
          status: "revoked"
        },
        "req_123",
        {
          writeRegistryOverride
        }
      )
    ).resolves.toEqual({
      keyId: "key_configured",
      override: {
        label: "Runtime Key",
        status: "revoked",
        updatedAt: "2026-05-14T01:00:00.000Z"
      }
    });

    expect(writeRegistryOverride).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "key_configured"
      }),
      {
        label: "Runtime Key",
        status: "revoked"
      }
    );
  });

  it("rejects registry-unknown configured-key override updates", async () => {
    await expect(
      updateConfiguredGatewayKeyRegistryOverride(
        [createConfiguredKey()],
        "key_missing",
        {
          label: "Runtime Key"
        },
        "req_404",
        {
          writeRegistryOverride: vi.fn()
        }
      )
    ).rejects.toMatchObject({
      code: "gateway_key_not_found"
    });
  });
});

describe("clearConfiguredGatewayKeyRegistryOverride", () => {
  it("requires a configured key and clears the stored override", async () => {
    const clearRegistryOverride = vi.fn().mockResolvedValue(undefined);

    await expect(
      clearConfiguredGatewayKeyRegistryOverride(
        [createConfiguredKey()],
        "key_configured",
        "req_123",
        {
          clearRegistryOverride
        }
      )
    ).resolves.toEqual({
      keyId: "key_configured",
      override: null
    });

    expect(clearRegistryOverride).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "key_configured"
      })
    );
  });
});

describe("getConfiguredGatewayApiKeyStatusSnapshot", () => {
  it("derives configured-key snapshots through the governance runtime contract", async () => {
    const readOverlayState = vi
      .fn()
      .mockResolvedValueOnce({
        revoked: false,
        updatedAt: "2026-05-14T00:00:00.000Z"
      })
      .mockResolvedValueOnce({
        revoked: true,
        updatedAt: "2026-05-14T01:00:00.000Z"
      });
    const resolveRuntimeKey = vi.fn().mockResolvedValue({
      runtimeGatewayApiKey: createConfiguredKey({
        label: "Runtime Key",
        status: "active",
        expiresAt: "2026-06-01T00:00:00.000Z"
      }),
      registryOverride: {
        label: "Runtime Key",
        updatedAt: "2026-05-14T01:00:00.000Z"
      }
    });

    await expect(
      getConfiguredGatewayApiKeyStatusSnapshot("key_configured", "req_123", {
        gatewayApiKeys: [createConfiguredKey()],
        readOverlayState,
        resolveRuntimeKey
      })
    ).resolves.toMatchObject({
      keyId: "key_configured",
      ownership: "configured",
      runtime: {
        label: "Runtime Key",
        overlayRevoked: true
      },
      registryOverrideApplied: true
    });
  });
});
