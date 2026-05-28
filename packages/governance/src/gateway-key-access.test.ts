import { describe, expect, it, vi } from "vitest";

import type { ProviderId } from "@airlock/shared";

import {
  assertGatewayKeyAllowsModelAccess,
  assertGatewayKeyAllowsProviderAccess,
  assertGatewayKeyAllowsRouteAccess,
  authorizeGatewayKeyAccess
} from "./gateway-key-access.js";
import type { GatewayApiKeyRecord } from "./gateway-auth.js";
import { GatewayError } from "@airlock/shared";

const gatewaySecretHash =
  "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6";

function expectGatewayErrorCode(fn: () => void, code: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(GatewayError);
    expect(error).toMatchObject({ code });
    return;
  }

  throw new Error(`Expected GatewayError with code ${code}`);
}

describe("authorizeGatewayKeyAccess", () => {
  it("prefers configured key matches and resolves runtime key before active-state gating", async () => {
    const resolveConfiguredRuntimeKey = vi.fn().mockResolvedValue({
      id: "key_configured",
      label: "Configured Runtime Key",
      value: "gateway-secret",
      status: "active"
    } satisfies GatewayApiKeyRecord);
    const assertNotRevoked = vi.fn().mockResolvedValue(undefined);

    const gatewayApiKey = await authorizeGatewayKeyAccess(
      "Bearer gateway-secret",
      [
        {
          id: "key_configured",
          label: "Configured Key",
          value: "gateway-secret",
          status: "active"
        }
      ],
      "req_123",
      {
        registryEnabled: true,
        resolveConfiguredRuntimeKey,
        findRegistryKeyByToken: vi.fn(),
        assertNotRevoked
      }
    );

    expect(gatewayApiKey).toMatchObject({
      id: "key_configured",
      label: "Configured Runtime Key"
    });
    expect(resolveConfiguredRuntimeKey).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "key_configured"
      })
    );
    expect(assertNotRevoked).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "key_configured"
      })
    );
  });

  it("falls back to registry token lookup when configured keys miss", async () => {
    const findRegistryKeyByToken = vi.fn().mockResolvedValue({
      id: "key_registry",
      label: "Registry Key",
      valueHash: gatewaySecretHash,
      status: "active"
    } satisfies GatewayApiKeyRecord);

    const gatewayApiKey = await authorizeGatewayKeyAccess(
      "Bearer gateway-secret",
      [],
      "req_123",
      {
        registryEnabled: true,
        resolveConfiguredRuntimeKey: vi.fn(),
        findRegistryKeyByToken,
        assertNotRevoked: vi.fn().mockResolvedValue(undefined)
      }
    );

    expect(gatewayApiKey).toMatchObject({
      id: "key_registry"
    });
    expect(findRegistryKeyByToken).toHaveBeenCalledWith("gateway-secret");
  });

  it("rejects missing configured and registry matches", async () => {
    await expect(
      authorizeGatewayKeyAccess("Bearer gateway-secret", [], "req_123", {
        registryEnabled: true,
        resolveConfiguredRuntimeKey: vi.fn(),
        findRegistryKeyByToken: vi.fn().mockResolvedValue(undefined),
        assertNotRevoked: vi.fn()
      })
    ).rejects.toMatchObject({
      code: "auth_invalid_api_key"
    });
  });
});

describe("assertGatewayKeyAllowsModelAccess", () => {
  it("allows models by default when no allow-list or block-list policy is configured", () => {
    expect(() =>
      assertGatewayKeyAllowsModelAccess(
        {
          id: "key_1",
          label: "Gateway Key",
          status: "active"
        },
        "newly-added-model",
        "req_123",
        {}
      )
    ).not.toThrow();
  });

  it("allows explicit model matches", () => {
    expect(() =>
      assertGatewayKeyAllowsModelAccess(
        {
          id: "key_1",
          label: "Gateway Key",
          status: "active",
          policy: {
            allowedExternalModels: ["gpt-4.1-mini"]
          }
        },
        "gpt-4.1-mini",
        "req_123",
        {}
      )
    ).not.toThrow();
  });

  it("allows model-group matches", () => {
    expect(() =>
      assertGatewayKeyAllowsModelAccess(
        {
          id: "key_1",
          label: "Gateway Key",
          status: "active",
          policy: {
            allowedModelGroups: ["default-chat"]
          }
        },
        "gpt-4.1-mini",
        "req_123",
        {
          "default-chat": ["gpt-4.1-mini", "claude-sonnet-4-5"]
        }
      )
    ).not.toThrow();
  });

  it("rejects blocked external model matches", () => {
    expectGatewayErrorCode(() => {
      assertGatewayKeyAllowsModelAccess(
        {
          id: "key_1",
          label: "Gateway Key",
          status: "active",
          policy: {
            blockedExternalModels: ["claude-sonnet-4-5"]
          }
        },
        "claude-sonnet-4-5",
        "req_123",
        {}
      );
    }, "auth_model_not_allowed");
  });

  it("allows unblocked models when only a block-list policy is configured", () => {
    expect(() =>
      assertGatewayKeyAllowsModelAccess(
        {
          id: "key_1",
          label: "Gateway Key",
          status: "active",
          policy: {
            blockedExternalModels: ["claude-sonnet-4-5"]
          }
        },
        "gpt-4.1-mini",
        "req_123",
        {}
      )
    ).not.toThrow();
  });

  it("lets blocked external models override explicit allow-list matches", () => {
    expectGatewayErrorCode(() => {
      assertGatewayKeyAllowsModelAccess(
        {
          id: "key_1",
          label: "Gateway Key",
          status: "active",
          policy: {
            allowedExternalModels: ["gpt-4.1-mini"],
            blockedExternalModels: ["gpt-4.1-mini"]
          }
        },
        "gpt-4.1-mini",
        "req_123",
        {}
      );
    }, "auth_model_not_allowed");
  });

  it("rejects when neither explicit models nor model groups match", () => {
    expectGatewayErrorCode(() => {
      assertGatewayKeyAllowsModelAccess(
        {
          id: "key_1",
          label: "Gateway Key",
          status: "active",
          policy: {
            allowedExternalModels: ["gpt-4.1-mini"],
            allowedModelGroups: ["cheap-chat"]
          }
        },
        "claude-sonnet-4-5",
        "req_123",
        {
          "cheap-chat": ["gpt-4.1-mini"]
        }
      );
    }, "auth_model_not_allowed");
  });
});

describe("assertGatewayKeyAllowsProviderAccess", () => {
  it("rejects disallowed providers", () => {
    expectGatewayErrorCode(() => {
      assertGatewayKeyAllowsProviderAccess(
        {
          id: "key_1",
          label: "Gateway Key",
          status: "active",
          policy: {
            allowedProviders: ["anthropic"]
          }
        },
        "openai" satisfies ProviderId,
        "req_123"
      );
    }, "auth_provider_not_allowed");
  });
});

describe("assertGatewayKeyAllowsRouteAccess", () => {
  it("rejects tier mismatches", () => {
    expectGatewayErrorCode(() => {
      assertGatewayKeyAllowsRouteAccess(
        {
          id: "key_1",
          label: "Gateway Key",
          status: "active",
          policy: {
            tier: "dev"
          }
        },
        {
          requiredKeyTier: "prod"
        },
        "req_123"
      );
    }, "auth_route_policy_not_allowed");
  });

  it("rejects missing required tags", () => {
    expectGatewayErrorCode(() => {
      assertGatewayKeyAllowsRouteAccess(
        {
          id: "key_1",
          label: "Gateway Key",
          status: "active",
          policy: {
            tags: ["internal"]
          }
        },
        {
          requiredKeyTags: ["internal", "critical"]
        },
        "req_123"
      );
    }, "auth_route_policy_not_allowed");
  });

  it("allows routes when tier and tags satisfy requirements", () => {
    expect(() =>
      assertGatewayKeyAllowsRouteAccess(
        {
          id: "key_1",
          label: "Gateway Key",
          status: "active",
          policy: {
            tier: "prod",
            tags: ["internal", "critical"]
          }
        },
        {
          requiredKeyTier: "prod",
          requiredKeyTags: ["internal", "critical"]
        },
        "req_123"
      )
    ).not.toThrow();
  });
});
