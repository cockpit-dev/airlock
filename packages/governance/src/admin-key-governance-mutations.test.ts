import { describe, expect, it, vi } from "vitest";

import {
  clearGatewayAdminKeyRegistryOverride,
  clearGatewayAdminKeyRevocation,
  createGatewayAdminKey,
  deleteGatewayAdminKey,
  finalizeGatewayAdminKeyRotation,
  revokeGatewayAdminKey,
  rotateGatewayAdminKey,
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
