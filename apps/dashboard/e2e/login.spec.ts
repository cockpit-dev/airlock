import { test, expect } from "@playwright/test";

test.describe("Login page", () => {
  test("shows login form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Gateway URL")).toBeVisible();
    await expect(page.getByLabel("Admin Token")).toBeVisible();
    await expect(page.getByRole("button", { name: /login/i })).toBeVisible();
  });

  test("shows error on invalid credentials", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Gateway URL").fill("http://localhost:8787");
    await page.getByLabel("Admin Token").fill("invalid-token");
    await page.getByRole("button", { name: /login/i }).click();
    await expect(page.getByText(/failed|error|unauthorized/i)).toBeVisible({
      timeout: 10000
    });
  });
});
