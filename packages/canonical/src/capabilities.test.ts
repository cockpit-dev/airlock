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
      requiresToolReplay: false,
      requiresStreamingTools: false,
      requiresMultimodalInput: false,
      requiresSystemMessages: true,
      requiresPreviousResponseId: false,
      requiresConversationId: false,
      requiresPrompt: false,
      requiresReasoning: false,
      requiresStructuredOutputs: false,
      requiresParallelToolCallControl: false
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
      requiresToolReplay: false,
      requiresStreamingTools: false,
      requiresMultimodalInput: false,
      requiresSystemMessages: false,
      requiresPreviousResponseId: false,
      requiresConversationId: false,
      requiresPrompt: false,
      requiresReasoning: false,
      requiresStructuredOutputs: false,
      requiresParallelToolCallControl: false
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
      requiresToolReplay: false,
      requiresStreamingTools: false,
      requiresMultimodalInput: false,
      requiresSystemMessages: false,
      requiresPreviousResponseId: false,
      requiresConversationId: false,
      requiresPrompt: false,
      requiresReasoning: false,
      requiresStructuredOutputs: false,
      requiresParallelToolCallControl: false
    });
  });

  it("marks tool requirements when canonical requests replay assistant tool calls", () => {
    const request: CanonicalRequest = {
      model: "claude-sonnet-4-5",
      stream: false,
      messages: [
        {
          role: "user",
          content: "Weather in Shanghai?"
        },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "call_123",
              name: "lookup_weather",
              arguments: "{\"city\":\"Shanghai\"}"
            }
          ]
        }
      ]
    };

    expect(getCanonicalRequestCapabilityRequirements(request)).toEqual({
      requiresStreaming: false,
      requiresTools: true,
      requiresToolReplay: true,
      requiresStreamingTools: false,
      requiresMultimodalInput: false,
      requiresSystemMessages: false,
      requiresPreviousResponseId: false,
      requiresConversationId: false,
      requiresPrompt: false,
      requiresReasoning: false,
      requiresStructuredOutputs: false,
      requiresParallelToolCallControl: false
    });
  });

  it("marks tool requirements when canonical requests replay tool result messages", () => {
    const request: CanonicalRequest = {
      model: "claude-sonnet-4-5",
      stream: false,
      messages: [
        {
          role: "tool",
          content: "{\"temperature_c\":26}",
          toolCallId: "call_123"
        }
      ]
    };

    expect(getCanonicalRequestCapabilityRequirements(request)).toEqual({
      requiresStreaming: false,
      requiresTools: true,
      requiresToolReplay: true,
      requiresStreamingTools: false,
      requiresMultimodalInput: false,
      requiresSystemMessages: false,
      requiresPreviousResponseId: false,
      requiresConversationId: false,
      requiresPrompt: false,
      requiresReasoning: false,
      requiresStructuredOutputs: false,
      requiresParallelToolCallControl: false
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
      requiresToolReplay: false,
      requiresStreamingTools: false,
      requiresMultimodalInput: false,
      requiresSystemMessages: false,
      requiresPreviousResponseId: true,
      requiresConversationId: true,
      requiresPrompt: false,
      requiresReasoning: false,
      requiresStructuredOutputs: false,
      requiresParallelToolCallControl: false
    });
  });

  it("marks prompt and reasoning requirements when present", () => {
    const request: CanonicalRequest = {
      model: "gpt-4.1-mini",
      stream: false,
      prompt: {
        id: "pmpt_123"
      },
      reasoningEffort: "medium",
      messages: []
    };

    expect(getCanonicalRequestCapabilityRequirements(request)).toEqual({
      requiresStreaming: false,
      requiresTools: false,
      requiresToolReplay: false,
      requiresStreamingTools: false,
      requiresMultimodalInput: false,
      requiresSystemMessages: false,
      requiresPreviousResponseId: false,
      requiresConversationId: false,
      requiresPrompt: true,
      requiresReasoning: true,
      requiresStructuredOutputs: false,
      requiresParallelToolCallControl: false
    });
  });

  it("marks reasoning requirements when reasoning summary control is present", () => {
    const request: CanonicalRequest = {
      model: "gpt-4.1-mini",
      stream: false,
      reasoningSummary: "auto",
      messages: []
    };

    expect(getCanonicalRequestCapabilityRequirements(request)).toEqual({
      requiresStreaming: false,
      requiresTools: false,
      requiresToolReplay: false,
      requiresStreamingTools: false,
      requiresMultimodalInput: false,
      requiresSystemMessages: false,
      requiresPreviousResponseId: false,
      requiresConversationId: false,
      requiresPrompt: false,
      requiresReasoning: true,
      requiresStructuredOutputs: false,
      requiresParallelToolCallControl: false
    });
  });

  it("marks structured output requirements when json_schema output format is present", () => {
    const request: CanonicalRequest = {
      model: "gpt-4.1-mini",
      stream: false,
      outputFormat: {
        type: "json_schema",
        name: "weather",
        schema: {
          type: "object"
        },
        strict: true
      },
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
      requiresToolReplay: false,
      requiresStreamingTools: false,
      requiresMultimodalInput: false,
      requiresSystemMessages: false,
      requiresPreviousResponseId: false,
      requiresConversationId: false,
      requiresPrompt: false,
      requiresReasoning: false,
      requiresStructuredOutputs: true,
      requiresParallelToolCallControl: false
    });
  });

  it("marks structured output requirements when json_object output format is present", () => {
    const request: CanonicalRequest = {
      model: "gpt-4.1-mini",
      stream: false,
      outputFormat: {
        type: "json_object"
      },
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
      requiresToolReplay: false,
      requiresStreamingTools: false,
      requiresMultimodalInput: false,
      requiresSystemMessages: false,
      requiresPreviousResponseId: false,
      requiresConversationId: false,
      requiresPrompt: false,
      requiresReasoning: false,
      requiresStructuredOutputs: true,
      requiresParallelToolCallControl: false
    });
  });

  it("marks parallel tool call control requirements when explicitly disabled", () => {
    const request: CanonicalRequest = {
      model: "gpt-4.1-mini",
      stream: false,
      allowParallelToolCalls: false,
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
          content: "Say hi."
        }
      ]
    };

    expect(getCanonicalRequestCapabilityRequirements(request)).toEqual({
      requiresStreaming: false,
      requiresTools: true,
      requiresToolReplay: false,
      requiresStreamingTools: false,
      requiresMultimodalInput: false,
      requiresSystemMessages: false,
      requiresPreviousResponseId: false,
      requiresConversationId: false,
      requiresPrompt: false,
      requiresReasoning: false,
      requiresStructuredOutputs: false,
      requiresParallelToolCallControl: true
    });
  });

  it("marks parallel tool call control requirements when explicitly enabled", () => {
    const request: CanonicalRequest = {
      model: "gpt-4.1-mini",
      stream: false,
      allowParallelToolCalls: true,
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
          content: "Say hi."
        }
      ]
    };

    expect(getCanonicalRequestCapabilityRequirements(request)).toEqual({
      requiresStreaming: false,
      requiresTools: true,
      requiresToolReplay: false,
      requiresStreamingTools: false,
      requiresMultimodalInput: false,
      requiresSystemMessages: false,
      requiresPreviousResponseId: false,
      requiresConversationId: false,
      requiresPrompt: false,
      requiresReasoning: false,
      requiresStructuredOutputs: false,
      requiresParallelToolCallControl: true
    });
  });

  it("marks streaming tool requirements when canonical requests stream declared tools", () => {
    const request: CanonicalRequest = {
      model: "gpt-4.1-mini",
      stream: true,
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
      requiresStreaming: true,
      requiresTools: true,
      requiresToolReplay: false,
      requiresStreamingTools: true,
      requiresMultimodalInput: false,
      requiresSystemMessages: false,
      requiresPreviousResponseId: false,
      requiresConversationId: false,
      requiresPrompt: false,
      requiresReasoning: false,
      requiresStructuredOutputs: false,
      requiresParallelToolCallControl: false
    });
  });
});
