import { describe, expect, it } from "vitest";

import { GatewayError } from "@airlock/shared";

import {
  attachRouteFallbacks,
  attachRouteKeyAccessPolicy,
  attachRouteRequestShaping,
  attachRouteTargetSelection,
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
        "gpt-4.1-mini=gpt-4.1-mini,claude-sonnet-4-5=gpt-4.1-mini",
        "gpt-4.1-mini"
      )
    ).toEqual([
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
    ]);
  });

  it("falls back to the default model when aliases are absent", () => {
    expect(parseModelAliases(undefined, "gpt-4.1-mini")).toEqual([
      {
        externalModel: "gpt-4.1-mini",
        target: {
          provider: "openai",
          providerModel: "gpt-4.1-mini"
        }
      }
    ]);
  });

  it("parses explicit provider-aware route syntax", () => {
    expect(
      parseModelAliases(
        "gpt-4.1-mini=openai:gpt-4.1-mini,claude-sonnet-4-5=anthropic:claude-sonnet-4-5,gemini-2.5-flash=gemini:gemini-2.5-flash",
        "gpt-4.1-mini"
      )
    ).toEqual([
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
      },
      {
        externalModel: "gemini-2.5-flash",
        target: {
          provider: "gemini",
          providerModel: "gemini-2.5-flash"
        }
      }
    ]);
  });

  it("rejects aliases with empty model parts", () => {
    expect(() => parseModelAliases("gpt-4.1-mini=", "gpt-4.1-mini")).toThrow(
      GatewayError
    );
  });

  it("rejects unsupported provider ids", () => {
    expect(() =>
      parseModelAliases("gpt-4.1-mini=vertex:gemini-2.5-pro", "gpt-4.1-mini")
    ).toThrow(GatewayError);
  });

  it("rejects duplicate external model aliases", () => {
    expect(() =>
      parseModelAliases(
        "gpt-4.1-mini=gpt-4.1-mini,gpt-4.1-mini=other-model",
        "gpt-4.1-mini"
      )
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
});

describe("listExternalModels", () => {
  it("returns external model names in insertion order", () => {
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
            provider: "openai",
            providerModel: "gpt-4.1-mini"
          }
        }
      ])
    ).toEqual(["gpt-4.1-mini", "claude-sonnet-4-5"]);
  });
});

describe("attachRouteRequestShaping", () => {
  it("attaches shaping profiles to matching routes", () => {
    expect(
      attachRouteRequestShaping(
        parseModelAliases(
          "gpt-4.1-mini=openai:gpt-4.1-mini,claude-sonnet-4-5=anthropic:claude-sonnet-4-5",
          "gpt-4.1-mini"
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
        parseModelAliases("gpt-4.1-mini=gpt-4.1-mini", "gpt-4.1-mini"),
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
          "gpt-4.1-mini=openai:gpt-4.1-mini,claude-sonnet-4-5=anthropic:claude-sonnet-4-5",
          "gpt-4.1-mini"
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
      attachRouteFallbacks(
        parseModelAliases("gpt-4.1-mini=gpt-4.1-mini", "gpt-4.1-mini"),
        {
          unknown: ["openai:gpt-4.1-nano"]
        }
      )
    ).toThrow(GatewayError);
  });

  it("allows cross-provider fallback targets for unshaped routes", () => {
    expect(
      attachRouteFallbacks(
        parseModelAliases("gpt-4.1-mini=openai:gpt-4.1-mini", "gpt-4.1-mini"),
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

  it("rejects cross-provider fallback targets for shaped routes", () => {
    expect(() =>
      attachRouteFallbacks(
        attachRouteRequestShaping(
          parseModelAliases("gpt-4.1-mini=openai:gpt-4.1-mini", "gpt-4.1-mini"),
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
    ).toThrow(GatewayError);
  });

  it("rejects duplicate fallback targets", () => {
    expect(() =>
      attachRouteFallbacks(
        parseModelAliases("gpt-4.1-mini=openai:gpt-4.1-mini", "gpt-4.1-mini"),
        {
          "gpt-4.1-mini": ["openai:gpt-4.1-nano", "openai:gpt-4.1-nano"]
        }
      )
    ).toThrow(GatewayError);
  });
});

describe("attachRouteTargetSelection", () => {
  it("attaches weighted selection to a matching route", () => {
    expect(
      attachRouteTargetSelection(
        attachRouteFallbacks(
          parseModelAliases(
            "assistant-default=openai:gpt-4.1-mini,claude-haiku-4-5=anthropic:claude-haiku-4-5",
            "gpt-4.1-mini"
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
        parseModelAliases("gpt-4.1-mini=gpt-4.1-mini", "gpt-4.1-mini"),
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
        parseModelAliases("gpt-4.1-mini=openai:gpt-4.1-mini", "gpt-4.1-mini"),
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
            "assistant-default=openai:gpt-4.1-mini,claude-haiku-4-5=anthropic:claude-haiku-4-5",
            "gpt-4.1-mini"
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
        parseModelAliases("gpt-4.1-mini=openai:gpt-4.1-mini", "gpt-4.1-mini"),
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
});

describe("attachRouteKeyAccessPolicy", () => {
  it("attaches key access policy metadata to a matching route", () => {
    expect(
      attachRouteKeyAccessPolicy(
        parseModelAliases(
          "assistant-default=openai:gpt-4.1-mini,claude-haiku-4-5=anthropic:claude-haiku-4-5",
          "gpt-4.1-mini"
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
        parseModelAliases("gpt-4.1-mini=gpt-4.1-mini", "gpt-4.1-mini"),
        {
          unknown: {
            requiredKeyTier: "prod"
          }
        }
      )
    ).toThrow(GatewayError);
  });
});
