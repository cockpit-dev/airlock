import { describe, expect, it, vi } from "vitest";

import {
  archiveGatewayAdminKey,
  bulkArchiveGatewayAdminKeys,
  bulkCreateGatewayAdminKeys,
  bulkDeleteGatewayAdminKeys,
  bulkRotateGatewayAdminKeys,
  bulkRestoreGatewayAdminKeys,
  restoreGatewayAdminKey,
  clearGatewayAdminKeyRegistryOverride,
  clearGatewayAdminKeyRevocation,
  createGatewayAdminKey,
  deleteGatewayAdminKey,
  finalizeGatewayAdminKeyRotation,
  revokeGatewayAdminKey,
  rotateGatewayAdminKey,
  bulkUpdateGatewayAdminKeys,
  updateGatewayAdminKey
} from "./admin-key-governance-mutations.js";

const gatewaySecretHash =
  "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6";

describe("createGatewayAdminKey", () => {
  it("delegates creation and returns the created registry-owned key view", async () => {
    const createRegistryKey = vi.fn().mockResolvedValue({
      keyId: "key_dynamic",
      ownership: "registry",
      key: {
        id: "key_dynamic",
        label: "Dynamic Runtime Key",
        valueHash: gatewaySecretHash,
        status: "active"
      },
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z"
    });

    await expect(
      createGatewayAdminKey(
        { id: "key_dynamic" },
        {
          createRegistryKey
        }
      )
    ).resolves.toMatchObject({
      keyId: "key_dynamic",
      ownership: "registry"
    });
  });
});

describe("deleteGatewayAdminKey", () => {
  it("rejects deletion of configured keys", async () => {
    await expect(
      deleteGatewayAdminKey(
        "key_env",
        {},
        "req_123",
        {
          isConfiguredKey: vi.fn().mockReturnValue(true),
          deleteRegistryKey: vi.fn()
        }
      )
    ).rejects.toMatchObject({
      code: "gateway_key_not_registry_owned"
    });
  });

  it("returns an acknowledged delete response for registry-owned keys", async () => {
    const deleteRegistryKey = vi.fn().mockResolvedValue(undefined);

    await expect(
      deleteGatewayAdminKey(
        "key_dynamic",
        { reason: "cleanup" },
        "req_123",
        {
          isConfiguredKey: vi.fn().mockReturnValue(false),
          deleteRegistryKey
        }
      )
    ).resolves.toEqual({
      keyId: "key_dynamic",
      deleted: true
    });

    expect(deleteRegistryKey).toHaveBeenCalledWith("key_dynamic", {
      reason: "cleanup"
    });
  });
});

describe("rotateGatewayAdminKey", () => {
  it("passes the payload through to registry-owned key rotation", async () => {
    const rotateRegistryKey = vi.fn().mockResolvedValue({
      keyId: "key_dynamic",
      ownership: "registry",
      key: {
        id: "key_dynamic",
        label: "Dynamic Runtime Key",
        valueHash: gatewaySecretHash,
        status: "active"
      },
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T01:00:00.000Z"
    });

    await rotateGatewayAdminKey(
      "key_dynamic",
      { reason: "scheduled rollover", valueHash: gatewaySecretHash },
      "req_123",
      {
        isConfiguredKey: vi.fn().mockReturnValue(false),
        rotateRegistryKey
      }
    );

    expect(rotateRegistryKey).toHaveBeenCalledWith("key_dynamic", {
      reason: "scheduled rollover",
      valueHash: gatewaySecretHash
    });
  });

  it("rejects rotation of configured keys", async () => {
    await expect(
      rotateGatewayAdminKey(
        "key_env",
        { valueHash: gatewaySecretHash },
        "req_123",
        {
          isConfiguredKey: vi.fn().mockReturnValue(true),
          rotateRegistryKey: vi.fn()
        }
      )
    ).rejects.toMatchObject({
      code: "gateway_key_not_registry_owned"
    });
  });
});

describe("archiveGatewayAdminKey", () => {
  it("passes archive payloads through for registry-owned keys", async () => {
    const archiveRegistryKey = vi.fn().mockResolvedValue({
      keyId: "key_dynamic",
      ownership: "registry",
      key: {
        id: "key_dynamic",
        label: "Archived Runtime Key",
        valueHash: gatewaySecretHash,
        status: "active"
      },
      archivedAt: "2026-05-14T00:00:00.000Z",
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z"
    });

    await expect(
      archiveGatewayAdminKey(
        "key_dynamic",
        { reason: "tenant paused" },
        "req_123",
        {
          isConfiguredKey: vi.fn().mockReturnValue(false),
          archiveRegistryKey
        }
      )
    ).resolves.toMatchObject({
      keyId: "key_dynamic",
      archivedAt: "2026-05-14T00:00:00.000Z"
    });
  });
});

describe("restoreGatewayAdminKey", () => {
  it("passes restore payloads through for registry-owned keys", async () => {
    const restoreRegistryKey = vi.fn().mockResolvedValue({
      keyId: "key_dynamic",
      ownership: "registry",
      key: {
        id: "key_dynamic",
        label: "Runtime Key",
        valueHash: gatewaySecretHash,
        status: "active"
      },
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-14T01:00:00.000Z"
    });

    await expect(
      restoreGatewayAdminKey(
        "key_dynamic",
        { reason: "tenant resumed" },
        "req_123",
        {
          isConfiguredKey: vi.fn().mockReturnValue(false),
          restoreRegistryKey
        }
      )
    ).resolves.toMatchObject({
      keyId: "key_dynamic",
      ownership: "registry"
    });
  });
});

describe("updateGatewayAdminKey", () => {
  it("passes update payloads through for registry-owned keys", async () => {
    const updateRegistryKey = vi.fn().mockResolvedValue({
      keyId: "key_dynamic",
      ownership: "registry",
      key: {
        id: "key_dynamic",
        label: "Renamed Runtime Key",
        valueHash: gatewaySecretHash,
        status: "revoked"
      },
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T01:00:00.000Z"
    });

    await updateGatewayAdminKey(
      "key_dynamic",
      {
        label: "Renamed Runtime Key",
        status: "revoked",
        reason: "temporary hold"
      },
      "req_123",
      {
        isConfiguredKey: vi.fn().mockReturnValue(false),
        updateRegistryKey
      }
    );

    expect(updateRegistryKey).toHaveBeenCalledWith("key_dynamic", {
      label: "Renamed Runtime Key",
      status: "revoked",
      reason: "temporary hold"
    });
  });

  it("rejects updates for configured keys", async () => {
    await expect(
      updateGatewayAdminKey(
        "key_env",
        { label: "Nope" },
        "req_123",
        {
          isConfiguredKey: vi.fn().mockReturnValue(true),
          updateRegistryKey: vi.fn()
        }
      )
    ).rejects.toMatchObject({
      code: "gateway_key_not_registry_owned"
    });
  });
});

describe("bulkUpdateGatewayAdminKeys", () => {
  it("passes bulk update payloads through for registry-owned keys", async () => {
    const bulkUpdateRegistryKeys = vi.fn().mockResolvedValue([
      {
        keyId: "key_dynamic_a",
        ownership: "registry",
        key: {
          id: "key_dynamic_a",
          label: "Key A",
          valueHash: gatewaySecretHash,
          status: "revoked"
        },
        createdAt: "2026-05-14T00:00:00.000Z",
        updatedAt: "2026-05-14T01:00:00.000Z"
      }
    ]);

    await bulkUpdateGatewayAdminKeys(
      {
        updates: [{ keyId: "key_dynamic_a", status: "revoked" }],
        reason: "maintenance"
      },
      "req_123",
      {
        isConfiguredKey: vi.fn().mockReturnValue(false),
        bulkUpdateRegistryKeys
      }
    );

    expect(bulkUpdateRegistryKeys).toHaveBeenCalledWith({
      updates: [{ keyId: "key_dynamic_a", status: "revoked" }],
      reason: "maintenance"
    });
  });

  it("rejects batches that include configured keys", async () => {
    await expect(
      bulkUpdateGatewayAdminKeys(
        {
          updates: [
            { keyId: "key_dynamic_a", status: "revoked" },
            { keyId: "key_env", status: "revoked" }
          ]
        },
        "req_123",
        {
          isConfiguredKey: vi.fn((keyId: string) => keyId === "key_env"),
          bulkUpdateRegistryKeys: vi.fn()
        }
      )
    ).rejects.toMatchObject({
      code: "gateway_key_not_registry_owned"
    });
  });
});

describe("bulkCreateGatewayAdminKeys", () => {
  it("passes bulk create payloads through for registry-owned keys", async () => {
    const bulkCreateRegistryKeys = vi.fn().mockResolvedValue([
      {
        keyId: "key_dynamic_a",
        ownership: "registry",
        key: {
          id: "key_dynamic_a",
          label: "Key A",
          valueHash: gatewaySecretHash,
          status: "active"
        },
        createdAt: "2026-05-14T00:00:00.000Z",
        updatedAt: "2026-05-14T00:00:00.000Z"
      }
    ]);

    await expect(
      bulkCreateGatewayAdminKeys(
        {
          keys: [
            {
              id: "key_dynamic_a",
              label: "Key A",
              valueHash: gatewaySecretHash,
              status: "active"
            }
          ]
        },
        {
          bulkCreateRegistryKeys
        }
      )
    ).resolves.toEqual({
      keys: [
        {
          keyId: "key_dynamic_a",
          ownership: "registry",
          key: {
            id: "key_dynamic_a",
            label: "Key A",
            valueHash: gatewaySecretHash,
            status: "active"
          },
          createdAt: "2026-05-14T00:00:00.000Z",
          updatedAt: "2026-05-14T00:00:00.000Z"
        }
      ]
    });

    expect(bulkCreateRegistryKeys).toHaveBeenCalledWith({
      keys: [
        {
          id: "key_dynamic_a",
          label: "Key A",
          valueHash: gatewaySecretHash,
          status: "active"
        }
      ]
    });
  });
});

describe("bulkDeleteGatewayAdminKeys", () => {
  it("passes bulk delete payloads through for registry-owned keys", async () => {
    const bulkDeleteRegistryKeys = vi.fn().mockResolvedValue([
      {
        keyId: "key_dynamic_a",
        deleted: true
      },
      {
        keyId: "key_dynamic_b",
        deleted: true
      }
    ]);

    await expect(
      bulkDeleteGatewayAdminKeys(
        {
          keyIds: ["key_dynamic_a", "key_dynamic_b"],
          reason: "tenant offboarding"
        },
        "req_123",
        {
          isConfiguredKey: vi.fn().mockReturnValue(false),
          bulkDeleteRegistryKeys
        }
      )
    ).resolves.toEqual({
      keys: [
        {
          keyId: "key_dynamic_a",
          deleted: true
        },
        {
          keyId: "key_dynamic_b",
          deleted: true
        }
      ]
    });

    expect(bulkDeleteRegistryKeys).toHaveBeenCalledWith({
      keyIds: ["key_dynamic_a", "key_dynamic_b"],
      reason: "tenant offboarding"
    });
  });

  it("rejects batches that include configured keys", async () => {
    await expect(
      bulkDeleteGatewayAdminKeys(
        {
          keyIds: ["key_dynamic_a", "key_env"]
        },
        "req_123",
        {
          isConfiguredKey: vi.fn((keyId: string) => keyId === "key_env"),
          bulkDeleteRegistryKeys: vi.fn()
        }
      )
    ).rejects.toMatchObject({
      code: "gateway_key_not_registry_owned"
    });
  });
});

describe("bulkRotateGatewayAdminKeys", () => {
  it("passes bulk rotate payloads through for registry-owned keys", async () => {
    const bulkRotateRegistryKeys = vi.fn().mockResolvedValue([
      {
        keyId: "key_dynamic_a",
        ownership: "registry",
        key: {
          id: "key_dynamic_a",
          label: "Key A",
          valueHash: gatewaySecretHash,
          status: "active"
        },
        createdAt: "2026-05-14T00:00:00.000Z",
        updatedAt: "2026-05-14T01:00:00.000Z"
      }
    ]);

    await expect(
      bulkRotateGatewayAdminKeys(
        {
          rotations: [
            {
              keyId: "key_dynamic_a",
              valueHash: gatewaySecretHash,
              overlapSeconds: 60
            }
          ],
          reason: "credential rollover"
        },
        "req_123",
        {
          isConfiguredKey: vi.fn().mockReturnValue(false),
          bulkRotateRegistryKeys
        }
      )
    ).resolves.toEqual({
      keys: [
        {
          keyId: "key_dynamic_a",
          ownership: "registry",
          key: {
            id: "key_dynamic_a",
            label: "Key A",
            valueHash: gatewaySecretHash,
            status: "active"
          },
          createdAt: "2026-05-14T00:00:00.000Z",
          updatedAt: "2026-05-14T01:00:00.000Z"
        }
      ]
    });

    expect(bulkRotateRegistryKeys).toHaveBeenCalledWith({
      rotations: [
        {
          keyId: "key_dynamic_a",
          valueHash: gatewaySecretHash,
          overlapSeconds: 60
        }
      ],
      reason: "credential rollover"
    });
  });

  it("rejects batches that include configured keys", async () => {
    await expect(
      bulkRotateGatewayAdminKeys(
        {
          rotations: [
            {
              keyId: "key_dynamic_a",
              valueHash: gatewaySecretHash
            },
            {
              keyId: "key_env",
              valueHash: gatewaySecretHash
            }
          ]
        },
        "req_123",
        {
          isConfiguredKey: vi.fn((keyId: string) => keyId === "key_env"),
          bulkRotateRegistryKeys: vi.fn()
        }
      )
    ).rejects.toMatchObject({
      code: "gateway_key_not_registry_owned"
    });
  });
});

describe("bulkArchiveGatewayAdminKeys", () => {
  it("passes bulk archive payloads through for registry-owned keys", async () => {
    const bulkArchiveRegistryKeys = vi.fn().mockResolvedValue([
      {
        keyId: "key_dynamic_a",
        ownership: "registry",
        key: {
          id: "key_dynamic_a",
          label: "Key A",
          valueHash: gatewaySecretHash,
          status: "active"
        },
        archivedAt: "2026-05-14T01:00:00.000Z",
        createdAt: "2026-05-14T00:00:00.000Z",
        updatedAt: "2026-05-14T01:00:00.000Z"
      }
    ]);

    await expect(
      bulkArchiveGatewayAdminKeys(
        {
          keyIds: ["key_dynamic_a"],
          reason: "tenant paused"
        },
        "req_123",
        {
          isConfiguredKey: vi.fn().mockReturnValue(false),
          bulkArchiveRegistryKeys
        }
      )
    ).resolves.toEqual({
      keys: [
        {
          keyId: "key_dynamic_a",
          ownership: "registry",
          key: {
            id: "key_dynamic_a",
            label: "Key A",
            valueHash: gatewaySecretHash,
            status: "active"
          },
          archivedAt: "2026-05-14T01:00:00.000Z",
          createdAt: "2026-05-14T00:00:00.000Z",
          updatedAt: "2026-05-14T01:00:00.000Z"
        }
      ]
    });

    expect(bulkArchiveRegistryKeys).toHaveBeenCalledWith({
      keyIds: ["key_dynamic_a"],
      reason: "tenant paused"
    });
  });

  it("rejects batches that include configured keys", async () => {
    await expect(
      bulkArchiveGatewayAdminKeys(
        {
          keyIds: ["key_dynamic_a", "key_env"]
        },
        "req_123",
        {
          isConfiguredKey: vi.fn((keyId: string) => keyId === "key_env"),
          bulkArchiveRegistryKeys: vi.fn()
        }
      )
    ).rejects.toMatchObject({
      code: "gateway_key_not_registry_owned"
    });
  });
});

describe("bulkRestoreGatewayAdminKeys", () => {
  it("passes bulk restore payloads through for registry-owned keys", async () => {
    const bulkRestoreRegistryKeys = vi.fn().mockResolvedValue([
      {
        keyId: "key_dynamic_a",
        ownership: "registry",
        key: {
          id: "key_dynamic_a",
          label: "Key A",
          valueHash: gatewaySecretHash,
          status: "active"
        },
        createdAt: "2026-05-14T00:00:00.000Z",
        updatedAt: "2026-05-14T02:00:00.000Z"
      }
    ]);

    await expect(
      bulkRestoreGatewayAdminKeys(
        {
          keyIds: ["key_dynamic_a"],
          reason: "tenant resumed"
        },
        "req_123",
        {
          isConfiguredKey: vi.fn().mockReturnValue(false),
          bulkRestoreRegistryKeys
        }
      )
    ).resolves.toEqual({
      keys: [
        {
          keyId: "key_dynamic_a",
          ownership: "registry",
          key: {
            id: "key_dynamic_a",
            label: "Key A",
            valueHash: gatewaySecretHash,
            status: "active"
          },
          createdAt: "2026-05-14T00:00:00.000Z",
          updatedAt: "2026-05-14T02:00:00.000Z"
        }
      ]
    });

    expect(bulkRestoreRegistryKeys).toHaveBeenCalledWith({
      keyIds: ["key_dynamic_a"],
      reason: "tenant resumed"
    });
  });

  it("rejects batches that include configured keys", async () => {
    await expect(
      bulkRestoreGatewayAdminKeys(
        {
          keyIds: ["key_dynamic_a", "key_env"]
        },
        "req_123",
        {
          isConfiguredKey: vi.fn((keyId: string) => keyId === "key_env"),
          bulkRestoreRegistryKeys: vi.fn()
        }
      )
    ).rejects.toMatchObject({
      code: "gateway_key_not_registry_owned"
    });
  });
});

describe("finalizeGatewayAdminKeyRotation", () => {
  it("rejects finalization of configured keys", async () => {
    await expect(
      finalizeGatewayAdminKeyRotation(
        "key_env",
        {},
        "req_123",
        {
          isConfiguredKey: vi.fn().mockReturnValue(true),
          finalizeRegistryKeyRotation: vi.fn()
        }
      )
    ).rejects.toMatchObject({
      code: "gateway_key_not_registry_owned"
    });
  });
});

describe("clearGatewayAdminKeyRegistryOverride", () => {
  it("returns a stable clear response after delegation", async () => {
    const clearRegistryOverride = vi.fn().mockResolvedValue(undefined);

    await expect(
      clearGatewayAdminKeyRegistryOverride(
        "key_env",
        {
          clearRegistryOverride
        }
      )
    ).resolves.toEqual({
      keyId: "key_env",
      override: null
    });
  });
});

describe("revokeGatewayAdminKey", () => {
  it("delegates revocation and returns the mutation result", async () => {
    const revokeKey = vi.fn().mockResolvedValue({
      keyId: "gak_1",
      revoked: true,
      updatedAt: "2026-05-14T00:00:00.000Z"
    });

    await expect(
      revokeGatewayAdminKey(
        "gak_1",
        { reason: "incident containment" },
        {
          revokeKey
        }
      )
    ).resolves.toEqual({
      keyId: "gak_1",
      revoked: true,
      updatedAt: "2026-05-14T00:00:00.000Z"
    });
  });
});

describe("clearGatewayAdminKeyRevocation", () => {
  it("delegates revocation clearing and returns the mutation result", async () => {
    const clearKeyRevocation = vi.fn().mockResolvedValue({
      keyId: "gak_1",
      revoked: false,
      updatedAt: "2026-05-14T00:00:00.000Z"
    });

    await expect(
      clearGatewayAdminKeyRevocation(
        "gak_1",
        { reason: "incident resolved" },
        {
          clearKeyRevocation
        }
      )
    ).resolves.toEqual({
      keyId: "gak_1",
      revoked: false,
      updatedAt: "2026-05-14T00:00:00.000Z"
    });
  });
});
