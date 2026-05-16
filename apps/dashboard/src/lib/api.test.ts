import { describe, it, expect, vi, beforeEach } from "vitest";
import { AirlockClient, AuthError, ApiError } from "./api.js";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("AirlockClient", () => {
  function mockFetch(response: Response) {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response);
  }

  function jsonRes(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" }
    });
  }

  describe("constructor", () => {
    it("strips trailing slash from baseUrl", () => {
      const c = new AirlockClient("http://host/", "tok");
      expect((c as unknown as { baseUrl: string }).baseUrl).toBe("http://host");
    });
  });

  describe("auth header", () => {
    it("sends Authorization bearer token", async () => {
      mockFetch(jsonRes({ ok: true }));
      const c = new AirlockClient("http://host", "my-token");
      await c.getStatus();
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://host/_airlock/status",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer my-token"
          })
        })
      );
    });
  });

  describe("error handling", () => {
    it("throws AuthError on 401", async () => {
      mockFetch(new Response("unauthorized", { status: 401 }));
      const c = new AirlockClient("http://host", "tok");
      await expect(c.getStatus()).rejects.toThrow(AuthError);
    });

    it("throws ApiError with message from body on non-ok", async () => {
      mockFetch(
        jsonRes({ error: { message: "bad request" } }, 400)
      );
      const c = new AirlockClient("http://host", "tok");
      try {
        await c.getStatus();
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        expect((e as ApiError).status).toBe(400);
        expect((e as ApiError).message).toBe("bad request");
      }
    });

    it("throws ApiError with HTTP status fallback", async () => {
      mockFetch(new Response("not json", { status: 500 }));
      const c = new AirlockClient("http://host", "tok");
      await expect(c.getStatus()).rejects.toThrow("HTTP 500");
    });
  });

  describe("API methods", () => {
    it("getStatus sends GET to /_airlock/status", async () => {
      mockFetch(jsonRes({ configFingerprint: "abc", mode: "free" }));
      const c = new AirlockClient("http://host", "tok");
      const res = await c.getStatus();
      expect(res).toEqual({ configFingerprint: "abc", mode: "free" });
    });

    it("getMetrics sends GET to /_airlock/metrics", async () => {
      mockFetch(jsonRes({ requests: 10 }));
      const c = new AirlockClient("http://host", "tok");
      const res = await c.getMetrics();
      expect(res).toEqual({ requests: 10 });
    });

    it("getConfig sends GET to /_airlock/config", async () => {
      mockFetch(jsonRes({ providers: {} }));
      const c = new AirlockClient("http://host", "tok");
      const res = await c.getConfig();
      expect(res).toEqual({ providers: {} });
    });

    it("getRoutingHealth sends GET to /_airlock/routing/health", async () => {
      mockFetch(jsonRes({ targets: {}, routes: {} }));
      const c = new AirlockClient("http://host", "tok");
      const res = await c.getRoutingHealth();
      expect(res).toEqual({ targets: {}, routes: {} });
    });

    it("listKeys sends GET with query params", async () => {
      mockFetch(jsonRes([]));
      const c = new AirlockClient("http://host", "tok");
      await c.listKeys({ state: "active" });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://host/_airlock/keys?state=active",
        expect.anything()
      );
    });

    it("listKeys sends GET without params", async () => {
      mockFetch(jsonRes([]));
      const c = new AirlockClient("http://host", "tok");
      await c.listKeys();
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://host/_airlock/keys",
        expect.anything()
      );
    });

    it("createKey sends POST with body", async () => {
      mockFetch(jsonRes({ id: "k1" }));
      const c = new AirlockClient("http://host", "tok");
      await c.createKey({ label: "test" });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://host/_airlock/keys",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ label: "test" })
        })
      );
    });

    it("deleteKey sends DELETE", async () => {
      mockFetch(jsonRes({ ok: true }));
      const c = new AirlockClient("http://host", "tok");
      await c.deleteKey("k1");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://host/_airlock/keys/k1",
        expect.objectContaining({ method: "DELETE" })
      );
    });

    it("encodes special characters in keyId", async () => {
      mockFetch(jsonRes({ ok: true }));
      const c = new AirlockClient("http://host", "tok");
      await c.getKey("key/with/slashes");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://host/_airlock/keys/key%2Fwith%2Fslashes",
        expect.anything()
      );
    });

    it("rotateKey sends POST to rotate endpoint", async () => {
      mockFetch(jsonRes({ ok: true }));
      const c = new AirlockClient("http://host", "tok");
      await c.rotateKey("k1");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://host/_airlock/keys/k1/rotate",
        expect.objectContaining({ method: "POST" })
      );
    });

    it("archiveKey sends POST to archive endpoint", async () => {
      mockFetch(jsonRes({ ok: true }));
      const c = new AirlockClient("http://host", "tok");
      await c.archiveKey("k1");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://host/_airlock/keys/k1/archive",
        expect.objectContaining({ method: "POST" })
      );
    });

    it("restoreKey sends POST to restore endpoint", async () => {
      mockFetch(jsonRes({ ok: true }));
      const c = new AirlockClient("http://host", "tok");
      await c.restoreKey("k1");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://host/_airlock/keys/k1/restore",
        expect.objectContaining({ method: "POST" })
      );
    });

    it("revokeKey sends POST to revocation endpoint", async () => {
      mockFetch(jsonRes({ ok: true }));
      const c = new AirlockClient("http://host", "tok");
      await c.revokeKey("k1");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://host/_airlock/keys/k1/revocation",
        expect.objectContaining({ method: "POST" })
      );
    });

    it("getKeyStatus sends GET to status endpoint", async () => {
      mockFetch(jsonRes({ quota: {} }));
      const c = new AirlockClient("http://host", "tok");
      await c.getKeyStatus("k1");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://host/_airlock/keys/k1/status",
        expect.anything()
      );
    });

    it("getKeyEvents sends GET to events endpoint", async () => {
      mockFetch(jsonRes({ events: [] }));
      const c = new AirlockClient("http://host", "tok");
      await c.getKeyEvents("k1");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://host/_airlock/keys/k1/events",
        expect.anything()
      );
    });

    describe("Config Store API", () => {
      it("getConfigStoreSnapshot sends GET to manage endpoint", async () => {
        mockFetch(jsonRes({ sections: {} }));
        const c = new AirlockClient("http://host", "tok");
        const res = await c.getConfigStoreSnapshot();
        expect(res).toEqual({ sections: {} });
        expect(globalThis.fetch).toHaveBeenCalledWith(
          "http://host/_airlock/config/manage",
          expect.anything()
        );
      });

      it("getConfigStoreSection encodes section name", async () => {
        mockFetch(jsonRes({ data: {} }));
        const c = new AirlockClient("http://host", "tok");
        await c.getConfigStoreSection("providers/config");
        expect(globalThis.fetch).toHaveBeenCalledWith(
          "http://host/_airlock/config/manage/providers%2Fconfig",
          expect.anything()
        );
      });

      it("putConfigStoreSection sends PUT with data", async () => {
        mockFetch(jsonRes({ written: true }));
        const c = new AirlockClient("http://host", "tok");
        await c.putConfigStoreSection("accounts", [{ email: "a@b.c" }]);
        expect(globalThis.fetch).toHaveBeenCalledWith(
          "http://host/_airlock/config/manage/accounts",
          expect.objectContaining({
            method: "PUT",
            body: JSON.stringify([{ email: "a@b.c" }])
          })
        );
      });

      it("deleteConfigStoreSection sends DELETE with encoded section", async () => {
        mockFetch(jsonRes({ deleted: true, section: "test" }));
        const c = new AirlockClient("http://host", "tok");
        await c.deleteConfigStoreSection("test");
        expect(globalThis.fetch).toHaveBeenCalledWith(
          "http://host/_airlock/config/manage/test",
          expect.objectContaining({ method: "DELETE" })
        );
      });
    });
  });
});

describe("AuthError", () => {
  it("sets name to AuthError", () => {
    const e = new AuthError("test");
    expect(e.name).toBe("AuthError");
    expect(e.message).toBe("test");
  });
});

describe("ApiError", () => {
  it("sets name and status", () => {
    const e = new ApiError("fail", 429);
    expect(e.name).toBe("ApiError");
    expect(e.status).toBe(429);
    expect(e.message).toBe("fail");
  });
});
