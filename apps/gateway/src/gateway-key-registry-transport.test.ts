import { describe, expect, it, vi } from "vitest";

import type { GatewayBindings } from "./env.js";
import {
  createGatewayKeyRegistryInvalidResponseError,
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

  it("supports override write requests against the shared registry object", () => {
    const request = buildRegistryRequest("req_123", "override", {
      method: "PUT",
      keyId: "gak_1",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        label: "Primary Key"
      })
    });

    expect(request.method).toBe("PUT");
    expect(request.headers.get("x-airlock-request-id")).toBe("req_123");
    expect(request.headers.get("content-type")).toContain("application/json");
    const url = new URL(request.url);
    expect(url.searchParams.get("kind")).toBe("override");
    expect(url.searchParams.get("keyId")).toBe("gak_1");
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
            fetch: vi
              .fn()
              .mockResolvedValue(new Response("Not found", { status: 404 }))
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

  it("parses configured-key registry override write responses through the shared transport flow", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          keyId: "gak_1",
          override: {
            label: "Primary Key",
            updatedAt: "2026-05-14T00:00:00.000Z"
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    await expect(
      fetchParsedRegistryResponse(
        () => {
          return {
            fetch
          };
        },
        buildRegistryRequest("req_123", "override", {
          method: "PUT",
          keyId: "gak_1",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            label: "Primary Key"
          })
        }),
        "req_123",
        {
          parse: (value) =>
            value as {
              keyId: string;
              override: {
                label: string;
                updatedAt: string;
              };
            }
        }
      )
    ).resolves.toEqual({
      keyId: "gak_1",
      override: {
        label: "Primary Key",
        updatedAt: "2026-05-14T00:00:00.000Z"
      }
    });
  });

  it("wraps invalid override write responses as registry invalid-response errors", async () => {
    await expect(
      fetchParsedRegistryResponse(
        () => {
          return {
            fetch: vi.fn().mockResolvedValue(
              new Response(
                JSON.stringify({
                  keyId: "gak_1",
                  override: null
                }),
                {
                  status: 200,
                  headers: {
                    "content-type": "application/json"
                  }
                }
              )
            )
          };
        },
        buildRegistryRequest("req_123", "override", {
          method: "PUT",
          keyId: "gak_1",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            label: "Primary Key"
          })
        }),
        "req_123",
        {
          parse: (value) => {
            const parsed = value as {
              override: null | {
                label: string;
                updatedAt: string;
              };
            };

            if (!parsed.override) {
              throw new Error("Override response was empty");
            }

            return parsed.override;
          }
        }
      )
    ).rejects.toMatchObject(
      createGatewayKeyRegistryInvalidResponseError("req_123")
    );
  });
});
