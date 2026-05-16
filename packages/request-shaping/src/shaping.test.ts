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
  type OutboundRequestShape,
  type RouteRequestShapingProfile
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

  it("deep merges nested jsonBody objects instead of replacing them wholesale", () => {
    expect(
      applyRequestShaping(createOutboundRequestShape(), {
        jsonBody: {
          metadata: {
            source: "route",
            nested: {
              trace: true
            }
          }
        }
      })
    ).toEqual({
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
        model: "gpt-4.1-mini",
        metadata: {
          source: "route",
          nested: {
            trace: true
          }
        }
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
          components: [
            "method",
            "path",
            "query",
            "body_sha256",
            "header:x-api-key"
          ]
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

  it("rejects reserved signing output headers", async () => {
    await expect(
      applySigningStrategy(
        createOutboundRequestShape(),
        {
          type: "hmac_sha256_header",
          headerName: "authorization",
          secret: {
            secretRef: "shared-signing-secret"
          },
          components: ["method", "path"]
        },
        {
          "shared-signing-secret": "signing-secret"
        }
      )
    ).rejects.toThrow(GatewayError);
  });

  it("rejects self-referential signing header components", async () => {
    await expect(
      applySigningStrategy(
        createOutboundRequestShape(),
        {
          type: "hmac_sha256_header",
          headerName: "x-airlock-signature",
          secret: {
            secretRef: "shared-signing-secret"
          },
          components: ["method", "header:x-airlock-signature"]
        },
        {
          "shared-signing-secret": "signing-secret"
        }
      )
    ).rejects.toThrow(GatewayError);
  });

  it("rejects shaping headers that collide with the signing output header", async () => {
    await expect(
      applySigningStrategy(
        applyRequestShaping(createOutboundRequestShape(), {
          headers: {
            "x-airlock-signature": "override"
          }
        }),
        {
          type: "hmac_sha256_header",
          headerName: "x-airlock-signature",
          secret: {
            secretRef: "shared-signing-secret"
          },
          components: ["method", "path"]
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
            },
            signing: {
              type: "hmac_sha256_header",
              headerName: "x-airlock-signature",
              secret: {
                secretRef: "openai-signing-secret"
              },
              components: ["method", "path"]
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
        },
        signing: {
          type: "hmac_sha256_header",
          headerName: "x-airlock-signature",
          secret: {
            secretRef: "openai-signing-secret"
          },
          components: ["method", "path"]
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
            defaults: {
              query: {
                trace: "shared"
              }
            },
            targets: {
              "openai:gpt-4.1-mini": {
                headers: {
                  "openai-beta": "responses=v1"
                },
                signing: {
                  type: "hmac_sha256_header",
                  headerName: "x-airlock-signature",
                  secret: {
                    secretRef: "shared-signing-secret"
                  },
                  components: ["method", "path"]
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
        defaults: {
          query: {
            trace: "shared"
          }
        },
        targets: {
          "openai:gpt-4.1-mini": {
            headers: {
              "openai-beta": "responses=v1"
            },
            signing: {
              type: "hmac_sha256_header",
              headerName: "x-airlock-signature",
              secret: {
                secretRef: "shared-signing-secret"
              },
              components: ["method", "path"]
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

  it("rejects request-scoped signing directives as request errors", () => {
    expect(() =>
      parseRequestRequestShaping({
        signing: {
          type: "hmac_sha256_header",
          headerName: "x-airlock-signature",
          secret: {
            secretRef: "request-secret"
          },
          components: ["method", "path"]
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

  it("rejects header values containing carriage return", () => {
    expect(() =>
      parseRequestRequestShaping({
        headers: {
          "x-custom": "value\rX-Injected: malicious"
        }
      })
    ).toThrow(GatewayError);
  });

  it("rejects header values containing newline", () => {
    expect(() =>
      parseRequestRequestShaping({
        headers: {
          "x-custom": "value\nX-Injected: malicious"
        }
      })
    ).toThrow(GatewayError);
  });

  it("rejects header names containing carriage return", () => {
    expect(() =>
      parseRequestRequestShaping({
        headers: {
          "x-custom\rX-Injected": "value"
        }
      })
    ).toThrow(GatewayError);
  });

  it("rejects header names containing newline", () => {
    expect(() =>
      parseRequestRequestShaping({
        headers: {
          "x-custom\nX-Injected": "value"
        }
      })
    ).toThrow(GatewayError);
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

  it("deep merges nested jsonBody objects across merged shaping profiles", () => {
    expect(
      mergeRequestShapingProfiles(
        {
          jsonBody: {
            metadata: {
              source: "route",
              nested: {
                trace: true,
                level: 1
              }
            }
          }
        },
        {
          jsonBody: {
            metadata: {
              nested: {
                level: 2,
                span: "request"
              }
            }
          }
        }
      )
    ).toEqual({
      jsonBody: {
        metadata: {
          source: "route",
          nested: {
            trace: true,
            level: 2,
            span: "request"
          }
        }
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
      defaults: {
        query: {
          trace: "shared"
        }
      },
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

  it("merges target-scoped defaults with target-specific overrides", () => {
    const shaping: RouteRequestShapingProfile = {
      defaults: {
        query: {
          trace: "shared"
        },
        jsonBody: {
          temperature: 0.2
        },
        signing: {
          type: "hmac_sha256_header" as const,
          headerName: "x-airlock-signature",
          secret: {
            secretRef: "shared-signing-secret"
          },
          components: ["method", "path"] as const
        }
      },
      targets: {
        "anthropic:claude-haiku-4-5": {
          query: {
            trace: "target"
          },
          jsonBody: {
            metadata: "fallback"
          },
          signing: {
            type: "hmac_sha256_header" as const,
            headerName: "x-fallback-signature",
            secret: {
              secretRef: "fallback-signing-secret"
            },
            components: ["method", "path", "query"] as const
          }
        }
      }
    };

    expect(
      resolveRouteRequestShapingForTarget(
        shaping,
        "openai:gpt-4.1-mini",
        "anthropic:claude-haiku-4-5"
      )
    ).toEqual({
      query: {
        trace: "target"
      },
      jsonBody: {
        temperature: 0.2,
        metadata: "fallback"
      },
      signing: {
        type: "hmac_sha256_header",
        headerName: "x-fallback-signature",
        secret: {
          secretRef: "fallback-signing-secret"
        },
        components: ["method", "path", "query"]
      }
    });
  });

  it("falls back to target-scoped defaults when an active target has no specific override", () => {
    const shaping = {
      defaults: {
        headers: {
          "openai-beta": "responses=v1"
        },
        query: {
          trace: "shared"
        }
      },
      targets: {
        "openai:gpt-4.1-mini": {}
      }
    };

    expect(
      resolveRouteRequestShapingForTarget(
        shaping,
        "openai:gpt-4.1-mini",
        "openai:gpt-4.1-nano"
      )
    ).toEqual({
      headers: {
        "openai-beta": "responses=v1"
      },
      query: {
        trace: "shared"
      }
    });
  });
});
