import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("$app/environment", () => ({
  get browser() {
    return true;
  }
}));

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    _store: store
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true
});

describe("auth module", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.restoreAllMocks();
  });

  describe("getStoredCredentials", () => {
    it("returns null when no credentials stored", async () => {
      const { getStoredCredentials } = await import("./auth.js");
      expect(getStoredCredentials()).toBeNull();
    });

    it("returns credentials when both stored", async () => {
      localStorageMock.setItem("airlock_gateway_url", "http://gw");
      localStorageMock.setItem("airlock_admin_token", "tok123");
      const { getStoredCredentials } = await import("./auth.js");
      expect(getStoredCredentials()).toEqual({
        url: "http://gw",
        token: "tok123"
      });
    });

    it("returns null when only URL stored", async () => {
      localStorageMock.setItem("airlock_gateway_url", "http://gw");
      const { getStoredCredentials } = await import("./auth.js");
      expect(getStoredCredentials()).toBeNull();
    });
  });

  describe("storeCredentials", () => {
    it("stores URL and token", async () => {
      const { storeCredentials } = await import("./auth.js");
      storeCredentials("http://gw", "tok");
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        "airlock_gateway_url",
        "http://gw"
      );
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        "airlock_admin_token",
        "tok"
      );
    });
  });

  describe("clearCredentials", () => {
    it("removes both keys", async () => {
      localStorageMock.setItem("airlock_gateway_url", "http://gw");
      localStorageMock.setItem("airlock_admin_token", "tok");
      const { clearCredentials } = await import("./auth.js");
      clearCredentials();
      expect(localStorageMock.removeItem).toHaveBeenCalledWith(
        "airlock_gateway_url"
      );
      expect(localStorageMock.removeItem).toHaveBeenCalledWith(
        "airlock_admin_token"
      );
    });
  });

  describe("createClient", () => {
    it("returns null when no credentials", async () => {
      const { createClient } = await import("./auth.js");
      expect(createClient()).toBeNull();
    });

    it("returns AirlockClient when credentials exist", async () => {
      localStorageMock.setItem("airlock_gateway_url", "http://gw");
      localStorageMock.setItem("airlock_admin_token", "tok");
      const { createClient } = await import("./auth.js");
      const client = createClient();
      expect(client).not.toBeNull();
    });
  });

  describe("verifyCredentials", () => {
    it("returns true on successful auth", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ mode: "free" }), { status: 200 })
      );
      const { verifyCredentials } = await import("./auth.js");
      const result = await verifyCredentials("http://gw", "tok");
      expect(result).toBe(true);
    });

    it("returns false on AuthError (401)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("unauthorized", { status: 401 })
      );
      const { verifyCredentials } = await import("./auth.js");
      const result = await verifyCredentials("http://gw", "bad-token");
      expect(result).toBe(false);
    });

    it("re-throws network errors", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
        new TypeError("network error")
      );
      const { verifyCredentials } = await import("./auth.js");
      await expect(
        verifyCredentials("http://gw", "tok")
      ).rejects.toThrow("network error");
    });
  });
});
