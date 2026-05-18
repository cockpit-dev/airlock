import { describe, expect, it, beforeEach } from "vitest";

import {
  resetConfigCache,
  resetDashboardOverlayCache,
  resolveGatewayConfig,
  resolveGatewayConfigWithOverlay
} from "./config.js";
import type { GatewayBindings } from "./env.js";

function createBindings(
  overrides: Partial<GatewayBindings> = {}
): GatewayBindings {
  return {
    AIRLOCK_MODE: "free",
    AIRLOCK_TELEMETRY_SUCCESS_SAMPLE_RATE_FREE: 0.1,
    AIRLOCK_TELEMETRY_SUCCESS_SAMPLE_RATE_SCALE: 1,
    AIRLOCK_GATEWAY_API_KEYS: "gateway-secret",
    AIRLOCK_PROVIDER_TIMEOUT_MS: 30_000,
    AIRLOCK_PROVIDER_MAX_RETRIES: 0,
    AIRLOCK_PROVIDER_RETRY_BACKOFF_MS: 0,
    AIRLOCK_PROVIDER_STREAM_IDLE_TIMEOUT_MS: 15_000,
    AIRLOCK_MAX_REQUEST_BODY_BYTES: 10_485_760,
    AIRLOCK_PROVIDER_CIRCUIT_BREAKER_THRESHOLD: 3,
    AIRLOCK_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS: 30_000,
    AIRLOCK_PROVIDER_CIRCUIT_BREAKER_PERSISTENT: false,
    AIRLOCK_ROUTING_LATENCY_FRESHNESS_MS: 30_000,
    AIRLOCK_ROUTING_COST_FRESHNESS_MS: 30_000,
    AIRLOCK_ROUTING_FAILURE_FRESHNESS_MS: 30_000,
    AIRLOCK_ROUTING_RECOVERY_WINDOW_MS: 30_000,
    AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: false,
    AIRLOCK_INTERNAL_ADMIN_ACTOR_REQUIRED: false,
    AIRLOCK_REQUEST_LOGGING: false,
    OPENAI_API_KEY: "openai-secret",
    OPENAI_BASE_URL: "https://api.openai.com/v1",
    OPENAI_DEFAULT_MODEL: "gpt-4.1-mini",
    ...overrides
  };
}

beforeEach(() => {
  resetConfigCache();
  resetDashboardOverlayCache();
});

describe("resolveGatewayConfig", () => {
  describe("basic config resolution", () => {
    it("resolves minimal config with required fields only", () => {
      const config = resolveGatewayConfig(createBindings());
      expect(config.mode).toBe("free");
      expect(config.openAI?.apiKey).toBe("openai-secret");
      expect(config.openAI?.baseUrl).toBe("https://api.openai.com/v1");
      expect(config.openAI?.defaultModel).toBe("gpt-4.1-mini");
      expect(config.providerTimeoutMs).toBe(30_000);
      expect(config.modelGroups).toEqual({});
      expect(config.gatewayApiKeys).toHaveLength(1);
      expect(config.requestSigningSecrets ?? {}).toEqual({});
      expect(config.anthropic).toBeUndefined();
      expect(config.gemini).toBeUndefined();
      expect(config.ipRateLimitPolicy).toBeUndefined();
    });

    it("resolves scale mode", () => {
      const config = resolveGatewayConfig(
        createBindings({ AIRLOCK_MODE: "scale" })
      );
      expect(config.mode).toBe("scale");
    });
  });

  describe("config caching", () => {
    it("returns the same object on repeated calls with identical bindings", () => {
      const bindings = createBindings();
      const first = resolveGatewayConfig(bindings);
      const second = resolveGatewayConfig(bindings);
      expect(first).toBe(second);
    });

    it("returns a new object after resetConfigCache", () => {
      const bindings = createBindings();
      const first = resolveGatewayConfig(bindings);
      resetConfigCache();
      const second = resolveGatewayConfig(bindings);
      expect(first).not.toBe(second);
      expect(first).toEqual(second);
    });

    it("returns a new object when bindings change", () => {
      const first = resolveGatewayConfig(createBindings());
      const second = resolveGatewayConfig(
        createBindings({ AIRLOCK_MODE: "scale" })
      );
      expect(first).not.toBe(second);
      expect(first.mode).toBe("free");
      expect(second.mode).toBe("scale");
    });
  });

  describe("model groups", () => {
    it("parses valid model groups", () => {
      const config = resolveGatewayConfig(
        createBindings({
          AIRLOCK_MODEL_GROUPS: JSON.stringify({
            fast: ["gpt-4.1-mini"],
            smart: ["gpt-4.1"]
          }),
          AIRLOCK_MODEL_ALIASES: "gpt-4.1-mini=gpt-4.1-mini,gpt-4.1=gpt-4.1"
        })
      );
      expect(config.modelGroups).toEqual({
        fast: ["gpt-4.1-mini"],
        smart: ["gpt-4.1"]
      });
    });

    it("returns empty object when no model groups configured", () => {
      const config = resolveGatewayConfig(createBindings());
      expect(config.modelGroups).toEqual({});
    });

    it("rejects malformed JSON", () => {
      expect(() =>
        resolveGatewayConfig(
          createBindings({ AIRLOCK_MODEL_GROUPS: "{not-json" })
        )
      ).toThrow("Model group config must be valid JSON");
    });

    it("rejects non-object JSON", () => {
      expect(() =>
        resolveGatewayConfig(createBindings({ AIRLOCK_MODEL_GROUPS: "[]" }))
      ).toThrow("Model group config must be a JSON object");
    });

    it("rejects empty group names", () => {
      expect(() =>
        resolveGatewayConfig(
          createBindings({
            AIRLOCK_MODEL_GROUPS: JSON.stringify({ "": ["model"] })
          })
        )
      ).toThrow("Model group names must be non-empty");
    });

    it("rejects non-array group members", () => {
      expect(() =>
        resolveGatewayConfig(
          createBindings({
            AIRLOCK_MODEL_GROUPS: JSON.stringify({ fast: "model" })
          })
        )
      ).toThrow("Model group members must be arrays");
    });

    it("rejects non-string group members", () => {
      expect(() =>
        resolveGatewayConfig(
          createBindings({
            AIRLOCK_MODEL_GROUPS: JSON.stringify({ fast: [123] })
          })
        )
      ).toThrow("Model group members must be non-empty strings");
    });

    it("rejects duplicate group members", () => {
      expect(() =>
        resolveGatewayConfig(
          createBindings({
            AIRLOCK_MODEL_GROUPS: JSON.stringify({
              fast: ["model", "model"]
            })
          })
        )
      ).toThrow("Model group members must be unique within a group");
    });

    it("rejects group referencing unknown external model", () => {
      expect(() =>
        resolveGatewayConfig(
          createBindings({
            AIRLOCK_MODEL_GROUPS: JSON.stringify({
              fast: ["nonexistent-model"]
            }),
            AIRLOCK_MODEL_ALIASES: "gpt-4.1-mini=gpt-4.1-mini"
          })
        )
      ).toThrow("Model group references an unknown external model");
    });

    it("rejects key policy referencing unknown model group", () => {
      expect(() =>
        resolveGatewayConfig(
          createBindings({
            AIRLOCK_GATEWAY_API_KEYS: JSON.stringify([
              {
                id: "key-1",
                label: "Test Key",
                value: "secret",
                status: "active",
                policy: { allowedModelGroups: ["nonexistent-group"] }
              }
            ]),
            AIRLOCK_MODEL_GROUPS: JSON.stringify({
              fast: ["gpt-4.1-mini"]
            }),
            AIRLOCK_MODEL_ALIASES: "gpt-4.1-mini=gpt-4.1-mini"
          })
        )
      ).toThrow("Gateway API key policy references an unknown model group");
    });
  });

  describe("request signing secrets", () => {
    it("parses valid signing secrets", () => {
      const config = resolveGatewayConfig(
        createBindings({
          AIRLOCK_REQUEST_SIGNING_SECRETS: JSON.stringify({
            "my-key": "my-secret-value"
          })
        })
      );
      expect(config.requestSigningSecrets).toEqual({
        "my-key": "my-secret-value"
      });
    });

    it("returns empty object when no secrets configured", () => {
      const config = resolveGatewayConfig(createBindings());
      expect(config.requestSigningSecrets).toBeUndefined();
    });

    it("rejects malformed JSON", () => {
      expect(() =>
        resolveGatewayConfig(
          createBindings({
            AIRLOCK_REQUEST_SIGNING_SECRETS: "{not-json"
          })
        )
      ).toThrow("Request signing secrets config must be valid JSON");
    });

    it("rejects non-object JSON", () => {
      expect(() =>
        resolveGatewayConfig(
          createBindings({
            AIRLOCK_REQUEST_SIGNING_SECRETS: "[]"
          })
        )
      ).toThrow("Request signing secrets config must be a JSON object");
    });

    it("rejects empty key names", () => {
      expect(() =>
        resolveGatewayConfig(
          createBindings({
            AIRLOCK_REQUEST_SIGNING_SECRETS: JSON.stringify({
              "": "secret-value"
            })
          })
        )
      ).toThrow("Request signing secret keys must be non-empty strings");
    });

    it("rejects non-string values", () => {
      expect(() =>
        resolveGatewayConfig(
          createBindings({
            AIRLOCK_REQUEST_SIGNING_SECRETS: JSON.stringify({
              "my-key": 123
            })
          })
        )
      ).toThrow("Request signing secret values must be non-empty strings");
    });

    it("rejects empty string values", () => {
      expect(() =>
        resolveGatewayConfig(
          createBindings({
            AIRLOCK_REQUEST_SIGNING_SECRETS: JSON.stringify({
              "my-key": ""
            })
          })
        )
      ).toThrow("Request signing secret values must be non-empty strings");
    });
  });

  describe("IP rate limit policy", () => {
    it("parses valid IP rate limit policy", () => {
      const namespace = {
        idFromName: (name: string) => name,
        get: (_id: unknown) => ({
          fetch: () => Promise.resolve(new Response())
        })
      };
      const config = resolveGatewayConfig(
        createBindings({
          AIRLOCK_IP_RATE_LIMIT_POLICY: JSON.stringify({
            limit: 100,
            windowSeconds: 60
          }),
          AIRLOCK_IP_RATE_LIMIT: namespace
        })
      );
      expect(config.ipRateLimitPolicy).toEqual({
        limit: 100,
        windowSeconds: 60
      });
    });

    it("omits ipRateLimitPolicy when not configured", () => {
      const config = resolveGatewayConfig(createBindings());
      expect(config.ipRateLimitPolicy).toBeUndefined();
    });

    it("rejects malformed JSON", () => {
      expect(() =>
        resolveGatewayConfig(
          createBindings({
            AIRLOCK_IP_RATE_LIMIT_POLICY: "{not-json"
          })
        )
      ).toThrow("IP rate limit policy must be valid JSON");
    });

    it("rejects invalid policy values", () => {
      expect(() =>
        resolveGatewayConfig(
          createBindings({
            AIRLOCK_IP_RATE_LIMIT_POLICY: JSON.stringify({
              limit: -1,
              windowSeconds: 60
            })
          })
        )
      ).toThrow("IP rate limit policy is invalid");
    });

    it("rejects policy without DO binding", () => {
      expect(() =>
        resolveGatewayConfig(
          createBindings({
            AIRLOCK_IP_RATE_LIMIT_POLICY: JSON.stringify({
              limit: 100,
              windowSeconds: 60
            })
          })
        )
      ).toThrow(
        "IP rate limit Durable Object binding is required when policy is configured"
      );
    });
  });

  describe("provider configuration", () => {
    it("resolves anthropic config when anthropic routes exist", () => {
      const config = resolveGatewayConfig(
        createBindings({
          AIRLOCK_MODEL_ALIASES:
            "gpt-4.1-mini=gpt-4.1-mini,claude-4=anthropic:claude-sonnet-4-20250514",
          ANTHROPIC_API_KEY: "anthropic-secret",
          ANTHROPIC_BASE_URL: "https://api.anthropic.com",
          ANTHROPIC_DEFAULT_MAX_TOKENS: 4096
        })
      );
      expect(config.anthropic).toEqual({
        apiKey: "anthropic-secret",
        baseUrl: "https://api.anthropic.com",
        defaultMaxTokens: 4096
      });
    });

    it("rejects anthropic routes without anthropic config", () => {
      expect(() =>
        resolveGatewayConfig(
          createBindings({
            AIRLOCK_MODEL_ALIASES:
              "gpt-4.1-mini=gpt-4.1-mini,claude-4=anthropic:claude-sonnet-4-20250514"
          })
        )
      ).toThrow("Anthropic configuration is required");
    });

    it("resolves gemini config when gemini routes exist", () => {
      const config = resolveGatewayConfig(
        createBindings({
          AIRLOCK_MODEL_ALIASES:
            "gpt-4.1-mini=gpt-4.1-mini,gemini-2.5-flash=gemini:gemini-2.5-flash",
          GEMINI_API_KEY: "gemini-secret",
          GEMINI_BASE_URL: "https://generativelanguage.googleapis.com"
        })
      );
      expect(config.gemini).toEqual({
        apiKey: "gemini-secret",
        baseUrl: "https://generativelanguage.googleapis.com"
      });
    });

    it("rejects gemini routes without gemini config", () => {
      expect(() =>
        resolveGatewayConfig(
          createBindings({
            AIRLOCK_MODEL_ALIASES:
              "gpt-4.1-mini=gpt-4.1-mini,gemini-2.5-flash=gemini:gemini-2.5-flash"
          })
        )
      ).toThrow("Gemini configuration is required");
    });

    it("omits anthropic config when no anthropic routes exist", () => {
      const config = resolveGatewayConfig(createBindings());
      expect(config.anthropic).toBeUndefined();
    });

    it("omits gemini config when no gemini routes exist", () => {
      const config = resolveGatewayConfig(createBindings());
      expect(config.gemini).toBeUndefined();
    });
  });

  describe("binding validation", () => {
    it("rejects registry enabled without registry binding", () => {
      expect(() =>
        resolveGatewayConfig(
          createBindings({
            AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: true
          })
        )
      ).toThrow("Gateway key registry binding is required");
    });

    it("rejects internal admin token without revocation binding", () => {
      expect(() =>
        resolveGatewayConfig(
          createBindings({
            AIRLOCK_INTERNAL_ADMIN_TOKEN: "admin-token"
          })
        )
      ).toThrow("Gateway key revocation binding is required");
    });

    it("rejects persistent circuit breaker without binding", () => {
      expect(() =>
        resolveGatewayConfig(
          createBindings({
            AIRLOCK_PROVIDER_CIRCUIT_BREAKER_PERSISTENT: true
          })
        )
      ).toThrow("Provider circuit breaker binding is required");
    });
  });
});

function createConfigStoreNamespace(snapshot: Record<string, unknown>) {
  return {
    idFromName: () => "global",
    get: () => ({
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify(snapshot), {
            headers: { "Content-Type": "application/json" }
          })
        )
    })
  };
}

describe("resolveGatewayConfigWithOverlay", () => {
  it("returns base config when no DO binding", async () => {
    const config = await resolveGatewayConfigWithOverlay(createBindings());
    expect(config.openAI?.apiKey).toBe("openai-secret");
    expect(config.anthropic).toBeUndefined();
    expect(config.gemini).toBeUndefined();
  });

  it("returns base config when DO snapshot has empty sections", async () => {
    const namespace = createConfigStoreNamespace({
      sections: {},
      globalVersion: 0
    });
    const config = await resolveGatewayConfigWithOverlay(
      createBindings({ AIRLOCK_CONFIG_STORE: namespace })
    );
    expect(config.openAI?.apiKey).toBe("openai-secret");
  });

  it("merges provider config from DO overlay", async () => {
    const namespace = createConfigStoreNamespace({
      sections: {
        providers: {
          data: {
            openai: {
              apiKey: "do-openai-key",
              baseUrl: "https://custom.openai.com/v1"
            }
          },
          updatedAt: Date.now(),
          updatedBy: "admin",
          version: 1
        }
      },
      globalVersion: 1
    });
    const config = await resolveGatewayConfigWithOverlay(
      createBindings({ AIRLOCK_CONFIG_STORE: namespace })
    );
    expect(config.openAI?.apiKey).toBe("do-openai-key");
    expect(config.openAI?.baseUrl).toBe("https://custom.openai.com/v1");
    expect(config.openAI?.defaultModel).toBe("gpt-4.1-mini");
  });

  it("resolves anthropic config from DO when env vars missing", async () => {
    const namespace = createConfigStoreNamespace({
      sections: {
        providers: {
          data: {
            anthropic: {
              apiKey: "do-anthropic-key",
              baseUrl: "https://api.anthropic.com",
              defaultMaxTokens: 8192
            }
          },
          updatedAt: Date.now(),
          updatedBy: "admin",
          version: 1
        }
      },
      globalVersion: 1
    });
    const config = await resolveGatewayConfigWithOverlay(
      createBindings({
        AIRLOCK_CONFIG_STORE: namespace,
        AIRLOCK_MODEL_ALIASES:
          "gpt-4.1-mini=gpt-4.1-mini,claude=anthropic:claude-sonnet-4-20250514"
      })
    );
    expect(config.anthropic).toEqual({
      apiKey: "do-anthropic-key",
      baseUrl: "https://api.anthropic.com",
      defaultMaxTokens: 8192
    });
  });

  it("throws post-merge validation when provider missing from both env and DO", async () => {
    const namespace = createConfigStoreNamespace({
      sections: {},
      globalVersion: 0
    });
    await expect(
      resolveGatewayConfigWithOverlay(
        createBindings({
          AIRLOCK_CONFIG_STORE: namespace,
          AIRLOCK_MODEL_ALIASES:
            "gpt-4.1-mini=gpt-4.1-mini,claude=anthropic:claude-sonnet-4-20250514"
        })
      )
    ).rejects.toThrow("Anthropic configuration is required");
  });

  it("merges limits config from DO overlay", async () => {
    const namespace = createConfigStoreNamespace({
      sections: {
        limits: {
          data: {
            providerTimeoutMs: 60_000,
            providerMaxRetries: 3
          },
          updatedAt: Date.now(),
          updatedBy: "admin",
          version: 1
        }
      },
      globalVersion: 1
    });
    const config = await resolveGatewayConfigWithOverlay(
      createBindings({ AIRLOCK_CONFIG_STORE: namespace })
    );
    expect(config.providerTimeoutMs).toBe(60_000);
    expect(config.providerMaxRetries).toBe(3);
  });

  it("supports bootstrap-minimal startup when dashboard overlay provides business config", async () => {
    const namespace = createConfigStoreNamespace({
      sections: {
        providers: {
          data: {
            openai: {
              apiKey: "do-openai-key",
              baseUrl: "https://api.openai.com/v1",
              defaultModel: "gpt-4.1-mini"
            }
          },
          updatedAt: Date.now(),
          updatedBy: "admin",
          version: 1
        },
        routes: {
          data: [
            {
              externalModel: "openai/gpt-4.1-mini",
              target: {
                provider: "openai",
                providerModel: "gpt-4.1-mini"
              }
            }
          ],
          updatedAt: Date.now(),
          updatedBy: "admin",
          version: 1
        },
        key_policies: {
          data: {
            "openai/gpt-4.1-mini": {
              requiredKeyTier: "default"
            }
          },
          updatedAt: Date.now(),
          updatedBy: "admin",
          version: 1
        }
      },
      globalVersion: 3
    });

    const registryNamespace = {
      idFromName: (name: string) => name,
      get: (_id: unknown) => ({
        fetch: () => Promise.resolve(new Response())
      })
    };

    const config = await resolveGatewayConfigWithOverlay(
      createBindings({
        AIRLOCK_CONFIG_STORE: namespace,
        AIRLOCK_GATEWAY_API_KEYS: undefined,
        OPENAI_API_KEY: undefined,
        OPENAI_BASE_URL: undefined,
        OPENAI_DEFAULT_MODEL: undefined,
        AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: true,
        AIRLOCK_GATEWAY_KEY_REGISTRY: registryNamespace
      })
    );

    expect(config.openAI?.apiKey).toBe("do-openai-key");
    expect(config.gatewayApiKeys).toHaveLength(0);
    expect(config.modelAliases).toHaveLength(1);
    expect(config.modelAliases[0]?.externalModel).toBe("openai/gpt-4.1-mini");
    expect(config.modelAliases[0]?.requiredKeyTier).toBe("default");
  });

  it("supports bootstrap-minimal startup with registry-only caller auth", async () => {
    const namespace = createConfigStoreNamespace({
      sections: {
        providers: {
          data: {
            openai: {
              apiKey: "do-openai-key",
              baseUrl: "https://api.openai.com/v1",
              defaultModel: "gpt-4.1-mini"
            }
          },
          updatedAt: Date.now(),
          updatedBy: "admin",
          version: 1
        },
        routes: {
          data: [
            {
              externalModel: "openai/gpt-4.1-mini",
              target: {
                provider: "openai",
                providerModel: "gpt-4.1-mini"
              }
            }
          ],
          updatedAt: Date.now(),
          updatedBy: "admin",
          version: 1
        }
      },
      globalVersion: 2
    });

    const registryNamespace = {
      idFromName: (name: string) => name,
      get: (_id: unknown) => ({
        fetch: () => Promise.resolve(new Response())
      })
    };

    const config = await resolveGatewayConfigWithOverlay(
      createBindings({
        AIRLOCK_CONFIG_STORE: namespace,
        AIRLOCK_GATEWAY_API_KEYS: undefined,
        OPENAI_API_KEY: undefined,
        OPENAI_BASE_URL: undefined,
        OPENAI_DEFAULT_MODEL: undefined,
        AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: true,
        AIRLOCK_GATEWAY_KEY_REGISTRY: registryNamespace
      })
    );

    expect(config.gatewayApiKeys).toEqual([]);
    expect(config.gatewayKeyRegistryEnabled).toBe(true);
    expect(config.modelAliases).toHaveLength(1);
    expect(config.openAI?.apiKey).toBe("do-openai-key");
  });

  it("merges route config from DO overlay", async () => {
    const namespace = createConfigStoreNamespace({
      sections: {
        routes: {
          data: [
            {
              externalModel: "anthropic/claude-sonnet-4-5",
              target: {
                provider: "anthropic",
                providerModel: "claude-sonnet-4-5"
              },
              fallbacks: [
                {
                  provider: "openai",
                  providerModel: "gpt-4.1-mini"
                }
              ],
              requiredKeyTier: "premium",
              requiredKeyTags: ["internal"],
              strategy: "health_priority"
            }
          ],
          updatedAt: Date.now(),
          updatedBy: "admin",
          version: 1
        },
        providers: {
          data: {
            anthropic: {
              apiKey: "do-anthropic-key",
              baseUrl: "https://api.anthropic.com",
              defaultMaxTokens: 4096
            }
          },
          updatedAt: Date.now(),
          updatedBy: "admin",
          version: 1
        }
      },
      globalVersion: 2
    });

    const config = await resolveGatewayConfigWithOverlay(
      createBindings({
        AIRLOCK_CONFIG_STORE: namespace,
        AIRLOCK_MODEL_ALIASES: undefined
      })
    );

    expect(config.modelAliases).toHaveLength(1);
    expect(config.modelAliases[0]?.externalModel).toBe(
      "anthropic/claude-sonnet-4-5"
    );
    expect(config.modelAliases[0]?.fallbacks).toEqual([
      { provider: "openai", providerModel: "gpt-4.1-mini" }
    ]);
    expect(config.modelAliases[0]?.requiredKeyTier).toBe("premium");
    expect(config.modelAliases[0]?.requiredKeyTags).toEqual(["internal"]);
    expect(config.modelAliases[0]?.targetSelection?.strategy).toBe(
      "health_priority"
    );
  });

  it("applies key policy overlays onto routes without replacing gateway keys", async () => {
    const namespace = createConfigStoreNamespace({
      sections: {
        key_policies: {
          data: {
            "openai/gpt-4.1-mini": {
              requiredKeyTier: "premium",
              requiredKeyTags: ["internal"]
            }
          },
          updatedAt: Date.now(),
          updatedBy: "admin",
          version: 1
        }
      },
      globalVersion: 1
    });

    const config = await resolveGatewayConfigWithOverlay(
      createBindings({
        AIRLOCK_CONFIG_STORE: namespace,
        AIRLOCK_MODEL_ALIASES: "openai/gpt-4.1-mini=openai:gpt-4.1-mini"
      })
    );

    expect(config.gatewayApiKeys).toHaveLength(1);
    expect(config.modelAliases[0]?.requiredKeyTier).toBe("premium");
    expect(config.modelAliases[0]?.requiredKeyTags).toEqual(["internal"]);
  });

  it("merges feature config from DO overlay", async () => {
    const namespace = createConfigStoreNamespace({
      sections: {
        features: {
          data: {
            requestLogging: true,
            corsOrigins: "https://admin.example.com"
          },
          updatedAt: Date.now(),
          updatedBy: "admin",
          version: 1
        }
      },
      globalVersion: 1
    });

    const config = await resolveGatewayConfigWithOverlay(
      createBindings({
        AIRLOCK_CONFIG_STORE: namespace,
        AIRLOCK_CORS_ORIGINS: undefined,
        AIRLOCK_REQUEST_LOGGING: false
      })
    );

    expect(config.requestLogging).toBe(true);
    expect(config.corsOrigins).toBe("https://admin.example.com");
  });

  it("accepts dashboard IP rate limit format in limits overlay", async () => {
    const namespace = createConfigStoreNamespace({
      sections: {
        limits: {
          data: {
            ipRateLimitPolicy: {
              requestsPerMinute: 120
            }
          },
          updatedAt: Date.now(),
          updatedBy: "admin",
          version: 1
        }
      },
      globalVersion: 1
    });

    const rateLimitNamespace = {
      idFromName: (name: string) => name,
      get: (_id: unknown) => ({
        fetch: () => Promise.resolve(new Response())
      })
    };

    const config = await resolveGatewayConfigWithOverlay(
      createBindings({
        AIRLOCK_CONFIG_STORE: namespace,
        AIRLOCK_IP_RATE_LIMIT: rateLimitNamespace
      })
    );

    expect(config.ipRateLimitPolicy).toEqual({
      limit: 120,
      windowSeconds: 60
    });
  });
});
