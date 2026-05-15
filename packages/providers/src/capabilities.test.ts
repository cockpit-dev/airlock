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
        supportsToolReplay: true,
        supportsStreamingTools: true,
        supportsMultimodalInput: false,
        supportsSystemMessages: true,
        supportsEndUserId: true,
        supportsPreviousResponseId: true,
        supportsConversationId: true,
        supportsPrompt: true,
        supportsReasoning: true,
        supportsStructuredOutputs: true,
        supportsStreamingStructuredOutputs: true,
        supportsParallelToolCallControl: true,
        supportsOpenAIRequestMetadata: true,
        supportsOpenAIResponsesTextControls: true,
        supportsRouteScopedShaping: true,
        supportsStaticFallbackSameProvider: true,
        supportsToolChoice: true,
        supportsStopSequences: true,
        supportsSamplingParameters: true,
        supportsAnthropicRequestMetadata: false
      },
      {
        provider: "anthropic",
        displayName: "Anthropic",
        supportsStreaming: true,
        supportsTools: true,
        supportsToolReplay: true,
        supportsStreamingTools: true,
        supportsMultimodalInput: false,
        supportsSystemMessages: true,
        supportsEndUserId: true,
        supportsPreviousResponseId: false,
        supportsConversationId: false,
        supportsPrompt: false,
        supportsReasoning: false,
        supportsStructuredOutputs: false,
        supportsStreamingStructuredOutputs: false,
        supportsParallelToolCallControl: false,
        supportsOpenAIRequestMetadata: false,
        supportsOpenAIResponsesTextControls: false,
        supportsRouteScopedShaping: true,
        supportsStaticFallbackSameProvider: true,
        supportsToolChoice: true,
        supportsStopSequences: true,
        supportsSamplingParameters: true,
        supportsAnthropicRequestMetadata: true
      },
      {
        provider: "gemini",
        displayName: "Gemini",
        supportsStreaming: true,
        supportsTools: true,
        supportsToolReplay: true,
        supportsStreamingTools: true,
        supportsMultimodalInput: false,
        supportsSystemMessages: true,
        supportsEndUserId: false,
        supportsPreviousResponseId: false,
        supportsConversationId: false,
        supportsPrompt: false,
        supportsReasoning: false,
        supportsStructuredOutputs: true,
        supportsStreamingStructuredOutputs: true,
        supportsParallelToolCallControl: false,
        supportsOpenAIRequestMetadata: false,
        supportsOpenAIResponsesTextControls: false,
        supportsRouteScopedShaping: true,
        supportsStaticFallbackSameProvider: true,
        supportsToolChoice: true,
        supportsStopSequences: true,
        supportsSamplingParameters: true,
        supportsAnthropicRequestMetadata: false
      }
    ]);
  });

  it("returns the descriptor for a supported provider", () => {
    expect(getProviderCapabilityDescriptor("gemini")).toEqual({
      provider: "gemini",
      displayName: "Gemini",
      supportsStreaming: true,
      supportsTools: true,
      supportsToolReplay: true,
      supportsStreamingTools: true,
      supportsMultimodalInput: false,
      supportsSystemMessages: true,
      supportsEndUserId: false,
      supportsPreviousResponseId: false,
      supportsConversationId: false,
      supportsPrompt: false,
      supportsReasoning: false,
      supportsStructuredOutputs: true,
      supportsStreamingStructuredOutputs: true,
      supportsParallelToolCallControl: false,
      supportsOpenAIRequestMetadata: false,
      supportsOpenAIResponsesTextControls: false,
      supportsRouteScopedShaping: true,
      supportsStaticFallbackSameProvider: true,
      supportsToolChoice: true,
      supportsStopSequences: true,
      supportsSamplingParameters: true,
      supportsAnthropicRequestMetadata: false
    });
  });

  it("returns OpenAI as tool-capable", () => {
    expect(getProviderCapabilityDescriptor("openai")).toMatchObject({
      provider: "openai",
      supportsTools: true,
      supportsToolReplay: true,
      supportsStreamingTools: true,
      supportsEndUserId: true,
      supportsPreviousResponseId: true,
      supportsConversationId: true,
      supportsPrompt: true,
      supportsReasoning: true,
      supportsStructuredOutputs: true,
      supportsStreamingStructuredOutputs: true,
      supportsParallelToolCallControl: true,
      supportsOpenAIRequestMetadata: true,
      supportsOpenAIResponsesTextControls: true
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
      supportsTools: true,
      supportsToolReplay: true,
      supportsStreamingTools: true,
      supportsEndUserId: true
    });
  });

  it("returns Gemini as tool-capable for first-turn buffered function calling", () => {
    expect(getProviderCapabilityDescriptor("gemini")).toMatchObject({
      provider: "gemini",
      supportsTools: true,
      supportsToolReplay: true,
      supportsStreamingTools: true,
      supportsStructuredOutputs: true,
      supportsStreamingStructuredOutputs: true
    });
  });
});
