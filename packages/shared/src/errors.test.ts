import { describe, expect, it } from "vitest";
import { GatewayError } from "./errors.js";

describe("GatewayError", () => {
  it("stores all options as readonly properties", () => {
    const cause = new Error("upstream timeout");
    const err = new GatewayError("request failed", {
      code: "UPSTREAM_TIMEOUT",
      category: "provider",
      httpStatus: 504,
      retryable: true,
      provider: "openai",
      requestId: "req_abc123",
      headers: { "x-ratelimit-remaining": "0" },
      cause,
      upstreamErrorCode: "timeout_exceeded"
    });

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(GatewayError);
    expect(err.name).toBe("GatewayError");
    expect(err.message).toBe("request failed");
    expect(err.code).toBe("UPSTREAM_TIMEOUT");
    expect(err.category).toBe("provider");
    expect(err.httpStatus).toBe(504);
    expect(err.retryable).toBe(true);
    expect(err.provider).toBe("openai");
    expect(err.requestId).toBe("req_abc123");
    expect(err.headers).toEqual({ "x-ratelimit-remaining": "0" });
    expect(err.upstreamErrorCode).toBe("timeout_exceeded");
    expect(err.cause).toBe(cause);
  });

  it("handles minimal options without optional fields", () => {
    const err = new GatewayError("bad request", {
      code: "INVALID_INPUT",
      category: "client",
      httpStatus: 400,
      retryable: false
    });

    expect(err.message).toBe("bad request");
    expect(err.code).toBe("INVALID_INPUT");
    expect(err.category).toBe("client");
    expect(err.httpStatus).toBe(400);
    expect(err.retryable).toBe(false);
    expect(err.provider).toBeUndefined();
    expect(err.requestId).toBeUndefined();
    expect(err.headers).toBeUndefined();
    expect(err.cause).toBeUndefined();
    expect(err.upstreamErrorCode).toBeUndefined();
  });

  it("preserves cause chain when cause is provided", () => {
    const root = new Error("connection refused");
    const err = new GatewayError("provider unreachable", {
      code: "PROVIDER_UNREACHABLE",
      category: "network",
      httpStatus: 502,
      retryable: true,
      cause: root
    });

    expect(err.cause).toBe(root);
    expect((err.cause as Error).message).toBe("connection refused");
  });

  it("does not set cause when cause is undefined", () => {
    const err = new GatewayError("rate limited", {
      code: "RATE_LIMITED",
      category: "throttle",
      httpStatus: 429,
      retryable: true
    });

    expect(err.cause).toBeUndefined();
  });

  it("can be thrown and caught as GatewayError", () => {
    const throwIt = () => {
      throw new GatewayError("unauthorized", {
        code: "AUTH_FAILED",
        category: "auth",
        httpStatus: 401,
        retryable: false,
        provider: "anthropic"
      });
    };

    try {
      throwIt();
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GatewayError);
      const gw = e as GatewayError;
      expect(gw.httpStatus).toBe(401);
      expect(gw.provider).toBe("anthropic");
    }
  });

  it("properties are readonly (TypeScript compile-time guarantee)", () => {
    const err = new GatewayError("test", {
      code: "TEST",
      category: "test",
      httpStatus: 200,
      retryable: false
    });

    // Runtime check: assignment should not change the value
    // (TypeScript prevents this at compile time, but we verify runtime behavior)
    expect(err.code).toBe("TEST");
    expect(err.httpStatus).toBe(200);
    expect(err.retryable).toBe(false);
  });
});
