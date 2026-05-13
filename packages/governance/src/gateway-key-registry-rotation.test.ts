import { describe, expect, it, vi } from "vitest";

import {
  bulkCancelGatewayRegistryKeyRotations,
  bulkFinalizeGatewayRegistryKeyRotations,
  bulkRotateGatewayRegistryKeys,
  cancelGatewayRegistryKeyRotation,
  finalizeGatewayRegistryKeyRotation,
  rotateGatewayRegistryKey
} from "./gateway-key-registry-rotation.js";
import type { GatewayApiKeyRecord } from "./gateway-auth.js";
import type { GatewayKeyRegistryDynamicKeyView } from "./gateway-key-registry.js";

const currentHash =
  "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6";
const nextHash =
  "2e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6";

function createRegistryView(overrides: Record<string, unknown> = {}) {
  return {
    keyId: "key_dynamic",
    ownership: "registry" as const,
    key: {
      id: "key_dynamic",
      label: "Dynamic Key",
      valueHash: currentHash,
      status: "active",
      ...(overrides.key && typeof overrides.key === "object"
        ? overrides.key
        : {})
    },
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:00.000Z",
    ...(overrides.previousValueHash
      ? { previousValueHash: overrides.previousValueHash }
      : {}),
    ...(overrides.previousValueHashExpiresAt
      ? { previousValueHashExpiresAt: overrides.previousValueHashExpiresAt }
      : {}),
    ...(overrides.archivedAt ? { archivedAt: overrides.archivedAt } : {})
  };
}

describe("rotateGatewayRegistryKey", () => {
  it("rejects configured key ids before touching registry state", async () => {
    const getRegistryKey = vi.fn();

    await expect(
      rotateGatewayRegistryKey(
        "key_env",
        {
          valueHash: nextHash
        },
        "req_123",
        {
          isConfiguredKey: vi.fn().mockReturnValue(true),
          getRegistryKey,
          listComparableKeysForRotation: vi.fn(),
          validateRotatedKey: vi.fn(),
          clearRevocationOverlay: vi.fn(),
          rotateRegistryKey: vi.fn()
        }
      )
    ).rejects.toMatchObject({
      code: "gateway_key_not_registry_owned"
    });

    expect(getRegistryKey).not.toHaveBeenCalled();
  });

  it("validates rotation candidates, clears revocation, and delegates the write", async () => {
    const validateRotatedKey = vi.fn();
    const clearRevocationOverlay = vi.fn().mockResolvedValue(undefined);
    const rotateRegistryKeyWrite = vi.fn().mockResolvedValue({
      keyId: "key_dynamic",
      ownership: "registry",
      key: {
        id: "key_dynamic",
        label: "Dynamic Key",
        valueHash: nextHash,
        status: "active"
      },
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T01:00:00.000Z"
    });

    await expect(
      rotateGatewayRegistryKey(
        "key_dynamic",
        {
          valueHash: nextHash,
          overlapSeconds: 120,
          reason: "scheduled rollover"
        },
        "req_123",
        {
          isConfiguredKey: vi.fn().mockReturnValue(false),
          getRegistryKey: vi.fn().mockResolvedValue(createRegistryView()),
          listComparableKeysForRotation: vi.fn().mockResolvedValue([
            {
              id: "key_other",
              label: "Other Key",
              valueHash:
                "3e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
              status: "active"
            }
          ]),
          validateRotatedKey,
          clearRevocationOverlay,
          rotateRegistryKey: rotateRegistryKeyWrite
        }
      )
    ).resolves.toMatchObject({
      keyId: "key_dynamic",
      key: {
        valueHash: nextHash
      }
    });

    expect(validateRotatedKey).toHaveBeenCalledWith(
      expect.objectContaining({
        keyId: "key_dynamic"
      }),
      nextHash,
      [
        {
          id: "key_other",
          label: "Other Key",
          valueHash:
            "3e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
          status: "active"
        }
      ]
    );
    expect(clearRevocationOverlay).toHaveBeenCalledWith(
      expect.objectContaining({
        keyId: "key_dynamic"
      })
    );
    expect(rotateRegistryKeyWrite).toHaveBeenCalledWith("key_dynamic", {
      valueHash: nextHash,
      overlapSeconds: 120,
      reason: "scheduled rollover"
    });
  });

  it("rejects missing registry keys", async () => {
    await expect(
      rotateGatewayRegistryKey(
        "key_dynamic",
        {
          valueHash: nextHash
        },
        "req_123",
        {
          isConfiguredKey: vi.fn().mockReturnValue(false),
          getRegistryKey: vi.fn().mockResolvedValue(null),
          listComparableKeysForRotation: vi.fn(),
          validateRotatedKey: vi.fn(),
          clearRevocationOverlay: vi.fn(),
          rotateRegistryKey: vi.fn()
        }
      )
    ).rejects.toMatchObject({
      code: "gateway_key_not_found"
    });
  });
});

describe("finalizeGatewayRegistryKeyRotation", () => {
  it("rejects non-staged registry keys", async () => {
    await expect(
      finalizeGatewayRegistryKeyRotation(
        "key_dynamic",
        {
          reason: "finalize now"
        },
        "req_123",
        {
          isConfiguredKey: vi.fn().mockReturnValue(false),
          getRegistryKey: vi.fn().mockResolvedValue(createRegistryView()),
          finalizeRegistryKeyRotation: vi.fn()
        }
      )
    ).rejects.toMatchObject({
      code: "gateway_key_rotation_not_staged"
    });
  });
});

describe("cancelGatewayRegistryKeyRotation", () => {
  it("rejects expired staged rotations", async () => {
    await expect(
      cancelGatewayRegistryKeyRotation(
        "key_dynamic",
        {
          reason: "rollback"
        },
        "req_123",
        {
          isConfiguredKey: vi.fn().mockReturnValue(false),
          getRegistryKey: vi.fn().mockResolvedValue(
            createRegistryView({
              previousValueHash: currentHash,
              previousValueHashExpiresAt: "2026-05-14T00:00:00.000Z"
            })
          ),
          cancelRegistryKeyRotation: vi.fn()
        },
        Date.parse("2026-05-14T01:00:00.000Z")
      )
    ).rejects.toMatchObject({
      code: "gateway_key_rotation_not_cancelable"
    });
  });
});

describe("bulkRotateGatewayRegistryKeys", () => {
  it("rejects batches that include configured key ids", async () => {
    await expect(
      bulkRotateGatewayRegistryKeys(
        {
          rotations: [
            {
              keyId: "key_env",
              valueHash: nextHash
            }
          ]
        },
        "req_123",
        {
          isConfiguredKey: vi.fn().mockReturnValue(true),
          getRegistryKeys: vi.fn(),
          listComparableKeysForRotation: vi.fn(),
          validateRotatedKey: vi.fn(),
          clearRevocationOverlay: vi.fn(),
          bulkRotateRegistryKeys: vi.fn()
        }
      )
    ).rejects.toMatchObject({
      code: "gateway_key_not_registry_owned"
    });
  });

  it("validates rotate candidates in request order and clears overlays before delegating", async () => {
    const validateRotatedKey = vi.fn().mockImplementation(
      (
        existingKey: GatewayKeyRegistryDynamicKeyView,
        valueHash: string
      ): GatewayApiKeyRecord => {
        return {
          ...existingKey.key,
          valueHash
        };
      }
    );
    const clearRevocationOverlay = vi.fn().mockResolvedValue(undefined);
    const bulkRotateRegistryKeysWrite = vi.fn().mockResolvedValue({
      operationId: "req_bulk_rotate_123",
      keys: [
        createRegistryView({
          key: {
            id: "key_dynamic",
            valueHash: nextHash
          }
        }),
        {
          ...createRegistryView({
            key: {
              id: "key_dynamic_b",
              label: "Dynamic Key B",
              valueHash:
                "4e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
              status: "active"
            }
          }),
          keyId: "key_dynamic_b"
        }
      ]
    });

    const result = await bulkRotateGatewayRegistryKeys(
      {
        rotations: [
          {
            keyId: "key_dynamic",
            valueHash: nextHash,
            overlapSeconds: 60
          },
          {
            keyId: "key_dynamic_b",
            valueHash:
              "4e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6"
          }
        ],
        reason: "fleet rollover"
      },
      "req_123",
      {
        isConfiguredKey: vi.fn().mockReturnValue(false),
        getRegistryKeys: vi.fn().mockResolvedValue([
          createRegistryView(),
          {
            ...createRegistryView({
              key: {
                id: "key_dynamic_b",
                label: "Dynamic Key B",
                valueHash:
                  "3e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
                status: "active"
              }
            }),
            keyId: "key_dynamic_b"
          }
        ]),
        listComparableKeysForRotation: vi.fn().mockResolvedValue([
          {
            id: "key_configured",
            label: "Configured Key",
            valueHash:
              "9e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
            status: "active"
          }
        ]),
        validateRotatedKey,
        clearRevocationOverlay,
        bulkRotateRegistryKeys: bulkRotateRegistryKeysWrite
      }
    );

    expect(result).toMatchObject({
      operationId: "req_bulk_rotate_123"
    });
    expect(validateRotatedKey).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        keyId: "key_dynamic"
      }),
      nextHash,
      [
        {
          id: "key_configured",
          label: "Configured Key",
          valueHash:
            "9e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
          status: "active"
        }
      ]
    );
    expect(validateRotatedKey).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        keyId: "key_dynamic_b"
      }),
      "4e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
      [
        {
          id: "key_configured",
          label: "Configured Key",
          valueHash:
            "9e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
          status: "active"
        },
        {
          id: "key_dynamic",
          label: "Dynamic Key",
          valueHash: nextHash,
          status: "active"
        }
      ]
    );
    expect(clearRevocationOverlay).toHaveBeenCalledTimes(2);
    expect(bulkRotateRegistryKeysWrite).toHaveBeenCalledWith({
      rotations: [
        {
          keyId: "key_dynamic",
          valueHash: nextHash,
          overlapSeconds: 60
        },
        {
          keyId: "key_dynamic_b",
          valueHash:
            "4e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6"
        }
      ],
      auditMetadata: {
        reason: "fleet rollover"
      }
    });
  });
});

describe("bulkFinalizeGatewayRegistryKeyRotations", () => {
  it("rejects non-staged keys atomically", async () => {
    await expect(
      bulkFinalizeGatewayRegistryKeyRotations(
        {
          keyIds: ["key_dynamic", "key_dynamic_b"]
        },
        "req_123",
        {
          isConfiguredKey: vi.fn().mockReturnValue(false),
          getRegistryKeys: vi.fn().mockResolvedValue([
            createRegistryView({
              previousValueHash: currentHash,
              previousValueHashExpiresAt: "2026-05-14T01:00:00.000Z"
            }),
            {
              ...createRegistryView({
                key: {
                  id: "key_dynamic_b",
                  label: "Dynamic Key B",
                  valueHash: nextHash,
                  status: "active"
                }
              }),
              keyId: "key_dynamic_b"
            }
          ]),
          bulkFinalizeRegistryKeyRotations: vi.fn()
        }
      )
    ).rejects.toMatchObject({
      code: "gateway_key_rotation_not_staged"
    });
  });
});

describe("bulkCancelGatewayRegistryKeyRotations", () => {
  it("rejects expired overlaps atomically", async () => {
    await expect(
      bulkCancelGatewayRegistryKeyRotations(
        {
          keyIds: ["key_dynamic", "key_dynamic_b"]
        },
        "req_123",
        {
          isConfiguredKey: vi.fn().mockReturnValue(false),
          getRegistryKeys: vi.fn().mockResolvedValue([
            createRegistryView({
              previousValueHash: currentHash,
              previousValueHashExpiresAt: "2026-05-14T00:30:00.000Z"
            }),
            {
              ...createRegistryView({
                key: {
                  id: "key_dynamic_b",
                  label: "Dynamic Key B",
                  valueHash: nextHash,
                  status: "active"
                }
              }),
              keyId: "key_dynamic_b",
              previousValueHash: currentHash,
              previousValueHashExpiresAt: "2026-05-14T01:30:00.000Z"
            }
          ]),
          bulkCancelRegistryKeyRotations: vi.fn()
        },
        Date.parse("2026-05-14T01:00:00.000Z")
      )
    ).rejects.toMatchObject({
      code: "gateway_key_rotation_not_cancelable"
    });
  });
});
