import { describe, expect, it } from "vitest";

import type { CanonicalRequest } from "./models.js";

import { getCanonicalRequestCapabilityRequirements } from "./capabilities.js";

describe("getCanonicalRequestCapabilityRequirements", () => {
  it("marks system-message requirements when canonical requests include system messages", () => {
    const request: CanonicalRequest = {
      model: "gpt-4.1-mini",
      stream: false,
      messages: [
        {
          role: "system",
          content: "You are precise."
        },
        {
          role: "user",
          content: "Say hi."
        }
      ]
    };

    expect(getCanonicalRequestCapabilityRequirements(request)).toEqual({
      requiresStreaming: false,
      requiresTools: false,
      requiresMultimodalInput: false,
      requiresSystemMessages: true
    });
  });

  it("does not require system-message support when system messages are absent", () => {
    const request: CanonicalRequest = {
      model: "gpt-4.1-mini",
      stream: false,
      messages: [
        {
          role: "user",
          content: "Say hi."
        }
      ]
    };

    expect(getCanonicalRequestCapabilityRequirements(request)).toEqual({
      requiresStreaming: false,
      requiresTools: false,
      requiresMultimodalInput: false,
      requiresSystemMessages: false
    });
  });
});
