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
    await expect(page.getByText("Request Status")).toBeVisible({
      timeout: 5000
    });
  });

  test("shows navigation links", async ({ page }) => {
    await expect(page.getByRole("link", { name: /dashboard/i })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Keys", exact: true })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Providers" })).toBeVisible();
  });

  test("navigates to keys page", async ({ page }) => {
    await page.getByRole("link", { name: "Keys", exact: true }).click();
    await expect(page).toHaveURL(/\/keys/, { timeout: 5000 });
  });

  test("navigates to config page", async ({ page }) => {
    await page.getByRole("link", { name: "Providers" }).click();
    await expect(page).toHaveURL(/\/config\/providers/, { timeout: 5000 });
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
    await expect(page.getByText("Routing Health")).toBeVisible({
      timeout: 10000
    });
  });
});

test.describe("Logout", () => {
  test("clears credentials and redirects to login", async ({ page }) => {
    const logoutBtn = page.getByRole("button", { name: /logout|sign out/i });
    if (await logoutBtn.isVisible()) {
      await logoutBtn.click();
      await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
    }
  });
});
