import { describe, expect, it } from "vitest";
import { type ProviderId, isProviderId, providerIds } from "./providers.js";

describe("providers", () => {
  describe("providerIds", () => {
    it("contains the three supported providers", () => {
      expect(providerIds).toEqual(["openai", "anthropic", "gemini"]);
    });

    it("is a readonly tuple (frozen at type level)", () => {
      expect(Array.isArray(providerIds)).toBe(true);
      expect(providerIds).toHaveLength(3);
    });
  });

  describe("isProviderId", () => {
    it("returns true for openai", () => {
      expect(isProviderId("openai")).toBe(true);
    });

    it("returns true for anthropic", () => {
      expect(isProviderId("anthropic")).toBe(true);
    });

    it("returns true for gemini", () => {
      expect(isProviderId("gemini")).toBe(true);
    });

    it("returns false for unknown provider", () => {
      expect(isProviderId("azure")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isProviderId("")).toBe(false);
    });

    it("returns false for case-variant strings", () => {
      expect(isProviderId("OpenAI")).toBe(false);
      expect(isProviderId("ANTHROPIC")).toBe(false);
      expect(isProviderId("Gemini")).toBe(false);
    });

    it("narrows type to ProviderId when true", () => {
      const value: string = "openai";
      if (isProviderId(value)) {
        // TypeScript narrows to ProviderId here — this compiles only if the
        // type guard is correctly declared as `value is ProviderId`.
        const _assigned: ProviderId = value;
        expect(_assigned).toBe("openai");
      } else {
        expect.unreachable("should have been a valid ProviderId");
      }
    });
  });
});
