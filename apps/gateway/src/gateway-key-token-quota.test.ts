import { describe, expect, it } from "vitest";

import type { GatewayKeyTokenQuotaStorage } from "@airlock/governance";

import type { DurableObjectStorageLike } from "./durable-object-state.js";

import {
  chargeGatewayKeyTokenQuotaFromStorage,
  precheckGatewayKeyTokenQuotaFromStorage,
  reconcileGatewayKeyTokenQuotaReservationFromStorage,
  releaseGatewayKeyTokenQuotaReservationFromStorage,
  reserveGatewayKeyTokenQuotaFromStorage
} from "./gateway-key-token-quota.js";

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

const policy = { limit: 1000, windowSeconds: 60 };
const now = 5000;

function storedState(
  overrides: Partial<GatewayKeyTokenQuotaStorage> = {}
): GatewayKeyTokenQuotaStorage {
  const windowStartedAt = now - (now % (policy.windowSeconds * 1000));
  return {
    windowStartedAt,
    usedTokens: 0,
    reservations: [],
    ...overrides
  };
}

describe("precheckGatewayKeyTokenQuotaFromStorage", () => {
  it("allows when quota available", async () => {
    const storage = createMockStorage(
      new Map([["token_quota", storedState({ usedTokens: 500 })]])
    );

    const decision = await precheckGatewayKeyTokenQuotaFromStorage(
      storage,
      { kind: "precheck", ...policy },
      now
    );

    expect(decision.allowed).toBe(true);
  });

  it("denies when quota exhausted", async () => {
    const storage = createMockStorage(
      new Map([["token_quota", storedState({ usedTokens: 1000 })]])
    );

    const decision = await precheckGatewayKeyTokenQuotaFromStorage(
      storage,
      { kind: "precheck", ...policy },
      now
    );

    expect(decision.allowed).toBe(false);
  });

  it("accounts for reserved tokens", async () => {
    const storage = createMockStorage(
      new Map([
        [
          "token_quota",
          storedState({
            usedTokens: 500,
            reservations: [
              { reservationId: "r1", tokens: 400, expiresAt: now + 30000 }
            ]
          })
        ]
      ])
    );

    const decision = await precheckGatewayKeyTokenQuotaFromStorage(
      storage,
      { kind: "precheck", ...policy },
      now
    );

    expect(decision.allowed).toBe(true);
  });

  it("denies when used + reserved exceeds limit", async () => {
    const storage = createMockStorage(
      new Map([
        [
          "token_quota",
          storedState({
            usedTokens: 500,
            reservations: [
              { reservationId: "r1", tokens: 600, expiresAt: now + 30000 }
            ]
          })
        ]
      ])
    );

    const decision = await precheckGatewayKeyTokenQuotaFromStorage(
      storage,
      { kind: "precheck", ...policy },
      now
    );

    expect(decision.allowed).toBe(false);
  });
});

describe("reserveGatewayKeyTokenQuotaFromStorage", () => {
  it("reserves tokens successfully", async () => {
    const store = new Map([["token_quota", storedState()]]);
    const storage = createMockStorage(store);

    const decision = await reserveGatewayKeyTokenQuotaFromStorage(
      storage,
      {
        kind: "reserve",
        ...policy,
        reservationId: "r1",
        tokens: 200,
        ttlMs: 30000
      },
      now
    );

    expect(decision.allowed).toBe(true);
    const stored = store.get("token_quota") as GatewayKeyTokenQuotaStorage;
    expect(stored.reservations).toHaveLength(1);
    expect(stored.reservations![0]!.reservationId).toBe("r1");
    expect(stored.reservations![0]!.tokens).toBe(200);
  });

  it("denies reservation exceeding limit", async () => {
    const store = new Map([
      ["token_quota", storedState({ usedTokens: 900 })]
    ]);
    const storage = createMockStorage(store);

    const decision = await reserveGatewayKeyTokenQuotaFromStorage(
      storage,
      {
        kind: "reserve",
        ...policy,
        reservationId: "r1",
        tokens: 200,
        ttlMs: 30000
      },
      now
    );

    expect(decision.allowed).toBe(false);
    const stored = store.get("token_quota") as GatewayKeyTokenQuotaStorage;
    expect(stored.reservations).toHaveLength(0);
  });

  it("replaces existing reservation with same ID", async () => {
    const store = new Map([
      [
        "token_quota",
        storedState({
          reservations: [
            { reservationId: "r1", tokens: 100, expiresAt: now + 30000 }
          ]
        })
      ]
    ]);
    const storage = createMockStorage(store);

    const decision = await reserveGatewayKeyTokenQuotaFromStorage(
      storage,
      {
        kind: "reserve",
        ...policy,
        reservationId: "r1",
        tokens: 300,
        ttlMs: 30000
      },
      now
    );

    expect(decision.allowed).toBe(true);
    const stored = store.get("token_quota") as GatewayKeyTokenQuotaStorage;
    expect(stored.reservations).toHaveLength(1);
    expect(stored.reservations![0]!.tokens).toBe(300);
  });

  it("does not write to storage when denied", async () => {
    const original = storedState({ usedTokens: 900 });
    const store = new Map([["token_quota", { ...original }]]);
    const storage = createMockStorage(store);

    await reserveGatewayKeyTokenQuotaFromStorage(
      storage,
      {
        kind: "reserve",
        ...policy,
        reservationId: "r1",
        tokens: 200,
        ttlMs: 30000
      },
      now
    );

    const stored = store.get("token_quota") as GatewayKeyTokenQuotaStorage;
    expect(stored.usedTokens).toBe(900);
    expect(stored.reservations).toHaveLength(0);
  });
});

describe("releaseGatewayKeyTokenQuotaReservationFromStorage", () => {
  it("removes reservation and returns updated decision", async () => {
    const store = new Map([
      [
        "token_quota",
        storedState({
          usedTokens: 500,
          reservations: [
            { reservationId: "r1", tokens: 300, expiresAt: now + 30000 }
          ]
        })
      ]
    ]);
    const storage = createMockStorage(store);

    const decision = await releaseGatewayKeyTokenQuotaReservationFromStorage(
      storage,
      { kind: "release", ...policy, reservationId: "r1" },
      now
    );

    expect(decision.allowed).toBe(true);
    const stored = store.get("token_quota") as GatewayKeyTokenQuotaStorage;
    expect(stored.reservations).toHaveLength(0);
    expect(stored.usedTokens).toBe(500);
  });

  it("is idempotent for non-existent reservation", async () => {
    const store = new Map([
      [
        "token_quota",
        storedState({
          reservations: [
            { reservationId: "r1", tokens: 300, expiresAt: now + 30000 }
          ]
        })
      ]
    ]);
    const storage = createMockStorage(store);

    const decision = await releaseGatewayKeyTokenQuotaReservationFromStorage(
      storage,
      { kind: "release", ...policy, reservationId: "r-nonexistent" },
      now
    );

    expect(decision.allowed).toBe(true);
    const stored = store.get("token_quota") as GatewayKeyTokenQuotaStorage;
    expect(stored.reservations).toHaveLength(1);
  });
});

describe("reconcileGatewayKeyTokenQuotaReservationFromStorage", () => {
  it("replaces reservation with actual usage", async () => {
    const store = new Map([
      [
        "token_quota",
        storedState({
          usedTokens: 100,
          reservations: [
            { reservationId: "r1", tokens: 200, expiresAt: now + 30000 }
          ]
        })
      ]
    ]);
    const storage = createMockStorage(store);

    const decision =
      await reconcileGatewayKeyTokenQuotaReservationFromStorage(
        storage,
        {
          kind: "reconcile",
          ...policy,
          reservationId: "r1",
          actualTokens: 150
        },
        now
      );

    expect(decision.allowed).toBe(true);
    const stored = store.get("token_quota") as GatewayKeyTokenQuotaStorage;
    expect(stored.usedTokens).toBe(50);
    expect(stored.reservations).toHaveLength(0);
  });

  it("increases used tokens when actual exceeds reserved", async () => {
    const store = new Map([
      [
        "token_quota",
        storedState({
          usedTokens: 100,
          reservations: [
            { reservationId: "r1", tokens: 200, expiresAt: now + 30000 }
          ]
        })
      ]
    ]);
    const storage = createMockStorage(store);

    await reconcileGatewayKeyTokenQuotaReservationFromStorage(
      storage,
      {
        kind: "reconcile",
        ...policy,
        reservationId: "r1",
        actualTokens: 300
      },
      now
    );

    const stored = store.get("token_quota") as GatewayKeyTokenQuotaStorage;
    expect(stored.usedTokens).toBe(200);
  });

  it("clamps negative used tokens to zero", async () => {
    const store = new Map([
      [
        "token_quota",
        storedState({
          usedTokens: 50,
          reservations: [
            { reservationId: "r1", tokens: 200, expiresAt: now + 30000 }
          ]
        })
      ]
    ]);
    const storage = createMockStorage(store);

    await reconcileGatewayKeyTokenQuotaReservationFromStorage(
      storage,
      {
        kind: "reconcile",
        ...policy,
        reservationId: "r1",
        actualTokens: 0
      },
      now
    );

    const stored = store.get("token_quota") as GatewayKeyTokenQuotaStorage;
    expect(stored.usedTokens).toBe(0);
  });

  it("handles reconcile when reservation no longer exists", async () => {
    const store = new Map([
      ["token_quota", storedState({ usedTokens: 100 })]
    ]);
    const storage = createMockStorage(store);

    await reconcileGatewayKeyTokenQuotaReservationFromStorage(
      storage,
      {
        kind: "reconcile",
        ...policy,
        reservationId: "r-missing",
        actualTokens: 50
      },
      now
    );

    const stored = store.get("token_quota") as GatewayKeyTokenQuotaStorage;
    expect(stored.usedTokens).toBe(150);
  });
});

describe("chargeGatewayKeyTokenQuotaFromStorage", () => {
  it("adds tokens to used count", async () => {
    const store = new Map([
      ["token_quota", storedState({ usedTokens: 100 })]
    ]);
    const storage = createMockStorage(store);

    const decision = await chargeGatewayKeyTokenQuotaFromStorage(
      storage,
      { kind: "charge", ...policy, tokens: 200 },
      now
    );

    expect(decision.allowed).toBe(true);
    const stored = store.get("token_quota") as GatewayKeyTokenQuotaStorage;
    expect(stored.usedTokens).toBe(300);
  });

  it("charges into empty state", async () => {
    const store = new Map<string, unknown>();
    const storage = createMockStorage(store);

    const decision = await chargeGatewayKeyTokenQuotaFromStorage(
      storage,
      { kind: "charge", ...policy, tokens: 500 },
      now
    );

    expect(decision.allowed).toBe(true);
    const stored = store.get("token_quota") as GatewayKeyTokenQuotaStorage;
    expect(stored.usedTokens).toBe(500);
  });
});
