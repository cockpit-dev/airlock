import { describe, expect, it } from "vitest";

import { geminiGenerateContentRequestSchema } from "./gemini.js";

describe("geminiGenerateContentRequestSchema", () => {
  it("accepts a Gemini generateContent request with tools and generation config", () => {
    const parsed = geminiGenerateContentRequestSchema.parse({
      system_instruction: {
        parts: [{ text: "Be concise." }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: "Weather in Shanghai?" }]
        }
      ],
      tools: [
        {
          functionDeclarations: [
            {
              name: "lookup_weather",
              parameters: {
                type: "object"
              }
            }
          ]
        }
      ],
      toolConfig: {
        functionCallingConfig: {
          mode: "ANY",
          allowedFunctionNames: ["lookup_weather"]
        }
      },
      generationConfig: {
        maxOutputTokens: 128,
        responseMimeType: "application/json"
      }
    });

    expect(parsed.contents).toHaveLength(1);
    expect(parsed.tools?.[0]?.functionDeclarations[0]?.name).toBe(
      "lookup_weather"
    );
  });

  it("rejects a Gemini request without contents", () => {
    const result = geminiGenerateContentRequestSchema.safeParse({
      generationConfig: {
        maxOutputTokens: 128
      }
    });

    expect(result.success).toBe(false);
  });
});
