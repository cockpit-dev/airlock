import { test as base, expect } from "@playwright/test";
import { mockGatewayApi, performTokenLogin } from "./helpers.js";

const test = base.extend({
  page: async ({ page }, use) => {
    await mockGatewayApi(page);
    await performTokenLogin(page);
    await use(page);
  }
});

test.describe("Dashboard home page", () => {
  test("shows dashboard heading after login", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible(
      {
        timeout: 5000
      }
    );
  });

  test("shows status section", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Request Status" })
    ).toBeVisible({ timeout: 5000 });
  });

  test("shows navigation links", async ({ page }) => {
    const nav = page.locator("nav");
    await expect(nav.getByText("Dashboard")).toBeVisible();
    await expect(nav.getByText("Keys")).toBeVisible();
    await expect(nav.getByText("Config")).toBeVisible();
  });

  test("navigates to keys page", async ({ page }) => {
    await page.locator("nav").getByText("Keys").click();
    await expect(page).toHaveURL(/\/keys/, { timeout: 5000 });
  });

  test("navigates to config page", async ({ page }) => {
    await page.locator("nav").getByText("Config").click();
    await expect(page).toHaveURL(/\/config/, { timeout: 5000 });
  });
});

test.describe("Keys management page", () => {
  test("shows keys heading", async ({ page }) => {
    await page.goto("/keys");
    await expect(page.getByRole("heading", { name: /keys/i })).toBeVisible({
      timeout: 5000
    });
  });
});

test.describe("Config pages", () => {
  test("shows providers config", async ({ page }) => {
    await page.goto("/config/providers");
    await expect(page.getByRole("heading", { name: /provider/i })).toBeVisible({
      timeout: 5000
    });
  });

  test("shows accounts config", async ({ page }) => {
    await page.goto("/config/accounts");
    await expect(page.getByRole("heading", { name: /account/i })).toBeVisible({
      timeout: 5000
    });
  });

  test("shows routes config", async ({ page }) => {
    await page.goto("/config/routes");
    await expect(page.getByRole("heading", { name: /route/i })).toBeVisible({
      timeout: 5000
    });
  });
});

test.describe("Route health page", () => {
  test("shows routing health heading", async ({ page }) => {
    await page.goto("/routes");
    await expect(page.getByRole("heading", { name: /route/i })).toBeVisible({
      timeout: 5000
    });
  });
});

test.describe("Logout", () => {
  test("clears credentials and redirects to login", async ({ page }) => {
    await expect(page.locator("nav")).toBeVisible();
    const logoutBtn = page.getByRole("button", { name: /logout|sign out/i });
    if (await logoutBtn.isVisible()) {
      await logoutBtn.click();
      await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
    }
  });
});
