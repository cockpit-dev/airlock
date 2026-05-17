import { describe, expect, it } from "vitest";

import type { GatewayKeyConcurrencyLease } from "@airlock/governance";

import type { DurableObjectStorageLike } from "./durable-object-state.js";

import {
  acquireGatewayKeyConcurrencyLeaseFromStorage,
  readActiveLeases,
  releaseGatewayKeyConcurrencyLeaseFromStorage
} from "./gateway-key-concurrency.js";

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

describe("readActiveLeases", () => {
  it("returns empty array when no leases stored", async () => {
    const storage = createMockStorage();
    const leases = await readActiveLeases(storage, 1000);

    expect(leases).toEqual([]);
  });

  it("returns only non-expired leases", async () => {
    const now = 10000;
    const leases: GatewayKeyConcurrencyLease[] = [
      { leaseId: "lease-1", expiresAt: now + 5000 },
      { leaseId: "lease-2", expiresAt: now - 1000 }
    ];
    const storage = createMockStorage(new Map([["leases", leases]]));

    const active = await readActiveLeases(storage, now);

    expect(active).toHaveLength(1);
    expect(active[0]!.leaseId).toBe("lease-1");
  });

  it("garbage-collects expired leases from storage", async () => {
    const now = 10000;
    const leases: GatewayKeyConcurrencyLease[] = [
      { leaseId: "lease-1", expiresAt: now + 5000 },
      { leaseId: "lease-2", expiresAt: now - 1000 }
    ];
    const store = new Map([["leases", leases]]);
    const storage = createMockStorage(store);

    await readActiveLeases(storage, now);

    const stored = store.get("leases") as GatewayKeyConcurrencyLease[];
    expect(stored).toHaveLength(1);
    expect(stored[0]!.leaseId).toBe("lease-1");
  });

  it("does not write to storage when no expired leases", async () => {
    const now = 10000;
    const leases: GatewayKeyConcurrencyLease[] = [
      { leaseId: "lease-1", expiresAt: now + 5000 }
    ];
    const store = new Map([["leases", leases]]);
    const storage = createMockStorage(store);

    await readActiveLeases(storage, now);

    const stored = store.get("leases") as GatewayKeyConcurrencyLease[];
    expect(stored).toBe(leases);
  });

  it("handles non-array stored value gracefully", async () => {
    const storage = createMockStorage(new Map([["leases", "not-an-array"]]));

    const active = await readActiveLeases(storage, 1000);

    expect(active).toEqual([]);
  });
});

describe("acquireGatewayKeyConcurrencyLeaseFromStorage", () => {
  const policy = { limit: 2 };
  const ttlMs = 30000;
  const now = 10000;

  it("allows acquire in empty state", async () => {
    const storage = createMockStorage();
    const decision = await acquireGatewayKeyConcurrencyLeaseFromStorage(
      storage,
      policy,
      "lease-1",
      ttlMs,
      now
    );

    expect(decision.allowed).toBe(true);
  });

  it("stores new lease with correct expiry", async () => {
    const store = new Map<string, unknown>();
    const storage = createMockStorage(store);

    await acquireGatewayKeyConcurrencyLeaseFromStorage(
      storage,
      policy,
      "lease-1",
      ttlMs,
      now
    );

    const leases = store.get("leases") as GatewayKeyConcurrencyLease[];
    expect(leases).toHaveLength(1);
    expect(leases[0]!.leaseId).toBe("lease-1");
    expect(leases[0]!.expiresAt).toBe(now + ttlMs);
  });

  it("allows acquire up to limit", async () => {
    const existingLeases: GatewayKeyConcurrencyLease[] = [
      { leaseId: "lease-1", expiresAt: now + 5000 }
    ];
    const storage = createMockStorage(new Map([["leases", existingLeases]]));

    const decision = await acquireGatewayKeyConcurrencyLeaseFromStorage(
      storage,
      policy,
      "lease-2",
      ttlMs,
      now
    );

    expect(decision.allowed).toBe(true);
  });

  it("denies acquire at capacity", async () => {
    const existingLeases: GatewayKeyConcurrencyLease[] = [
      { leaseId: "lease-1", expiresAt: now + 5000 },
      { leaseId: "lease-2", expiresAt: now + 5000 }
    ];
    const storage = createMockStorage(new Map([["leases", existingLeases]]));

    const decision = await acquireGatewayKeyConcurrencyLeaseFromStorage(
      storage,
      policy,
      "lease-3",
      ttlMs,
      now
    );

    expect(decision.allowed).toBe(false);
  });

  it("allows acquire after expired lease garbage-collected", async () => {
    const existingLeases: GatewayKeyConcurrencyLease[] = [
      { leaseId: "lease-1", expiresAt: now + 5000 },
      { leaseId: "lease-2", expiresAt: now - 1000 }
    ];
    const storage = createMockStorage(new Map([["leases", existingLeases]]));

    const decision = await acquireGatewayKeyConcurrencyLeaseFromStorage(
      storage,
      policy,
      "lease-3",
      ttlMs,
      now
    );

    expect(decision.allowed).toBe(true);
  });

  it("denies acquire when expired leases not yet collected", async () => {
    const futureNow = now + 10000;
    const existingLeases: GatewayKeyConcurrencyLease[] = [
      { leaseId: "lease-1", expiresAt: futureNow + 5000 },
      { leaseId: "lease-2", expiresAt: futureNow + 5000 }
    ];
    const storage = createMockStorage(new Map([["leases", existingLeases]]));

    const decision = await acquireGatewayKeyConcurrencyLeaseFromStorage(
      storage,
      policy,
      "lease-3",
      ttlMs,
      futureNow
    );

    expect(decision.allowed).toBe(false);
  });
});

describe("releaseGatewayKeyConcurrencyLeaseFromStorage", () => {
  const now = 10000;

  it("removes specific lease by ID", async () => {
    const existingLeases: GatewayKeyConcurrencyLease[] = [
      { leaseId: "lease-1", expiresAt: now + 5000 },
      { leaseId: "lease-2", expiresAt: now + 5000 }
    ];
    const store = new Map([["leases", existingLeases]]);
    const storage = createMockStorage(store);

    await releaseGatewayKeyConcurrencyLeaseFromStorage(storage, "lease-1", now);

    const remaining = store.get("leases") as GatewayKeyConcurrencyLease[];
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.leaseId).toBe("lease-2");
  });

  it("is idempotent for non-existent lease", async () => {
    const existingLeases: GatewayKeyConcurrencyLease[] = [
      { leaseId: "lease-1", expiresAt: now + 5000 }
    ];
    const store = new Map([["leases", existingLeases]]);
    const storage = createMockStorage(store);

    await releaseGatewayKeyConcurrencyLeaseFromStorage(
      storage,
      "lease-nonexistent",
      now
    );

    const remaining = store.get("leases") as GatewayKeyConcurrencyLease[];
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.leaseId).toBe("lease-1");
  });

  it("works with empty lease list", async () => {
    const storage = createMockStorage();

    await expect(
      releaseGatewayKeyConcurrencyLeaseFromStorage(storage, "lease-1", now)
    ).resolves.toBeUndefined();
  });
});
