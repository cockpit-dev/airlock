import { describe, expect, it, vi } from "vitest";

import type { GatewayBindings } from "./env.js";
import {
  buildRegistryRequest,
  fetchParsedRegistryResponse,
  isGatewayKeyRegistryEnabled
} from "./gateway-key-registry-transport.js";

function createEnv(overrides: Partial<GatewayBindings> = {}): GatewayBindings {
  return {
    AIRLOCK_MODE: "free",
    AIRLOCK_TELEMETRY_SUCCESS_SAMPLE_RATE_FREE: 0.1,
    AIRLOCK_TELEMETRY_SUCCESS_SAMPLE_RATE_SCALE: 1,
    AIRLOCK_GATEWAY_API_KEYS: "[]",
    OPENAI_API_KEY: "test",
    OPENAI_BASE_URL: "https://api.openai.com/v1",
    OPENAI_DEFAULT_MODEL: "gpt-4.1-mini",
    AIRLOCK_PROVIDER_TIMEOUT_MS: 30_000,
    AIRLOCK_PROVIDER_MAX_RETRIES: 0,
    AIRLOCK_PROVIDER_RETRY_BACKOFF_MS: 0,
    AIRLOCK_PROVIDER_CIRCUIT_BREAKER_THRESHOLD: 3,
    AIRLOCK_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS: 30_000,
    AIRLOCK_PROVIDER_CIRCUIT_BREAKER_PERSISTENT: false,
    AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: true,
    ...overrides
  } as GatewayBindings;
}

describe("isGatewayKeyRegistryEnabled", () => {
  it("accepts boolean and string-like truthy env values", () => {
    expect(isGatewayKeyRegistryEnabled(createEnv())).toBe(true);
    expect(
      isGatewayKeyRegistryEnabled(
        createEnv({
          AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: "true" as never
        })
      )
    ).toBe(true);
  });
});

describe("buildRegistryRequest", () => {
  it("injects request id and optional key id into the request", () => {
    const request = buildRegistryRequest("req_123", "dynamic", {
      method: "GET",
      keyId: "key_dynamic"
    });

    expect(request.headers.get("x-airlock-request-id")).toBe("req_123");
    const url = new URL(request.url);
    expect(url.searchParams.get("kind")).toBe("dynamic");
    expect(url.searchParams.get("keyId")).toBe("key_dynamic");
  });
});

describe("fetchParsedRegistryResponse", () => {
  it("parses successful responses through the provided parser", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ key: { id: "key_dynamic" } }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      })
    );

    await expect(
      fetchParsedRegistryResponse(
        () => {
          return {
            fetch
          };
        },
        buildRegistryRequest("req_123", "dynamic", {
          method: "GET",
          keyId: "key_dynamic"
        }),
        "req_123",
        {
          parse: (value) => value as { key: { id: string } }
        }
      )
    ).resolves.toEqual({
      key: {
        id: "key_dynamic"
      }
    });
  });

  it("allows status handlers to intercept non-ok responses", async () => {
    await expect(
      fetchParsedRegistryResponse(
        () => {
          return {
            fetch: vi.fn().mockResolvedValue(new Response("Not found", { status: 404 }))
          };
        },
        buildRegistryRequest("req_123", "dynamic", {
          method: "GET",
          keyId: "key_dynamic"
        }),
        "req_123",
        {
          parse: (value) => value,
          handleStatus: (response) => {
            if (response.status === 404) {
              return null;
            }

            return undefined;
          }
        }
      )
    ).resolves.toBeNull();
  });
});
