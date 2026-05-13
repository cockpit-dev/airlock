import { describe, expect, it, vi } from "vitest";

import {
  findConfiguredGatewayApiKeyById,
  isConfiguredGatewayApiKeyId,
  requireConfiguredGatewayApiKeyById,
  resolveGatewayApiKeyByIdWithOwnership
} from "./gateway-key-identity.js";

const gatewaySecretHash =
  "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6";

const configuredKeys = [
  {
    id: "key_configured",
    label: "Configured Key",
    valueHash: gatewaySecretHash,
    status: "active" as const
  }
];

describe("isConfiguredGatewayApiKeyId", () => {
  it("returns true only for configured key ids", () => {
    expect(
      isConfiguredGatewayApiKeyId(configuredKeys, "key_configured")
    ).toBe(true);
    expect(isConfiguredGatewayApiKeyId(configuredKeys, "key_registry")).toBe(
      false
    );
  });
});

describe("findConfiguredGatewayApiKeyById", () => {
  it("returns the configured key when present", () => {
    expect(
      findConfiguredGatewayApiKeyById(configuredKeys, "key_configured")
    ).toMatchObject({
      id: "key_configured",
      label: "Configured Key"
    });
  });
});

describe("requireConfiguredGatewayApiKeyById", () => {
  it("throws a governance not-found error when the configured key is missing", () => {
    try {
      requireConfiguredGatewayApiKeyById(
        configuredKeys,
        "missing_key",
        "req_123"
      );
      throw new Error("expected configured-key lookup to fail");
    } catch (error) {
      expect(error).toMatchObject({
        code: "gateway_key_not_found",
        category: "governance",
        httpStatus: 404,
        requestId: "req_123",
        retryable: false
      });
    }
  });
});

describe("resolveGatewayApiKeyByIdWithOwnership", () => {
  it("prefers configured keys over registry lookups", async () => {
    const getRegistryKey = vi.fn().mockResolvedValue({
      keyId: "key_configured",
      ownership: "registry",
      key: {
        id: "key_configured",
        label: "Registry Key",
        valueHash: gatewaySecretHash,
        status: "active" as const
      },
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z"
    });

    await expect(
      resolveGatewayApiKeyByIdWithOwnership(
        configuredKeys,
        "key_configured",
        "req_123",
        {
          getRegistryKey
        }
      )
    ).resolves.toEqual({
      gatewayApiKey: configuredKeys[0],
      ownership: "configured"
    });

    expect(getRegistryKey).not.toHaveBeenCalled();
  });

  it("falls back to registry-owned keys when no configured key exists", async () => {
    const registryKey = {
      keyId: "key_registry",
      ownership: "registry" as const,
      key: {
        id: "key_registry",
        label: "Registry Key",
        valueHash: gatewaySecretHash,
        status: "active" as const
      },
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z"
    };

    await expect(
      resolveGatewayApiKeyByIdWithOwnership(
        configuredKeys,
        "key_registry",
        "req_123",
        {
          getRegistryKey: vi.fn().mockResolvedValue(registryKey)
        }
      )
    ).resolves.toEqual({
      gatewayApiKey: registryKey.key,
      ownership: "registry"
    });
  });

  it("throws a governance not-found error when the key does not exist anywhere", async () => {
    await expect(
      resolveGatewayApiKeyByIdWithOwnership(
        configuredKeys,
        "missing_key",
        "req_123",
        {
          getRegistryKey: vi.fn().mockResolvedValue(null)
        }
      )
    ).rejects.toMatchObject({
      code: "gateway_key_not_found"
    });
  });
});
