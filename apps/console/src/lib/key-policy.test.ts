import { describe, expect, it } from "vitest";

import {
  buildGatewayKeyCreatePayload,
  buildUpdatedKeyPolicy,
  generateGatewayKeyValue,
  getConfiguredModels,
  hashGatewayKeyValue,
} from "./key-policy";
import type { AdminConfigResponse, GatewayApiKeyPolicy } from "./api";

const config = {
  providers: [
    {
      id: "glm",
      type: "openai",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      configured: true,
      models: ["glm-5.1", "glm-5-turbo"],
    },
    {
      id: "openai",
      type: "openai",
      baseUrl: "https://api.openai.com/v1",
      configured: true,
      models: ["gpt-5.5"],
    },
  ],
  routes: [
    {
      externalModel: "glm/glm-5.1",
      target: { provider: "glm", providerModel: "glm-5.1" },
    },
    {
      externalModel: "gpt-5.5",
      target: { provider: "openai", providerModel: "gpt-5.5" },
    },
  ],
  modelGroups: {},
  keys: { total: 0, configured: 0, registryOwned: 0 },
  features: {
    circuitBreaker: { enabled: true, persistent: true },
    quota: false,
    tokenQuota: false,
    concurrency: false,
    registry: true,
    ipRateLimit: false,
    telemetry: false,
    cors: true,
    requestLogging: false,
  },
  limits: {
    providerTimeoutMs: 30_000,
    maxRequestBodyBytes: 1_048_576,
    providerStreamIdleTimeoutMs: 30_000,
    maxRetries: 2,
    retryBackoffMs: 100,
  },
} satisfies AdminConfigResponse;

describe("key policy helpers", () => {
  it("derives unique configured model ids from routes and provider model names", () => {
    expect(getConfiguredModels(config)).toEqual([
      "glm/glm-5.1",
      "gpt-5.5",
      "glm/glm-5-turbo",
      "openai/gpt-5.5",
    ]);
  });

  it("keeps all models enabled when no blocked model list is present", () => {
    expect(buildUpdatedKeyPolicy(undefined, [])).toBeUndefined();
  });

  it("preserves existing policy fields while replacing blocked models", () => {
    const current: GatewayApiKeyPolicy = {
      tier: "prod",
      tags: ["tenant-a"],
      allowedProviders: ["glm"],
      blockedExternalModels: ["gpt-5.5"],
    };

    expect(buildUpdatedKeyPolicy(current, ["glm/glm-5.1"])).toEqual({
      tier: "prod",
      tags: ["tenant-a"],
      allowedProviders: ["glm"],
      blockedExternalModels: ["glm/glm-5.1"],
    });
  });

  it("makes the model editor block list authoritative over old model allow-lists", () => {
    const current: GatewayApiKeyPolicy = {
      tier: "prod",
      allowedExternalModels: ["glm/glm-5.1"],
      allowedModelGroups: ["fast"],
    };

    expect(buildUpdatedKeyPolicy(current, ["gpt-5.5"])).toEqual({
      tier: "prod",
      blockedExternalModels: ["gpt-5.5"],
    });
  });

  it("removes the block list when every model is enabled", () => {
    const current: GatewayApiKeyPolicy = {
      blockedExternalModels: ["gpt-5.5"],
    };

    expect(buildUpdatedKeyPolicy(current, [])).toBeUndefined();
  });

  it("hashes key values with the gateway SHA-256 digest format", async () => {
    await expect(hashGatewayKeyValue("runtime-secret")).resolves.toBe(
      "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16"
    );
  });

  it("builds registry create payloads without restricting models by default", async () => {
    const plainTextKey = "runtime-secret";

    await expect(
      buildGatewayKeyCreatePayload({
        label: "Production client",
        plainTextKey,
        blockedExternalModels: [],
      })
    ).resolves.toMatchObject({
      label: "Production client",
      status: "active",
      valueHash:
        "2443a92e70e0b308401944a08a07bf32219e468942304770f9e63cc06fed5f16",
    });
  });

  it("generates airlock-prefixed one-time key material", () => {
    const key = generateGatewayKeyValue();
    expect(key).toMatch(/^airlok_[a-f0-9]{64}$/);
  });
});
