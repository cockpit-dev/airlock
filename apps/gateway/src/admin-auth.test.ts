import { describe, it, expect } from "vitest";

describe("requireAdminScope", () => {
  it("exports requireAdminScope function", async () => {
    const mod = await import("./admin-auth.js");
    expect(typeof mod.requireAdminScope).toBe("function");
  });
});
