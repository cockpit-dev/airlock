import { describe, expect, it } from "vitest";

import { GatewayError } from "@airlock/shared";

import {
  applyGatewayApiKeyMetadataOverride,
  extractBearerToken,
  parseInternalAdminCredentials,
  parseGatewayApiKeyMetadataOverride,
  parseGatewayDynamicApiKeyRecord,
  parseGatewayApiKeys,
  requireGatewayAuthorization,
  validateGatewayApiKey
} from "./gateway-auth.js";

const gatewaySecretHash =
  "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6";

describe("extractBearerToken", () => {
  it("extracts the bearer token from an authorization header", () => {
    expect(extractBearerToken("Bearer gateway-secret")).toBe("gateway-secret");
  });

  it("throws for missing or malformed authorization headers", () => {
    expect(() => extractBearerToken(undefined)).toThrow(GatewayError);
    expect(() => extractBearerToken("Basic abc")).toThrow(GatewayError);
  });
});

describe("validateGatewayApiKey", () => {
  it("accepts a configured key", async () => {
    await expect(
      validateGatewayApiKey("gateway-secret", [
        {
          id: "gak_1",
          label: "Gateway Key 1",
          value: "gateway-secret",
          status: "active"
        },
        {
          id: "gak_2",
          label: "Gateway Key 2",
          value: "other",
          status: "active"
        }
      ])
    ).resolves.toEqual({
      id: "gak_1",
      label: "Gateway Key 1",
      value: "gateway-secret",
      status: "active"
    });
  });

  it("rejects an unknown key", async () => {
    await expect(
      validateGatewayApiKey("wrong-secret", [
        {
          id: "gak_1",
          label: "Gateway Key 1",
          value: "gateway-secret",
          status: "active"
        }
      ])
    ).rejects.toThrow(GatewayError);
  });

  it("rejects a revoked key", async () => {
    await expect(
      validateGatewayApiKey("gateway-secret", [
        {
          id: "gak_1",
          label: "Gateway Key 1",
          value: "gateway-secret",
          status: "revoked"
        }
      ])
    ).rejects.toThrow(GatewayError);
  });

  it("accepts a configured hashed key", async () => {
    await expect(
      validateGatewayApiKey("gateway-secret", [
        {
          id: "gak_1",
          label: "Gateway Key 1",
          valueHash: gatewaySecretHash,
          status: "active"
        }
      ])
    ).resolves.toEqual({
      id: "gak_1",
      label: "Gateway Key 1",
      valueHash: gatewaySecretHash,
      status: "active"
    });
  });

  it("rejects a revoked hashed key", async () => {
    await expect(
      validateGatewayApiKey("gateway-secret", [
        {
          id: "gak_1",
          label: "Gateway Key 1",
          valueHash: gatewaySecretHash,
          status: "revoked"
        }
      ])
    ).rejects.toThrow(GatewayError);
  });

  it("rejects a not-yet-active key", async () => {
    await expect(
      validateGatewayApiKey("gateway-secret", [
        {
          id: "gak_1",
          label: "Gateway Key 1",
          value: "gateway-secret",
          status: "active",
          notBefore: "2099-01-01T00:00:00.000Z"
        }
      ])
    ).rejects.toMatchObject({
      code: "auth_api_key_not_yet_active"
    });
  });

  it("rejects an expired key", async () => {
    await expect(
      validateGatewayApiKey("gateway-secret", [
        {
          id: "gak_1",
          label: "Gateway Key 1",
          value: "gateway-secret",
          status: "active",
          expiresAt: "2000-01-01T00:00:00.000Z"
        }
      ])
    ).rejects.toMatchObject({
      code: "auth_api_key_expired"
    });
  });
});

describe("requireGatewayAuthorization", () => {
  it("returns the matched key record for a valid authorization header", async () => {
    await expect(
      requireGatewayAuthorization(
        "Bearer gateway-secret",
        [
          {
            id: "gak_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active"
          }
        ],
        "req_123"
      )
    ).resolves.toEqual({
      id: "gak_1",
      label: "Gateway Key 1",
      value: "gateway-secret",
      status: "active"
    });
  });

  it("throws a gateway auth error for an invalid authorization header", () => {
    expect(() =>
      requireGatewayAuthorization(
        "Basic abc",
        [
          {
            id: "gak_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active"
          }
        ],
        "req_123"
      )
    ).toThrow(GatewayError);
  });

  it("returns the matched hashed key record for a valid authorization header", async () => {
    await expect(
      requireGatewayAuthorization(
        "Bearer gateway-secret",
        [
          {
            id: "gak_1",
            label: "Gateway Key 1",
            valueHash: gatewaySecretHash,
            status: "active"
          }
        ],
        "req_123"
      )
    ).resolves.toEqual({
      id: "gak_1",
      label: "Gateway Key 1",
      valueHash: gatewaySecretHash,
      status: "active"
    });
  });
});

describe("parseGatewayApiKeys", () => {
  it("parses comma-separated keys into structured records", () => {
    expect(parseGatewayApiKeys("gateway-secret, other-secret")).toEqual([
      {
        id: "gak_1",
        label: "Gateway Key 1",
        value: "gateway-secret",
        status: "active"
      },
      {
        id: "gak_2",
        label: "Gateway Key 2",
        value: "other-secret",
        status: "active"
      }
    ]);
  });

  it("rejects duplicate key values after trimming", () => {
    expect(() =>
      parseGatewayApiKeys("gateway-secret, gateway-secret ")
    ).toThrow(GatewayError);
  });

  it("rejects empty key entries", () => {
    expect(() => parseGatewayApiKeys("gateway-secret,   ")).toThrow(
      GatewayError
    );
  });

  it("parses structured json key records with policy metadata", () => {
    expect(
      parseGatewayApiKeys(
        JSON.stringify([
          {
            id: "key_prod",
            label: "Production Key",
            value: "gateway-secret",
            status: "active",
            notBefore: "2026-05-01T00:00:00.000Z",
            expiresAt: "2026-06-01T00:00:00.000Z",
            policy: {
              tier: "prod",
              tags: ["internal", "critical"],
              allowedExternalModels: ["gpt-4.1-mini", "claude-sonnet-4-5"],
              allowedProviders: ["openai", "anthropic"],
              allowedModelGroups: ["default-chat"],
              requestQuota: {
                limit: 1000,
                windowSeconds: 3600
              },
              tokenQuota: {
                limit: 100000,
                windowSeconds: 3600
              },
              concurrencyQuota: {
                limit: 2
              }
            }
          },
          {
            id: "key_revoked",
            label: "Revoked Key",
            value: "revoked-secret",
            status: "revoked"
          }
        ])
      )
    ).toEqual([
      {
        id: "key_prod",
        label: "Production Key",
        value: "gateway-secret",
        status: "active",
        notBefore: "2026-05-01T00:00:00.000Z",
        expiresAt: "2026-06-01T00:00:00.000Z",
        policy: {
          tier: "prod",
          tags: ["internal", "critical"],
          allowedExternalModels: ["gpt-4.1-mini", "claude-sonnet-4-5"],
          allowedProviders: ["openai", "anthropic"],
          allowedModelGroups: ["default-chat"],
          requestQuota: {
            limit: 1000,
            windowSeconds: 3600
          },
          tokenQuota: {
            limit: 100000,
            windowSeconds: 3600
          },
          concurrencyQuota: {
            limit: 2
          }
        }
      },
      {
        id: "key_revoked",
        label: "Revoked Key",
        value: "revoked-secret",
        status: "revoked"
      }
    ]);
  });

  it("parses structured json key records with hashed secret material", () => {
    expect(
      parseGatewayApiKeys(
        JSON.stringify([
          {
            id: "key_prod",
            label: "Production Key",
            valueHash: gatewaySecretHash,
            status: "active"
          }
        ])
      )
    ).toEqual([
      {
        id: "key_prod",
        label: "Production Key",
        valueHash: gatewaySecretHash,
        status: "active"
      }
    ]);
  });

  it("rejects structured key records that define both value and valueHash", () => {
    expect(() =>
      parseGatewayApiKeys(
        JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            valueHash: gatewaySecretHash,
            status: "active"
          }
        ])
      )
    ).toThrow(GatewayError);
  });

  it("rejects invalid request quota policy values", () => {
    expect(() =>
      parseGatewayApiKeys(
        JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              requestQuota: {
                limit: 0,
                windowSeconds: 3600
              }
            }
          }
        ])
      )
    ).toThrow(GatewayError);

    expect(() =>
      parseGatewayApiKeys(
        JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              requestQuota: {
                limit: 10,
                windowSeconds: -1
              }
            }
          }
        ])
      )
    ).toThrow(GatewayError);
  });

  it("rejects invalid concurrency quota policy values", () => {
    expect(() =>
      parseGatewayApiKeys(
        JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              concurrencyQuota: {
                limit: 0
              }
            }
          }
        ])
      )
    ).toThrow(GatewayError);

    expect(() =>
      parseGatewayApiKeys(
        JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              concurrencyQuota: {
                limit: 1.5
              }
            }
          }
        ])
      )
    ).toThrow(GatewayError);
  });

  it("rejects invalid token quota policy values", () => {
    expect(() =>
      parseGatewayApiKeys(
        JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              tokenQuota: {
                limit: 0,
                windowSeconds: 3600
              }
            }
          }
        ])
      )
    ).toThrow(GatewayError);

    expect(() =>
      parseGatewayApiKeys(
        JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              tokenQuota: {
                limit: 10,
                windowSeconds: -1
              }
            }
          }
        ])
      )
    ).toThrow(GatewayError);
  });

  it("rejects invalid lifecycle timestamp values", () => {
    expect(() =>
      parseGatewayApiKeys(
        JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            notBefore: "not-a-date"
          }
        ])
      )
    ).toThrow(GatewayError);

    expect(() =>
      parseGatewayApiKeys(
        JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            expiresAt: "not-a-date"
          }
        ])
      )
    ).toThrow(GatewayError);
  });

  it("rejects lifecycle windows where expiresAt is not after notBefore", () => {
    expect(() =>
      parseGatewayApiKeys(
        JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            notBefore: "2026-05-13T00:00:00.000Z",
            expiresAt: "2026-05-13T00:00:00.000Z"
          }
        ])
      )
    ).toThrow(GatewayError);
  });

  it("rejects structured key records that define neither value nor valueHash", () => {
    expect(() =>
      parseGatewayApiKeys(
        JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            status: "active"
          }
        ])
      )
    ).toThrow(GatewayError);
  });

  it("rejects malformed structured key value hashes", () => {
    expect(() =>
      parseGatewayApiKeys(
        JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            valueHash: "not-a-sha256-hash",
            status: "active"
          }
        ])
      )
    ).toThrow(GatewayError);
  });

  it("rejects duplicate structured key ids", () => {
    expect(() =>
      parseGatewayApiKeys(
        JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active"
          },
          {
            id: "key_1",
            label: "Gateway Key 2",
            value: "other-secret",
            status: "active"
          }
        ])
      )
    ).toThrow(GatewayError);
  });

  it("rejects duplicate structured key values", () => {
    expect(() =>
      parseGatewayApiKeys(
        JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active"
          },
          {
            id: "key_2",
            label: "Gateway Key 2",
            value: "gateway-secret",
            status: "active"
          }
        ])
      )
    ).toThrow(GatewayError);
  });

  it("rejects invalid structured policy tags", () => {
    expect(() =>
      parseGatewayApiKeys(
        JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              tags: ["internal", "internal"]
            }
          }
        ])
      )
    ).toThrow(GatewayError);
  });

  it("rejects invalid allowed external model policy values", () => {
    expect(() =>
      parseGatewayApiKeys(
        JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              allowedExternalModels: ["gpt-4.1-mini", ""]
            }
          }
        ])
      )
    ).toThrow(GatewayError);
  });

  it("rejects duplicate allowed external model policy values", () => {
    expect(() =>
      parseGatewayApiKeys(
        JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              allowedExternalModels: ["gpt-4.1-mini", "gpt-4.1-mini"]
            }
          }
        ])
      )
    ).toThrow(GatewayError);
  });

  it("rejects invalid allowed provider policy values", () => {
    expect(() =>
      parseGatewayApiKeys(
        JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              allowedProviders: ["openai", "invalid-provider"]
            }
          }
        ])
      )
    ).toThrow(GatewayError);
  });

  it("rejects duplicate allowed provider policy values", () => {
    expect(() =>
      parseGatewayApiKeys(
        JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              allowedProviders: ["openai", "openai"]
            }
          }
        ])
      )
    ).toThrow(GatewayError);
  });

  it("rejects invalid allowed model group policy values", () => {
    expect(() =>
      parseGatewayApiKeys(
        JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              allowedModelGroups: ["default-chat", ""]
            }
          }
        ])
      )
    ).toThrow(GatewayError);
  });

  it("rejects duplicate allowed model group policy values", () => {
    expect(() =>
      parseGatewayApiKeys(
        JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              allowedModelGroups: ["default-chat", "default-chat"]
            }
          }
        ])
      )
    ).toThrow(GatewayError);
  });
});

describe("parseGatewayApiKeyMetadataOverride", () => {
  it("parses a valid metadata override with policy and lifecycle fields", () => {
    expect(
      parseGatewayApiKeyMetadataOverride({
        label: "Rotated Production Key",
        status: "active",
        notBefore: "2026-05-13T00:00:00.000Z",
        expiresAt: "2026-06-13T00:00:00.000Z",
        policy: {
          tier: "prod",
          tags: ["internal"],
          allowedProviders: ["openai"],
          requestQuota: {
            limit: 100,
            windowSeconds: 60
          }
        }
      })
    ).toEqual({
      label: "Rotated Production Key",
      status: "active",
      notBefore: "2026-05-13T00:00:00.000Z",
      expiresAt: "2026-06-13T00:00:00.000Z",
      policy: {
        tier: "prod",
        tags: ["internal"],
        allowedProviders: ["openai"],
        requestQuota: {
          limit: 100,
          windowSeconds: 60
        }
      }
    });
  });

  it("allows clearing optional lifecycle and policy fields with null", () => {
    expect(
      parseGatewayApiKeyMetadataOverride({
        notBefore: null,
        expiresAt: null,
        policy: null
      })
    ).toEqual({
      notBefore: null,
      expiresAt: null,
      policy: null
    });
  });

  it("rejects invalid metadata override status", () => {
    expect(() =>
      parseGatewayApiKeyMetadataOverride({
        status: "disabled"
      })
    ).toThrow(GatewayError);
  });
});

describe("parseGatewayDynamicApiKeyRecord", () => {
  it("parses a valid registry-owned hashed gateway key record", () => {
    expect(
      parseGatewayDynamicApiKeyRecord({
        id: "dyn_1",
        label: "Runtime Key 1",
        valueHash: gatewaySecretHash,
        status: "active",
        notBefore: "2026-05-13T00:00:00.000Z",
        expiresAt: "2026-06-13T00:00:00.000Z",
        policy: {
          tier: "runtime",
          allowedProviders: ["openai"],
          requestQuota: {
            limit: 10,
            windowSeconds: 60
          }
        }
      })
    ).toEqual({
      id: "dyn_1",
      label: "Runtime Key 1",
      valueHash: gatewaySecretHash,
      status: "active",
      notBefore: "2026-05-13T00:00:00.000Z",
      expiresAt: "2026-06-13T00:00:00.000Z",
      policy: {
        tier: "runtime",
        allowedProviders: ["openai"],
        requestQuota: {
          limit: 10,
          windowSeconds: 60
        }
      }
    });
  });

  it("rejects plaintext value material for registry-owned dynamic records", () => {
    expect(() =>
      parseGatewayDynamicApiKeyRecord({
        id: "dyn_1",
        label: "Runtime Key 1",
        value: "runtime-secret",
        status: "active"
      })
    ).toThrow(GatewayError);
  });

  it("rejects dynamic records that collide with configured ids", () => {
    expect(() =>
      parseGatewayDynamicApiKeyRecord(
        {
          id: "key_1",
          label: "Runtime Key 1",
          valueHash: gatewaySecretHash,
          status: "active"
        },
        [
          {
            id: "key_1",
            label: "Configured Key 1",
            value: "gateway-secret",
            status: "active"
          }
        ]
      )
    ).toThrow(GatewayError);
  });
});

describe("parseInternalAdminCredentials", () => {
  it("parses valid structured internal admin credentials", () => {
    expect(
      parseInternalAdminCredentials(
        JSON.stringify([
          {
            id: "ops_primary",
            tokenHash: gatewaySecretHash,
            actor: "ops@example.com",
            scopes: ["keys.read"]
          }
        ])
      )
    ).toEqual([
      {
        id: "ops_primary",
        tokenHash: gatewaySecretHash,
        actor: "ops@example.com",
        scopes: ["keys.read"]
      }
    ]);
  });

  it("rejects credentials without actor identity", () => {
    expect(() =>
      parseInternalAdminCredentials(
        JSON.stringify([
          {
            id: "ops_primary",
            tokenHash: gatewaySecretHash
          }
        ])
      )
    ).toThrow(GatewayError);
  });

  it("rejects credentials with unknown scopes", () => {
    expect(() =>
      parseInternalAdminCredentials(
        JSON.stringify([
          {
            id: "ops_primary",
            tokenHash: gatewaySecretHash,
            actor: "ops@example.com",
            scopes: ["keys.admin"]
          }
        ])
      )
    ).toThrow(GatewayError);
  });

  it("defaults credentials without scopes to full access in this phase", () => {
    expect(
      parseInternalAdminCredentials(
        JSON.stringify([
          {
            id: "ops_primary",
            tokenHash: gatewaySecretHash,
            actor: "ops@example.com"
          }
        ])
      )
    ).toEqual([
      {
        id: "ops_primary",
        tokenHash: gatewaySecretHash,
        actor: "ops@example.com",
        scopes: ["keys.read", "keys.write"]
      }
    ]);
  });
});

describe("applyGatewayApiKeyMetadataOverride", () => {
  it("applies an override onto a configured key record", () => {
    expect(
      applyGatewayApiKeyMetadataOverride(
        {
          id: "key_1",
          label: "Configured Key",
          value: "gateway-secret",
          status: "active",
          notBefore: "2026-05-01T00:00:00.000Z",
          policy: {
            tier: "dev"
          }
        },
        {
          label: "Runtime Key",
          status: "revoked",
          notBefore: null,
          expiresAt: "2026-06-01T00:00:00.000Z",
          policy: {
            tier: "prod"
          }
        }
      )
    ).toEqual({
      id: "key_1",
      label: "Runtime Key",
      value: "gateway-secret",
      status: "revoked",
      expiresAt: "2026-06-01T00:00:00.000Z",
      policy: {
        tier: "prod"
      }
    });
  });

  it("rejects overrides that produce an invalid lifecycle window", () => {
    expect(() =>
      applyGatewayApiKeyMetadataOverride(
        {
          id: "key_1",
          label: "Configured Key",
          value: "gateway-secret",
          status: "active",
          notBefore: "2026-05-13T00:00:00.000Z"
        },
        {
          expiresAt: "2026-05-13T00:00:00.000Z"
        }
      )
    ).toThrow(GatewayError);
  });
});
