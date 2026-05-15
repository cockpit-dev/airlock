import { describe, expect, it, vi } from "vitest";

import {
  bulkCreateGatewayRegistryKeys,
  bulkDeleteGatewayRegistryKeys,
  bulkUpdateGatewayRegistryKeys,
  createGatewayRegistryKey,
  deleteGatewayRegistryKey,
  updateGatewayRegistryKey
} from "./gateway-key-registry-mutations.js";
import type { GatewayApiKeyRecord } from "./gateway-auth.js";
import type { GatewayKeyRegistryDynamicKeyView } from "./gateway-key-registry.js";

const currentHash =
  "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6";

function createRegistryView(
  overrides: Record<string, unknown> = {}
): GatewayKeyRegistryDynamicKeyView {
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
    updatedAt: "2026-05-14T00:00:00.000Z"
  };
}

describe("createGatewayRegistryKey", () => {
  it("parses create payloads against comparable keys and validates runtime dependencies", async () => {
    const validateRuntimeDependencies = vi.fn();
    const createRegistryKeyWrite = vi
      .fn<
        (request: {
          key: GatewayApiKeyRecord;
          actorContext?: {
            actor: string;
            actorSource: "payload" | "trusted_header" | "credential";
          };
        }) => Promise<GatewayKeyRegistryDynamicKeyView>
      >()
      .mockResolvedValue(createRegistryView());

    await expect(
      createGatewayRegistryKey(
        {
          id: "key_dynamic",
          label: "Dynamic Key",
          valueHash: currentHash,
          status: "active",
          actor: "ops@example.com"
        },
        "req_123",
        {
          listComparableKeysForCreate: vi.fn().mockResolvedValue([
            {
              id: "key_env",
              label: "Configured Key",
              valueHash:
                "2e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
              status: "active"
            }
          ]),
          validateRuntimeDependencies,
          createRegistryKey: createRegistryKeyWrite
        }
      )
    ).resolves.toMatchObject({
      keyId: "key_dynamic"
    });

    expect(validateRuntimeDependencies).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "key_dynamic",
        label: "Dynamic Key"
      })
    );
    const [createRequest] = createRegistryKeyWrite.mock.calls[0]!;

    expect(createRequest.key).toMatchObject({
      id: "key_dynamic",
      label: "Dynamic Key"
    });
    expect(createRequest.actorContext).toEqual({
      actor: "ops@example.com",
      actorSource: "payload"
    });
  });

  it("passes create audit metadata through the registry port when present", async () => {
    const createRegistryKey = vi
      .fn<
        (request: {
          key: GatewayApiKeyRecord;
          auditMetadata: {
            reason?: string;
            actor?: string;
            actorSource?: "payload" | "trusted_header" | "credential";
          };
          actorContext?: {
            actor: string;
            actorSource: "payload" | "trusted_header" | "credential";
          };
        }) => Promise<GatewayKeyRegistryDynamicKeyView>
      >()
      .mockResolvedValue(createRegistryView());

    await createGatewayRegistryKey(
      {
        id: "key_dynamic",
        label: "Dynamic Key",
        valueHash: currentHash,
        status: "active",
        reason: "initial rollout",
        actor: "ops@example.com"
      },
      "req_123",
      {
        listComparableKeysForCreate: vi.fn().mockResolvedValue([]),
        validateRuntimeDependencies: vi.fn(),
        createRegistryKey
      }
    );

    const createRequest = createRegistryKey.mock.calls[0]?.[0];
    expect(createRequest).toMatchObject({
      auditMetadata: {
        reason: "initial rollout"
      }
    });
  });
});

describe("bulkCreateGatewayRegistryKeys", () => {
  it("validates every create candidate in request order before delegating", async () => {
    const validateRuntimeDependencies = vi.fn();
    const bulkCreateRegistryKeysWrite = vi.fn().mockResolvedValue({
      operationId: "req_bulk_create_123",
      keys: [
        createRegistryView(),
        {
          ...createRegistryView({
            key: {
              id: "key_dynamic_b",
              label: "Dynamic Key B",
              valueHash:
                "2e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
              status: "revoked"
            }
          }),
          keyId: "key_dynamic_b"
        }
      ]
    });

    await expect(
      bulkCreateGatewayRegistryKeys(
        {
          keys: [
            {
              id: "key_dynamic",
              label: "Dynamic Key",
              valueHash: currentHash,
              status: "active"
            },
            {
              id: "key_dynamic_b",
              label: "Dynamic Key B",
              valueHash:
                "2e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
              status: "revoked"
            }
          ],
          actor: "ops@example.com"
        },
        "req_123",
        {
          listComparableKeysForCreate: vi.fn().mockResolvedValue([
            {
              id: "key_env",
              label: "Configured Key",
              valueHash:
                "3e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
              status: "active"
            }
          ]),
          validateRuntimeDependencies,
          bulkCreateRegistryKeys: bulkCreateRegistryKeysWrite
        }
      )
    ).resolves.toMatchObject({
      operationId: "req_bulk_create_123"
    });

    expect(validateRuntimeDependencies).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: "key_dynamic"
      })
    );
    expect(validateRuntimeDependencies).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: "key_dynamic_b"
      })
    );
    expect(bulkCreateRegistryKeysWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        actorContext: {
          actor: "ops@example.com",
          actorSource: "payload"
        }
      })
    );
  });

  it("passes bulk create audit metadata through the registry port when present", async () => {
    const bulkCreateRegistryKeysWrite = vi
      .fn<
        (request: {
          keys: GatewayApiKeyRecord[];
          auditMetadata?: {
            reason?: string;
            actor?: string;
            actorSource?: "payload" | "trusted_header" | "credential";
          };
          actorContext?: {
            actor: string;
            actorSource: "payload" | "trusted_header" | "credential";
          };
        }) => Promise<{
          operationId: string;
          keys: GatewayKeyRegistryDynamicKeyView[];
        }>
      >()
      .mockResolvedValue({
        operationId: "req_bulk_create_123",
        keys: []
      });

    await bulkCreateGatewayRegistryKeys(
      {
        keys: [
          {
            id: "key_dynamic",
            label: "Dynamic Key",
            valueHash: currentHash,
            status: "active"
          }
        ],
        reason: "initial rollout",
        actor: "ops@example.com"
      },
      "req_123",
      {
        listComparableKeysForCreate: vi.fn().mockResolvedValue([]),
        validateRuntimeDependencies: vi.fn(),
        bulkCreateRegistryKeys: bulkCreateRegistryKeysWrite
      }
    );

    const bulkCreateRequest = bulkCreateRegistryKeysWrite.mock.calls[0]?.[0];
    expect(bulkCreateRequest).toMatchObject({
      auditMetadata: {
        reason: "initial rollout"
      }
    });
  });
});

describe("updateGatewayRegistryKey", () => {
  it("rejects configured keys before touching registry state", async () => {
    const getRegistryKey = vi.fn();

    await expect(
      updateGatewayRegistryKey(
        "key_env",
        {
          label: "Nope"
        },
        "req_123",
        {
          isConfiguredKey: vi.fn().mockReturnValue(true),
          getRegistryKey,
          applyUpdate: vi.fn(),
          validateRuntimeDependencies: vi.fn(),
          updateRegistryKey: vi.fn()
        }
      )
    ).rejects.toMatchObject({
      code: "gateway_key_not_registry_owned"
    });

    expect(getRegistryKey).not.toHaveBeenCalled();
  });

  it("validates updated runtime candidates before delegating", async () => {
    const applyUpdate = vi.fn().mockImplementation(
      (existingKey: GatewayApiKeyRecord, update: Record<string, unknown>) => {
        return {
          ...existingKey,
          ...update
        };
      }
    );
    const validateRuntimeDependencies = vi.fn();
    const updateRegistryKeyWrite = vi.fn().mockResolvedValue(
      createRegistryView({
        key: {
          id: "key_dynamic",
          label: "Dynamic Key (Paused)",
          valueHash: currentHash,
          status: "revoked",
          notBefore: "2099-01-01T00:00:00.000Z"
        }
      })
    );

    await expect(
      updateGatewayRegistryKey(
        "key_dynamic",
        {
          label: "Dynamic Key (Paused)",
          status: "revoked",
          notBefore: "2099-01-01T00:00:00.000Z",
          reason: "maintenance"
        },
        "req_123",
        {
          isConfiguredKey: vi.fn().mockReturnValue(false),
          getRegistryKey: vi.fn().mockResolvedValue(createRegistryView()),
          applyUpdate,
          validateRuntimeDependencies,
          updateRegistryKey: updateRegistryKeyWrite
        }
      )
    ).resolves.toMatchObject({
      keyId: "key_dynamic",
      key: {
        label: "Dynamic Key (Paused)"
      }
    });

    expect(applyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "key_dynamic"
      }),
      {
        label: "Dynamic Key (Paused)",
        status: "revoked",
        notBefore: "2099-01-01T00:00:00.000Z"
      }
    );
    expect(validateRuntimeDependencies).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "Dynamic Key (Paused)",
        status: "revoked"
      })
    );
    expect(updateRegistryKeyWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        keyId: "key_dynamic",
        auditMetadata: {
          reason: "maintenance"
        }
      })
    );
  });
});

describe("bulkUpdateGatewayRegistryKeys", () => {
  it("rejects missing registry keys atomically", async () => {
    await expect(
      bulkUpdateGatewayRegistryKeys(
        {
          updates: [
            {
              keyId: "key_dynamic",
              status: "revoked"
            },
            {
              keyId: "key_dynamic_b",
              label: "Tenant B Key"
            }
          ]
        },
        "req_123",
        {
          isConfiguredKey: vi.fn().mockReturnValue(false),
          getRegistryKeys: vi.fn().mockResolvedValue([createRegistryView(), null]),
          applyUpdate: vi.fn(),
          validateRuntimeDependencies: vi.fn(),
          bulkUpdateRegistryKeys: vi.fn()
        }
      )
    ).rejects.toMatchObject({
      code: "gateway_key_not_found"
    });
  });
});

describe("deleteGatewayRegistryKey", () => {
  it("clears revocation overlay before delegating delete", async () => {
    const clearRevocationOverlay = vi.fn().mockResolvedValue(undefined);
    const deleteRegistryKeyWrite = vi.fn().mockResolvedValue(undefined);

    await expect(
      deleteGatewayRegistryKey(
        "key_dynamic",
        {
          reason: "tenant offboarding"
        },
        "req_123",
        {
          isConfiguredKey: vi.fn().mockReturnValue(false),
          getRegistryKey: vi.fn().mockResolvedValue(createRegistryView()),
          clearRevocationOverlay,
          deleteRegistryKey: deleteRegistryKeyWrite
        }
      )
    ).resolves.toEqual({
      keyId: "key_dynamic",
      deleted: true
    });

    expect(clearRevocationOverlay).toHaveBeenCalledWith(
      expect.objectContaining({
        keyId: "key_dynamic"
      })
    );
    expect(deleteRegistryKeyWrite).toHaveBeenCalledWith("key_dynamic", {
      reason: "tenant offboarding"
    });
  });
});

describe("bulkDeleteGatewayRegistryKeys", () => {
  it("clears overlays for every key before delegating delete batch", async () => {
    const clearRevocationOverlay = vi.fn().mockResolvedValue(undefined);
    const bulkDeleteRegistryKeysWrite = vi.fn().mockResolvedValue({
      operationId: "req_bulk_delete_123",
      keys: [
        { keyId: "key_dynamic", deleted: true },
        { keyId: "key_dynamic_b", deleted: true }
      ]
    });

    await expect(
      bulkDeleteGatewayRegistryKeys(
        {
          keyIds: ["key_dynamic", "key_dynamic_b"],
          reason: "tenant offboarding"
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
                    "2e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
                  status: "active"
                }
              }),
              keyId: "key_dynamic_b"
            }
          ]),
          clearRevocationOverlay,
          bulkDeleteRegistryKeys: bulkDeleteRegistryKeysWrite
        }
      )
    ).resolves.toMatchObject({
      operationId: "req_bulk_delete_123"
    });

    expect(clearRevocationOverlay).toHaveBeenCalledTimes(2);
    expect(bulkDeleteRegistryKeysWrite).toHaveBeenCalledWith({
      keyIds: ["key_dynamic", "key_dynamic_b"],
      auditMetadata: {
        reason: "tenant offboarding"
      }
    });
  });
});
