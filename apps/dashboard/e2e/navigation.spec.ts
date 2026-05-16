import { test, expect } from "@playwright/test";

test.describe("Unauthenticated access", () => {
  test("redirects to login from dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  });

  test("redirects to login from keys page", async ({ page }) => {
    await page.goto("/keys");
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  });

  test("redirects to login from config page", async ({ page }) => {
    await page.goto("/config");
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  });

  test("redirects to login from routes page", async ({ page }) => {
    await page.goto("/routes");
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  });
});

test.describe("Navigation bar", () => {
  test("shows all nav links on login page", async ({ page }) => {
    await page.goto("/login");
    const nav = page.locator("nav");
    await expect(nav.getByText("Dashboard")).toBeVisible();
    await expect(nav.getByText("Keys")).toBeVisible();
    await expect(nav.getByText("Routes")).toBeVisible();
    await expect(nav.getByText("Config")).toBeVisible();
    await expect(nav.getByText("Providers")).toBeVisible();
  });
});
