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
      requiresSystemMessages: true,
      requiresPreviousResponseId: false,
      requiresConversationId: false
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
      requiresSystemMessages: false,
      requiresPreviousResponseId: false,
      requiresConversationId: false
    });
  });

  it("marks tool requirements when canonical requests include tools", () => {
    const request: CanonicalRequest = {
      model: "claude-sonnet-4-5",
      stream: false,
      tools: [
        {
          name: "lookup_weather",
          inputSchema: {
            type: "object"
          }
        }
      ],
      messages: [
        {
          role: "user",
          content: "Weather in Shanghai?"
        }
      ]
    };

    expect(getCanonicalRequestCapabilityRequirements(request)).toEqual({
      requiresStreaming: false,
      requiresTools: true,
      requiresMultimodalInput: false,
      requiresSystemMessages: false,
      requiresPreviousResponseId: false,
      requiresConversationId: false
    });
  });

  it("marks streaming and previous-response requirements when present", () => {
    const request: CanonicalRequest = {
      model: "gpt-4.1-mini",
      stream: true,
      previousResponseId: "resp_123",
      conversationId: "conv_123",
      messages: [
        {
          role: "user",
          content: "continue"
        }
      ]
    };

    expect(getCanonicalRequestCapabilityRequirements(request)).toEqual({
      requiresStreaming: true,
      requiresTools: false,
      requiresMultimodalInput: false,
      requiresSystemMessages: false,
      requiresPreviousResponseId: true,
      requiresConversationId: true
    });
  });
});
