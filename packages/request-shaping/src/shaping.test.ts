import { describe, expect, it } from "vitest";

import { GatewayError } from "@airlock/shared";

import {
  applyRequestShaping,
  buildRequestUrl,
  mergeRequestShapingProfiles,
  parseRouteRequestShaping,
  parseRequestRequestShaping,
  type OutboundRequestShape
} from "./shaping.js";

function createOutboundRequestShape(): OutboundRequestShape {
  return {
    path: "/chat/completions",
    method: "POST",
    headers: {
      authorization: "Bearer secret",
      "content-type": "application/json"
    },
    query: {
      existing: "1"
    },
    jsonBody: {
      model: "gpt-4.1-mini"
    }
  };
}

describe("applyRequestShaping", () => {
  it("merges additional headers, query params, and body fields", () => {
    expect(
      applyRequestShaping(createOutboundRequestShape(), {
        headers: {
          "openai-beta": "responses=v1"
        },
        query: {
          "api-version": "2025-01-01"
        },
        jsonBody: {
          temperature: 0.2
        }
      })
    ).toEqual({
      path: "/chat/completions",
      method: "POST",
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json",
        "openai-beta": "responses=v1"
      },
      query: {
        existing: "1",
        "api-version": "2025-01-01"
      },
      jsonBody: {
        model: "gpt-4.1-mini",
        temperature: 0.2
      }
    });
  });

  it("rejects reserved auth-controlled headers", () => {
    expect(() =>
      applyRequestShaping(createOutboundRequestShape(), {
        headers: {
          authorization: "Bearer override"
        }
      })
    ).toThrow(GatewayError);
  });

  it("rejects Gemini auth header overrides", () => {
    expect(() =>
      applyRequestShaping(createOutboundRequestShape(), {
        headers: {
          "x-goog-api-key": "override"
        }
      })
    ).toThrow(GatewayError);
  });
});

describe("buildRequestUrl", () => {
  it("builds a request url with merged query params", () => {
    const shaped = applyRequestShaping(createOutboundRequestShape(), {
      query: {
        "api-version": "2025-01-01"
      }
    });

    expect(buildRequestUrl("https://api.openai.com/v1", shaped)).toBe(
      "https://api.openai.com/v1/chat/completions?existing=1&api-version=2025-01-01"
    );
  });
});

describe("parseRouteRequestShaping", () => {
  it("parses a shaping json object keyed by external model", () => {
    expect(
      parseRouteRequestShaping(
        JSON.stringify({
          "gpt-4.1-mini": {
            headers: {
              "openai-beta": "responses=v1"
            }
          },
          "claude-sonnet-4-5": {
            query: {
              trace: "1"
            },
            jsonBody: {
              metadata: {
                source: "airlock"
              }
            }
          }
        })
      )
    ).toEqual({
      "gpt-4.1-mini": {
        headers: {
          "openai-beta": "responses=v1"
        }
      },
      "claude-sonnet-4-5": {
        query: {
          trace: "1"
        },
        jsonBody: {
          metadata: {
            source: "airlock"
          }
        }
      }
    });
  });

  it("rejects malformed json", () => {
    expect(() => parseRouteRequestShaping("{not-json")).toThrow(GatewayError);
  });

  it("rejects reserved header overrides during parsing", () => {
    expect(() =>
      parseRouteRequestShaping(
        JSON.stringify({
          "gpt-4.1-mini": {
            headers: {
              authorization: "Bearer override"
            }
          }
        })
      )
    ).toThrow(GatewayError);
  });
});

describe("parseRequestRequestShaping", () => {
  it("parses a request-scoped shaping profile", () => {
    expect(
      parseRequestRequestShaping({
        headers: {
          "openai-beta": "responses=v1"
        },
        query: {
          trace: "1"
        },
        jsonBody: {
          temperature: 0.2
        }
      })
    ).toEqual({
      headers: {
        "openai-beta": "responses=v1"
      },
      query: {
        trace: "1"
      },
      jsonBody: {
        temperature: 0.2
      }
    });
  });

  it("rejects reserved header overrides as request errors", () => {
    expect(() =>
      parseRequestRequestShaping({
        headers: {
          authorization: "Bearer override"
        }
      })
    ).toThrowError(
      expect.objectContaining({
        code: "request_invalid_request_shaping",
        category: "request",
        httpStatus: 400,
        retryable: false
      })
    );
  });
});

describe("mergeRequestShapingProfiles", () => {
  it("lets request-scoped shaping override route-scoped shaping on the same key", () => {
    expect(
      mergeRequestShapingProfiles(
        {
          headers: {
            "openai-beta": "responses=v1"
          },
          query: {
            trace: "route"
          },
          jsonBody: {
            temperature: 0.2,
            metadata: "route"
          }
        },
        {
          headers: {
            "openai-beta": "responses=v2"
          },
          query: {
            trace: "request"
          },
          jsonBody: {
            temperature: 0.8
          }
        }
      )
    ).toEqual({
      headers: {
        "openai-beta": "responses=v2"
      },
      query: {
        trace: "request"
      },
      jsonBody: {
        temperature: 0.8,
        metadata: "route"
      }
    });
  });
});
