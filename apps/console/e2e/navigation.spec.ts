import { expect, type Page, test } from "@playwright/test";

const gatewayStatus = {
  configFingerprint: "test",
  mode: "test",
  routes: [
    {
      externalModel: "glm/glm-5.1",
      primaryTarget: { provider: "glm", providerModel: "glm-5.1" },
      fallbackCount: 0,
    },
  ],
  providers: [{ id: "glm", type: "openai", configured: true, routeCount: 1 }],
  keys: { total: 1, configured: 0, registryOwned: 1 },
  circuitBreaker: { totalTargets: 1, openTargets: [], halfOpenTargets: [] },
  config: {
    providerTimeoutMs: 30000,
    providerMaxRetries: 1,
    providerStreamIdleTimeoutMs: 30000,
    maxRequestBodyBytes: 1048576,
    routingLatencyFreshnessMs: 60000,
    routingCostFreshnessMs: 60000,
    routingFailureFreshnessMs: 60000,
    routingRecoveryWindowMs: 60000,
  },
};

const gatewayMetrics = {
  window: { durationMs: 60000, collectedSince: new Date(0).toISOString() },
  requests: 1284,
  errors: 17,
  errorRate: 0.0132,
  avgDurationMs: 742,
  streamCount: 318,
  streamRatio: 0.247,
  statusCodes: { "200": 1198, "429": 12, "500": 5 },
  byRoute: {
    "glm/glm-5.1": { requests: 1284, errors: 17, avgDurationMs: 742 },
  },
  byProvider: {
    glm: { requests: 1284, errors: 17, avgDurationMs: 742 },
  },
};

const routingHealth = {
  targets: {},
  routes: {
    "glm/glm-5.1": {
      strategy: "priority",
      targets: ["glm/glm-5.1"],
      healthStatus: "healthy",
      healthyTargetCount: 1,
      totalTargetCount: 1,
    },
  },
  config: {
    circuitBreakerPolicy: { threshold: 5, cooldownMs: 30000 },
    freshnessWindows: {
      latencyFreshnessMs: 60000,
      costFreshnessMs: 60000,
      failureFreshnessMs: 60000,
      recoveryWindowMs: 60000,
    },
    persistentBackend: true,
  },
};

const registryKeyId = "key_123";
const registrySnapshot = {
  keyId: registryKeyId,
  ownership: "registry",
  label: "Test key",
  configuredStatus: "active",
  lifecycleStatus: "active",
  overlayRevoked: false,
  overlayUpdatedAt: new Date(0).toISOString(),
  effectiveStatus: "active",
  acceptedNow: true,
  configured: {
    keyId: registryKeyId,
    label: "Test key",
    configuredStatus: "active",
    lifecycleStatus: "active",
    overlayRevoked: false,
    overlayUpdatedAt: new Date(0).toISOString(),
    effectiveStatus: "active",
    acceptedNow: true,
  },
  runtime: {
    keyId: registryKeyId,
    label: "Test key",
    configuredStatus: "active",
    lifecycleStatus: "active",
    overlayRevoked: false,
    overlayUpdatedAt: new Date(0).toISOString(),
    effectiveStatus: "active",
    acceptedNow: true,
  },
  registryOverride: null,
  registryOverrideApplied: false,
  registryUpdatedAt: new Date(0).toISOString(),
};

const registryKeyView = {
  keyId: registryKeyId,
  ownership: "registry",
  key: {
    id: registryKeyId,
    label: "Test key",
    status: "active",
    policy: {},
  },
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const adminConfig = {
  ...gatewayStatus,
  modelGroups: {},
  features: {
    circuitBreaker: { enabled: true, persistent: true },
    quota: true,
    tokenQuota: true,
    concurrency: true,
    registry: true,
    ipRateLimit: false,
    telemetry: true,
    cors: true,
    requestLogging: true,
  },
  limits: {
    providerTimeoutMs: 30000,
    maxRequestBodyBytes: 1048576,
    providerStreamIdleTimeoutMs: 30000,
    maxRetries: 1,
    retryBackoffMs: 250,
  },
};

const configSections = {
  providers: [
    {
      id: "glm",
      type: "openai",
      baseUrl: "https://api.example.test/v1",
      defaultModel: "glm-5.1",
    },
  ],
  routes: [
    {
      externalModel: "glm/glm-5.1",
      target: { provider: "glm", providerModel: "glm-5.1" },
      strategy: "priority",
    },
  ],
  accounts: [
    {
      email: "admin@example.test",
      role: "super_admin",
      enabled: true,
    },
  ],
} as const;

test("renders the login screen", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Airlock Console" })).toBeVisible();
  await expect(page.getByPlaceholder("https://your-gateway.workers.dev")).toBeVisible();
  await expect(page.getByPlaceholder("Your admin token")).toBeVisible();
});

test("redirects unauthenticated users to login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("keeps the API client available after login navigation", async ({ page }) => {
  await page.route("https://mock-gateway.test/_airlock/status", (route) =>
    route.fulfill({ json: gatewayStatus })
  );
  await page.route("https://mock-gateway.test/_airlock/metrics", (route) =>
    route.fulfill({ json: gatewayMetrics })
  );
  await page.route(
    "https://mock-gateway.test/_airlock/routing/health",
    (route) => route.fulfill({ json: routingHealth })
  );

  await page.goto("/login");
  await page
    .getByPlaceholder("https://your-gateway.workers.dev")
    .fill("https://mock-gateway.test/");
  await page.getByPlaceholder("Your admin token").fill("test-admin-token");
  await page.getByRole("button", { name: "Connect" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Dashboard" })
  ).toBeVisible();
  await expect(page.getByText("Something went wrong!")).toHaveCount(0);
});

test("opens the user menu and toggles the theme", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("airlock_gateway_url", "https://mock-gateway.test/");
    window.localStorage.setItem("airlock_admin_token", "test-admin-token");
    window.localStorage.setItem("heroui-theme", "light");
  });
  await page.route("https://mock-gateway.test/_airlock/status", (route) =>
    route.fulfill({ json: gatewayStatus })
  );
  await page.route("https://mock-gateway.test/_airlock/metrics", (route) =>
    route.fulfill({ json: gatewayMetrics })
  );
  await page.route(
    "https://mock-gateway.test/_airlock/routing/health",
    (route) => route.fulfill({ json: routingHealth })
  );

  await page.goto("/");
  await page.getByRole("button", { name: "Open user menu" }).click();

  await expect(page.getByRole("menuitem", { name: "Dark Mode" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Dark Mode" }).click();

  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe("dark");
  await expect(page.getByText("Something went wrong!")).toHaveCount(0);
});

test("opens the mobile drawer user menu and toggles the theme", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedAuthenticatedSession(page, "light");
  await mockConsoleApi(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Open user menu" }).click();

  await expect(page.getByRole("menuitem", { name: "Dark Mode" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Dark Mode" }).click();

  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe("dark");
  await expect(page.getByText("Something went wrong!")).toHaveCount(0);
});

test("shows a full navigation drawer on mobile after desktop sidebar collapse", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await seedAuthenticatedSession(page, "light");
  await mockConsoleApi(page);

  await page.goto("/playground");
  await page.getByRole("button", { name: "Collapse navigation" }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();

  const drawer = page.getByRole("dialog", { name: "Navigation" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Dashboard", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Keys", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Playground", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Providers", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Accounts", { exact: true })).toBeVisible();

  const layout = await page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Navigation"]'
    );
    const rect = dialog?.getBoundingClientRect();

    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      dialog: rect
        ? {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          }
        : null,
    };
  });

  expect(layout.dialog, JSON.stringify(layout)).not.toBeNull();
  expect(layout.dialog?.left, JSON.stringify(layout)).toBeLessThanOrEqual(1);
  expect(layout.dialog?.top, JSON.stringify(layout)).toBeLessThanOrEqual(1);
  expect(layout.dialog?.width, JSON.stringify(layout)).toBeGreaterThanOrEqual(240);
  expect(layout.dialog?.width, JSON.stringify(layout)).toBeLessThanOrEqual(
    layout.viewportWidth * 0.86
  );
  expect(layout.dialog?.height, JSON.stringify(layout)).toBeGreaterThanOrEqual(
    layout.viewportHeight - 1
  );
  expect(layout.scrollWidth, JSON.stringify(layout)).toBeLessThanOrEqual(
    layout.viewportWidth + 1
  );
});

test("syncs desktop sidebar selection with the current route", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await seedAuthenticatedSession(page, "light");
  await mockConsoleApi(page);

  await page.goto(`/keys/${registryKeyId}`);

  const keysItem = navItem(page, "Keys");
  const routesItem = navItem(page, "Routes");

  await expect(keysItem).toHaveAttribute("data-selected", "true");
  await expect(routesItem).not.toHaveAttribute("data-selected", "true");
  const activeBackground = await backgroundColor(keysItem);
  await expect
    .poll(() => backgroundColor(routesItem))
    .not.toBe(activeBackground);

  await routesItem.click();

  await expect(page).toHaveURL(/\/routes$/);
  await expect(page.getByRole("heading", { name: "Routes Health" })).toBeVisible();
  await expect(routesItem).toHaveAttribute("data-selected", "true");
  await expect(keysItem).not.toHaveAttribute("data-selected", "true");
  await expect.poll(() => backgroundColor(routesItem)).toBe(activeBackground);
  await expect
    .poll(() => backgroundColor(keysItem))
    .not.toBe(activeBackground);
});

test("renders key detail child route under keys", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("airlock_gateway_url", "https://mock-gateway.test/");
    window.localStorage.setItem("airlock_admin_token", "test-admin-token");
  });
  await page.route("https://mock-gateway.test/_airlock/config", (route) =>
    route.fulfill({ json: { ...gatewayStatus, modelGroups: {}, features: {}, limits: {} } })
  );
  await page.route(
    `https://mock-gateway.test/_airlock/keys/${registryKeyId}`,
    (route) => route.fulfill({ json: registryKeyView })
  );
  await page.route(
    `https://mock-gateway.test/_airlock/keys/${registryKeyId}/status`,
    (route) => route.fulfill({ json: registrySnapshot })
  );
  await page.route(
    `https://mock-gateway.test/_airlock/keys/${registryKeyId}/events`,
    (route) =>
      route.fulfill({
        json: {
          events: [
            {
              id: "event_1",
              kind: "key.updated",
              actor: "admin@example.test",
              reason: "test audit row",
              timestamp: new Date(0).toISOString(),
            },
          ],
        },
      })
  );

  await page.goto(`/keys/${registryKeyId}`);

  await expect(page.getByRole("heading", { name: "Test key" })).toBeVisible();
  await expect(page.getByText("Runtime Status")).toBeVisible();
  await expect(page.getByText("key.updated")).toBeVisible();
  await expect(page.getByText("Key Metadata")).toBeVisible();
  await expect(page.getByText("Something went wrong!")).toHaveCount(0);
});

test("shows a visible edit action on the keys list", async ({ page }) => {
  await seedAuthenticatedSession(page, "light");
  await mockConsoleApi(page);

  await page.goto("/keys");

  const editButton = page.getByRole("button", { name: "Edit Test key" });
  await expect(editButton).toBeVisible();
  await editButton.click();

  await expect(page).toHaveURL(new RegExp(`/keys/${registryKeyId}$`));
  await expect(page.getByRole("button", { name: "Edit key" })).toBeVisible();
  await expect(page.getByText("Something went wrong!")).toHaveCount(0);
});

test("keeps the keys list edit action visible on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedAuthenticatedSession(page, "light");
  await mockConsoleApi(page);

  await page.goto("/keys");

  const editButton = page.getByRole("button", { name: "Edit Test key" });
  await expect(editButton).toBeVisible();

  const layout = await editButton.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      left: rect.left,
      right: rect.right,
    };
  });

  expect(layout.left, JSON.stringify(layout)).toBeGreaterThanOrEqual(0);
  expect(layout.right, JSON.stringify(layout)).toBeLessThanOrEqual(
    layout.viewportWidth
  );
});

test("edits a key label and independent model access", async ({ page }) => {
  await seedAuthenticatedSession(page, "light");
  await mockConsoleApi(page);

  let updatePayload: unknown;
  await page.route(
    `https://mock-gateway.test/_airlock/keys/${registryKeyId}`,
    async (route) => {
      if (route.request().method() === "PUT") {
        updatePayload = route.request().postDataJSON();
        await route.fulfill({
          json: {
            ...registryKeyView,
            key: {
              ...registryKeyView.key,
              label: "Tenant A",
              policy: { blockedExternalModels: ["glm/glm-5.1"] },
            },
            updatedAt: new Date(1).toISOString(),
          },
        });
        return;
      }

      await route.fulfill({ json: registryKeyView });
    }
  );

  await page.goto(`/keys/${registryKeyId}`);
  await page.getByRole("button", { name: "Edit key" }).click();

  const dialog = page.getByRole("dialog", { name: "Edit key" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Key name").fill("Tenant A");
  const modelSwitch = dialog.getByRole("switch", {
    name: "glm/glm-5.1 model access",
  });
  await modelSwitch.focus();
  await modelSwitch.press("Space");
  await dialog.getByRole("button", { name: "Save changes" }).click();

  await expect.poll(() => updatePayload).toEqual({
    label: "Tenant A",
    status: "active",
    policy: { blockedExternalModels: ["glm/glm-5.1"] },
    reason: "updated from console",
  });
});

test("keeps the key editor usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedAuthenticatedSession(page, "light");
  await mockConsoleApi(page);

  await page.goto(`/keys/${registryKeyId}`);
  await page.getByRole("button", { name: "Edit key" }).click();

  const dialog = page.getByRole("dialog", { name: "Edit key" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save changes" })).toBeVisible();

  const layout = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      dialog: {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
      overflowing: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });

  expect(layout.dialog.left, JSON.stringify(layout)).toBeGreaterThanOrEqual(8);
  expect(layout.dialog.right, JSON.stringify(layout)).toBeLessThanOrEqual(
    layout.viewportWidth - 8
  );
  expect(layout.dialog.top, JSON.stringify(layout)).toBeGreaterThanOrEqual(8);
  expect(layout.dialog.bottom, JSON.stringify(layout)).toBeLessThanOrEqual(
    layout.viewportHeight - 8
  );
  expect(layout.overflowing, JSON.stringify(layout)).toBe(false);
});

test("loads playground models from the gateway model list", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("airlock_gateway_url", "https://mock-gateway.test/");
    window.localStorage.setItem("airlock_admin_token", "test-admin-token");
  });
  await page.route("https://mock-gateway.test/v1/models", (route) =>
    route.fulfill({
      json: {
        object: "list",
        data: [{ id: "glm/glm-5.1", object: "model", owned_by: "airlock" }],
      },
    })
  );

  await page.goto("/playground");

  await expect(page.getByRole("heading", { name: "Playground" })).toBeVisible();
  await expect(page.getByRole("button", { name: "glm/glm-5.1" })).toBeVisible();
  await expect(page.getByText("Request Preview")).toBeVisible();
  await expect(page.getByText("\"model\": \"glm/glm-5.1\"")).toBeVisible();
  await expect(page.getByText("Something went wrong!")).toHaveCount(0);
});

test("names playground icon-only controls", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("airlock_gateway_url", "https://mock-gateway.test/");
    window.localStorage.setItem("airlock_admin_token", "test-admin-token");
  });
  await page.route("https://mock-gateway.test/v1/models", (route) =>
    route.fulfill({
      json: {
        object: "list",
        data: [{ id: "glm/glm-5.1", object: "model", owned_by: "airlock" }],
      },
    })
  );
  await page.route("https://mock-gateway.test/v1/chat/completions", () => {
    // Keep the request pending so the streaming stop control is visible.
  });

  await page.goto("/playground");
  await page.getByRole("textbox", { name: "Message" }).fill("Hello");

  await expectAllIconButtonsNamed(page);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("button", { name: "Stop streaming" })).toBeVisible();
  await expectAllIconButtonsNamed(page);
});

test("uses compact console surfaces and renders real dashboard charts", async ({ page }) => {
  await seedAuthenticatedSession(page, "light");
  await mockConsoleApi(page);

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.locator(".recharts-wrapper svg").first()).toBeVisible();

  const radiusToken = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--radius").trim()
  );
  expect(radiusToken).toBe("0.5rem");

  const navButtonRadius = await page
    .getByRole("button", { name: "Collapse navigation" })
    .evaluate((button) =>
      Number.parseFloat(getComputedStyle(button).borderTopLeftRadius)
    );
  expect(navButtonRadius).toBeGreaterThanOrEqual(18);
});

test("uses HeroUI card surfaces instead of custom panels", async ({ page }) => {
  await seedAuthenticatedSession(page, "light");
  await mockConsoleApi(page);

  for (const auditedPage of auditedPages.filter(
    (entry) => entry.path !== "/playground"
  )) {
    await page.goto(auditedPage.path);

    await expect(
      page.getByRole("heading", { name: auditedPage.heading })
    ).toBeVisible();

    const layout = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll<HTMLElement>(".card"));
      const customPanels = document.querySelectorAll(".console-panel").length;
      const customStats = document.querySelectorAll(".console-stat").length;

      return {
        cardCount: cards.length,
        customPanels,
        customStats,
        radiusToken: getComputedStyle(document.documentElement)
          .getPropertyValue("--radius")
          .trim(),
        firstCardClass: cards[0]?.className ?? "",
        firstCardRadius: cards[0]
          ? Number.parseFloat(getComputedStyle(cards[0]).borderTopLeftRadius)
          : 0,
      };
    });

    expect(layout.cardCount, `${auditedPage.path} ${JSON.stringify(layout)}`)
      .toBeGreaterThanOrEqual(1);
    expect(layout.customPanels, `${auditedPage.path} ${JSON.stringify(layout)}`)
      .toBe(0);
    expect(layout.customStats, `${auditedPage.path} ${JSON.stringify(layout)}`)
      .toBe(0);
    expect(layout.radiusToken).toBe("0.5rem");
    expect(layout.firstCardClass).toContain("card--default");
    expect(
      layout.firstCardRadius,
      `${auditedPage.path} ${JSON.stringify(layout)}`
    ).toBeGreaterThanOrEqual(20);
  }
});

test("does not emit HeroUI interaction or label warnings", async ({ page }) => {
  const consoleMessages: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") {
      consoleMessages.push(message.text());
    }
  });

  await seedAuthenticatedSession(page, "light");
  await mockConsoleApi(page);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await page.getByRole("button", { name: "Open user menu" }).click();
  await expect(page.getByRole("menuitem", { name: "Dark Mode" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/playground");
  await expect(page.getByRole("heading", { name: "Playground" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("button", { name: "Open user menu" })).toBeVisible();

  expect(relevantHeroUiConsoleMessages(consoleMessages)).toEqual([]);
});

const auditedPages = [
  { path: "/", heading: "Dashboard" },
  { path: "/keys", heading: "API Keys" },
  { path: `/keys/${registryKeyId}`, heading: "Test key" },
  { path: "/routes", heading: "Routes Health" },
  { path: "/playground", heading: "Playground" },
  { path: "/config/providers", heading: "Providers" },
  { path: "/config/routes", heading: "Route Configuration" },
  { path: "/config/accounts", heading: "Accounts" },
] as const;

for (const theme of ["light", "dark"] as const) {
  for (const viewport of [
    { name: "desktop", width: 1366, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ] as const) {
    test.describe(`layout audit ${theme} ${viewport.name}`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize(viewport);
        await seedAuthenticatedSession(page, theme);
        await mockConsoleApi(page);
      });

      for (const auditedPage of auditedPages) {
        test(`${auditedPage.path} renders without broken layout`, async ({ page }) => {
          const warnings: string[] = [];
          page.on("console", (message) => {
            if (message.type() === "warning" || message.type() === "error") {
              warnings.push(message.text());
            }
          });

          await page.goto(auditedPage.path);

          await expect(
            page.getByRole("heading", { name: auditedPage.heading })
          ).toBeVisible();
          await expect(page.getByText("Something went wrong!")).toHaveCount(0);
          await expectAllIconButtonsNamed(page);
          await expect
            .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
            .toBe(theme);

          const layout = await page.evaluate(() => {
            const root = document.documentElement;
            return {
              viewportWidth: window.innerWidth,
              scrollWidth: root.scrollWidth,
              overflowing: root.scrollWidth > window.innerWidth + 1,
            };
          });

          expect(layout.overflowing, JSON.stringify(layout)).toBe(false);
          expect(relevantHeroUiConsoleMessages(warnings)).toEqual([]);
        });
      }
    });
  }
}

async function seedAuthenticatedSession(page: Page, theme = "light") {
  await page.addInitScript((selectedTheme) => {
    window.localStorage.setItem("airlock_gateway_url", "https://mock-gateway.test/");
    window.localStorage.setItem("airlock_admin_token", "test-admin-token");
    window.localStorage.setItem("heroui-theme", selectedTheme);
  }, theme);
}

async function mockConsoleApi(page: Page) {
  await page.route("https://mock-gateway.test/_airlock/status", (route) =>
    route.fulfill({ json: gatewayStatus })
  );
  await page.route("https://mock-gateway.test/_airlock/metrics", (route) =>
    route.fulfill({ json: gatewayMetrics })
  );
  await page.route("https://mock-gateway.test/_airlock/routing/health", (route) =>
    route.fulfill({ json: routingHealth })
  );
  await page.route("https://mock-gateway.test/_airlock/config", (route) =>
    route.fulfill({ json: adminConfig })
  );
  await page.route("https://mock-gateway.test/_airlock/keys", (route) =>
    route.fulfill({ json: { keys: [registrySnapshot] } })
  );
  await page.route(
    `https://mock-gateway.test/_airlock/keys/${registryKeyId}`,
    (route) => route.fulfill({ json: registryKeyView })
  );
  await page.route(
    `https://mock-gateway.test/_airlock/keys/${registryKeyId}/status`,
    (route) => route.fulfill({ json: registrySnapshot })
  );
  await page.route(
    `https://mock-gateway.test/_airlock/keys/${registryKeyId}/events`,
    (route) => route.fulfill({ json: { events: [] } })
  );
  await page.route("https://mock-gateway.test/v1/models", (route) =>
    route.fulfill({
      json: {
        object: "list",
        data: [{ id: "glm/glm-5.1", object: "model", owned_by: "airlock" }],
      },
    })
  );

  for (const [section, data] of Object.entries(configSections)) {
    await page.route(
      `https://mock-gateway.test/_airlock/config/manage/${section}`,
      (route) =>
        route.fulfill({
          json: {
            data,
            updatedAt: 0,
            updatedBy: "test",
            version: 1,
          },
        })
    );
  }
}

async function expectAllIconButtonsNamed(page: Page) {
  const unnamedIconButtons = await page.locator("button").evaluateAll((buttons) =>
    buttons
      .map((button) => ({
        label: button.getAttribute("aria-label")?.trim() ?? "",
        text: button.textContent?.trim() ?? "",
        html: button.outerHTML,
      }))
      .filter((button) => !button.label && !button.text)
      .map((button) => button.html)
  );

  expect(unnamedIconButtons).toEqual([]);
}

function navItem(page: Page, name: string) {
  return page
    .getByRole("listbox", { name: "PLATFORM navigation" })
    .locator('[data-slot="list-box-item"]')
    .filter({ hasText: name });
}

async function backgroundColor(locator: ReturnType<Page["locator"]>) {
  return locator.evaluate((element) => getComputedStyle(element).backgroundColor);
}

function relevantHeroUiConsoleMessages(messages: string[]) {
  return messages.filter(
    (message) =>
      message.includes("PressResponder was rendered without a pressable child") ||
      message.includes("Focusable> child must forward its ref") ||
      message.includes("If you do not provide a visible label") ||
      message.includes("If a Dialog does not contain a <Heading slot=\"title\">") ||
      message.includes("A dialog must have a title for accessibility") ||
      message.includes("A table must have at least one Column with the isRowHeader prop")
  );
}
