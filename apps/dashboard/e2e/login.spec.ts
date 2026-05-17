import { test, expect } from "@playwright/test";
import { TEST_TOKEN, TEST_URL, mockGatewayApi } from "./helpers.js";

test.describe("Login page", () => {
  test("shows login form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Gateway URL")).toBeVisible();
    await expect(page.getByLabel("Admin Token")).toBeVisible();
    await expect(page.getByRole("button", { name: /connect/i })).toBeVisible();
  });

  test("shows error on invalid credentials", async ({ page }) => {
    await mockGatewayApi(page);
    await page.goto("/login");
    await page.getByLabel("Gateway URL").fill(TEST_URL);
    await page.getByLabel("Admin Token").fill("invalid-token");
    await page.getByRole("button", { name: /connect/i }).click();
    await expect(page.getByText(/invalid credentials/i)).toBeVisible({
      timeout: 10000
    });
  });

  test("connects successfully with valid token", async ({ page }) => {
    await mockGatewayApi(page);
    await page.goto("/login");
    await page.getByLabel("Gateway URL").fill(TEST_URL);
    await page.getByLabel("Admin Token").fill(TEST_TOKEN);
    await page.getByRole("button", { name: /connect/i }).click();
    await expect(page).toHaveURL("/", { timeout: 10000 });
  });
});
