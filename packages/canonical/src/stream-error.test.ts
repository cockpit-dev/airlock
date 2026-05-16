import { describe, it, expect } from "vitest";
import {
  encodeOpenAIChatStreamError,
  encodeOpenAIResponsesStreamError,
  encodeAnthropicMessagesStreamError,
} from "./stream-error.js";

describe("stream-error", () => {
  describe("encodeOpenAIChatStreamError", () => {
    it("encodes error with code and category fields", () => {
      const error = Object.assign(new Error("provider timeout"), {
        code: "provider_timeout",
        category: "upstream",
      });
      const result = encodeOpenAIChatStreamError(error);
      expect(result).toContain(`"message":"provider timeout"`);
      expect(result).toContain(`"type":"upstream"`);
      expect(result).toContain(`"code":"provider_timeout"`);
      expect(result).toContain("data: [DONE]");
    });

    it("encodes plain Error with defaults", () => {
      const result = encodeOpenAIChatStreamError(new Error("oops"));
      expect(result).toContain(`"message":"oops"`);
      expect(result).toContain(`"type":"internal_error"`);
      expect(result).toContain(`"code":"stream_error"`);
    });

    it("encodes unknown error", () => {
      const result = encodeOpenAIChatStreamError("something broke");
      expect(result).toContain(`"message":"Internal server error"`);
    });

    it("produces correct SSE structure", () => {
      const result = encodeOpenAIChatStreamError(new Error("test"));
      expect(result).toMatch(/^data: \{.*\}\n\ndata: \[DONE\]\n\n$/);
    });
  });

  describe("encodeOpenAIResponsesStreamError", () => {
    it("encodes error with code", () => {
      const error = Object.assign(new Error("rate limited"), {
        code: "rate_limit_exceeded",
        category: "throttle",
      });
      const result = encodeOpenAIResponsesStreamError(error);
      expect(result).toContain(`"type":"error"`);
      expect(result).toContain(`"code":"rate_limit_exceeded"`);
      expect(result).toContain(`"message":"rate limited"`);
      expect(result).toContain("data: [DONE]");
    });

    it("produces correct SSE structure", () => {
      const result = encodeOpenAIResponsesStreamError(new Error("test"));
      expect(result).toMatch(/^data: \{.*\}\n\ndata: \[DONE\]\n\n$/);
    });
  });

  describe("encodeAnthropicMessagesStreamError", () => {
    it("encodes error with category as type", () => {
      const error = Object.assign(new Error("overloaded"), {
        code: "provider_overloaded",
        category: "upstream",
      });
      const result = encodeAnthropicMessagesStreamError(error);
      expect(result).toContain("event: error\n");
      expect(result).toContain(`"type":"error"`);
      expect(result).toContain(`"type":"upstream"`);
      expect(result).toContain(`"message":"overloaded"`);
    });

    it("does not include [DONE] terminator", () => {
      const result = encodeAnthropicMessagesStreamError(new Error("test"));
      expect(result).not.toContain("[DONE]");
    });

    it("produces correct SSE structure", () => {
      const result = encodeAnthropicMessagesStreamError(new Error("test"));
      expect(result).toMatch(/^event: error\ndata: \{.*\}\n\n$/);
    });
  });
});
