import { describe, expect, it } from "vitest";

import type { GatewayKeyQuotaStorage } from "@airlock/governance";

import type { DurableObjectStorageLike } from "./durable-object-state.js";

import { consumeGatewayKeyQuotaFromStorage } from "./gateway-key-quota.js";

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
    delete: (key: string): Promise<boolean> => Promise.resolve(store.delete(key))
  };
}

describe("consumeGatewayKeyQuotaFromStorage", () => {
  const policy = { limit: 3, windowSeconds: 60 };
  const windowStart = 60000;

  it("allows first consume in empty window", async () => {
    const storage = createMockStorage();
    const decision = await consumeGatewayKeyQuotaFromStorage(
      storage,
      policy,
      windowStart + 1000
    );

    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(2);
  });

  it("allows consume up to limit", async () => {
    const existing: GatewayKeyQuotaStorage = {
      windowStartedAt: windowStart,
      count: 2
    };
    const storage = createMockStorage(
      new Map([["request_quota", existing]])
    );
    const decision = await consumeGatewayKeyQuotaFromStorage(
      storage,
      policy,
      windowStart + 2000
    );

    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(0);
  });

  it("denies consume beyond limit", async () => {
    const existing: GatewayKeyQuotaStorage = {
      windowStartedAt: windowStart,
      count: 3
    };
    const storage = createMockStorage(
      new Map([["request_quota", existing]])
    );
    const decision = await consumeGatewayKeyQuotaFromStorage(
      storage,
      policy,
      windowStart + 3000
    );

    expect(decision.allowed).toBe(false);
  });

  it("resets count in new window", async () => {
    const existing: GatewayKeyQuotaStorage = {
      windowStartedAt: windowStart,
      count: 3
    };
    const storage = createMockStorage(
      new Map([["request_quota", existing]])
    );
    const nextWindowStart = windowStart + 60000;
    const decision = await consumeGatewayKeyQuotaFromStorage(
      storage,
      policy,
      nextWindowStart + 1000
    );

    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(2);
  });

  it("resumes from existing stored state", async () => {
    const existing: GatewayKeyQuotaStorage = {
      windowStartedAt: windowStart,
      count: 1
    };
    const storage = createMockStorage(
      new Map([["request_quota", existing]])
    );
    const decision = await consumeGatewayKeyQuotaFromStorage(
      storage,
      policy,
      windowStart + 5000
    );

    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(1);
  });

  it("does not write to storage when denied", async () => {
    const existing: GatewayKeyQuotaStorage = {
      windowStartedAt: windowStart,
      count: 3
    };
    const store = new Map([["request_quota", existing]]);
    const storage = createMockStorage(store);

    const decision = await consumeGatewayKeyQuotaFromStorage(
      storage,
      policy,
      windowStart + 3000
    );

    expect(decision.allowed).toBe(false);
    const stored = store.get("request_quota") as GatewayKeyQuotaStorage;
    expect(stored.count).toBe(3);
  });
});
