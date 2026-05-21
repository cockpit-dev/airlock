import { describe, expect, it } from "vitest";

import {
  parseCorsOrigins,
  corsHeaders,
  createPreflightResponse
} from "./cors.js";

describe("parseCorsOrigins", () => {
  it("returns undefined when input is undefined", () => {
    expect(parseCorsOrigins(undefined)).toEqual({ allowedOrigins: undefined });
  });

  it("returns undefined when input is empty string", () => {
    expect(parseCorsOrigins("")).toEqual({ allowedOrigins: undefined });
  });

  it("returns undefined when input is whitespace only", () => {
    expect(parseCorsOrigins("  ")).toEqual({ allowedOrigins: undefined });
  });

  it("returns wildcard for asterisk", () => {
    expect(parseCorsOrigins("*")).toEqual({ allowedOrigins: "*" });
  });

  it("returns trimmed comma-separated origins", () => {
    expect(
      parseCorsOrigins("http://localhost:3000, https://example.com")
    ).toEqual({ allowedOrigins: "http://localhost:3000, https://example.com" });
  });

  it("trims surrounding whitespace", () => {
    expect(parseCorsOrigins("  http://localhost:3000  ")).toEqual({
      allowedOrigins: "http://localhost:3000"
    });
  });
});

describe("corsHeaders", () => {
  it("echoes back browser origin when CORS is not explicitly configured", () => {
    const headers = corsHeaders("http://localhost:3000", {
      allowedOrigins: undefined
    });
    expect(headers["Access-Control-Allow-Origin"]).toBe(
      "http://localhost:3000"
    );
    expect(headers["Access-Control-Allow-Methods"]).toBeDefined();
  });

  it("returns empty object when no explicit config and no request origin", () => {
    expect(corsHeaders(undefined, { allowedOrigins: undefined })).toEqual({});
  });

  it("returns wildcard headers when origins is asterisk", () => {
    const headers = corsHeaders(undefined, { allowedOrigins: "*" });
    expect(headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(headers["Access-Control-Allow-Methods"]).toBeDefined();
    expect(headers["Access-Control-Allow-Headers"]).toBeDefined();
  });

  it("returns matching origin when request origin is allowed", () => {
    const headers = corsHeaders("http://localhost:3000", {
      allowedOrigins: "http://localhost:3000, https://example.com"
    });
    expect(headers["Access-Control-Allow-Origin"]).toBe(
      "http://localhost:3000"
    );
    expect(headers["Access-Control-Allow-Methods"]).toBe("GET, POST, OPTIONS");
  });

  it("returns empty object when request origin is not in allowed list", () => {
    const headers = corsHeaders("http://evil.com", {
      allowedOrigins: "http://localhost:3000, https://example.com"
    });
    expect(headers).toEqual({});
  });

  it("returns empty object when origins list is set but request has no origin", () => {
    const headers = corsHeaders(undefined, {
      allowedOrigins: "http://localhost:3000"
    });
    expect(headers).toEqual({});
  });

  it("includes expose-headers in response", () => {
    const headers = corsHeaders("http://localhost:3000", {
      allowedOrigins: "http://localhost:3000"
    });
    expect(headers["Access-Control-Expose-Headers"]).toContain("X-Request-ID");
    expect(headers["Access-Control-Max-Age"]).toBe("86400");
  });
});

describe("createPreflightResponse", () => {
  it("returns 403 when origin is not allowed", () => {
    const response = createPreflightResponse("http://evil.com", {
      allowedOrigins: "http://localhost:3000"
    });
    expect(response.status).toBe(403);
  });

  it("returns 204 with CORS headers when origin is allowed", () => {
    const response = createPreflightResponse("http://localhost:3000", {
      allowedOrigins: "http://localhost:3000"
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:3000"
    );
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET, POST, OPTIONS"
    );
  });

  it("returns 204 with wildcard when origins is asterisk", () => {
    const response = createPreflightResponse(undefined, {
      allowedOrigins: "*"
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("echoes back request headers in allow-headers", () => {
    const response = createPreflightResponse(
      "http://localhost:3000",
      {
        allowedOrigins: "http://localhost:3000"
      },
      {
        requestHeaders: "X-Stainless-OS, X-Stainless-Runtime"
      }
    );
    const allowHeaders = response.headers.get("Access-Control-Allow-Headers")!;
    expect(allowHeaders).toContain("Authorization");
    expect(allowHeaders).toContain("X-Stainless-OS");
    expect(allowHeaders).toContain("X-Stainless-Runtime");
  });

  it("uses baseline headers when no request headers provided", () => {
    const response = createPreflightResponse("http://localhost:3000", {
      allowedOrigins: "http://localhost:3000"
    });
    const allowHeaders = response.headers.get("Access-Control-Allow-Headers")!;
    expect(allowHeaders).toContain("Authorization");
    expect(allowHeaders).toContain("X-Request-ID");
  });
});
