import { describe, expect, it } from "vitest";

import { GatewayError } from "@airlock/shared";

import {
  applyAuthStrategy,
  applyRequestShaping,
  applySigningStrategy,
  buildRequestUrl,
  isTargetScopedRouteShapingProfile,
  mergeRequestShapingProfiles,
  parseRouteRequestShaping,
  parseRequestRequestShaping,
  resolveRouteRequestShapingForTarget,
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

describe("applyAuthStrategy", () => {
  it("applies a bearer auth strategy using a resolved secret ref", () => {
    expect(
      applyAuthStrategy(
        createOutboundRequestShape(),
        {
          type: "header_bearer",
          headerName: "authorization",
          credential: {
            secretRef: "openai-api-key"
          }
        },
        {
          "openai-api-key": "test-secret"
        }
      )
    ).toEqual({
      path: "/chat/completions",
      method: "POST",
      headers: {
        authorization: "Bearer test-secret",
        "content-type": "application/json"
      },
      query: {
        existing: "1"
      },
      jsonBody: {
        model: "gpt-4.1-mini"
      }
    });
  });

  it("applies a raw header-value auth strategy using a resolved secret ref", () => {
    expect(
      applyAuthStrategy(
        {
          ...createOutboundRequestShape(),
          headers: {
            "content-type": "application/json"
          }
        },
        {
          type: "header_value",
          headerName: "x-api-key",
          credential: {
            secretRef: "anthropic-api-key"
          }
        },
        {
          "anthropic-api-key": "anthropic-secret"
        }
      )
    ).toEqual({
      path: "/chat/completions",
      method: "POST",
      headers: {
        "x-api-key": "anthropic-secret",
        "content-type": "application/json"
      },
      query: {
        existing: "1"
      },
      jsonBody: {
        model: "gpt-4.1-mini"
      }
    });
  });

  it("rejects unresolved auth secret refs", () => {
    expect(() =>
      applyAuthStrategy(
        createOutboundRequestShape(),
        {
          type: "header_bearer",
          headerName: "authorization",
          credential: {
            secretRef: "missing-secret"
          }
        },
        {}
      )
    ).toThrow(GatewayError);
  });
});

describe("applySigningStrategy", () => {
  it("applies an HMAC-SHA256 signature header from deterministic request components", async () => {
    await expect(
      applySigningStrategy(
        {
          ...createOutboundRequestShape(),
          headers: {
            "content-type": "application/json",
            "x-api-key": "test-key"
          },
          query: {
            b: "2",
            a: "1"
          },
          jsonBody: {
            model: "gpt-4.1-mini",
            temperature: 0.2
          }
        },
        {
          type: "hmac_sha256_header",
          headerName: "x-airlock-signature",
          prefix: "sha256=",
          secret: {
            secretRef: "shared-signing-secret"
          },
          components: ["method", "path", "query", "body_sha256", "header:x-api-key"]
        },
        {
          "shared-signing-secret": "signing-secret"
        }
      )
    ).resolves.toMatchObject({
      headers: {
        "x-airlock-signature":
          "sha256=ed0995f1cc152c2a3dfb31be9a508c45c35e7a9a9da1d069a1db1a20b69c569b"
      }
    });
  });

  it("rejects unresolved signing secret refs", async () => {
    await expect(
      applySigningStrategy(
        createOutboundRequestShape(),
        {
          type: "hmac_sha256_header",
          headerName: "x-airlock-signature",
          secret: {
            secretRef: "missing-signing-secret"
          },
          components: ["method", "path"]
        },
        {}
      )
    ).rejects.toThrow(GatewayError);
  });

  it("rejects signing when a referenced header is missing", async () => {
    await expect(
      applySigningStrategy(
        createOutboundRequestShape(),
        {
          type: "hmac_sha256_header",
          headerName: "x-airlock-signature",
          secret: {
            secretRef: "shared-signing-secret"
          },
          components: ["header:x-sign-me"]
        },
        {
          "shared-signing-secret": "signing-secret"
        }
      )
    ).rejects.toThrow(GatewayError);
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

  it("parses target-scoped route shaping profiles", () => {
    expect(
      parseRouteRequestShaping(
        JSON.stringify({
          "assistant-default": {
            targets: {
              "openai:gpt-4.1-mini": {
                headers: {
                  "openai-beta": "responses=v1"
                }
              },
              "anthropic:claude-haiku-4-5": {
                query: {
                  trace: "1"
                }
              }
            }
          }
        })
      )
    ).toEqual({
      "assistant-default": {
        targets: {
          "openai:gpt-4.1-mini": {
            headers: {
              "openai-beta": "responses=v1"
            }
          },
          "anthropic:claude-haiku-4-5": {
            query: {
              trace: "1"
            }
          }
        }
      }
    });
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

describe("resolveRouteRequestShapingForTarget", () => {
  it("applies legacy route shaping only within the primary provider boundary", () => {
    expect(
      resolveRouteRequestShapingForTarget(
        {
          headers: {
            "openai-beta": "responses=v1"
          }
        },
        "openai:gpt-4.1-mini",
        "openai:gpt-4.1-nano"
      )
    ).toEqual({
      headers: {
        "openai-beta": "responses=v1"
      }
    });

    expect(
      resolveRouteRequestShapingForTarget(
        {
          headers: {
            "openai-beta": "responses=v1"
          }
        },
        "openai:gpt-4.1-mini",
        "anthropic:claude-haiku-4-5"
      )
    ).toBeUndefined();
  });

  it("resolves explicit target-scoped shaping profiles by target key", () => {
    const shaping = {
      targets: {
        "openai:gpt-4.1-mini": {
          headers: {
            "openai-beta": "responses=v1"
          }
        },
        "anthropic:claude-haiku-4-5": {
          query: {
            trace: "1"
          }
        }
      }
    };

    expect(isTargetScopedRouteShapingProfile(shaping)).toBe(true);
    expect(
      resolveRouteRequestShapingForTarget(
        shaping,
        "openai:gpt-4.1-mini",
        "anthropic:claude-haiku-4-5"
      )
    ).toEqual({
      query: {
        trace: "1"
      }
    });
  });
});
