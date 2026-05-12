import { describe, expect, it } from "vitest";

import { GatewayError } from "@airlock/shared";

import {
  extractBearerToken,
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
            policy: {
              tier: "prod",
              tags: ["internal", "critical"],
              allowedExternalModels: ["gpt-4.1-mini", "claude-sonnet-4-5"],
              allowedProviders: ["openai", "anthropic"],
              allowedModelGroups: ["default-chat"]
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
        policy: {
          tier: "prod",
          tags: ["internal", "critical"],
          allowedExternalModels: ["gpt-4.1-mini", "claude-sonnet-4-5"],
          allowedProviders: ["openai", "anthropic"],
          allowedModelGroups: ["default-chat"]
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
