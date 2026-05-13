import { describe, expect, it, vi } from "vitest";

import { type GatewayApiKeyRecord } from "./gateway-auth.js";
import {
  getGatewayApiKeyStatus,
  getGatewayApiKeyStatusSnapshot,
  getGatewayKeyRevocationStatus,
  getGatewayKeyRevocationStatusById,
  listGatewayApiKeyStatuses
} from "./gateway-key-status.js";

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

describe("getGatewayKeyRevocationStatus", () => {
  it("assembles a stable revocation-status response", async () => {
    await expect(
      getGatewayKeyRevocationStatus(
        createConfiguredKey(),
        {
          readOverlayState: vi.fn().mockResolvedValue({
            revoked: true,
            updatedAt: "2026-05-14T00:00:00.000Z"
          })
        }
      )
    ).resolves.toEqual({
      keyId: "key_configured",
      revoked: true,
      updatedAt: "2026-05-14T00:00:00.000Z"
    });
  });
});

describe("getGatewayKeyRevocationStatusById", () => {
  it("resolves key ownership before reading overlay state", async () => {
    const resolveKeyById = vi.fn().mockResolvedValue({
      gatewayApiKey: createConfiguredKey({
        id: "key_registry",
        label: "Registry Key"
      }),
      ownership: "registry" as const
    });
    const readOverlayState = vi.fn().mockResolvedValue({
      revoked: false,
      updatedAt: "2026-05-14T01:00:00.000Z"
    });

    await expect(
      getGatewayKeyRevocationStatusById("key_registry", {
        resolveKeyById,
        readOverlayState
      })
    ).resolves.toEqual({
      keyId: "key_registry",
      revoked: false,
      updatedAt: "2026-05-14T01:00:00.000Z"
    });

    expect(resolveKeyById).toHaveBeenCalledWith("key_registry");
    expect(readOverlayState).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "key_registry"
      })
    );
  });
});

describe("getGatewayApiKeyStatus", () => {
  it("derives a status view from overlay state", async () => {
    await expect(
      getGatewayApiKeyStatus(
        createConfiguredKey({
          status: "revoked"
        }),
        {
          readOverlayState: vi.fn().mockResolvedValue({
            revoked: false,
            updatedAt: "2026-05-14T00:00:00.000Z"
          })
        }
      )
    ).resolves.toMatchObject({
      keyId: "key_configured",
      effectiveStatus: "revoked",
      acceptedNow: false,
      overlayRevoked: false
    });
  });
});

describe("getGatewayApiKeyStatusSnapshot", () => {
  it("assembles configured snapshots with runtime override resolution", async () => {
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
      getGatewayApiKeyStatusSnapshot(
        createConfiguredKey(),
        "configured",
        {
          readOverlayState,
          resolveRuntimeKey
        }
      )
    ).resolves.toMatchObject({
      keyId: "key_configured",
      ownership: "configured",
      label: "Runtime Key",
      runtime: {
        label: "Runtime Key",
        overlayRevoked: true
      },
      registryOverrideApplied: true
    });

    expect(resolveRuntimeKey).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "key_configured"
      })
    );
  });

  it("assembles registry snapshots without resolving a runtime override", async () => {
    const resolveRuntimeKey = vi.fn();

    await expect(
      getGatewayApiKeyStatusSnapshot(
        createConfiguredKey({
          id: "key_registry",
          label: "Registry Key"
        }),
        "registry",
        {
          readOverlayState: vi.fn().mockResolvedValue({
            revoked: false,
            updatedAt: "2026-05-14T00:00:00.000Z"
          }),
          resolveRuntimeKey
        }
      )
    ).resolves.toMatchObject({
      keyId: "key_registry",
      ownership: "registry",
      registryOverrideApplied: false
    });

    expect(resolveRuntimeKey).not.toHaveBeenCalled();
  });
});

describe("listGatewayApiKeyStatuses", () => {
  it("merges configured and registry entries and filters archived registry keys by default", async () => {
    const resolveRuntimeKey = vi.fn().mockImplementation(
      (gatewayApiKey: GatewayApiKeyRecord) => {
        return {
          runtimeGatewayApiKey: gatewayApiKey,
          registryOverride: null
        };
      }
    );

    const entries = await listGatewayApiKeyStatuses(
      [
        createConfiguredKey(),
        createConfiguredKey({
          id: "key_configured_revoked",
          label: "Configured Revoked",
          status: "revoked"
        })
      ],
      {
        listRegistryKeys: vi.fn().mockResolvedValue([
          {
            key: createConfiguredKey({
              id: "key_registry_archived",
              label: "Registry Archived",
              archivedAt: "2026-05-14T00:00:00.000Z"
            })
          },
          {
            key: createConfiguredKey({
              id: "key_registry_active",
              label: "Registry Active"
            })
          }
        ]),
        readOverlayState: vi.fn().mockResolvedValue({
          revoked: false,
          updatedAt: "2026-05-14T00:00:00.000Z"
        }),
        resolveRuntimeKey
      }
    );

    expect(entries.map((entry) => entry.keyId)).toEqual([
      "key_configured",
      "key_configured_revoked",
      "key_registry_active"
    ]);
  });

  it("filters by acceptedNow and effectiveStatus against runtime status", async () => {
    const entries = await listGatewayApiKeyStatuses(
      [createConfiguredKey()],
      {
        listRegistryKeys: vi.fn().mockResolvedValue([]),
        readOverlayState: vi.fn().mockResolvedValue({
          revoked: true,
          updatedAt: "2026-05-14T00:00:00.000Z"
        }),
        resolveRuntimeKey: vi.fn().mockResolvedValue({
          runtimeGatewayApiKey: createConfiguredKey(),
          registryOverride: null
        })
      },
      {
        acceptedNow: false,
        effectiveStatus: "revoked"
      }
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      keyId: "key_configured",
      runtime: {
        acceptedNow: false,
        effectiveStatus: "revoked"
      }
    });
  });
});
