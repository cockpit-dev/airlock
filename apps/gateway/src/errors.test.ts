import { describe, expect, it } from "vitest";

import { GatewayError } from "@airlock/shared";

import {
  toErrorResponse,
  toMethodNotAllowedResponse,
  toNotFoundResponse
} from "./errors.js";

async function readJson(response: Response): Promise<unknown> {
  return response.json();
}

describe("toMethodNotAllowedResponse", () => {
  it("returns OpenAI-style 405 for /v1/chat/completions", async () => {
    const response = toMethodNotAllowedResponse(
      "req-1",
      "/v1/chat/completions"
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("x-request-id")).toBe("req-1");
    expect(response.headers.get("allow")).toBe("POST");
    const body = (await readJson(response)) as Record<string, unknown>;
    expect(body).toEqual({
      error: {
        message: "Method not allowed",
        type: "invalid_request_error",
        code: "method_not_allowed"
      }
    });
  });

  it("returns Anthropic-style 405 for /v1/messages", async () => {
    const response = toMethodNotAllowedResponse("req-2", "/v1/messages");
    expect(response.status).toBe(405);
    expect(response.headers.get("request-id")).toBe("req-2");
    expect(response.headers.get("x-request-id")).toBe("req-2");
    expect(response.headers.get("allow")).toBe("POST");
    const body = (await readJson(response)) as Record<string, unknown>;
    expect(body).toEqual({
      type: "error",
      error: {
        type: "method_not_allowed",
        message: "Method not allowed"
      },
      request_id: "req-2"
    });
  });

  it("returns OpenAI-style 405 for /v1/responses", async () => {
    const response = toMethodNotAllowedResponse("req-3", "/v1/responses");
    expect(response.status).toBe(405);
    const body = (await readJson(response)) as Record<string, unknown>;
    expect((body as { error: { code: string } }).error.code).toBe(
      "method_not_allowed"
    );
  });
});

describe("toNotFoundResponse", () => {
  it("returns OpenAI-style 404 for unknown path", async () => {
    const response = toNotFoundResponse("req-1", "/v1/unknown");
    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBe("req-1");
    const body = (await readJson(response)) as Record<string, unknown>;
    expect(body).toEqual({
      error: {
        message: "Not found",
        type: "invalid_request_error",
        code: "route_not_found"
      }
    });
  });

  it("returns Anthropic-style 404 for /v1/messages sub-path", async () => {
    const response = toNotFoundResponse("req-2", "/v1/messages/unknown");
    expect(response.status).toBe(404);
    expect(response.headers.get("request-id")).toBe("req-2");
    const body = (await readJson(response)) as Record<string, unknown>;
    expect(body).toEqual({
      type: "error",
      error: {
        type: "not_found",
        message: "Not found"
      },
      request_id: "req-2"
    });
  });
});

describe("toErrorResponse", () => {
  it("returns OpenAI-style error for GatewayError", async () => {
    const error = new GatewayError("Bad request", {
      code: "request_invalid",
      category: "request",
      httpStatus: 400,
      retryable: false,
      requestId: "req-1"
    });
    const response = toErrorResponse(error, "req-1", "/v1/chat/completions");
    expect(response.status).toBe(400);
    const body = (await readJson(response)) as Record<string, unknown>;
    expect(body).toEqual({
      error: {
        message: "Bad request",
        type: "request",
        code: "request_invalid"
      }
    });
  });

  it("returns Anthropic-style error for GatewayError on messages path", async () => {
    const error = new GatewayError("Rate limited", {
      code: "rate_limit_exceeded",
      category: "rate_limit",
      httpStatus: 429,
      retryable: false,
      requestId: "req-2"
    });
    const response = toErrorResponse(error, "req-2", "/v1/messages");
    expect(response.status).toBe(429);
    const body = (await readJson(response)) as Record<string, unknown>;
    expect(body).toEqual({
      type: "error",
      error: {
        type: "rate_limit",
        message: "Rate limited"
      },
      request_id: "req-2"
    });
  });

  it("includes error headers in response", () => {
    const error = new GatewayError("Limited", {
      code: "limited",
      category: "rate_limit",
      httpStatus: 429,
      retryable: false,
      requestId: "req-3",
      headers: { "retry-after": "30", "x-ratelimit-limit": "100" }
    });
    const response = toErrorResponse(error, "req-3", "/v1/chat/completions");
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("x-ratelimit-limit")).toBe("100");
  });

  it("returns OpenAI-style 500 for non-GatewayError", async () => {
    const response = toErrorResponse(
      new Error("boom"),
      "req-4",
      "/v1/chat/completions"
    );
    expect(response.status).toBe(500);
    const body = (await readJson(response)) as Record<string, unknown>;
    expect(body).toEqual({
      error: {
        message: "Internal server error",
        type: "internal_error",
        code: "internal_error"
      }
    });
  });

  it("returns Anthropic-style 500 for non-GatewayError on messages path", async () => {
    const response = toErrorResponse(
      new Error("boom"),
      "req-5",
      "/v1/messages"
    );
    expect(response.status).toBe(500);
    const body = (await readJson(response)) as Record<string, unknown>;
    expect(body).toEqual({
      type: "error",
      error: {
        type: "internal_error",
        message: "Internal server error"
      },
      request_id: "req-5"
    });
  });
});
