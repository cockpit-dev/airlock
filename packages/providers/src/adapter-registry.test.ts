import { describe, it, expect } from "vitest";

import type { CanonicalResponse } from "@airlock/canonical";
import type { ProviderAdapter } from "./types.js";
import {
  createProviderAdapterFromRegistry,
  registerProviderAdapterFactory
} from "./adapter-registry.js";

const stubCanonicalResponse: CanonicalResponse = {
  id: "test",
  model: "test-model",
  outputText: "",
  finishReason: "stop"
};

describe("Provider adapter registry", () => {
  describe("built-in providers", () => {
    it("creates an OpenAI adapter for the openai provider", () => {
      const adapter = createProviderAdapterFromRegistry("openai", {
        apiKey: "test-key",
        baseUrl: "https://api.openai.com/v1"
      });
      expect(adapter).toBeDefined();
      expect(typeof adapter.complete).toBe("function");
    });

    it("creates an Anthropic adapter for the anthropic provider", () => {
      const adapter = createProviderAdapterFromRegistry("anthropic", {
        apiKey: "test-key",
        baseUrl: "https://api.anthropic.com",
        defaultMaxTokens: 512
      });
      expect(adapter).toBeDefined();
      expect(typeof adapter.complete).toBe("function");
    });

    it("creates a Gemini adapter for the gemini provider", () => {
      const adapter = createProviderAdapterFromRegistry("gemini", {
        apiKey: "test-key",
        baseUrl: "https://generativelanguage.googleapis.com"
      });
      expect(adapter).toBeDefined();
      expect(typeof adapter.complete).toBe("function");
    });

    it("throws for an unregistered provider", () => {
      expect(() =>
        createProviderAdapterFromRegistry("unknown-provider" as never, {
          apiKey: "x",
          baseUrl: "https://example.com"
        })
      ).toThrow("No adapter factory registered for provider: unknown-provider");
    });
  });

  describe("custom factory registration", () => {
    it("allows registering a custom provider factory", () => {
      const mockAdapter: ProviderAdapter = {
        complete() {
          return Promise.resolve(stubCanonicalResponse);
        }
      };

      registerProviderAdapterFactory("custom-test" as never, () => mockAdapter);

      const result = createProviderAdapterFromRegistry("custom-test" as never, {
        apiKey: "x",
        baseUrl: "https://example.com"
      });

      expect(result).toBe(mockAdapter);
    });
  });
});
