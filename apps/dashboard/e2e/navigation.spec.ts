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
  test("keeps unauthenticated users on the token login screen", async ({
    page
  }) => {
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: /airlock dashboard/i })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /dashboard/i })).toHaveCount(0);
  });
});
