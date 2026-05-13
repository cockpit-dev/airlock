import { describe, expect, it, vi } from "vitest";

import {
  archiveGatewayRegistryKey,
  bulkArchiveGatewayRegistryKeys,
  bulkRestoreGatewayRegistryKeys,
  restoreGatewayRegistryKey
} from "./gateway-key-registry-lifecycle.js";

const currentHash =
  "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6";

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
    ...(overrides.archivedAt ? { archivedAt: overrides.archivedAt } : {})
  };
}

describe("archiveGatewayRegistryKey", () => {
  it("rejects configured key ids before touching registry state", async () => {
    const getRegistryKey = vi.fn();

    await expect(
      archiveGatewayRegistryKey(
        "key_env",
        {
          reason: "tenant paused"
        },
        "req_123",
        {
          isConfiguredKey: vi.fn().mockReturnValue(true),
          getRegistryKey,
          archiveRegistryKey: vi.fn()
        }
      )
    ).rejects.toMatchObject({
      code: "gateway_key_not_registry_owned"
    });

    expect(getRegistryKey).not.toHaveBeenCalled();
  });

  it("rejects already archived registry keys", async () => {
    await expect(
      archiveGatewayRegistryKey(
        "key_dynamic",
        {
          reason: "tenant paused"
        },
        "req_123",
        {
          isConfiguredKey: vi.fn().mockReturnValue(false),
          getRegistryKey: vi.fn().mockResolvedValue(
            createRegistryView({
              archivedAt: "2026-05-14T01:00:00.000Z"
            })
          ),
          archiveRegistryKey: vi.fn()
        }
      )
    ).rejects.toMatchObject({
      code: "gateway_key_already_archived"
    });
  });

  it("passes parsed lifecycle payloads through after validation", async () => {
    const archiveRegistryKeyWrite = vi.fn().mockResolvedValue(
      createRegistryView({
        archivedAt: "2026-05-14T01:00:00.000Z"
      })
    );

    await expect(
      archiveGatewayRegistryKey(
        "key_dynamic",
        {
          reason: "tenant paused",
          actor: "ops@example.com"
        },
        "req_123",
        {
          isConfiguredKey: vi.fn().mockReturnValue(false),
          getRegistryKey: vi.fn().mockResolvedValue(createRegistryView()),
          archiveRegistryKey: archiveRegistryKeyWrite
        }
      )
    ).resolves.toMatchObject({
      keyId: "key_dynamic",
      archivedAt: "2026-05-14T01:00:00.000Z"
    });

    expect(archiveRegistryKeyWrite).toHaveBeenCalledWith("key_dynamic", {
      reason: "tenant paused",
      actor: "ops@example.com",
      actorSource: "payload"
    });
  });
});

describe("restoreGatewayRegistryKey", () => {
  it("rejects non-archived registry keys", async () => {
    await expect(
      restoreGatewayRegistryKey(
        "key_dynamic",
        {
          reason: "tenant resumed"
        },
        "req_123",
        {
          isConfiguredKey: vi.fn().mockReturnValue(false),
          getRegistryKey: vi.fn().mockResolvedValue(createRegistryView()),
          restoreRegistryKey: vi.fn()
        }
      )
    ).rejects.toMatchObject({
      code: "gateway_key_not_archived"
    });
  });
});

describe("bulkArchiveGatewayRegistryKeys", () => {
  it("rejects batches that include configured key ids", async () => {
    await expect(
      bulkArchiveGatewayRegistryKeys(
        {
          keyIds: ["key_dynamic", "key_env"]
        },
        "req_123",
        {
          isConfiguredKey: vi.fn((keyId: string) => keyId === "key_env"),
          getRegistryKeys: vi.fn(),
          bulkArchiveRegistryKeys: vi.fn()
        }
      )
    ).rejects.toMatchObject({
      code: "gateway_key_not_registry_owned"
    });
  });

  it("rejects already archived keys atomically", async () => {
    await expect(
      bulkArchiveGatewayRegistryKeys(
        {
          keyIds: ["key_dynamic", "key_dynamic_b"]
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
                },
                archivedAt: "2026-05-14T01:00:00.000Z"
              }),
              keyId: "key_dynamic_b"
            }
          ]),
          bulkArchiveRegistryKeys: vi.fn()
        }
      )
    ).rejects.toMatchObject({
      code: "gateway_key_already_archived"
    });
  });
});

describe("bulkRestoreGatewayRegistryKeys", () => {
  it("rejects non-archived keys atomically", async () => {
    await expect(
      bulkRestoreGatewayRegistryKeys(
        {
          keyIds: ["key_dynamic", "key_dynamic_b"]
        },
        "req_123",
        {
          isConfiguredKey: vi.fn().mockReturnValue(false),
          getRegistryKeys: vi.fn().mockResolvedValue([
            createRegistryView({
              archivedAt: "2026-05-14T01:00:00.000Z"
            }),
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
          bulkRestoreRegistryKeys: vi.fn()
        }
      )
    ).rejects.toMatchObject({
      code: "gateway_key_not_archived"
    });
  });

  it("passes parsed bulk lifecycle payloads through after validation", async () => {
    const bulkRestoreRegistryKeysWrite = vi.fn().mockResolvedValue({
      operationId: "req_bulk_restore_123",
      keys: [
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
      ]
    });

    await expect(
      bulkRestoreGatewayRegistryKeys(
        {
          keyIds: ["key_dynamic", "key_dynamic_b"],
          reason: "tenant resumed",
          actor: "ops@example.com"
        },
        "req_123",
        {
          isConfiguredKey: vi.fn().mockReturnValue(false),
          getRegistryKeys: vi.fn().mockResolvedValue([
            createRegistryView({
              archivedAt: "2026-05-14T01:00:00.000Z"
            }),
            {
              ...createRegistryView({
                key: {
                  id: "key_dynamic_b",
                  label: "Dynamic Key B",
                  valueHash:
                    "2e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
                  status: "active"
                },
                archivedAt: "2026-05-14T01:00:00.000Z"
              }),
              keyId: "key_dynamic_b"
            }
          ]),
          bulkRestoreRegistryKeys: bulkRestoreRegistryKeysWrite
        }
      )
    ).resolves.toMatchObject({
      operationId: "req_bulk_restore_123"
    });

    expect(bulkRestoreRegistryKeysWrite).toHaveBeenCalledWith({
      keyIds: ["key_dynamic", "key_dynamic_b"],
      auditMetadata: {
        reason: "tenant resumed",
        actor: "ops@example.com",
        actorSource: "payload"
      }
    });
  });
});
