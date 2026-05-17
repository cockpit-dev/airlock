import { describe, it, expect } from "vitest";
import { GatewayError } from "@airlock/shared";
import {
  assertAllowedOpenAITopLevelFields,
  assertSupportedOpenAIChatStreamOptions,
  assertSupportedOpenAIChatResponseFormat,
  assertSupportedOpenAIChatToolsSemantics,
  assertSupportedOpenAIResponsesToolsSemantics,
  assertSupportedOpenAIResponsesSemantics,
  assertSupportedOpenAIResponsesStreamOptions,
  assertOpenAIForcedToolChoiceMatchesDeclaredTools,
  parseOpenAIRequestSchema
} from "./openai-request-validation.js";
import { z } from "zod";

const REQ_ID = "test-req-002";

describe("assertAllowedOpenAITopLevelFields", () => {
  it("passes when payload is null", () => {
    expect(() =>
      assertAllowedOpenAITopLevelFields(null, REQ_ID, "OpenAI Chat", ["model"])
    ).not.toThrow();
  });

  it("passes with allowed fields", () => {
    expect(() =>
      assertAllowedOpenAITopLevelFields(
        { model: "gpt-4", messages: [] },
        REQ_ID,
        "OpenAI Chat",
        ["model", "messages"]
      )
    ).not.toThrow();
  });

  it("throws on disallowed field with route label in message", () => {
    try {
      assertAllowedOpenAITopLevelFields(
        { model: "gpt-4", bad: true },
        REQ_ID,
        "OpenAI Responses",
        ["model"]
      );
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GatewayError);
      expect((e as GatewayError).message).toContain("OpenAI Responses");
      expect((e as GatewayError).message).toContain("bad");
      expect((e as GatewayError).httpStatus).toBe(400);
    }
  });
});

describe("assertSupportedOpenAIChatStreamOptions", () => {
  it("passes without stream_options", () => {
    expect(() =>
      assertSupportedOpenAIChatStreamOptions({ stream: true }, REQ_ID)
    ).not.toThrow();
  });

  it("passes with include_usage=true and stream=true", () => {
    expect(() =>
      assertSupportedOpenAIChatStreamOptions(
        { stream: true, stream_options: { include_usage: true } },
        REQ_ID
      )
    ).not.toThrow();
  });

  it("rejects stream_options without stream=true", () => {
    expect(() =>
      assertSupportedOpenAIChatStreamOptions(
        { stream_options: { include_usage: true } },
        REQ_ID
      )
    ).toThrow(GatewayError);
  });

  it("rejects stream_options with extra keys", () => {
    expect(() =>
      assertSupportedOpenAIChatStreamOptions(
        { stream: true, stream_options: { include_usage: true, extra: 1 } },
        REQ_ID
      )
    ).toThrow(GatewayError);
  });

  it("rejects include_usage=false", () => {
    expect(() =>
      assertSupportedOpenAIChatStreamOptions(
        { stream: true, stream_options: { include_usage: false } },
        REQ_ID
      )
    ).toThrow(GatewayError);
  });
});

describe("assertSupportedOpenAIChatResponseFormat", () => {
  it("passes without response_format", () => {
    expect(() =>
      assertSupportedOpenAIChatResponseFormat({}, REQ_ID)
    ).not.toThrow();
  });

  it.each(["text", "json_object", "json_schema"])(
    "passes with type=%s",
    (type) => {
      expect(() =>
        assertSupportedOpenAIChatResponseFormat(
          { response_format: { type } },
          REQ_ID
        )
      ).not.toThrow();
    }
  );

  it("rejects unsupported type", () => {
    expect(() =>
      assertSupportedOpenAIChatResponseFormat(
        { response_format: { type: "xml" } },
        REQ_ID
      )
    ).toThrow(GatewayError);
  });
});

describe("assertSupportedOpenAIChatToolsSemantics", () => {
  it("passes without tools or parallel_tool_calls", () => {
    expect(() =>
      assertSupportedOpenAIChatToolsSemantics({}, REQ_ID)
    ).not.toThrow();
  });

  it("passes with tools and valid parallel_tool_calls", () => {
    expect(() =>
      assertSupportedOpenAIChatToolsSemantics(
        { tools: [{}], parallel_tool_calls: true },
        REQ_ID
      )
    ).not.toThrow();
  });

  it("rejects parallel_tool_calls without declared tools", () => {
    expect(() =>
      assertSupportedOpenAIChatToolsSemantics(
        { parallel_tool_calls: true },
        REQ_ID
      )
    ).toThrow(GatewayError);
  });

  it("rejects non-boolean parallel_tool_calls", () => {
    expect(() =>
      assertSupportedOpenAIChatToolsSemantics(
        { tools: [{}], parallel_tool_calls: "yes" },
        REQ_ID
      )
    ).toThrow(GatewayError);
  });
});

describe("assertSupportedOpenAIResponsesToolsSemantics", () => {
  it("rejects parallel_tool_calls without declared tools", () => {
    expect(() =>
      assertSupportedOpenAIResponsesToolsSemantics(
        { parallel_tool_calls: true },
        REQ_ID
      )
    ).toThrow(GatewayError);
  });

  it("rejects non-boolean parallel_tool_calls with tools", () => {
    expect(() =>
      assertSupportedOpenAIResponsesToolsSemantics(
        { tools: [{}], parallel_tool_calls: 1 },
        REQ_ID
      )
    ).toThrow(GatewayError);
  });
});

describe("assertSupportedOpenAIResponsesSemantics", () => {
  it("passes with empty payload", () => {
    expect(() =>
      assertSupportedOpenAIResponsesSemantics({}, REQ_ID)
    ).not.toThrow();
  });

  it("passes with valid reasoning object", () => {
    expect(() =>
      assertSupportedOpenAIResponsesSemantics(
        { reasoning: { effort: "high" } },
        REQ_ID
      )
    ).not.toThrow();
  });

  it("rejects non-object reasoning", () => {
    expect(() =>
      assertSupportedOpenAIResponsesSemantics(
        { reasoning: "high" },
        REQ_ID
      )
    ).toThrow(GatewayError);
  });

  it("passes with string stop", () => {
    expect(() =>
      assertSupportedOpenAIResponsesSemantics(
        { stop: "end" },
        REQ_ID
      )
    ).not.toThrow();
  });

  it("passes with string array stop", () => {
    expect(() =>
      assertSupportedOpenAIResponsesSemantics(
        { stop: ["end", "stop"] },
        REQ_ID
      )
    ).not.toThrow();
  });

  it("accepts single string stop including empty string", () => {
    expect(() =>
      assertSupportedOpenAIResponsesSemantics(
        { stop: "" },
        REQ_ID
      )
    ).not.toThrow();
  });

  it("rejects empty array stop", () => {
    expect(() =>
      assertSupportedOpenAIResponsesSemantics(
        { stop: [] },
        REQ_ID
      )
    ).toThrow(GatewayError);
  });

  it("passes with valid text.format", () => {
    expect(() =>
      assertSupportedOpenAIResponsesSemantics(
        { text: { format: { type: "json_object" } } },
        REQ_ID
      )
    ).not.toThrow();
  });

  it("passes with valid text.verbosity", () => {
    expect(() =>
      assertSupportedOpenAIResponsesSemantics(
        { text: { verbosity: "low" } },
        REQ_ID
      )
    ).not.toThrow();
  });

  it("rejects unsupported text.format.type", () => {
    expect(() =>
      assertSupportedOpenAIResponsesSemantics(
        { text: { format: { type: "xml" } } },
        REQ_ID
      )
    ).toThrow(GatewayError);
  });

  it("rejects unsupported text.verbosity", () => {
    expect(() =>
      assertSupportedOpenAIResponsesSemantics(
        { text: { verbosity: "ultra" } },
        REQ_ID
      )
    ).toThrow(GatewayError);
  });

  it("rejects text without format or verbosity", () => {
    expect(() =>
      assertSupportedOpenAIResponsesSemantics(
        { text: { custom: true } },
        REQ_ID
      )
    ).toThrow(GatewayError);
  });
});

describe("assertSupportedOpenAIResponsesStreamOptions", () => {
  it("passes without stream_options", () => {
    expect(() =>
      assertSupportedOpenAIResponsesStreamOptions({}, REQ_ID)
    ).not.toThrow();
  });

  it("passes with include_obfuscation=false and stream=true", () => {
    expect(() =>
      assertSupportedOpenAIResponsesStreamOptions(
        { stream: true, stream_options: { include_obfuscation: false } },
        REQ_ID
      )
    ).not.toThrow();
  });

  it("rejects without stream=true", () => {
    expect(() =>
      assertSupportedOpenAIResponsesStreamOptions(
        { stream_options: { include_obfuscation: false } },
        REQ_ID
      )
    ).toThrow(GatewayError);
  });

  it("rejects include_obfuscation=true", () => {
    expect(() =>
      assertSupportedOpenAIResponsesStreamOptions(
        { stream: true, stream_options: { include_obfuscation: true } },
        REQ_ID
      )
    ).toThrow(GatewayError);
  });
});

describe("assertOpenAIForcedToolChoiceMatchesDeclaredTools", () => {
  it("passes with no tool_choice", () => {
    expect(() =>
      assertOpenAIForcedToolChoiceMatchesDeclaredTools(
        { model: "gpt-4" },
        REQ_ID,
        "OpenAI Chat"
      )
    ).not.toThrow();
  });

  it("passes with auto tool_choice", () => {
    expect(() =>
      assertOpenAIForcedToolChoiceMatchesDeclaredTools(
        { tool_choice: "auto", tools: [{ function: { name: "search" } }] },
        REQ_ID,
        "OpenAI Chat"
      )
    ).not.toThrow();
  });

  it("passes when forced tool_choice matches declared tool (nested function)", () => {
    expect(() =>
      assertOpenAIForcedToolChoiceMatchesDeclaredTools(
        {
          tool_choice: { function: { name: "search" } },
          tools: [{ function: { name: "search" } }]
        },
        REQ_ID,
        "OpenAI Chat"
      )
    ).not.toThrow();
  });

  it("passes when forced tool_choice matches declared tool (flat name)", () => {
    expect(() =>
      assertOpenAIForcedToolChoiceMatchesDeclaredTools(
        {
          tool_choice: { name: "my_tool" },
          tools: [{ name: "my_tool" }]
        },
        REQ_ID,
        "OpenAI Responses"
      )
    ).not.toThrow();
  });

  it("rejects when forced tool_choice name not in declared tools", () => {
    expect(() =>
      assertOpenAIForcedToolChoiceMatchesDeclaredTools(
        {
          tool_choice: { function: { name: "missing" } },
          tools: [{ function: { name: "search" } }]
        },
        REQ_ID,
        "OpenAI Chat"
      )
    ).toThrow(GatewayError);
  });

  it("rejects required tool_choice with no declared tools", () => {
    expect(() =>
      assertOpenAIForcedToolChoiceMatchesDeclaredTools(
        { tool_choice: "required" },
        REQ_ID,
        "OpenAI Chat"
      )
    ).toThrow(GatewayError);
  });
});

describe("parseOpenAIRequestSchema", () => {
  const schema = z.object({ model: z.string() });

  it("parses valid payload", () => {
    const result = parseOpenAIRequestSchema(
      schema,
      { model: "gpt-4" },
      REQ_ID,
      "OpenAI Chat"
    );
    expect(result).toEqual({ model: "gpt-4" });
  });

  it("throws GatewayError on ZodError with route label", () => {
    try {
      parseOpenAIRequestSchema(schema, { model: 42 }, REQ_ID, "OpenAI Responses");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GatewayError);
      expect((e as GatewayError).message).toContain("OpenAI Responses");
      expect((e as GatewayError).code).toBe("request_invalid_openai_payload");
    }
  });

  it("re-throws non-ZodError", () => {
    expect(() =>
      parseOpenAIRequestSchema(
        {
          parse: () => {
            throw new Error("oops");
          }
        },
        {},
        REQ_ID,
        "OpenAI Chat"
      )
    ).toThrow("oops");
  });
});
