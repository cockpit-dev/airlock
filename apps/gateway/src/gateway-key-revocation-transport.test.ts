import { describe, expect, it, vi } from "vitest";

import type { GatewayBindings } from "./env.js";
import {
  REVOCATION_OPERATION_LOG_OBJECT_NAME,
  buildGatewayKeyRevocationEventsRequest,
  buildGatewayKeyRevocationOperationEventsRequest,
  buildGatewayKeyRevocationStateRequest,
  fetchParsedRevocationResponse,
  isGatewayKeyRevocationEnabled
} from "./gateway-key-revocation-transport.js";

function createEnv(overrides: Partial<GatewayBindings> = {}): GatewayBindings {
  return {
    AIRLOCK_MODE: "free",
    AIRLOCK_TELEMETRY_SUCCESS_SAMPLE_RATE_FREE: 0.1,
    AIRLOCK_TELEMETRY_SUCCESS_SAMPLE_RATE_SCALE: 1,
    AIRLOCK_GATEWAY_API_KEYS: "[]",
    AIRLOCK_PROVIDERS: JSON.stringify([
      {
        id: "openai",
        type: "openai",
        apiKey: "test",
        baseUrl: "https://api.openai.com/v1",
        defaultModel: "gpt-4.1-mini"
      }
    ]),
    AIRLOCK_PROVIDER_TIMEOUT_MS: 30_000,
    AIRLOCK_PROVIDER_MAX_RETRIES: 0,
    AIRLOCK_PROVIDER_RETRY_BACKOFF_MS: 0,
    AIRLOCK_PROVIDER_CIRCUIT_BREAKER_THRESHOLD: 3,
    AIRLOCK_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS: 30_000,
    AIRLOCK_PROVIDER_CIRCUIT_BREAKER_PERSISTENT: false,
    ...overrides
  } as GatewayBindings;
}

describe("isGatewayKeyRevocationEnabled", () => {
  it("reflects whether the revocation durable object binding exists", () => {
    expect(
      isGatewayKeyRevocationEnabled(
        createEnv({
          AIRLOCK_GATEWAY_KEY_REVOCATION: {
            get: vi.fn()
          } as never
        })
      )
    ).toBe(true);

    expect(isGatewayKeyRevocationEnabled(createEnv())).toBe(false);
  });
});

describe("revocation transport request builders", () => {
  it("builds state requests with request-id and JSON body when provided", async () => {
    const request = buildGatewayKeyRevocationStateRequest("req_123", {
      method: "POST",
      body: JSON.stringify({ revoked: true }),
      headers: {
        "content-type": "application/json"
      }
    });

    expect(request.headers.get("x-airlock-request-id")).toBe("req_123");
    expect(request.headers.get("content-type")).toBe("application/json");
    expect(await request.text()).toBe(JSON.stringify({ revoked: true }));
  });

  it("builds revocation events and operation-events requests with expected query params", () => {
    const eventsRequest = buildGatewayKeyRevocationEventsRequest(
      "req_123",
      "key_dynamic"
    );
    const eventsUrl = new URL(eventsRequest.url);
    expect(eventsUrl.searchParams.get("kind")).toBe("events");
    expect(eventsUrl.searchParams.get("keyId")).toBe("key_dynamic");

    const operationEventsRequest =
      buildGatewayKeyRevocationOperationEventsRequest("req_123", "op_123");
    const operationEventsUrl = new URL(operationEventsRequest.url);
    expect(operationEventsUrl.searchParams.get("kind")).toBe(
      "operation_events"
    );
    expect(operationEventsUrl.searchParams.get("operationId")).toBe("op_123");
    expect(REVOCATION_OPERATION_LOG_OBJECT_NAME).toBe(
      "gateway-key-revocation-operations"
    );
  });
});

describe("fetchParsedRevocationResponse", () => {
  it("parses successful responses through the provided parser", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ revoked: true }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      })
    );

    await expect(
      fetchParsedRevocationResponse(
        () => {
          return {
            fetch
          };
        },
        buildGatewayKeyRevocationStateRequest("req_123", {
          method: "GET"
        }),
        "req_123",
        {
          parse: async (response) => {
            return (await response.json()) as { revoked: boolean };
          }
        }
      )
    ).resolves.toEqual({ revoked: true });
  });

  it("allows status handlers to intercept non-ok responses", async () => {
    await expect(
      fetchParsedRevocationResponse(
        () => {
          return {
            fetch: vi
              .fn()
              .mockResolvedValue(new Response("Not found", { status: 404 }))
          };
        },
        buildGatewayKeyRevocationOperationEventsRequest("req_123", "op_123"),
        "req_123",
        {
          parse: async (response) => {
            return await response.json();
          },
          handleStatus: (response) => {
            if (response.status === 404) {
              return [];
            }

            return undefined;
          }
        }
      )
    ).resolves.toEqual([]);
  });

  it("allows parsers to handle no-content success responses without forcing json reads", async () => {
    await expect(
      fetchParsedRevocationResponse(
        () => {
          return {
            fetch: vi
              .fn()
              .mockResolvedValue(new Response(null, { status: 204 }))
          };
        },
        buildGatewayKeyRevocationOperationEventsRequest("req_123", "op_123"),
        "req_123",
        {
          parse: () => null
        }
      )
    ).resolves.toBeNull();
  });
});
