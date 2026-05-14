import { describe, expect, it } from "vitest";

import {
  getProviderCapabilityDescriptor,
  listProviderCapabilityDescriptors
} from "./capabilities.js";

describe("provider capability descriptors", () => {
  it("lists descriptors for all currently supported providers", () => {
    expect(listProviderCapabilityDescriptors()).toEqual([
      {
        provider: "openai",
        displayName: "OpenAI",
        supportsStreaming: true,
        supportsTools: true,
        supportsMultimodalInput: false,
        supportsSystemMessages: true,
        supportsPreviousResponseId: true,
        supportsConversationId: true,
        supportsPrompt: true,
        supportsReasoning: true,
        supportsStructuredOutputs: true,
        supportsParallelToolCallControl: true,
        supportsRouteScopedShaping: true,
        supportsStaticFallbackSameProvider: true
      },
      {
        provider: "anthropic",
        displayName: "Anthropic",
        supportsStreaming: true,
        supportsTools: true,
        supportsMultimodalInput: false,
        supportsSystemMessages: true,
        supportsPreviousResponseId: false,
        supportsConversationId: false,
        supportsPrompt: false,
        supportsReasoning: false,
        supportsStructuredOutputs: false,
        supportsParallelToolCallControl: false,
        supportsRouteScopedShaping: true,
        supportsStaticFallbackSameProvider: true
      },
      {
        provider: "gemini",
        displayName: "Gemini",
        supportsStreaming: true,
        supportsTools: false,
        supportsMultimodalInput: false,
        supportsSystemMessages: true,
        supportsPreviousResponseId: false,
        supportsConversationId: false,
        supportsPrompt: false,
        supportsReasoning: false,
        supportsStructuredOutputs: false,
        supportsParallelToolCallControl: false,
        supportsRouteScopedShaping: true,
        supportsStaticFallbackSameProvider: true
      }
    ]);
  });

  it("returns the descriptor for a supported provider", () => {
    expect(getProviderCapabilityDescriptor("gemini")).toEqual({
      provider: "gemini",
      displayName: "Gemini",
      supportsStreaming: true,
      supportsTools: false,
      supportsMultimodalInput: false,
      supportsSystemMessages: true,
      supportsPreviousResponseId: false,
      supportsConversationId: false,
      supportsPrompt: false,
      supportsReasoning: false,
      supportsStructuredOutputs: false,
      supportsParallelToolCallControl: false,
      supportsRouteScopedShaping: true,
      supportsStaticFallbackSameProvider: true
    });
  });

  it("returns OpenAI as tool-capable", () => {
    expect(getProviderCapabilityDescriptor("openai")).toMatchObject({
      provider: "openai",
      supportsTools: true,
      supportsPreviousResponseId: true,
      supportsConversationId: true,
      supportsPrompt: true,
      supportsReasoning: true,
      supportsStructuredOutputs: true,
      supportsParallelToolCallControl: true
    });
  });

  it("returns Anthropic as not conversation-capable", () => {
    expect(getProviderCapabilityDescriptor("anthropic")).toMatchObject({
      provider: "anthropic",
      supportsConversationId: false
    });
  });

  it("returns Anthropic as tool-capable", () => {
    expect(getProviderCapabilityDescriptor("anthropic")).toMatchObject({
      provider: "anthropic",
      supportsTools: true
    });
  });
});
