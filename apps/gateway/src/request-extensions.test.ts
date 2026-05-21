import { describe, expect, it } from "vitest";

import {
  extractForwardedHeaders,
  extractForwardedQuery
} from "./request-extensions.js";

describe("extractForwardedHeaders", () => {
  it("returns undefined when no custom headers are present", () => {
    const headers = new Headers({
      authorization: "Bearer secret",
      "content-type": "application/json",
      host: "localhost",
      "x-request-id": "req_123"
    });

    expect(extractForwardedHeaders(headers)).toBeUndefined();
  });

  it("extracts custom headers while filtering gateway-internal headers", () => {
    const headers = new Headers({
      authorization: "Bearer secret",
      "content-type": "application/json",
      "x-custom-trace": "trace-abc",
      "x-api-version": "2024-01",
      accept: "application/json"
    });

    const result = extractForwardedHeaders(headers);
    expect(result).toEqual({
      "x-custom-trace": "trace-abc",
      "x-api-version": "2024-01"
    });
  });

  it("filters cf- and sec- prefixed headers", () => {
    const headers = new Headers({
      "cf-connecting-ip": "1.2.3.4",
      "sec-fetch-mode": "cors",
      "x-custom": "value"
    });

    const result = extractForwardedHeaders(headers);
    expect(result).toEqual({ "x-custom": "value" });
  });

  it("returns undefined when all headers are reserved", () => {
    const headers = new Headers({
      authorization: "Bearer secret",
      "content-length": "100",
      connection: "keep-alive"
    });

    expect(extractForwardedHeaders(headers)).toBeUndefined();
  });
});

describe("extractForwardedQuery", () => {
  it("returns undefined for URL without query string", () => {
    expect(extractForwardedQuery("http://localhost/v1/messages")).toBeUndefined();
  });

  it("extracts query parameters from URL", () => {
    const result = extractForwardedQuery(
      "http://localhost/v1/chat/completions?beta=true&version=v2"
    );
    expect(result).toEqual({ beta: "true", version: "v2" });
  });

  it("returns undefined for empty query string", () => {
    expect(extractForwardedQuery("http://localhost/v1/messages?")).toBeUndefined();
  });
});
