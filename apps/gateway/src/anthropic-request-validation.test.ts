import { describe, it, expect } from "vitest";
import { GatewayError } from "@airlock/shared";
import {
  assertAllowedAnthropicTopLevelFields,
  assertSupportedAnthropicMetadataSemantics,
  assertAnthropicForcedToolChoiceMatchesDeclaredTools,
  parseAnthropicRequestSchema
} from "./anthropic-request-validation.js";
import { z } from "zod";

const REQ_ID = "test-req-001";

describe("assertAllowedAnthropicTopLevelFields", () => {
  it("passes when payload is null", () => {
    expect(() =>
      assertAllowedAnthropicTopLevelFields(null, REQ_ID, ["model", "messages"])
    ).not.toThrow();
  });

  it("passes when all fields are in allowlist", () => {
    expect(() =>
      assertAllowedAnthropicTopLevelFields(
        { model: "claude-3", messages: [] },
        REQ_ID,
        ["model", "messages"]
      )
    ).not.toThrow();
  });

  it("throws on disallowed field", () => {
    expect(() =>
      assertAllowedAnthropicTopLevelFields(
        { model: "claude-3", messages: [], unknown_field: true },
        REQ_ID,
        ["model", "messages"]
      )
    ).toThrow(GatewayError);
  });

  it("includes field name in error message", () => {
    try {
      assertAllowedAnthropicTopLevelFields({ foo: 1 }, REQ_ID, ["model"]);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GatewayError);
      expect((e as GatewayError).message).toContain("foo");
      expect((e as GatewayError).code).toBe(
        "request_unsupported_anthropic_semantics"
      );
      expect((e as GatewayError).httpStatus).toBe(400);
    }
  });
});

describe("assertSupportedAnthropicMetadataSemantics", () => {
  it("passes when no metadata", () => {
    expect(() =>
      assertSupportedAnthropicMetadataSemantics({ model: "x" }, REQ_ID)
    ).not.toThrow();
  });

  it("passes with valid user_id metadata", () => {
    expect(() =>
      assertSupportedAnthropicMetadataSemantics(
        { metadata: { user_id: "user123" } },
        REQ_ID
      )
    ).not.toThrow();
  });

  it("rejects metadata with extra fields", () => {
    expect(() =>
      assertSupportedAnthropicMetadataSemantics(
        { metadata: { user_id: "user123", extra: true } },
        REQ_ID
      )
    ).toThrow(GatewayError);
  });

  it("rejects empty user_id", () => {
    expect(() =>
      assertSupportedAnthropicMetadataSemantics(
        { metadata: { user_id: "" } },
        REQ_ID
      )
    ).toThrow(GatewayError);
  });

  it("rejects non-string user_id", () => {
    expect(() =>
      assertSupportedAnthropicMetadataSemantics(
        { metadata: { user_id: 42 } },
        REQ_ID
      )
    ).toThrow(GatewayError);
  });

  it("rejects missing user_id", () => {
    expect(() =>
      assertSupportedAnthropicMetadataSemantics(
        { metadata: { custom: "value" } },
        REQ_ID
      )
    ).toThrow(GatewayError);
  });
});

describe("assertAnthropicForcedToolChoiceMatchesDeclaredTools", () => {
  it("passes with no tool_choice", () => {
    expect(() =>
      assertAnthropicForcedToolChoiceMatchesDeclaredTools(
        { model: "x", messages: [] },
        REQ_ID
      )
    ).not.toThrow();
  });

  it("passes when forced tool_choice matches declared tools", () => {
    expect(() =>
      assertAnthropicForcedToolChoiceMatchesDeclaredTools(
        {
          tool_choice: { type: "tool", name: "search" },
          tools: [{ name: "search" }, { name: "calc" }]
        },
        REQ_ID
      )
    ).not.toThrow();
  });

  it("rejects when forced tool_choice name not in declared tools", () => {
    expect(() =>
      assertAnthropicForcedToolChoiceMatchesDeclaredTools(
        {
          tool_choice: { type: "tool", name: "missing" },
          tools: [{ name: "search" }]
        },
        REQ_ID
      )
    ).toThrow(GatewayError);
  });

  it("rejects tool_choice type=tool with no declared tools", () => {
    expect(() =>
      assertAnthropicForcedToolChoiceMatchesDeclaredTools(
        { tool_choice: { type: "tool", name: "x" } },
        REQ_ID
      )
    ).toThrow(GatewayError);
  });

  it("allows auto tool_choice without declared tools", () => {
    expect(() =>
      assertAnthropicForcedToolChoiceMatchesDeclaredTools(
        { tool_choice: { type: "auto" } },
        REQ_ID
      )
    ).not.toThrow();
  });
});

describe("parseAnthropicRequestSchema", () => {
  const schema = z.object({
    model: z.string(),
    messages: z.array(z.any())
  });

  it("parses valid payload", () => {
    const result = parseAnthropicRequestSchema(
      schema,
      { model: "claude-3", messages: [] },
      REQ_ID
    );
    expect(result).toEqual({ model: "claude-3", messages: [] });
  });

  it("throws GatewayError on ZodError", () => {
    try {
      parseAnthropicRequestSchema(schema, { model: 42 }, REQ_ID);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GatewayError);
      expect((e as GatewayError).code).toBe(
        "request_invalid_anthropic_payload"
      );
      expect((e as GatewayError).httpStatus).toBe(400);
    }
  });

  it("re-throws non-ZodError exceptions", () => {
    const badSchema = {
      parse() {
        throw new Error("not a zod error");
      }
    };
    expect(() => parseAnthropicRequestSchema(badSchema, {}, REQ_ID)).toThrow(
      "not a zod error"
    );
  });
});
