import type { Page, Route } from "@playwright/test";

export const TEST_URL = "http://localhost:8787";
export const TEST_TOKEN = "test-admin-token";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

function jsonResponse(route: Route, status: number, body: JsonValue) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

function buildKeysPayload() {
  return {
    keys: [
      {
        id: "key_primary",
        label: "Primary Key",
        lifecycleStatus: "active",
        createdAt: "2026-05-18T00:00:00.000Z"
      }
    ]
  };
}

function buildKeyDetailPayload() {
  return {
    id: "key_primary",
    label: "Primary Key",
    lifecycleStatus: "active",
    createdAt: "2026-05-18T00:00:00.000Z"
  };
}

function buildGatewayStatusPayload() {
  return {
    configFingerprint: "cfg_fingerprint_1234567890",
    mode: "free",
    routes: [
      {
        externalModel: "gpt-4.1-mini",
        primaryTarget: { provider: "openai", providerModel: "gpt-4.1-mini" },
        fallbackCount: 1
      }
    ],
    providers: [{ id: "openai", configured: true, routeCount: 1 }],
    keys: { total: 1, configured: 1, registryOwned: 0 },
    circuitBreaker: {
      totalTargets: 1,
      openTargets: [],
      halfOpenTargets: []
    },
    config: {
      providerTimeoutMs: 30000,
      providerMaxRetries: 0,
      providerStreamIdleTimeoutMs: 15000,
      maxRequestBodyBytes: 10485760,
      routingLatencyFreshnessMs: 30000,
      routingCostFreshnessMs: 30000,
      routingFailureFreshnessMs: 30000,
      routingRecoveryWindowMs: 30000
    }
  };
}

function buildMetricsPayload() {
  return {
    window: {
      durationMs: 60000,
      collectedSince: "2026-05-18T00:00:00.000Z"
    },
    requests: 42,
    errors: 1,
    errorRate: 0.0238,
    avgDurationMs: 420,
    statusCodes: { 200: 41, 500: 1 },
    byRoute: {
      "/v1/chat/completions": {
        requests: 30,
        errors: 1,
        avgDurationMs: 350
      },
      "/v1/responses": {
        requests: 12,
        errors: 0,
        avgDurationMs: 540
      }
    }
  };
}

function buildRoutingHealthPayload() {
  return {
    config: {
      persistentBackend: false,
      circuitBreakerPolicy: {
        threshold: 3,
        cooldownMs: 30000
      }
    },
    routes: {
      "gpt-4.1-mini": {
        healthStatus: "healthy",
        healthyTargetCount: 1,
        totalTargetCount: 1,
        strategy: "priority"
      }
    },
    targets: {
      "openai:gpt-4.1-mini": {
        circuitState: { state: "closed" },
        metrics: {
          errorRate: 0,
          recoveryScore: 1,
          freshness: {
            latencyFreshMs: 1000,
            failureFreshMs: 1000
          }
        }
      }
    }
  };
}

function buildAdminConfigPayload() {
  return {
    providers: {
      openai: {
        baseUrl: "https://api.openai.com/v1",
        defaultModel: "gpt-4.1-mini",
        configured: true
      }
    },
    routes: [
      {
        externalModel: "gpt-4.1-mini",
        target: { provider: "openai", providerModel: "gpt-4.1-mini" },
        fallbacks: [{ provider: "openai", providerModel: "gpt-4.1" }],
        strategy: "priority"
      }
    ],
    modelGroups: {
      premium: ["gpt-4.1-mini"]
    },
    keys: { total: 1, configured: 1, registryOwned: 0 },
    features: {
      circuitBreaker: { enabled: true, persistent: false },
      quota: false,
      tokenQuota: false,
      concurrency: false,
      registry: false,
      ipRateLimit: false,
      telemetry: false,
      cors: true,
      requestLogging: false
    },
    limits: {
      providerTimeoutMs: 30000,
      maxRequestBodyBytes: 10485760,
      providerStreamIdleTimeoutMs: 15000,
      maxRetries: 0,
      retryBackoffMs: 0
    }
  };
}

function buildConfigStoreSnapshot() {
  return {
    sections: {
      providers: {
        data: {
          openai: {
            apiKey: "sk-test",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4.1-mini"
          }
        },
        updatedAt: 1715990400000,
        updatedBy: "tester@example.com",
        version: 1
      },
      routes: {
        data: [
          {
            externalModel: "gpt-4.1-mini",
            target: {
              provider: "openai",
              providerModel: "gpt-4.1-mini"
            }
          }
        ],
        updatedAt: 1715990400000,
        updatedBy: "tester@example.com",
        version: 1
      },
      accounts: {
        data: {
          accounts: [
            {
              email: "admin@example.com",
              role: "admin",
              enabled: true,
              createdAt: 1715990400000
            }
          ]
        },
        updatedAt: 1715990400000,
        updatedBy: "tester@example.com",
        version: 1
      }
    },
    globalVersion: 3
  };
}

export async function mockGatewayApi(page: Page): Promise<void> {
  await page.route(`${TEST_URL}/**`, async (route) => {
    const request = route.request();
    const authorization = request.headers()["authorization"];
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (authorization !== `Bearer ${TEST_TOKEN}`) {
      await jsonResponse(route, 401, {
        error: { message: "Unauthorized" }
      });
      return;
    }

    if (pathname === "/_airlock/status") {
      await jsonResponse(route, 200, buildGatewayStatusPayload());
      return;
    }

    if (pathname === "/_airlock/metrics") {
      await jsonResponse(route, 200, buildMetricsPayload());
      return;
    }

    if (pathname === "/_airlock/config") {
      await jsonResponse(route, 200, buildAdminConfigPayload());
      return;
    }

    if (pathname === "/_airlock/routing/health") {
      await jsonResponse(route, 200, buildRoutingHealthPayload());
      return;
    }

    if (pathname === "/_airlock/keys") {
      if (request.method() === "POST") {
        await jsonResponse(route, 200, { created: true, id: "key_new" });
        return;
      }
      await jsonResponse(route, 200, buildKeysPayload());
      return;
    }

    if (pathname === "/_airlock/config/manage") {
      await jsonResponse(route, 200, buildConfigStoreSnapshot());
      return;
    }

    if (pathname.startsWith("/_airlock/config/manage/")) {
      if (request.method() === "DELETE") {
        await jsonResponse(route, 200, { deleted: true });
        return;
      }
      await jsonResponse(route, 200, {
        data: {},
        updatedAt: 1715990400000,
        updatedBy: "tester@example.com",
        version: 1
      });
      return;
    }

    if (pathname === "/_airlock/keys/key_primary/status") {
      await jsonResponse(route, 200, { requestsRemaining: 99 });
      return;
    }

    if (pathname === "/_airlock/keys/key_primary/events") {
      await jsonResponse(route, 200, {
        keyId: "key_primary",
        events: [
          {
            timestamp: "2026-05-18T00:00:00.000Z",
            operation: "key.created",
            actor: "tester@example.com",
            status: "success"
          }
        ]
      });
      return;
    }

    if (pathname.startsWith("/_airlock/keys/key_primary")) {
      if (request.method() !== "GET") {
        await jsonResponse(route, 200, { updated: true });
        return;
      }
      await jsonResponse(route, 200, buildKeyDetailPayload());
      return;
    }

    await jsonResponse(route, 404, { error: { message: "Not found" } });
  });
}

export async function performTokenLogin(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Gateway URL").fill(TEST_URL);
  await page.getByLabel("Admin Token").fill(TEST_TOKEN);
  await page.getByRole("button", { name: /connect/i }).click();
  await page.waitForURL("/", { timeout: 10000 });
}
