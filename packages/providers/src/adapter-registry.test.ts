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

    it("passes optional shaping to factory", () => {
      const adapter = createProviderAdapterFromRegistry("openai", {
        apiKey: "test-key",
        baseUrl: "https://api.openai.com/v1",
        shaping: { headers: { "x-custom": "value" } }
      });
      expect(adapter).toBeDefined();
    });

    it("passes optional fetcher to factory", () => {
      const customFetcher = (() =>
        Promise.resolve(new Response())) as unknown as typeof fetch;
      const adapter = createProviderAdapterFromRegistry("openai", {
        apiKey: "test-key",
        baseUrl: "https://api.openai.com/v1",
        fetcher: customFetcher
      });
      expect(adapter).toBeDefined();
    });

    it("passes signing secrets to factory", () => {
      const adapter = createProviderAdapterFromRegistry("anthropic", {
        apiKey: "test-key",
        baseUrl: "https://api.anthropic.com",
        defaultMaxTokens: 256,
        signingSecrets: { "hmac-key-1": "secret-value" }
      });
      expect(adapter).toBeDefined();
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

    it("receives construction options in factory callback", () => {
      let receivedApiKey: string | undefined;
      let receivedBaseUrl: string | undefined;
      const mockAdapter: ProviderAdapter = {
        complete() {
          return Promise.resolve(stubCanonicalResponse);
        }
      };

      registerProviderAdapterFactory("options-capture" as never, (opts) => {
        receivedApiKey = opts.apiKey;
        receivedBaseUrl = opts.baseUrl;
        return mockAdapter;
      });

      createProviderAdapterFromRegistry("options-capture" as never, {
        apiKey: "my-key",
        baseUrl: "https://example.com"
      });

      expect(receivedApiKey).toBe("my-key");
      expect(receivedBaseUrl).toBe("https://example.com");
    });
  });
});
