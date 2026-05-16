import { describe, expect, it } from "vitest";
import { runtimeModeSchema, type RuntimeMode } from "./env.js";

describe("env", () => {
  describe("runtimeModeSchema", () => {
    it("accepts 'free' mode", () => {
      const result = runtimeModeSchema.safeParse("free");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe("free");
      }
    });

    it("accepts 'scale' mode", () => {
      const result = runtimeModeSchema.safeParse("scale");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe("scale");
      }
    });

    it("rejects invalid mode strings", () => {
      const result = runtimeModeSchema.safeParse("enterprise");
      expect(result.success).toBe(false);
    });

    it("rejects empty string", () => {
      const result = runtimeModeSchema.safeParse("");
      expect(result.success).toBe(false);
    });

    it("rejects non-string types", () => {
      const result = runtimeModeSchema.safeParse(42);
      expect(result.success).toBe(false);
    });

    it("rejects null", () => {
      const result = runtimeModeSchema.safeParse(null);
      expect(result.success).toBe(false);
    });

    it("rejects undefined", () => {
      const result = runtimeModeSchema.safeParse(undefined);
      expect(result.success).toBe(false);
    });

    it("RuntimeMode type resolves to union of literals", () => {
      // Compile-time check: RuntimeMode should be "free" | "scale"
      const free: RuntimeMode = "free";
      const scale: RuntimeMode = "scale";
      expect(free).toBe("free");
      expect(scale).toBe("scale");
    });
  });
});
