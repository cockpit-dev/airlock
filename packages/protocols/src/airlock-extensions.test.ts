import { describe, expect, it } from "vitest";
import { airlockRequestExtensionsSchema } from "./airlock-extensions.js";

describe("airlockRequestExtensionsSchema", () => {
  it("accepts empty object", () => {
    const result = airlockRequestExtensionsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts requestShaping with arbitrary unknown value", () => {
    const result = airlockRequestExtensionsSchema.safeParse({
      requestShaping: {
        headers: { "x-custom": "value" },
        query: { trace: "1" },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requestShaping).toEqual({
        headers: { "x-custom": "value" },
        query: { trace: "1" },
      });
    }
  });

  it("accepts requestShaping as a simple object", () => {
    const result = airlockRequestExtensionsSchema.safeParse({
      requestShaping: { jsonBody: { key: "val" } },
    });
    expect(result.success).toBe(true);
  });

  it("accepts requestShaping with null value", () => {
    const result = airlockRequestExtensionsSchema.safeParse({
      requestShaping: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts requestShaping as a string", () => {
    const result = airlockRequestExtensionsSchema.safeParse({
      requestShaping: "any-string",
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown top-level keys (strict mode)", () => {
    const result = airlockRequestExtensionsSchema.safeParse({
      requestShaping: {},
      unknownField: "not allowed",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-object input", () => {
    const result = airlockRequestExtensionsSchema.safeParse("not an object");
    expect(result.success).toBe(false);
  });

  it("rejects null input", () => {
    const result = airlockRequestExtensionsSchema.safeParse(null);
    expect(result.success).toBe(false);
  });

  it("rejects array input", () => {
    const result = airlockRequestExtensionsSchema.safeParse([]);
    expect(result.success).toBe(false);
  });
});
