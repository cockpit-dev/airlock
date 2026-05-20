import { describe, it, expect } from "vitest";
import {
  maskApiKey,
  maskSensitiveFieldsInSection,
  maskSnapshot,
  mergeMaskedApiKeys
} from "./admin-config-manage.js";
import type { StoredConfigSnapshot } from "../gateway-config-store.js";

describe("admin-config-manage masking", () => {
  describe("maskApiKey", () => {
    it("masks keys longer than 4 chars showing last 4", () => {
      expect(maskApiKey("sk-abcdefghijklmnop")).toBe("****mnop");
    });

    it("masks short keys as just asterisks", () => {
      expect(maskApiKey("abc")).toBe("****");
      expect(maskApiKey("abcd")).toBe("****");
    });

    it("masks exactly 5-char key", () => {
      expect(maskApiKey("abcde")).toBe("****bcde");
    });
  });

  describe("maskSensitiveFieldsInSection", () => {
    it("masks apiKey in provider entries", () => {
      const providers = [
        { id: "openai", type: "openai", apiKey: "sk-test-key-1234", baseUrl: "https://api.openai.com" },
        { id: "anthropic", type: "anthropic", apiKey: "sk-ant-short", baseUrl: "https://api.anthropic.com" }
      ];
      const result = maskSensitiveFieldsInSection(providers) as Array<Record<string, unknown>>;
      expect(result[0]!.apiKey).toBe("****1234");
      expect(result[1]!.apiKey).toBe("****hort");
      expect(result[0]!.id).toBe("openai");
      expect(result[0]!.baseUrl).toBe("https://api.openai.com");
    });

    it("preserves entries without apiKey", () => {
      const data = [{ id: "route1", externalModel: "gpt-4" }];
      const result = maskSensitiveFieldsInSection(data);
      expect(result).toEqual(data);
    });

    it("returns non-array data unchanged", () => {
      expect(maskSensitiveFieldsInSection({ foo: "bar" })).toEqual({ foo: "bar" });
      expect(maskSensitiveFieldsInSection("string")).toBe("string");
      expect(maskSensitiveFieldsInSection(42)).toBe(42);
    });
  });

  describe("maskSnapshot", () => {
    it("masks provider apiKeys in snapshot", () => {
      const snapshot: StoredConfigSnapshot = {
        globalVersion: 5,
        sections: {
          providers: {
            data: [
              { id: "glm", type: "openai", apiKey: "sk-real-key-5678", baseUrl: "https://open.bigmodel.cn" }
            ],
            updatedAt: Date.now(),
            updatedBy: "admin",
            version: 3
          },
          routes: {
            data: [{ externalModel: "gpt-4", target: { provider: "glm", providerModel: "glm-4" } }],
            updatedAt: Date.now(),
            updatedBy: "admin",
            version: 2
          }
        }
      };

      const masked = maskSnapshot(snapshot);
      const maskedProviders = masked.sections.providers!.data as Array<Record<string, unknown>>;
      expect(maskedProviders[0]!.apiKey).toBe("****5678");
      expect(maskedProviders[0]!.id).toBe("glm");

      // routes section unchanged
      const routes = masked.sections.routes!.data as Array<Record<string, unknown>>;
      expect(routes[0]!.externalModel).toBe("gpt-4");
    });

    it("handles snapshot without providers section", () => {
      const snapshot: StoredConfigSnapshot = {
        globalVersion: 1,
        sections: {
          routes: {
            data: [],
            updatedAt: Date.now(),
            updatedBy: "admin",
            version: 1
          }
        }
      };
      const masked = maskSnapshot(snapshot);
      expect(masked.sections.providers).toBeUndefined();
    });
  });

  describe("mergeMaskedApiKeys", () => {
    it("preserves existing apiKey when client sends masked value", () => {
      const newData = [
        { id: "openai", type: "openai", apiKey: "****1234", baseUrl: "https://api.openai.com" }
      ];
      const existingData = [
        { id: "openai", type: "openai", apiKey: "sk-real-key-1234", baseUrl: "https://api.openai.com" }
      ];

      const result = mergeMaskedApiKeys(newData, existingData) as Array<Record<string, unknown>>;
      expect(result[0]!.apiKey).toBe("sk-real-key-1234");
    });

    it("uses new apiKey when client sends unmasked value", () => {
      const newData = [
        { id: "openai", type: "openai", apiKey: "sk-brand-new-key", baseUrl: "https://api.openai.com" }
      ];
      const existingData = [
        { id: "openai", type: "openai", apiKey: "sk-old-key", baseUrl: "https://api.openai.com" }
      ];

      const result = mergeMaskedApiKeys(newData, existingData) as Array<Record<string, unknown>>;
      expect(result[0]!.apiKey).toBe("sk-brand-new-key");
    });

    it("handles new provider without existing entry", () => {
      const newData = [
        { id: "anthropic", type: "anthropic", apiKey: "****5678", baseUrl: "https://api.anthropic.com" }
      ];
      const existingData = [
        { id: "openai", type: "openai", apiKey: "sk-openai-key", baseUrl: "https://api.openai.com" }
      ];

      const result = mergeMaskedApiKeys(newData, existingData) as Array<Record<string, unknown>>;
      // No existing entry for anthropic, masked value stays as-is
      expect(result[0]!.apiKey).toBe("****5678");
    });

    it("returns new data unchanged when existing is not array", () => {
      const newData = [{ id: "openai", apiKey: "sk-key" }];
      expect(mergeMaskedApiKeys(newData, null)).toBe(newData);
      expect(mergeMaskedApiKeys(newData, "not-array")).toBe(newData);
    });
  });
});
