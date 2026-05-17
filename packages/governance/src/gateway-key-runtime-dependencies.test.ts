import { describe, expect, it } from "vitest";

import {
  assertGatewayApiKeysRuntimeDependencies,
  assertGatewayApiKeyRuntimeDependencies
} from "./gateway-key-runtime-dependencies.js";

function getThrownError(fn: () => void) {
  try {
    fn();
  } catch (error) {
    return error;
  }

  throw new Error("Expected function to throw");
}

describe("assertGatewayApiKeyRuntimeDependencies", () => {
  it("allows keys whose policy does not require runtime bindings", () => {
    expect(() =>
      assertGatewayApiKeyRuntimeDependencies(
        {
          id: "key_1",
          label: "Gateway Key 1",
          valueHash:
            "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
          status: "active"
        },
        {
          gatewayKeyQuota: false,
          gatewayKeyTokenQuota: false,
          gatewayKeyConcurrency: false
        }
      )
    ).not.toThrow();
  });

  it("rejects missing request quota binding", () => {
    expect(
      getThrownError(() =>
        assertGatewayApiKeyRuntimeDependencies(
          {
            id: "key_quota",
            label: "Quota Key",
            valueHash:
              "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
            status: "active",
            policy: {
              requestQuota: {
                limit: 1,
                windowSeconds: 3600
              }
            }
          },
          {
            gatewayKeyQuota: false,
            gatewayKeyTokenQuota: true,
            gatewayKeyConcurrency: true
          },
          "req_123"
        )
      )
    ).toMatchObject({
      code: "config_missing_gateway_key_quota",
      requestId: "req_123"
    });
  });

  it("rejects missing token quota binding", () => {
    expect(
      getThrownError(() =>
        assertGatewayApiKeyRuntimeDependencies(
          {
            id: "key_token",
            label: "Token Key",
            valueHash:
              "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
            status: "active",
            policy: {
              tokenQuota: {
                limit: 20,
                windowSeconds: 3600
              }
            }
          },
          {
            gatewayKeyQuota: true,
            gatewayKeyTokenQuota: false,
            gatewayKeyConcurrency: true
          }
        )
      )
    ).toMatchObject({
      code: "config_missing_gateway_key_token_quota"
    });
  });

  it("rejects missing concurrency binding", () => {
    expect(
      getThrownError(() =>
        assertGatewayApiKeyRuntimeDependencies(
          {
            id: "key_concurrency",
            label: "Concurrency Key",
            valueHash:
              "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
            status: "active",
            policy: {
              concurrencyQuota: {
                limit: 1
              }
            }
          },
          {
            gatewayKeyQuota: true,
            gatewayKeyTokenQuota: true,
            gatewayKeyConcurrency: false
          }
        )
      )
    ).toMatchObject({
      code: "config_missing_gateway_key_concurrency"
    });
  });
});

describe("assertGatewayApiKeysRuntimeDependencies", () => {
  it("checks configured keys in stable request-token-concurrency order", () => {
    expect(
      getThrownError(() =>
        assertGatewayApiKeysRuntimeDependencies(
          [
            {
              id: "key_token",
              label: "Token Key",
              valueHash:
                "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
              status: "active",
              policy: {
                tokenQuota: {
                  limit: 20,
                  windowSeconds: 3600
                }
              }
            },
            {
              id: "key_request",
              label: "Request Key",
              valueHash:
                "2e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
              status: "active",
              policy: {
                requestQuota: {
                  limit: 1,
                  windowSeconds: 3600
                }
              }
            },
            {
              id: "key_concurrency",
              label: "Concurrency Key",
              valueHash:
                "3e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
              status: "active",
              policy: {
                concurrencyQuota: {
                  limit: 1
                }
              }
            }
          ],
          {
            gatewayKeyQuota: false,
            gatewayKeyTokenQuota: false,
            gatewayKeyConcurrency: false
          }
        )
      )
    ).toMatchObject({
      code: "config_missing_gateway_key_quota"
    });
  });
});
