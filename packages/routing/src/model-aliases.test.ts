import { describe, expect, it } from "vitest";

import { GatewayError } from "@airlock/shared";

import {
  attachRouteFallbacks,
  attachRouteKeyAccessPolicy,
  attachRouteRequestShaping,
  attachRouteTargetSelection,
  getProviderModelId,
  listExternalModels,
  parseModelAliases,
  parseRouteFallbacks,
  parseRouteKeyAccessPolicy,
  parseRouteTargetSelection,
  resolveModelRoute
} from "./model-aliases.js";

describe("parseModelAliases", () => {
  it("parses a comma-separated alias map into structured routes", () => {
    expect(
      parseModelAliases(
        "gpt-4.1-mini=openai-prod:gpt-4.1-mini,claude-sonnet-4-5=openai-backup:gpt-4.1-mini"
      )
    ).toEqual([
      {
        externalModel: "gpt-4.1-mini",
        target: {
          provider: "openai-prod",
          providerModel: "gpt-4.1-mini"
        }
      },
      {
        externalModel: "claude-sonnet-4-5",
        target: {
          provider: "openai-backup",
          providerModel: "gpt-4.1-mini"
        }
      }
    ]);
  });

  it("returns no routes when aliases are absent", () => {
    expect(parseModelAliases(undefined)).toEqual([]);
  });

  it("parses explicit provider-instance route syntax", () => {
    expect(
      parseModelAliases(
        "gpt-4.1-mini=openai-prod:gpt-4.1-mini,claude-sonnet-4-5=anthropic-team-a:claude-sonnet-4-5,gemini-2.5-flash=gemini-free:gemini-2.5-flash"
      )
    ).toEqual([
      {
        externalModel: "gpt-4.1-mini",
        target: {
          provider: "openai-prod",
          providerModel: "gpt-4.1-mini"
        }
      },
      {
        externalModel: "claude-sonnet-4-5",
        target: {
          provider: "anthropic-team-a",
          providerModel: "claude-sonnet-4-5"
        }
      },
      {
        externalModel: "gemini-2.5-flash",
        target: {
          provider: "gemini-free",
          providerModel: "gemini-2.5-flash"
        }
      }
    ]);
  });

  it("rejects aliases with empty model parts", () => {
    expect(() => parseModelAliases("gpt-4.1-mini=")).toThrow(GatewayError);
  });

  it("rejects target entries without a provider instance key", () => {
    expect(() => parseModelAliases("gpt-4.1-mini=gpt-4.1-mini")).toThrow(
      GatewayError
    );
  });

  it("rejects duplicate external model aliases", () => {
    expect(() =>
      parseModelAliases("gpt-4.1-mini=gpt-4.1-mini,gpt-4.1-mini=other-model")
    ).toThrow(GatewayError);
  });
});

describe("resolveModelRoute", () => {
  it("resolves an external model to a structured route", () => {
    expect(
      resolveModelRoute("claude-sonnet-4-5", [
        {
          externalModel: "gpt-4.1-mini",
          target: {
            provider: "openai",
            providerModel: "gpt-4.1-mini"
          }
        },
        {
          externalModel: "claude-sonnet-4-5",
          target: {
            provider: "openai",
            providerModel: "gpt-4.1-mini"
          }
        }
      ])
    ).toEqual({
      externalModel: "claude-sonnet-4-5",
      target: {
        provider: "openai",
        providerModel: "gpt-4.1-mini"
      }
    });
  });

  it("throws a typed error for unknown models", () => {
    expect(() =>
      resolveModelRoute("unknown-model", [
        {
          externalModel: "gpt-4.1-mini",
          target: {
            provider: "openai",
            providerModel: "gpt-4.1-mini"
          }
        }
      ])
    ).toThrow(GatewayError);
  });

  it("resolves provider/model format by matching route target", () => {
    const routes = [
      {
        externalModel: "gpt-4.1-mini",
        target: { provider: "openai" as const, providerModel: "gpt-4.1-mini" }
      },
      {
        externalModel: "claude-sonnet-4-5",
        target: {
          provider: "anthropic" as const,
          providerModel: "claude-sonnet-4-5"
        }
      }
    ];

    const route = resolveModelRoute("anthropic/claude-sonnet-4-5", routes);
    expect(route.externalModel).toBe("claude-sonnet-4-5");
    expect(route.target).toEqual({
      provider: "anthropic",
      providerModel: "claude-sonnet-4-5"
    });
  });

  it("creates a synthetic route for provider/model with no matching route", () => {
    const routes = [
      {
        externalModel: "gpt-4.1-mini",
        target: { provider: "openai" as const, providerModel: "gpt-4.1-mini" }
      }
    ];

    const route = resolveModelRoute("gemini/gemini-2.5-pro", routes);
    expect(route).toEqual({
      externalModel: "gemini/gemini-2.5-pro",
      target: {
        provider: "gemini",
        providerModel: "gemini-2.5-pro"
      }
    });
  });

  it("prefers exact externalModel match over provider/model format", () => {
    const routes = [
      {
        externalModel: "openai/gpt-4.1-mini",
        target: {
          provider: "anthropic" as const,
          providerModel: "claude-sonnet-4-5"
        }
      }
    ];

    const route = resolveModelRoute("openai/gpt-4.1-mini", routes);
    expect(route.externalModel).toBe("openai/gpt-4.1-mini");
    expect(route.target.provider).toBe("anthropic");
  });

  it("treats provider/model provider segment as a provider instance id", () => {
    const route = resolveModelRoute("vertex/gemini-2.5-pro", [
      {
        externalModel: "gpt-4.1-mini",
        target: { provider: "openai", providerModel: "gpt-4.1-mini" }
      }
    ]);

    expect(route.target).toEqual({
      provider: "vertex",
      providerModel: "gemini-2.5-pro"
    });
  });

  it("includes requestId in model_not_found error", () => {
    try {
      resolveModelRoute("unknown", [], "req-123");
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GatewayError);
      expect((e as GatewayError).requestId).toBe("req-123");
    }
  });
});

describe("listExternalModels", () => {
  it("returns provider/model format derived from route targets", () => {
    expect(
      listExternalModels([
        {
          externalModel: "gpt-4.1-mini",
          target: {
            provider: "openai",
            providerModel: "gpt-4.1-mini"
          }
        },
        {
          externalModel: "claude-sonnet-4-5",
          target: {
            provider: "anthropic",
            providerModel: "claude-sonnet-4-5"
          }
        }
      ])
    ).toEqual(["openai/gpt-4.1-mini", "anthropic/claude-sonnet-4-5"]);
  });

  it("deduplicates routes that share the same provider target", () => {
    expect(
      listExternalModels([
        {
          externalModel: "gpt-4.1-mini",
          target: {
            provider: "openai",
            providerModel: "gpt-4.1-mini"
          }
        },
        {
          externalModel: "fast-chat",
          target: {
            provider: "openai",
            providerModel: "gpt-4.1-mini"
          }
        }
      ])
    ).toEqual(["openai/gpt-4.1-mini"]);
  });
});

describe("getProviderModelId", () => {
  it("returns provider/model format from a route target", () => {
    expect(
      getProviderModelId({
        externalModel: "gpt-4.1-mini",
        target: { provider: "openai", providerModel: "gpt-4.1-mini" }
      })
    ).toBe("openai/gpt-4.1-mini");
  });
});

describe("attachRouteRequestShaping", () => {
  it("attaches shaping profiles to matching routes", () => {
    expect(
      attachRouteRequestShaping(
        parseModelAliases(
          "gpt-4.1-mini=openai:gpt-4.1-mini,claude-sonnet-4-5=anthropic:claude-sonnet-4-5"
        ),
        {
          "gpt-4.1-mini": {
            headers: {
              "openai-beta": "responses=v1"
            }
          }
        }
      )
    ).toEqual([
      {
        externalModel: "gpt-4.1-mini",
        target: {
          provider: "openai",
          providerModel: "gpt-4.1-mini"
        },
        shaping: {
          headers: {
            "openai-beta": "responses=v1"
          }
        }
      },
      {
        externalModel: "claude-sonnet-4-5",
        target: {
          provider: "anthropic",
          providerModel: "claude-sonnet-4-5"
        }
      }
    ]);
  });

  it("rejects shaping keys that do not match configured routes", () => {
    expect(() =>
      attachRouteRequestShaping(
        parseModelAliases("gpt-4.1-mini=gpt-4.1-mini"),
        {
          unknown: {
            headers: {
              "openai-beta": "responses=v1"
            }
          }
        }
      )
    ).toThrow(GatewayError);
  });

  it("attaches target-scoped shaping profiles while preserving backward compatibility", () => {
    expect(
      attachRouteRequestShaping(
        attachRouteFallbacks(
          parseModelAliases("assistant-default=openai:gpt-4.1-mini"),
          {
            "assistant-default": ["anthropic:claude-haiku-4-5"]
          }
        ),
        {
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
        }
      )
    ).toEqual([
      {
        externalModel: "assistant-default",
        target: {
          provider: "openai",
          providerModel: "gpt-4.1-mini"
        },
        fallbacks: [
          {
            provider: "anthropic",
            providerModel: "claude-haiku-4-5"
          }
        ],
        shaping: {
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
      }
    ]);
  });
});

describe("parseRouteFallbacks", () => {
  it("parses fallback targets keyed by external model", () => {
    expect(
      parseRouteFallbacks(
        JSON.stringify({
          "gpt-4.1-mini": ["openai:gpt-4.1-nano"],
          "claude-sonnet-4-5": ["anthropic:claude-haiku-4-5"]
        })
      )
    ).toEqual({
      "gpt-4.1-mini": ["openai:gpt-4.1-nano"],
      "claude-sonnet-4-5": ["anthropic:claude-haiku-4-5"]
    });
  });

  it("rejects malformed fallback json", () => {
    expect(() => parseRouteFallbacks("{not-json")).toThrow(GatewayError);
  });
});

describe("parseRouteTargetSelection", () => {
  it("parses weighted target selection keyed by external model", () => {
    expect(
      parseRouteTargetSelection(
        JSON.stringify({
          "assistant-default": {
            strategy: "weighted",
            weights: {
              "openai:gpt-4.1-mini": 1,
              "anthropic:claude-haiku-4-5": 4
            }
          }
        })
      )
    ).toEqual({
      "assistant-default": {
        strategy: "weighted",
        weights: {
          "openai:gpt-4.1-mini": 1,
          "anthropic:claude-haiku-4-5": 4
        }
      }
    });
  });

  it("parses health-priority target selection keyed by external model", () => {
    expect(
      parseRouteTargetSelection(
        JSON.stringify({
          "assistant-default": {
            strategy: "health_priority"
          }
        })
      )
    ).toEqual({
      "assistant-default": {
        strategy: "health_priority"
      }
    });
  });

  it("rejects malformed target selection json", () => {
    expect(() => parseRouteTargetSelection("{not-json")).toThrow(GatewayError);
  });

  it("parses lowest-cost target selection keyed by external model", () => {
    expect(
      parseRouteTargetSelection(
        JSON.stringify({
          "assistant-default": {
            strategy: "lowest_cost",
            costs: {
              "openai:gpt-4.1-mini": 10,
              "anthropic:claude-haiku-4-5": 3
            }
          }
        })
      )
    ).toEqual({
      "assistant-default": {
        strategy: "lowest_cost",
        costs: {
          "openai:gpt-4.1-mini": 10,
          "anthropic:claude-haiku-4-5": 3
        }
      }
    });
  });

  it("parses priority target selection keyed by external model", () => {
    expect(
      parseRouteTargetSelection(
        JSON.stringify({
          "assistant-default": {
            strategy: "priority",
            latencySloMs: {
              "openai:gpt-4.1-mini": 300,
              "anthropic:claude-haiku-4-5": 800
            },
            costs: {
              "openai:gpt-4.1-mini": 10,
              "anthropic:claude-haiku-4-5": 3
            }
          }
        })
      )
    ).toEqual({
      "assistant-default": {
        strategy: "priority",
        latencySloMs: {
          "openai:gpt-4.1-mini": 300,
          "anthropic:claude-haiku-4-5": 800
        },
        costs: {
          "openai:gpt-4.1-mini": 10,
          "anthropic:claude-haiku-4-5": 3
        }
      }
    });
  });

  it("rejects priority target selection without latency or cost hints", () => {
    expect(() =>
      parseRouteTargetSelection(
        JSON.stringify({
          "assistant-default": {
            strategy: "priority"
          }
        })
      )
    ).toThrow(GatewayError);
  });

  it("parses health-score target selection", () => {
    expect(
      parseRouteTargetSelection(
        JSON.stringify({
          "assistant-default": {
            strategy: "health_score",
            latencySloMs: {
              "openai:gpt-4.1-mini": 300,
              "anthropic:claude-haiku-4-5": 800
            }
          }
        })
      )
    ).toEqual({
      "assistant-default": {
        strategy: "health_score",
        latencySloMs: {
          "openai:gpt-4.1-mini": 300,
          "anthropic:claude-haiku-4-5": 800
        }
      }
    });
  });

  it("parses health-score target selection without latencySloMs", () => {
    expect(
      parseRouteTargetSelection(
        JSON.stringify({
          "assistant-default": {
            strategy: "health_score"
          }
        })
      )
    ).toEqual({
      "assistant-default": {
        strategy: "health_score"
      }
    });
  });
});

describe("parseRouteKeyAccessPolicy", () => {
  it("parses route key access policy keyed by external model", () => {
    expect(
      parseRouteKeyAccessPolicy(
        JSON.stringify({
          "assistant-default": {
            requiredKeyTier: "prod",
            requiredKeyTags: ["internal", "critical"]
          }
        })
      )
    ).toEqual({
      "assistant-default": {
        requiredKeyTier: "prod",
        requiredKeyTags: ["internal", "critical"]
      }
    });
  });

  it("rejects malformed route key access policy json", () => {
    expect(() => parseRouteKeyAccessPolicy("{not-json")).toThrow(GatewayError);
  });

  it("rejects duplicate required route key tags", () => {
    expect(() =>
      parseRouteKeyAccessPolicy(
        JSON.stringify({
          "assistant-default": {
            requiredKeyTags: ["internal", "internal"]
          }
        })
      )
    ).toThrow(GatewayError);
  });
});

describe("attachRouteFallbacks", () => {
  it("attaches fallback targets to matching routes", () => {
    expect(
      attachRouteFallbacks(
        parseModelAliases(
          "gpt-4.1-mini=openai:gpt-4.1-mini,claude-sonnet-4-5=anthropic:claude-sonnet-4-5"
        ),
        {
          "gpt-4.1-mini": ["openai:gpt-4.1-nano"]
        }
      )
    ).toEqual([
      {
        externalModel: "gpt-4.1-mini",
        target: {
          provider: "openai",
          providerModel: "gpt-4.1-mini"
        },
        fallbacks: [
          {
            provider: "openai",
            providerModel: "gpt-4.1-nano"
          }
        ]
      },
      {
        externalModel: "claude-sonnet-4-5",
        target: {
          provider: "anthropic",
          providerModel: "claude-sonnet-4-5"
        }
      }
    ]);
  });

  it("rejects fallback keys that do not match configured routes", () => {
    expect(() =>
      attachRouteFallbacks(parseModelAliases("gpt-4.1-mini=gpt-4.1-mini"), {
        unknown: ["openai:gpt-4.1-nano"]
      })
    ).toThrow(GatewayError);
  });

  it("allows cross-provider fallback targets for unshaped routes", () => {
    expect(
      attachRouteFallbacks(
        parseModelAliases("gpt-4.1-mini=openai:gpt-4.1-mini"),
        {
          "gpt-4.1-mini": ["anthropic:claude-haiku-4-5"]
        }
      )
    ).toEqual([
      {
        externalModel: "gpt-4.1-mini",
        target: {
          provider: "openai",
          providerModel: "gpt-4.1-mini"
        },
        fallbacks: [
          {
            provider: "anthropic",
            providerModel: "claude-haiku-4-5"
          }
        ]
      }
    ]);
  });

  it("allows cross-provider fallback targets for shaped routes without target-scoped shaping", () => {
    expect(
      attachRouteFallbacks(
        attachRouteRequestShaping(
          parseModelAliases("gpt-4.1-mini=openai:gpt-4.1-mini"),
          {
            "gpt-4.1-mini": {
              headers: {
                "openai-beta": "responses=v1"
              }
            }
          }
        ),
        {
          "gpt-4.1-mini": ["anthropic:claude-haiku-4-5"]
        }
      )
    ).toEqual([
      {
        externalModel: "gpt-4.1-mini",
        target: {
          provider: "openai",
          providerModel: "gpt-4.1-mini"
        },
        shaping: {
          headers: {
            "openai-beta": "responses=v1"
          }
        },
        fallbacks: [
          {
            provider: "anthropic",
            providerModel: "claude-haiku-4-5"
          }
        ]
      }
    ]);
  });

  it("rejects duplicate fallback targets", () => {
    expect(() =>
      attachRouteFallbacks(
        parseModelAliases("gpt-4.1-mini=openai:gpt-4.1-mini"),
        {
          "gpt-4.1-mini": ["openai:gpt-4.1-nano", "openai:gpt-4.1-nano"]
        }
      )
    ).toThrow(GatewayError);
  });

  it("allows cross-provider fallback targets for shaped routes when target-scoped shaping exists for every target", () => {
    expect(
      attachRouteFallbacks(
        attachRouteRequestShaping(
          parseModelAliases("assistant-default=openai:gpt-4.1-mini"),
          {
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
          }
        ),
        {
          "assistant-default": ["anthropic:claude-haiku-4-5"]
        }
      )
    ).toEqual([
      {
        externalModel: "assistant-default",
        target: {
          provider: "openai",
          providerModel: "gpt-4.1-mini"
        },
        shaping: {
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
        },
        fallbacks: [
          {
            provider: "anthropic",
            providerModel: "claude-haiku-4-5"
          }
        ]
      }
    ]);
  });
});

describe("attachRouteTargetSelection", () => {
  it("attaches weighted selection to a matching route", () => {
    expect(
      attachRouteTargetSelection(
        attachRouteFallbacks(
          parseModelAliases(
            "assistant-default=openai:gpt-4.1-mini,claude-haiku-4-5=anthropic:claude-haiku-4-5"
          ),
          {
            "assistant-default": ["anthropic:claude-haiku-4-5"]
          }
        ),
        {
          "assistant-default": {
            strategy: "weighted",
            weights: {
              "openai:gpt-4.1-mini": 1,
              "anthropic:claude-haiku-4-5": 4
            }
          }
        }
      )
    ).toEqual([
      {
        externalModel: "assistant-default",
        target: {
          provider: "openai",
          providerModel: "gpt-4.1-mini"
        },
        fallbacks: [
          {
            provider: "anthropic",
            providerModel: "claude-haiku-4-5"
          }
        ],
        targetSelection: {
          strategy: "weighted",
          weights: {
            "openai:gpt-4.1-mini": 1,
            "anthropic:claude-haiku-4-5": 4
          }
        }
      },
      {
        externalModel: "claude-haiku-4-5",
        target: {
          provider: "anthropic",
          providerModel: "claude-haiku-4-5"
        }
      }
    ]);
  });

  it("rejects target selection keys that do not match configured routes", () => {
    expect(() =>
      attachRouteTargetSelection(
        parseModelAliases("gpt-4.1-mini=gpt-4.1-mini"),
        {
          unknown: {
            strategy: "weighted",
            weights: {
              "openai:gpt-4.1-mini": 1
            }
          }
        }
      )
    ).toThrow(GatewayError);
  });

  it("rejects weighted targets that do not exist in the route chain", () => {
    expect(() =>
      attachRouteTargetSelection(
        parseModelAliases("gpt-4.1-mini=openai:gpt-4.1-mini"),
        {
          "gpt-4.1-mini": {
            strategy: "weighted",
            weights: {
              "openai:gpt-4.1-nano": 1
            }
          }
        }
      )
    ).toThrow(GatewayError);
  });

  it("attaches lowest-cost selection to a matching route", () => {
    expect(
      attachRouteTargetSelection(
        attachRouteFallbacks(
          parseModelAliases(
            "assistant-default=openai:gpt-4.1-mini,claude-haiku-4-5=anthropic:claude-haiku-4-5"
          ),
          {
            "assistant-default": ["anthropic:claude-haiku-4-5"]
          }
        ),
        {
          "assistant-default": {
            strategy: "lowest_cost",
            costs: {
              "openai:gpt-4.1-mini": 10,
              "anthropic:claude-haiku-4-5": 3
            }
          }
        }
      )
    ).toEqual([
      {
        externalModel: "assistant-default",
        target: {
          provider: "openai",
          providerModel: "gpt-4.1-mini"
        },
        fallbacks: [
          {
            provider: "anthropic",
            providerModel: "claude-haiku-4-5"
          }
        ],
        targetSelection: {
          strategy: "lowest_cost",
          costs: {
            "openai:gpt-4.1-mini": 10,
            "anthropic:claude-haiku-4-5": 3
          }
        }
      },
      {
        externalModel: "claude-haiku-4-5",
        target: {
          provider: "anthropic",
          providerModel: "claude-haiku-4-5"
        }
      }
    ]);
  });

  it("rejects lowest-cost targets that do not exist in the route chain", () => {
    expect(() =>
      attachRouteTargetSelection(
        parseModelAliases("gpt-4.1-mini=openai:gpt-4.1-mini"),
        {
          "gpt-4.1-mini": {
            strategy: "lowest_cost",
            costs: {
              "openai:gpt-4.1-nano": 1
            }
          }
        }
      )
    ).toThrow(GatewayError);
  });

  it("attaches priority selection to a matching route", () => {
    expect(
      attachRouteTargetSelection(
        attachRouteFallbacks(
          parseModelAliases(
            "assistant-default=openai:gpt-4.1-mini,claude-haiku-4-5=anthropic:claude-haiku-4-5"
          ),
          {
            "assistant-default": ["anthropic:claude-haiku-4-5"]
          }
        ),
        {
          "assistant-default": {
            strategy: "priority",
            latencySloMs: {
              "openai:gpt-4.1-mini": 300,
              "anthropic:claude-haiku-4-5": 800
            },
            costs: {
              "openai:gpt-4.1-mini": 10,
              "anthropic:claude-haiku-4-5": 3
            }
          }
        }
      )
    ).toEqual([
      {
        externalModel: "assistant-default",
        target: {
          provider: "openai",
          providerModel: "gpt-4.1-mini"
        },
        fallbacks: [
          {
            provider: "anthropic",
            providerModel: "claude-haiku-4-5"
          }
        ],
        targetSelection: {
          strategy: "priority",
          latencySloMs: {
            "openai:gpt-4.1-mini": 300,
            "anthropic:claude-haiku-4-5": 800
          },
          costs: {
            "openai:gpt-4.1-mini": 10,
            "anthropic:claude-haiku-4-5": 3
          }
        }
      },
      {
        externalModel: "claude-haiku-4-5",
        target: {
          provider: "anthropic",
          providerModel: "claude-haiku-4-5"
        }
      }
    ]);
  });

  it("rejects priority targets that do not exist in the route chain", () => {
    expect(() =>
      attachRouteTargetSelection(
        parseModelAliases("gpt-4.1-mini=openai:gpt-4.1-mini"),
        {
          "gpt-4.1-mini": {
            strategy: "priority",
            costs: {
              "openai:gpt-4.1-nano": 1
            }
          }
        }
      )
    ).toThrow(GatewayError);
  });
});

describe("attachRouteKeyAccessPolicy", () => {
  it("attaches key access policy metadata to a matching route", () => {
    expect(
      attachRouteKeyAccessPolicy(
        parseModelAliases(
          "assistant-default=openai:gpt-4.1-mini,claude-haiku-4-5=anthropic:claude-haiku-4-5"
        ),
        {
          "assistant-default": {
            requiredKeyTier: "prod",
            requiredKeyTags: ["internal"]
          }
        }
      )
    ).toEqual([
      {
        externalModel: "assistant-default",
        target: {
          provider: "openai",
          providerModel: "gpt-4.1-mini"
        },
        requiredKeyTier: "prod",
        requiredKeyTags: ["internal"]
      },
      {
        externalModel: "claude-haiku-4-5",
        target: {
          provider: "anthropic",
          providerModel: "claude-haiku-4-5"
        }
      }
    ]);
  });

  it("rejects route key access policy keys that do not match configured routes", () => {
    expect(() =>
      attachRouteKeyAccessPolicy(
        parseModelAliases("gpt-4.1-mini=gpt-4.1-mini"),
        {
          unknown: {
            requiredKeyTier: "prod"
          }
        }
      )
    ).toThrow(GatewayError);
  });
});
