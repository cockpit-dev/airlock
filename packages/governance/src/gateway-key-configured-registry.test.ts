import { describe, expect, it, vi } from "vitest";

import {
  clearConfiguredGatewayKeyRegistryOverride,
  getConfiguredGatewayApiKeyStatusSnapshot,
  parseGatewayKeyRegistryOverrideMutationRequest,
  parseGatewayKeyRegistryOverrideClearRequest,
  parseGatewayKeyRegistryOverrideAuditMetadata,
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

describe("parseGatewayKeyRegistryOverrideMutationRequest", () => {
  it("parses a flat payload as override-only", () => {
    const result = parseGatewayKeyRegistryOverrideMutationRequest({
      label: "Updated Key",
      status: "active"
    });

    expect(result).toEqual({
      override: {
        label: "Updated Key",
        status: "active"
      }
    });
  });

  it("parses a wrapped payload with override and auditMetadata", () => {
    const result = parseGatewayKeyRegistryOverrideMutationRequest({
      override: {
        label: "Updated Key"
      },
      auditMetadata: {
        reason: "rotated",
        actor: "ops@example.com",
        actorSource: "credential"
      }
    });

    expect(result).toEqual({
      override: {
        label: "Updated Key"
      },
      auditMetadata: {
        reason: "rotated",
        actor: "ops@example.com",
        actorSource: "credential"
      }
    });
  });

  it("merges reason from payload-level into auditMetadata", () => {
    const result = parseGatewayKeyRegistryOverrideMutationRequest({
      label: "Updated Key",
      reason: "maintenance"
    });

    expect(result).toEqual({
      override: {
        label: "Updated Key"
      },
      auditMetadata: {
        reason: "maintenance"
      }
    });
  });

  it("parses a wrapped payload with override but no auditMetadata", () => {
    const result = parseGatewayKeyRegistryOverrideMutationRequest({
      override: {
        label: "Updated Key"
      }
    });

    expect(result).toEqual({
      override: {
        label: "Updated Key"
      }
    });
  });
});

describe("parseGatewayKeyRegistryOverrideClearRequest", () => {
  it("returns empty when no auditMetadata is provided", () => {
    const result = parseGatewayKeyRegistryOverrideClearRequest({});

    expect(result).toEqual({});
  });

  it("parses auditMetadata with reason", () => {
    const result = parseGatewayKeyRegistryOverrideClearRequest({
      auditMetadata: {
        reason: "rollback"
      }
    });

    expect(result).toEqual({
      auditMetadata: {
        reason: "rollback"
      }
    });
  });

  it("parses auditMetadata with actor context", () => {
    const result = parseGatewayKeyRegistryOverrideClearRequest({
      auditMetadata: {
        actor: "ops@example.com",
        actorSource: "trusted_header"
      }
    });

    expect(result).toEqual({
      auditMetadata: {
        actor: "ops@example.com",
        actorSource: "trusted_header"
      }
    });
  });

  it("extracts reason from top-level into auditMetadata", () => {
    const result = parseGatewayKeyRegistryOverrideClearRequest({
      reason: "incident"
    });

    expect(result).toEqual({
      auditMetadata: {
        reason: "incident"
      }
    });
  });
});

describe("parseGatewayKeyRegistryOverrideAuditMetadata", () => {
  it("returns undefined for null input", () => {
    expect(parseGatewayKeyRegistryOverrideAuditMetadata(null)).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(
      parseGatewayKeyRegistryOverrideAuditMetadata(undefined)
    ).toBeUndefined();
  });

  it("returns undefined when no reason or actor context", () => {
    expect(parseGatewayKeyRegistryOverrideAuditMetadata({})).toBeUndefined();
  });

  it("extracts reason from audit metadata", () => {
    expect(
      parseGatewayKeyRegistryOverrideAuditMetadata({ reason: "scheduled" })
    ).toEqual({
      reason: "scheduled"
    });
  });

  it("extracts actor context from audit metadata", () => {
    expect(
      parseGatewayKeyRegistryOverrideAuditMetadata({
        actor: "admin@example.com",
        actorSource: "credential"
      })
    ).toEqual({
      actor: "admin@example.com",
      actorSource: "credential"
    });
  });

  it("extracts both reason and actor context", () => {
    expect(
      parseGatewayKeyRegistryOverrideAuditMetadata({
        reason: "emergency",
        actor: "admin@example.com",
        actorSource: "payload"
      })
    ).toEqual({
      reason: "emergency",
      actor: "admin@example.com",
      actorSource: "payload"
    });
  });
});

describe("updateConfiguredGatewayKeyRegistryOverride", () => {
  it("requires a configured key and persists the parsed override", async () => {
    const writeRegistryOverride = vi.fn().mockResolvedValue({
      override: {
        label: "Runtime Key",
        status: "revoked",
        updatedAt: "2026-05-14T01:00:00.000Z"
      }
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
      },
      auditEvent: {
        keyId: "key_configured",
        kind: "override_updated",
        ownership: "configured",
        occurredAt: "2026-05-14T01:00:00.000Z",
        changes: [
          {
            field: "registryOverride",
            after: {
              label: "Runtime Key",
              status: "revoked",
              updatedAt: "2026-05-14T01:00:00.000Z"
            }
          }
        ]
      }
    });

    expect(writeRegistryOverride).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "key_configured"
      }),
      {
        label: "Runtime Key",
        status: "revoked"
      },
      {}
    );
  });

  it("forwards resolved audit metadata into configured-key override writes", async () => {
    const writeRegistryOverride = vi.fn().mockResolvedValue({
      override: {
        label: "Runtime Key",
        updatedAt: "2026-05-15T01:00:00.000Z"
      },
      auditEvent: {
        keyId: "key_configured",
        kind: "override_updated",
        ownership: "configured",
        occurredAt: "2026-05-15T01:00:00.000Z",
        operationId: "req_456",
        reason: "incident mitigation",
        actor: "ops@example.com",
        actorSource: "credential",
        changes: [
          {
            field: "registryOverride",
            after: {
              label: "Runtime Key",
              updatedAt: "2026-05-15T01:00:00.000Z"
            }
          }
        ]
      }
    });

    await expect(
      updateConfiguredGatewayKeyRegistryOverride(
        [createConfiguredKey()],
        "key_configured",
        {
          label: "Runtime Key"
        },
        "req_456",
        {
          writeRegistryOverride
        },
        {
          actorContext: {
            actor: "ops@example.com",
            actorSource: "credential"
          },
          reason: "incident mitigation",
          operationId: "req_456"
        }
      )
    ).resolves.toMatchObject({
      keyId: "key_configured",
      auditEvent: {
        operationId: "req_456",
        reason: "incident mitigation",
        actor: "ops@example.com",
        actorSource: "credential"
      }
    });

    expect(writeRegistryOverride).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "key_configured"
      }),
      {
        label: "Runtime Key"
      },
      {
        actorContext: {
          actor: "ops@example.com",
          actorSource: "credential"
        },
        reason: "incident mitigation",
        operationId: "req_456"
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
    const clearRegistryOverride = vi.fn().mockResolvedValue({
      auditEvent: {
        keyId: "key_configured",
        kind: "override_cleared",
        ownership: "configured",
        occurredAt: "2026-05-14T02:00:00.000Z"
      }
    });

    await expect(
      clearConfiguredGatewayKeyRegistryOverride(
        [createConfiguredKey()],
        "key_configured",
        undefined,
        "req_123",
        {
          clearRegistryOverride
        }
      )
    ).resolves.toEqual({
      keyId: "key_configured",
      override: null,
      auditEvent: {
        keyId: "key_configured",
        kind: "override_cleared",
        ownership: "configured",
        occurredAt: "2026-05-14T02:00:00.000Z"
      }
    });

    expect(clearRegistryOverride).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "key_configured"
      }),
      {}
    );
  });

  it("forwards resolved audit metadata into configured-key override clears", async () => {
    const clearRegistryOverride = vi.fn().mockResolvedValue({
      auditEvent: {
        keyId: "key_configured",
        kind: "override_cleared",
        ownership: "configured",
        occurredAt: "2026-05-15T02:00:00.000Z",
        operationId: "req_789",
        reason: "rollback",
        actor: "ops@example.com",
        actorSource: "trusted_header"
      }
    });

    await expect(
      clearConfiguredGatewayKeyRegistryOverride(
        [createConfiguredKey()],
        "key_configured",
        {},
        "req_789",
        {
          clearRegistryOverride
        },
        {
          actorContext: {
            actor: "ops@example.com",
            actorSource: "trusted_header"
          },
          reason: "rollback",
          operationId: "req_789"
        }
      )
    ).resolves.toMatchObject({
      keyId: "key_configured",
      auditEvent: {
        operationId: "req_789",
        reason: "rollback",
        actor: "ops@example.com",
        actorSource: "trusted_header"
      }
    });

    expect(clearRegistryOverride).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "key_configured"
      }),
      {
        actorContext: {
          actor: "ops@example.com",
          actorSource: "trusted_header"
        },
        reason: "rollback",
        operationId: "req_789"
      }
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
