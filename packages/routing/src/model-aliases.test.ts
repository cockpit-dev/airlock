import { describe, expect, it } from "vitest";

import { GatewayError } from "@airlock/shared";

import {
  attachRouteRequestShaping,
  attachRouteFallbacks,
  listExternalModels,
  parseRouteFallbacks,
  parseModelAliases,
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
