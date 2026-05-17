import { describe, expect, it, vi } from "vitest";

import { dispatchGovernanceTransport } from "./governance-transport-core.js";

function describeCause(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }

  return "";
}

describe("dispatchGovernanceTransport", () => {
  it("parses successful responses through the provided parser", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      })
    );

    await expect(
      dispatchGovernanceTransport(
        () => {
          return {
            fetch
          };
        },
        new Request("https://airlock.internal/test", { method: "GET" }),
        "req_123",
        {
          parse: async (response) => {
            return (await response.json()) as { ok: boolean };
          },
          createUnavailableError: (requestId, cause) => {
            return new Error(
              `unavailable:${requestId}:${describeCause(cause)}`
            );
          },
          createInvalidResponseError: (requestId, cause) => {
            return new Error(`invalid:${requestId}:${describeCause(cause)}`);
          }
        }
      )
    ).resolves.toEqual({ ok: true });
  });

  it("allows status handlers to intercept non-ok responses", async () => {
    await expect(
      dispatchGovernanceTransport(
        () => {
          return {
            fetch: vi
              .fn()
              .mockResolvedValue(new Response("Not found", { status: 404 }))
          };
        },
        new Request("https://airlock.internal/test", { method: "GET" }),
        "req_123",
        {
          parse: async (response) => {
            return await response.json();
          },
          handleStatus: (response) => {
            if (response.status === 404) {
              return null;
            }

            return undefined;
          },
          createUnavailableError: (requestId, cause) => {
            return new Error(
              `unavailable:${requestId}:${describeCause(cause)}`
            );
          },
          createInvalidResponseError: (requestId, cause) => {
            return new Error(`invalid:${requestId}:${describeCause(cause)}`);
          }
        }
      )
    ).resolves.toBeNull();
  });

  it("wraps fetch failures with the provided unavailable error factory", async () => {
    await expect(
      dispatchGovernanceTransport(
        () => {
          throw new Error("boom");
        },
        new Request("https://airlock.internal/test", { method: "GET" }),
        "req_123",
        {
          parse: async (response) => {
            return await response.json();
          },
          createUnavailableError: (requestId, cause) => {
            return new Error(
              `unavailable:${requestId}:${(cause as Error).message}`
            );
          },
          createInvalidResponseError: (requestId, cause) => {
            return new Error(`invalid:${requestId}:${describeCause(cause)}`);
          }
        }
      )
    ).rejects.toThrow("unavailable:req_123:boom");
  });

  it("wraps parse failures with the provided invalid-response factory", async () => {
    await expect(
      dispatchGovernanceTransport(
        () => {
          return {
            fetch: vi.fn().mockResolvedValue(
              new Response("{", {
                status: 200,
                headers: {
                  "content-type": "application/json"
                }
              })
            )
          };
        },
        new Request("https://airlock.internal/test", { method: "GET" }),
        "req_123",
        {
          parse: async (response) => {
            return await response.json();
          },
          createUnavailableError: (requestId, cause) => {
            return new Error(
              `unavailable:${requestId}:${describeCause(cause)}`
            );
          },
          createInvalidResponseError: (requestId, cause) => {
            return new Error(`invalid:${requestId}:${describeCause(cause)}`);
          }
        }
      )
    ).rejects.toThrow("invalid:req_123:");
  });
});
