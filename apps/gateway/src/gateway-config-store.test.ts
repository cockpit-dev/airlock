import { describe, it, expect } from "vitest";
import {
  GatewayConfigStoreDurableObject,
  CONFIG_SECTION_NAMES,
  type StoredConfigSection
} from "./gateway-config-store.js";
import type { DurableObjectStateLike } from "./durable-object-state.js";

function createMockState(): {
  state: DurableObjectStateLike;
  storage: Map<string, unknown>;
} {
  const storage = new Map<string, unknown>();
  const state: DurableObjectStateLike = {
    storage: {
      get<T>(key: string): Promise<T | undefined> {
        return Promise.resolve(storage.get(key) as T | undefined);
      },
      put<T>(key: string, value: T): Promise<void> {
        storage.set(key, value);
        return Promise.resolve();
      },
      delete(key: string): Promise<boolean | void> {
        storage.delete(key);
        return Promise.resolve(true);
      }
    }
  };
  return { state, storage };
}

function createRequest(
  method: string,
  path: string,
  body?: unknown
): Request {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return new Request(`https://airlock.internal${path}`, init);
}

describe("GatewayConfigStoreDurableObject", () => {
  it("returns version 0 when no config has been written", async () => {
    const { state } = createMockState();
    const do_ = new GatewayConfigStoreDurableObject(state);
    const response = await do_.fetch(createRequest("GET", "/version"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { version: number };
    expect(body.version).toBe(0);
  });

  it("lists empty sections initially", async () => {
    const { state } = createMockState();
    const do_ = new GatewayConfigStoreDurableObject(state);
    const response = await do_.fetch(createRequest("GET", "/sections"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      sections: Record<string, unknown>;
      globalVersion: number;
    };
    expect(body.sections).toEqual({});
    expect(body.globalVersion).toBe(0);
  });

  it("returns 404 for missing section", async () => {
    const { state } = createMockState();
    const do_ = new GatewayConfigStoreDurableObject(state);
    const response = await do_.fetch(
      createRequest("GET", "/sections/providers")
    );
    expect(response.status).toBe(404);
  });

  it("rejects invalid section name", async () => {
    const { state } = createMockState();
    const do_ = new GatewayConfigStoreDurableObject(state);
    const response = await do_.fetch(
      createRequest("GET", "/sections/invalid_name")
    );
    expect(response.status).toBe(400);
  });

  it("writes and reads a config section", async () => {
    const { state } = createMockState();
    const do_ = new GatewayConfigStoreDurableObject(state);

    const providers = {
      openai: { apiKey: "sk-test", baseUrl: "https://api.openai.com" }
    };

    const putResponse = await do_.fetch(
      createRequest("PUT", "/sections/providers", providers)
    );
    expect(putResponse.status).toBe(200);
    const putBody = (await putResponse.json()) as StoredConfigSection & {
      globalVersion: number;
    };
    expect(putBody.data).toEqual(providers);
    expect(putBody.version).toBe(1);
    expect(putBody.globalVersion).toBe(1);

    const getResponse = await do_.fetch(
      createRequest("GET", "/sections/providers")
    );
    expect(getResponse.status).toBe(200);
    const getBody = (await getResponse.json()) as StoredConfigSection;
    expect(getBody.data).toEqual(providers);
    expect(getBody.version).toBe(1);
  });

  it("increments version on subsequent writes", async () => {
    const { state } = createMockState();
    const do_ = new GatewayConfigStoreDurableObject(state);

    await do_.fetch(
      createRequest("PUT", "/sections/providers", { openai: {} })
    );
    await do_.fetch(
      createRequest("PUT", "/sections/providers", { openai: { v: 2 } })
    );

    const response = await do_.fetch(
      createRequest("GET", "/sections/providers")
    );
    const body = (await response.json()) as StoredConfigSection;
    expect(body.version).toBe(2);
  });

  it("increments global version across sections", async () => {
    const { state } = createMockState();
    const do_ = new GatewayConfigStoreDurableObject(state);

    await do_.fetch(createRequest("PUT", "/sections/providers", {}));
    await do_.fetch(createRequest("PUT", "/sections/limits", {}));

    const versionResponse = await do_.fetch(createRequest("GET", "/version"));
    const body = (await versionResponse.json()) as { version: number };
    expect(body.version).toBe(2);
  });

  it("deletes a section", async () => {
    const { state } = createMockState();
    const do_ = new GatewayConfigStoreDurableObject(state);

    await do_.fetch(createRequest("PUT", "/sections/providers", {}));
    const deleteResponse = await do_.fetch(
      createRequest("DELETE", "/sections/providers")
    );
    expect(deleteResponse.status).toBe(200);

    const getResponse = await do_.fetch(
      createRequest("GET", "/sections/providers")
    );
    expect(getResponse.status).toBe(404);
  });

  it("returns 404 when deleting non-existent section", async () => {
    const { state } = createMockState();
    const do_ = new GatewayConfigStoreDurableObject(state);
    const response = await do_.fetch(
      createRequest("DELETE", "/sections/limits")
    );
    expect(response.status).toBe(404);
  });

  it("returns full snapshot", async () => {
    const { state } = createMockState();
    const do_ = new GatewayConfigStoreDurableObject(state);

    await do_.fetch(
      createRequest("PUT", "/sections/providers", { openai: {} })
    );
    await do_.fetch(
      createRequest("PUT", "/sections/limits", { timeout: 30000 })
    );

    const response = await do_.fetch(createRequest("GET", "/full"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      sections: Record<string, StoredConfigSection>;
      globalVersion: number;
    };
    expect(body.globalVersion).toBe(2);
    expect(body.sections["providers"]).toBeDefined();
    expect(body.sections["limits"]).toBeDefined();
  });

  it("lists sections with version info", async () => {
    const { state } = createMockState();
    const do_ = new GatewayConfigStoreDurableObject(state);

    await do_.fetch(createRequest("PUT", "/sections/providers", {}));
    await do_.fetch(createRequest("PUT", "/sections/routes", []));

    const response = await do_.fetch(createRequest("GET", "/sections"));
    const body = (await response.json()) as {
      sections: Record<string, { version: number; updatedAt: number }>;
      globalVersion: number;
    };
    expect(Object.keys(body.sections)).toEqual(["providers", "routes"]);
    expect(body.globalVersion).toBe(2);
  });

  it("returns 404 for unknown paths", async () => {
    const { state } = createMockState();
    const do_ = new GatewayConfigStoreDurableObject(state);
    const response = await do_.fetch(createRequest("GET", "/unknown"));
    expect(response.status).toBe(404);
  });

  it("rejects PUT with invalid JSON", async () => {
    const { state } = createMockState();
    const do_ = new GatewayConfigStoreDurableObject(state);
    const request = new Request(
      "https://airlock.internal/sections/providers",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "not json"
      }
    );
    const response = await do_.fetch(request);
    expect(response.status).toBe(400);
  });

  it("records actor from header", async () => {
    const { state } = createMockState();
    const do_ = new GatewayConfigStoreDurableObject(state);

    const request = new Request(
      "https://airlock.internal/sections/providers",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-airlock-admin-actor": "admin@example.com"
        },
        body: JSON.stringify({})
      }
    );
    const response = await do_.fetch(request);
    const body = (await response.json()) as StoredConfigSection;
    expect(body.updatedBy).toBe("admin@example.com");
  });

  it("defaults actor to 'system'", async () => {
    const { state } = createMockState();
    const do_ = new GatewayConfigStoreDurableObject(state);
    const response = await do_.fetch(
      createRequest("PUT", "/sections/providers", {})
    );
    const body = (await response.json()) as StoredConfigSection;
    expect(body.updatedBy).toBe("system");
  });
});

describe("CONFIG_SECTION_NAMES", () => {
  it("contains expected section names", () => {
    expect(CONFIG_SECTION_NAMES).toContain("providers");
    expect(CONFIG_SECTION_NAMES).toContain("routes");
    expect(CONFIG_SECTION_NAMES).toContain("model_groups");
    expect(CONFIG_SECTION_NAMES).toContain("limits");
    expect(CONFIG_SECTION_NAMES).toContain("features");
    expect(CONFIG_SECTION_NAMES).toContain("key_policies");
    expect(CONFIG_SECTION_NAMES).toContain("shaping");
    expect(CONFIG_SECTION_NAMES).toContain("signing");
  });
});
