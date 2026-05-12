import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app.js";

async function readJson(response: Response): Promise<unknown> {
  return response.json();
}

async function readText(response: Response): Promise<string> {
  return response.text();
}

interface ModelDirectoryPayload {
  object: "list";
  data: Array<{
    id: string;
    object: "model";
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isModelDirectoryPayload(
  value: unknown
): value is ModelDirectoryPayload {
  if (!isRecord(value) || value.object !== "list" || !Array.isArray(value.data)) {
    return false;
  }

  return value.data.every(
    (entry) =>
      isRecord(entry) &&
      entry.object === "model" &&
      typeof entry.id === "string"
  );
}

function createBindings() {
  return {
    AIRLOCK_MODE: "free",
    AIRLOCK_GATEWAY_API_KEYS: "gateway-secret",
    ANTHROPIC_API_KEY: "anthropic-secret",
    ANTHROPIC_BASE_URL: "https://api.anthropic.com/v1",
    ANTHROPIC_DEFAULT_MAX_TOKENS: "256",
    AIRLOCK_PROVIDER_TIMEOUT_MS: "1000",
    OPENAI_API_KEY: "openai-secret",
    OPENAI_BASE_URL: "https://api.openai.com/v1",
    OPENAI_DEFAULT_MODEL: "gpt-4.1-mini",
    AIRLOCK_MODEL_ALIASES:
      "gpt-4.1-mini=openai:gpt-4.1-mini,claude-sonnet-4-5=anthropic:claude-sonnet-4-5"
  };
}

describe("gateway app", () => {
  it("returns ok from /healthz", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/healthz",
      undefined,
      createBindings()
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ ok: true });
  });

  it("returns ready from /readyz when required config is present", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/readyz",
      undefined,
      createBindings()
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ ok: true, ready: true });
  });

  it("returns ready from /readyz when structured gateway key config is valid", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_active",
          label: "Active Key",
          value: "gateway-secret",
          status: "active",
          policy: {
            tier: "prod",
            tags: ["internal"]
          }
        },
        {
          id: "key_revoked",
          label: "Revoked Key",
          value: "revoked-secret",
          status: "revoked"
        }
      ])
    });

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ ok: true, ready: true });
  });

  it("lists the configured model directory from /v1/models", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/models",
      undefined,
      createBindings()
    );

    expect(response.status).toBe(200);
    const payload = await readJson(response);

    expect(isModelDirectoryPayload(payload)).toBe(true);
    if (!isModelDirectoryPayload(payload)) {
      throw new Error("Expected a model directory payload");
    }

    expect(payload.data.map((model) => model.id)).toEqual(
      expect.arrayContaining(["gpt-4.1-mini", "claude-sonnet-4-5"])
    );
  });

  it("returns a configured model from /v1/models/:model", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/models/gpt-4.1-mini",
      undefined,
      createBindings()
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toMatchObject({
      id: "gpt-4.1-mini",
      object: "model"
    });
  });

  it("returns 404 for an unknown model from /v1/models/:model", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/models/unknown-model",
      undefined,
      createBindings()
    );

    expect(response.status).toBe(404);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "model_not_found"
      }
    });
  });

  it("returns not ready from /readyz when required config is missing", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      AIRLOCK_MODE: "free",
      AIRLOCK_GATEWAY_API_KEYS: "gateway-secret",
      OPENAI_API_KEY: "openai-secret",
      OPENAI_BASE_URL: "https://api.openai.com/v1",
      OPENAI_DEFAULT_MODEL: ""
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when gateway api key config is invalid", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      AIRLOCK_MODE: "free",
      AIRLOCK_GATEWAY_API_KEYS: "gateway-secret, gateway-secret ",
      OPENAI_API_KEY: "openai-secret",
      OPENAI_BASE_URL: "https://api.openai.com/v1",
      OPENAI_DEFAULT_MODEL: "gpt-4.1-mini"
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when structured gateway key config is invalid", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_1",
          label: "Gateway Key 1",
          value: "gateway-secret",
          status: "active",
          policy: {
            tags: ["internal", "internal"]
          }
        }
      ])
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when structured gateway key allowed-model policy is invalid", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_1",
          label: "Gateway Key 1",
          value: "gateway-secret",
          status: "active",
          policy: {
            allowedExternalModels: ["gpt-4.1-mini", "gpt-4.1-mini"]
          }
        }
      ])
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when structured gateway key allowed-provider policy is invalid", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_1",
          label: "Gateway Key 1",
          value: "gateway-secret",
          status: "active",
          policy: {
            allowedProviders: ["openai", "invalid-provider"]
          }
        }
      ])
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when structured gateway key allowed-model-group policy is invalid", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_1",
          label: "Gateway Key 1",
          value: "gateway-secret",
          status: "active",
          policy: {
            allowedModelGroups: ["default-chat", "default-chat"]
          }
        }
      ])
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when model group config is malformed", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_MODEL_GROUPS: "{not-json"
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when a key policy references an unknown model group", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_MODEL_GROUPS: JSON.stringify({
        "cheap-chat": ["gpt-4.1-mini"]
      }),
      AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
        {
          id: "key_1",
          label: "Gateway Key 1",
          value: "gateway-secret",
          status: "active",
          policy: {
            allowedModelGroups: ["default-chat"]
          }
        }
      ])
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when model alias config is invalid", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      AIRLOCK_MODE: "free",
      AIRLOCK_GATEWAY_API_KEYS: "gateway-secret",
      AIRLOCK_MODEL_ALIASES:
        "gpt-4.1-mini=gpt-4.1-mini,gpt-4.1-mini=other-model",
      OPENAI_API_KEY: "openai-secret",
      OPENAI_BASE_URL: "https://api.openai.com/v1",
      OPENAI_DEFAULT_MODEL: "gpt-4.1-mini"
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when anthropic routes exist but anthropic config is missing", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      AIRLOCK_MODE: "free",
      AIRLOCK_GATEWAY_API_KEYS: "gateway-secret",
      OPENAI_API_KEY: "openai-secret",
      OPENAI_BASE_URL: "https://api.openai.com/v1",
      OPENAI_DEFAULT_MODEL: "gpt-4.1-mini",
      AIRLOCK_MODEL_ALIASES:
        "gpt-4.1-mini=openai:gpt-4.1-mini,claude-sonnet-4-5=anthropic:claude-sonnet-4-5"
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when provider timeout config is invalid", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_PROVIDER_TIMEOUT_MS: "0"
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when gemini routes exist but gemini config is missing", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      AIRLOCK_MODE: "free",
      AIRLOCK_GATEWAY_API_KEYS: "gateway-secret",
      OPENAI_API_KEY: "openai-secret",
      OPENAI_BASE_URL: "https://api.openai.com/v1",
      OPENAI_DEFAULT_MODEL: "gpt-4.1-mini",
      AIRLOCK_MODEL_ALIASES:
        "gpt-4.1-mini=openai:gpt-4.1-mini,gemini-2.5-flash=gemini:gemini-2.5-flash"
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when model shaping json is malformed", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_MODEL_SHAPING: "{not-json"
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when model shaping targets an unknown route", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_MODEL_SHAPING: JSON.stringify({
        unknown: {
          headers: {
            "openai-beta": "responses=v1"
          }
        }
      })
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready from /readyz when fallback json is malformed", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_MODEL_FALLBACKS: "{not-json"
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("rejects unauthorized chat completions requests", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      createBindings()
    );

    expect(response.status).toBe(401);
  });

  it("rejects revoked structured gateway keys on chat completions requests", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer revoked-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "key_active",
            label: "Active Key",
            value: "gateway-secret",
            status: "active"
          },
          {
            id: "key_revoked",
            label: "Revoked Key",
            value: "revoked-secret",
            status: "revoked"
          }
        ])
      }
    );

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "auth_invalid_api_key"
      }
    });
  });

  it("rejects authenticated keys that are not allowed to access the requested external model", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              allowedExternalModels: ["gpt-4.1-mini"]
            }
          }
        ])
      }
    );

    expect(response.status).toBe(403);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "auth_model_not_allowed",
        type: "authorization"
      }
    });
  });

  it("allows authenticated keys to access explicitly allowed external models", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl_123",
          object: "chat.completion",
          created: 1,
          model: "gpt-4.1-mini",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "hello there"
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              allowedExternalModels: ["gpt-4.1-mini"]
            }
          }
        ])
      }
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("allows authenticated keys to access external models through allowed model groups", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl_123",
          object: "chat.completion",
          created: 1,
          model: "gpt-4.1-mini",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "hello there"
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_MODEL_GROUPS: JSON.stringify({
          "default-chat": ["gpt-4.1-mini", "claude-sonnet-4-5"]
        }),
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              allowedModelGroups: ["default-chat"]
            }
          }
        ])
      }
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects authenticated keys when neither explicit models nor allowed model groups match", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_MODEL_GROUPS: JSON.stringify({
          "cheap-chat": ["gpt-4.1-mini"]
        }),
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              allowedModelGroups: ["cheap-chat"]
            }
          }
        ])
      }
    );

    expect(response.status).toBe(403);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "auth_model_not_allowed",
        type: "authorization"
      }
    });
  });

  it("returns an OpenAI-compatible authorization error for denied /v1/responses model access", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/responses",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          input: "hi",
          stream: false
        })
      },
      {
        ...createBindings(),
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              allowedExternalModels: ["gpt-4.1-mini"]
            }
          }
        ])
      }
    );

    expect(response.status).toBe(403);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "auth_model_not_allowed",
        type: "authorization"
      }
    });
  });

  it("returns an Anthropic-compatible authorization error for denied /v1/messages model access", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/messages",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 256,
          messages: [
            {
              role: "user",
              content: "hi"
            }
          ]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              allowedExternalModels: ["gpt-4.1-mini"]
            }
          }
        ])
      }
    );

    expect(response.status).toBe(403);
    await expect(readJson(response)).resolves.toMatchObject({
      type: "error",
      error: {
        type: "authorization",
        message: "Gateway API key is not allowed to access this model"
      }
    });
    expect(response.headers.get("request-id")).toBeTruthy();
  });

  it("returns an OpenAI-compatible authorization error for denied primary provider access", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              allowedProviders: ["anthropic"]
            }
          }
        ])
      }
    );

    expect(response.status).toBe(403);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "auth_provider_not_allowed",
        type: "authorization"
      }
    });
  });

  it("returns an Anthropic-compatible authorization error for denied primary provider access", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/messages",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 256,
          messages: [
            {
              role: "user",
              content: "hi"
            }
          ]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              allowedProviders: ["openai"]
            }
          }
        ])
      }
    );

    expect(response.status).toBe(403);
    await expect(readJson(response)).resolves.toMatchObject({
      type: "error",
      error: {
        type: "authorization",
        message: "Gateway API key is not allowed to access this provider"
      }
    });
    expect(response.headers.get("request-id")).toBeTruthy();
  });

  it("returns an OpenAI-compatible chat completions response when authorized", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl_123",
          object: "chat.completion",
          created: 1,
          model: "gpt-4.1-mini",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "hello there"
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_MODEL_SHAPING: JSON.stringify({
          "gpt-4.1-mini": {
            headers: {
              "openai-beta": "responses=v1"
            },
            query: {
              "api-version": "2025-01-01"
            },
            jsonBody: {
              temperature: 0.2
            }
          }
        })
      }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(url).toBe(
      "https://api.openai.com/v1/chat/completions?api-version=2025-01-01"
    );
    expect(init.headers).toMatchObject({
      "openai-beta": "responses=v1"
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model: "gpt-4.1-mini",
      stream: false,
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.2
    });
    await expect(readJson(response)).resolves.toMatchObject({
      object: "chat.completion",
      model: "gpt-4.1-mini"
    });
  });

  it("applies request-scoped shaping to chat completions requests", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl_123",
          object: "chat.completion",
          created: 1,
          model: "gpt-4.1-mini",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "hello there"
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }],
          airlock: {
            requestShaping: {
              headers: {
                "openai-beta": "responses=v1"
              },
              query: {
                "api-version": "2025-01-01"
              },
              jsonBody: {
                temperature: 0.2
              }
            }
          }
        })
      },
      createBindings()
    );

    expect(response.status).toBe(200);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(url).toBe(
      "https://api.openai.com/v1/chat/completions?api-version=2025-01-01"
    );
    expect(init.headers).toMatchObject({
      "openai-beta": "responses=v1"
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model: "gpt-4.1-mini",
      stream: false,
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.2
    });
  });

  it("lets request-scoped shaping override route-level shaping for chat completions", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl_123",
          object: "chat.completion",
          created: 1,
          model: "gpt-4.1-mini",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "hello there"
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }],
          airlock: {
            requestShaping: {
              headers: {
                "openai-beta": "responses=v2"
              },
              query: {
                "api-version": "2025-02-02"
              },
              jsonBody: {
                temperature: 0.8
              }
            }
          }
        })
      },
      {
        ...createBindings(),
        AIRLOCK_MODEL_SHAPING: JSON.stringify({
          "gpt-4.1-mini": {
            headers: {
              "openai-beta": "responses=v1"
            },
            query: {
              "api-version": "2025-01-01"
            },
            jsonBody: {
              temperature: 0.2
            }
          }
        })
      }
    );

    expect(response.status).toBe(200);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(url).toBe(
      "https://api.openai.com/v1/chat/completions?api-version=2025-02-02"
    );
    expect(init.headers).toMatchObject({
      "openai-beta": "responses=v2"
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model: "gpt-4.1-mini",
      stream: false,
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.8
    });
  });

  it("fails over to the configured OpenAI fallback target on retryable upstream error", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "rate limited"
            }
          }),
          {
            status: 429,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "chatcmpl_fallback",
            object: "chat.completion",
            created: 1,
            model: "gpt-4.1-nano",
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: "fallback hello"
                }
              }
            ]
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      );

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
          "gpt-4.1-mini": ["openai:gpt-4.1-nano"]
        })
      }
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse((fetcher.mock.calls[0] as [string, RequestInit])[1].body as string))
      .toMatchObject({
        model: "gpt-4.1-mini"
      });
    expect(JSON.parse((fetcher.mock.calls[1] as [string, RequestInit])[1].body as string))
      .toMatchObject({
        model: "gpt-4.1-nano"
      });
    await expect(readJson(response)).resolves.toMatchObject({
      model: "gpt-4.1-nano"
    });
  });

  it("retries a retryable provider failure on the same target before succeeding", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "rate limited"
            }
          }),
          {
            status: 429,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "chatcmpl_retry",
            object: "chat.completion",
            created: 1,
            model: "gpt-4.1-mini",
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: "retry recovered"
                }
              }
            ]
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      );

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_PROVIDER_MAX_RETRIES: "1",
        AIRLOCK_PROVIDER_RETRY_BACKOFF_MS: "10"
      }
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse((fetcher.mock.calls[0] as [string, RequestInit])[1].body as string))
      .toMatchObject({
        model: "gpt-4.1-mini"
      });
    expect(JSON.parse((fetcher.mock.calls[1] as [string, RequestInit])[1].body as string))
      .toMatchObject({
        model: "gpt-4.1-mini"
      });
    await expect(readJson(response)).resolves.toMatchObject({
      model: "gpt-4.1-mini"
    });
  });

  it("fails over only after same-target retries are exhausted", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "rate limited"
            }
          }),
          {
            status: 429,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "still rate limited"
            }
          }),
          {
            status: 429,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "chatcmpl_fallback",
            object: "chat.completion",
            created: 1,
            model: "gpt-4.1-nano",
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: "fallback hello"
                }
              }
            ]
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      );

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_PROVIDER_MAX_RETRIES: "1",
        AIRLOCK_PROVIDER_RETRY_BACKOFF_MS: "10",
        AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
          "gpt-4.1-mini": ["openai:gpt-4.1-nano"]
        })
      }
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(JSON.parse((fetcher.mock.calls[0] as [string, RequestInit])[1].body as string))
      .toMatchObject({
        model: "gpt-4.1-mini"
      });
    expect(JSON.parse((fetcher.mock.calls[1] as [string, RequestInit])[1].body as string))
      .toMatchObject({
        model: "gpt-4.1-mini"
      });
    expect(JSON.parse((fetcher.mock.calls[2] as [string, RequestInit])[1].body as string))
      .toMatchObject({
        model: "gpt-4.1-nano"
      });
    await expect(readJson(response)).resolves.toMatchObject({
      model: "gpt-4.1-nano"
    });
  });

  it("does not fail over on non-retryable upstream errors", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: "bad request"
          }
        }),
        {
          status: 400,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
          "gpt-4.1-mini": ["openai:gpt-4.1-nano"]
        })
      }
    );

    expect(response.status).toBe(400);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fails over when the primary provider attempt times out", async () => {
    const fetcher = vi
      .fn()
      .mockImplementationOnce(async (_input, init?: RequestInit) => {
        const signal = init?.signal;

        return await new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      })
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "chatcmpl_fallback",
            object: "chat.completion",
            created: 1,
            model: "gpt-4.1-nano",
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: "fallback hello"
                }
              }
            ]
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      );

    const app = createApp({ fetcher });

    const nowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(10);

    try {
      const response = await app.request(
        "http://localhost/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer gateway-secret"
          },
          body: JSON.stringify({
            model: "gpt-4.1-mini",
            stream: false,
            messages: [{ role: "user", content: "hi" }]
          })
        },
        {
          ...createBindings(),
          AIRLOCK_PROVIDER_TIMEOUT_MS: "50",
          AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
            "gpt-4.1-mini": ["openai:gpt-4.1-nano"]
          })
        }
      );

      expect(response.status).toBe(200);
      expect(fetcher).toHaveBeenCalledTimes(2);
      await expect(readJson(response)).resolves.toMatchObject({
        model: "gpt-4.1-nano"
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("returns timeout instead of issuing another fallback call when the shared timeout budget is exhausted", async () => {
    const fetcher = vi
      .fn()
      .mockImplementationOnce(async (_input, init?: RequestInit) => {
        const signal = init?.signal;

        return await new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      });

    const app = createApp({ fetcher });

    const nowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(5);

    try {
      const response = await app.request(
        "http://localhost/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer gateway-secret"
          },
          body: JSON.stringify({
            model: "gpt-4.1-mini",
            stream: false,
            messages: [{ role: "user", content: "hi" }]
          })
        },
        {
          ...createBindings(),
          AIRLOCK_PROVIDER_TIMEOUT_MS: "1",
          AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
            "gpt-4.1-mini": ["openai:gpt-4.1-nano", "openai:gpt-4.1-micro"]
          })
        }
      );

      expect(response.status).toBe(504);
      expect(fetcher).toHaveBeenCalledTimes(1);
      await expect(readJson(response)).resolves.toMatchObject({
        error: {
          code: "provider_timeout",
          type: "provider"
        }
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("fails over across providers when an unshaped route has a retryable primary failure", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "rate limited"
            }
          }),
          {
            status: 429,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "msg_123",
            type: "message",
            role: "assistant",
            model: "claude-haiku-4-5",
            stop_reason: "end_turn",
            content: [
              {
                type: "text",
                text: "fallback hello"
              }
            ]
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      );

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "assistant-default",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_MODEL_ALIASES:
          "assistant-default=openai:gpt-4.1-mini,claude-haiku-4-5=anthropic:claude-haiku-4-5",
        AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
          "assistant-default": ["anthropic:claude-haiku-4-5"]
        })
      }
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(fetcher.mock.calls[1]?.[0]).toBe("https://api.anthropic.com/v1/messages");
    await expect(readJson(response)).resolves.toMatchObject({
      model: "claude-haiku-4-5"
    });
  });

  it("returns the primary upstream error when every later fallback target is filtered out by key policy", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            message: "rate limited"
          }
        }),
        {
          status: 429,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "assistant-default",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              allowedProviders: ["openai"]
            }
          }
        ]),
        AIRLOCK_MODEL_ALIASES:
          "assistant-default=openai:gpt-4.1-mini,claude-haiku-4-5=anthropic:claude-haiku-4-5",
        AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
          "assistant-default": ["anthropic:claude-haiku-4-5"]
        })
      }
    );

    expect(response.status).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "provider_upstream_error",
        type: "provider"
      }
    });
  });

  it("routes directly to the first provider-allowed fallback target without calling a disallowed primary target", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "chatcmpl_123",
          object: "chat.completion",
          created: 1,
          model: "gpt-4.1-mini",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "hello from openai"
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "assistant-default",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
          {
            id: "key_1",
            label: "Gateway Key 1",
            value: "gateway-secret",
            status: "active",
            policy: {
              allowedProviders: ["openai"]
            }
          }
        ]),
        AIRLOCK_MODEL_ALIASES:
          "assistant-default=anthropic:claude-sonnet-4-5,gpt-4.1-mini=openai:gpt-4.1-mini",
        AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
          "assistant-default": ["openai:gpt-4.1-mini"]
        })
      }
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    await expect(readJson(response)).resolves.toMatchObject({
      model: "gpt-4.1-mini"
    });
  });

  it("can start from a weighted fallback target before the configured primary target", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5",
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: "hello from anthropic"
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "assistant-default",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_MODEL_ALIASES:
          "assistant-default=openai:gpt-4.1-mini,claude-haiku-4-5=anthropic:claude-haiku-4-5",
        AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
          "assistant-default": ["anthropic:claude-haiku-4-5"]
        }),
        AIRLOCK_MODEL_TARGET_SELECTION: JSON.stringify({
          "assistant-default": {
            strategy: "weighted",
            weights: {
              "openai:gpt-4.1-mini": 1,
              "anthropic:claude-haiku-4-5": 10000
            }
          }
        })
      }
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/messages");
    await expect(readJson(response)).resolves.toMatchObject({
      model: "claude-haiku-4-5"
    });
  });

  it("can start from a lower-cost fallback target before the configured primary target", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5",
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: "hello from anthropic"
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "assistant-default",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_MODEL_ALIASES:
          "assistant-default=openai:gpt-4.1-mini,claude-haiku-4-5=anthropic:claude-haiku-4-5",
        AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
          "assistant-default": ["anthropic:claude-haiku-4-5"]
        }),
        AIRLOCK_MODEL_TARGET_SELECTION: JSON.stringify({
          "assistant-default": {
            strategy: "lowest_cost",
            costs: {
              "openai:gpt-4.1-mini": 10,
              "anthropic:claude-haiku-4-5": 3
            }
          }
        })
      }
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/messages");
    await expect(readJson(response)).resolves.toMatchObject({
      model: "claude-haiku-4-5"
    });
  });

  it("streams openai chat completion chunks and terminates with done", async () => {
    const encoder = new TextEncoder();
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                [
                  'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
                  'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"content":"hel"},"finish_reason":null}]}\n\n',
                  'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":null}]}\n\n',
                  'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
                  "data: [DONE]\n\n"
                ].join("")
              )
            );
            controller.close();
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "text/event-stream"
          }
        }
      )
    );

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: true,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      createBindings()
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    await expect(readText(response)).resolves.toContain("data: [DONE]");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns not ready when a shaped route configures cross-provider fallback", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_MODEL_ALIASES: "assistant-default=openai:gpt-4.1-mini",
      AIRLOCK_MODEL_SHAPING: JSON.stringify({
        "assistant-default": {
          headers: {
            "openai-beta": "responses=v1"
          }
        }
      }),
      AIRLOCK_MODEL_FALLBACKS: JSON.stringify({
        "assistant-default": ["anthropic:claude-haiku-4-5"]
      })
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("returns not ready when target selection references a target outside the route chain", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request("http://localhost/readyz", undefined, {
      ...createBindings(),
      AIRLOCK_MODEL_ALIASES: "assistant-default=openai:gpt-4.1-mini",
      AIRLOCK_MODEL_TARGET_SELECTION: JSON.stringify({
        "assistant-default": {
          strategy: "weighted",
          weights: {
            "anthropic:claude-haiku-4-5": 1
          }
        }
      })
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      ready: false
    });
  });

  it("routes authorized chat completions requests to Gemini when configured", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          responseId: "gemini-response-123",
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    text: "hello from gemini"
                  }
                ]
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gemini-2.5-flash",
          stream: false,
          messages: [{ role: "user", content: "hi" }]
        })
      },
      {
        ...createBindings(),
        GEMINI_API_KEY: "gemini-secret",
        GEMINI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
        AIRLOCK_MODEL_ALIASES:
          "gpt-4.1-mini=openai:gpt-4.1-mini,claude-sonnet-4-5=anthropic:claude-sonnet-4-5,gemini-2.5-flash=gemini:gemini-2.5-flash"
      }
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    );
    expect(init.headers).toMatchObject({
      "x-goog-api-key": "gemini-secret"
    });
    expect(JSON.parse(init.body as string)).toEqual({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: "hi"
            }
          ]
        }
      ]
    });
    await expect(readJson(response)).resolves.toMatchObject({
      object: "chat.completion",
      model: "gemini-2.5-flash"
    });
  });

  it("returns an OpenAI-compatible responses payload when authorized", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl_123",
          object: "chat.completion",
          created: 1,
          model: "gpt-4.1-mini",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "hello there"
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/responses",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          input: "hi",
          stream: false
        })
      },
      createBindings()
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toMatchObject({
      object: "response",
      model: "gpt-4.1-mini",
      output_text: "hello there"
    });
  });

  it("applies request-scoped shaping to responses requests", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl_123",
          object: "chat.completion",
          created: 1,
          model: "gpt-4.1-mini",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "hello there"
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/responses",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          input: "hi",
          stream: false,
          airlock: {
            requestShaping: {
              query: {
                "api-version": "2025-01-01"
              },
              jsonBody: {
                temperature: 0.2
              }
            }
          }
        })
      },
      createBindings()
    );

    expect(response.status).toBe(200);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(url).toBe(
      "https://api.openai.com/v1/chat/completions?api-version=2025-01-01"
    );
    expect(JSON.parse(init.body as string)).toEqual({
      model: "gpt-4.1-mini",
      stream: false,
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.2
    });
  });

  it("returns an Anthropic-compatible messages payload when authorized", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-5",
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: "hello there"
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/messages",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 256,
          messages: [
            {
              role: "user",
              content: "hi"
            }
          ]
        })
      },
      {
        ...createBindings(),
        AIRLOCK_MODEL_SHAPING: JSON.stringify({
          "claude-sonnet-4-5": {
            headers: {
              "anthropic-beta": "tools-2024-04-04"
            },
            query: {
              trace: "1"
            },
            jsonBody: {
              metadata: {
                source: "airlock"
              }
            }
          }
        })
      }
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://api.anthropic.com/v1/messages?trace=1");
    expect(init.headers).toMatchObject({
      "anthropic-beta": "tools-2024-04-04"
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model: "claude-sonnet-4-5",
      max_tokens: 256,
      metadata: {
        source: "airlock"
      },
      messages: [{ role: "user", content: "hi" }]
    });
    await expect(readJson(response)).resolves.toMatchObject({
      type: "message",
      role: "assistant",
      content: [
        {
          type: "text",
          text: "hello there"
        }
      ]
    });
  });

  it("applies request-scoped shaping to anthropic messages requests", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-5",
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: "hello there"
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const app = createApp({ fetcher });

    const response = await app.request(
      "http://localhost/v1/messages",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 256,
          system: "You are precise.",
          messages: [
            {
              role: "user",
              content: "hi"
            }
          ],
          airlock: {
            requestShaping: {
              headers: {
                "anthropic-beta": "prompt-caching-2024-07-31"
              },
              query: {
                trace: "1"
              },
              jsonBody: {
                metadata: {
                  source: "request"
                }
              }
            }
          }
        })
      },
      createBindings()
    );

    expect(response.status).toBe(200);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://api.anthropic.com/v1/messages?trace=1");
    expect(init.headers).toMatchObject({
      "anthropic-beta": "prompt-caching-2024-07-31"
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model: "claude-sonnet-4-5",
      max_tokens: 256,
      system: "You are precise.",
      metadata: {
        source: "request"
      },
      messages: [{ role: "user", content: "hi" }]
    });
  });

  it("rejects reserved request-scoped shaping headers as a request error", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-secret"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          stream: false,
          messages: [{ role: "user", content: "hi" }],
          airlock: {
            requestShaping: {
              headers: {
                authorization: "Bearer override"
              }
            }
          }
        })
      },
      createBindings()
    );

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "request_invalid_request_shaping",
        type: "request"
      }
    });
  });

  it("returns an Anthropic-compatible error payload for unauthorized /v1/messages", async () => {
    const app = createApp({ fetcher: vi.fn() });

    const response = await app.request(
      "http://localhost/v1/messages",
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 256,
          messages: [
            {
              role: "user",
              content: "hi"
            }
          ]
        })
      },
      createBindings()
    );

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toMatchObject({
      type: "error",
      error: {
        type: "authentication",
        message: "Unauthorized"
      }
    });
    expect(response.headers.get("request-id")).toBeTruthy();
  });
});
