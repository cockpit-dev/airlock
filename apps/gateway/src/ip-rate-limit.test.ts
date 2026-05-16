import { describe, expect, it } from "vitest";

import type { IpRateLimitStorage } from "@airlock/governance";

import type { DurableObjectStorageLike } from "./durable-object-state.js";

import {
  consumeIpRateLimitFromStorage,
  enforceIpRateLimit
} from "./ip-rate-limit.js";
import type { GatewayBindings } from "./env.js";

function createMockStorage(
  store: Map<string, unknown> = new Map()
): DurableObjectStorageLike {
  return {
    get: <T>(key: string): Promise<T | undefined> =>
      Promise.resolve(store.get(key) as T | undefined),
    put: <T>(key: string, value: T): Promise<void> => {
      store.set(key, value);
      return Promise.resolve();
    },
    delete: (key: string): Promise<boolean> =>
      Promise.resolve(store.delete(key))
  };
}

function createMockNamespace(ip: string, decisions: Map<string, unknown>[]) {
  let callIndex = 0;
  return {
    idFromName(name: string) {
      expect(name).toBe(ip);
      return name;
    },
    get(_id: unknown) {
      const storage = createMockStorage(
        decisions[callIndex] ?? new Map<string, unknown>()
      );
      callIndex++;
      return {
        async fetch(request: Request) {
          const body = (await request.json()) as {
            limit: number;
            windowSeconds: number;
          };
          const decision = await consumeIpRateLimitFromStorage(
            storage,
            body,
            60000 + 1000
          );
          return Response.json(decision);
        }
      };
    }
  };
}

describe("consumeIpRateLimitFromStorage", () => {
  const policy = { limit: 5, windowSeconds: 60 };
  const windowStart = 60000;

  it("allows first consume in empty window", async () => {
    const storage = createMockStorage();
    const decision = await consumeIpRateLimitFromStorage(
      storage,
      policy,
      windowStart + 1000
    );

    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(4);
  });

  it("allows consume up to limit", async () => {
    const existing: IpRateLimitStorage = {
      windowStartedAt: windowStart,
      count: 4
    };
    const storage = createMockStorage(new Map([["ip_rate_limit", existing]]));
    const decision = await consumeIpRateLimitFromStorage(
      storage,
      policy,
      windowStart + 2000
    );

    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(0);
  });

  it("denies consume beyond limit", async () => {
    const existing: IpRateLimitStorage = {
      windowStartedAt: windowStart,
      count: 5
    };
    const storage = createMockStorage(new Map([["ip_rate_limit", existing]]));
    const decision = await consumeIpRateLimitFromStorage(
      storage,
      policy,
      windowStart + 3000
    );

    expect(decision.allowed).toBe(false);
    expect(decision.remaining).toBe(0);
  });

  it("resets count in new window", async () => {
    const existing: IpRateLimitStorage = {
      windowStartedAt: windowStart,
      count: 5
    };
    const storage = createMockStorage(new Map([["ip_rate_limit", existing]]));
    const nextWindowStart = windowStart + 60000;
    const decision = await consumeIpRateLimitFromStorage(
      storage,
      policy,
      nextWindowStart + 1000
    );

    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(4);
  });

  it("does not write to storage when denied", async () => {
    const existing: IpRateLimitStorage = {
      windowStartedAt: windowStart,
      count: 5
    };
    const store = new Map([["ip_rate_limit", existing]]);
    const storage = createMockStorage(store);

    const decision = await consumeIpRateLimitFromStorage(
      storage,
      policy,
      windowStart + 3000
    );

    expect(decision.allowed).toBe(false);
    const stored = store.get("ip_rate_limit") as IpRateLimitStorage;
    expect(stored.count).toBe(5);
  });
});

describe("enforceIpRateLimit", () => {
  it("returns undefined when no policy is configured", async () => {
    const result = await enforceIpRateLimit(
      {} as GatewayBindings,
      undefined,
      new Headers(),
      "req-1"
    );

    expect(result).toBeUndefined();
  });

  it("throws when policy is set but DO binding is missing", async () => {
    await expect(
      enforceIpRateLimit(
        {} as GatewayBindings,
        { limit: 5, windowSeconds: 60 },
        new Headers(),
        "req-1"
      )
    ).rejects.toThrow("IP rate limit subsystem is unavailable");
  });

  it("returns decision when allowed", async () => {
    const namespace = createMockNamespace("1.2.3.4", [
      new Map<string, unknown>()
    ]);
    const headers = new Headers({ "cf-connecting-ip": "1.2.3.4" });

    const decision = await enforceIpRateLimit(
      { AIRLOCK_IP_RATE_LIMIT: namespace } as unknown as GatewayBindings,
      { limit: 5, windowSeconds: 60 },
      headers,
      "req-1"
    );

    expect(decision).toBeDefined();
    expect(decision!.allowed).toBe(true);
  });

  it("throws 429 when rate limited", async () => {
    const existing: IpRateLimitStorage = {
      windowStartedAt: 60000,
      count: 5
    };
    const namespace = createMockNamespace("1.2.3.4", [
      new Map([["ip_rate_limit", existing]])
    ]);
    const headers = new Headers({ "cf-connecting-ip": "1.2.3.4" });

    await expect(
      enforceIpRateLimit(
        { AIRLOCK_IP_RATE_LIMIT: namespace } as unknown as GatewayBindings,
        { limit: 5, windowSeconds: 60 },
        headers,
        "req-1"
      )
    ).rejects.toThrow("IP rate limit exceeded");
  });
});
