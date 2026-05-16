import { afterEach, describe, expect, it } from "vitest";

import type { ProviderTarget } from "@airlock/routing";

import {
  createInMemoryCircuitBreakerBackend,
  createPersistentCircuitBreakerBackend,
  getAllInMemoryCircuitBreakerStates,
  getProviderTargetCircuitState,
  isProviderTargetCircuitOpen,
  resetProviderCircuitBreakerState
} from "./circuit-breaker.js";

const openaiTarget: ProviderTarget = {
  provider: "openai",
  providerModel: "gpt-4.1-mini"
};

const anthropicTarget: ProviderTarget = {
  provider: "anthropic",
  providerModel: "claude-haiku-4-5"
};

const defaultPolicy = { threshold: 3, cooldownMs: 10_000 };

afterEach(() => {
  resetProviderCircuitBreakerState();
});

describe("createInMemoryCircuitBreakerBackend", () => {
  it("returns undefined state for an unseen target", async () => {
    const backend = createInMemoryCircuitBreakerBackend();
    const state = await backend.getState(openaiTarget);
    expect(state).toBeUndefined();
  });

  it("records a success and stores state", async () => {
    const backend = createInMemoryCircuitBreakerBackend();
    await backend.recordSuccess(openaiTarget, 150, 100, 1000);

    const state = await backend.getState(openaiTarget);
    expect(state).toBeDefined();
    expect(state!.consecutiveRetryableFailures).toBe(0);
    expect(state!.lastSuccessAt).toBe(1000);
    expect(state!.lastSuccessLatencyMs).toBe(150);
  });

  it("records retryable failures and increments consecutive count", async () => {
    const backend = createInMemoryCircuitBreakerBackend();

    await backend.recordRetryableFailure(openaiTarget, defaultPolicy, 1000);
    await backend.recordRetryableFailure(openaiTarget, defaultPolicy, 2000);

    const state = await backend.getState(openaiTarget);
    expect(state).toBeDefined();
    expect(state!.consecutiveRetryableFailures).toBe(2);
  });

  it("resets consecutive failures after a success", async () => {
    const backend = createInMemoryCircuitBreakerBackend();

    await backend.recordRetryableFailure(openaiTarget, defaultPolicy, 1000);
    await backend.recordRetryableFailure(openaiTarget, defaultPolicy, 2000);
    await backend.recordSuccess(openaiTarget, 100, 50, 3000);

    const state = await backend.getState(openaiTarget);
    expect(state!.consecutiveRetryableFailures).toBe(0);
  });

  it("isolates state between different targets", async () => {
    const backend = createInMemoryCircuitBreakerBackend();

    await backend.recordRetryableFailure(openaiTarget, defaultPolicy, 1000);
    await backend.recordSuccess(anthropicTarget, 100, 50, 1000);

    const openaiState = await backend.getState(openaiTarget);
    const anthropicState = await backend.getState(anthropicTarget);

    expect(openaiState!.consecutiveRetryableFailures).toBe(1);
    expect(anthropicState!.consecutiveRetryableFailures).toBe(0);
  });

  it("claims half-open probe when eligible", async () => {
    const backend = createInMemoryCircuitBreakerBackend();
    const policy = { threshold: 1, cooldownMs: 1000 };

    // Open the circuit
    await backend.recordRetryableFailure(openaiTarget, policy, 1000);

    // After cooldown, try to claim probe
    const claimed = await backend.claimHalfOpenProbe(
      openaiTarget,
      policy,
      3000
    );

    expect(claimed).toBe(true);
    const state = await backend.getState(openaiTarget);
    expect(state!.probeStartedAt).toBe(3000);
  });

  it("refuses half-open probe when not eligible", async () => {
    const backend = createInMemoryCircuitBreakerBackend();
    const policy = { threshold: 1, cooldownMs: 10_000 };

    // Open the circuit
    await backend.recordRetryableFailure(openaiTarget, policy, 1000);

    // Try to claim before cooldown
    const claimed = await backend.claimHalfOpenProbe(
      openaiTarget,
      policy,
      5000
    );

    expect(claimed).toBe(false);
  });

  it("refuses half-open probe for unseen target", async () => {
    const backend = createInMemoryCircuitBreakerBackend();
    const claimed = await backend.claimHalfOpenProbe(
      openaiTarget,
      defaultPolicy,
      1000
    );
    expect(claimed).toBe(false);
  });
});

describe("createPersistentCircuitBreakerBackend", () => {
  function createMockNamespace(responses: Map<string, Response>) {
    return {
      idFromName: (name: string) => name,
      get(_id: unknown) {
        return {
          async fetch(request: Request) {
            const url = new URL(request.url);
            if (request.method === "GET") {
              const response = responses.get(`GET:${url.pathname}`);
              if (response) return response;
              return Response.json({ consecutiveRetryableFailures: 0 });
            }

            const bodyText = await request.text();
            const body = JSON.parse(bodyText) as Record<string, unknown>;
            const key = `POST:${url.pathname}:${String(body.kind)}`;
            const response = responses.get(key);
            if (response) return response;
            return Response.json({ consecutiveRetryableFailures: 0 });
          }
        };
      }
    };
  }

  it("fetches state from DO via GET", async () => {
    const namespace = createMockNamespace(
      new Map([
        [
          "GET:/provider-circuit-breaker",
          Response.json({
            consecutiveRetryableFailures: 2,
            openedAt: 1000
          })
        ]
      ])
    );
    const backend = createPersistentCircuitBreakerBackend(namespace);
    const state = await backend.getState(openaiTarget);

    expect(state).toBeDefined();
    expect(state!.consecutiveRetryableFailures).toBe(2);
    expect(state!.openedAt).toBe(1000);
  });

  it("claims half-open probe via POST", async () => {
    const namespace = createMockNamespace(
      new Map([
        [
          "POST:/provider-circuit-breaker:claim_half_open_probe",
          Response.json({ claimed: true })
        ]
      ])
    );
    const backend = createPersistentCircuitBreakerBackend(namespace);
    const claimed = await backend.claimHalfOpenProbe(
      openaiTarget,
      defaultPolicy,
      1000
    );
    expect(claimed).toBe(true);
  });

  it("returns false when DO rejects probe claim", async () => {
    const namespace = createMockNamespace(
      new Map([
        [
          "POST:/provider-circuit-breaker:claim_half_open_probe",
          Response.json({ claimed: false })
        ]
      ])
    );
    const backend = createPersistentCircuitBreakerBackend(namespace);
    const claimed = await backend.claimHalfOpenProbe(
      openaiTarget,
      defaultPolicy,
      1000
    );
    expect(claimed).toBe(false);
  });

  it("sends success via POST without throwing", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const namespace = {
      idFromName: (name: string) => name,
      get(_id: unknown) {
        return {
          async fetch(request: Request) {
            capturedBody = (await request.json()) as Record<string, unknown>;
            return Response.json({ consecutiveRetryableFailures: 0 });
          }
        };
      }
    };
    const backend = createPersistentCircuitBreakerBackend(namespace);
    await backend.recordSuccess(openaiTarget, 200, 50, 5000);

    expect(capturedBody).toBeDefined();
    expect(capturedBody!.kind).toBe("success");
    expect(capturedBody!.latencyMs).toBe(200);
    expect(capturedBody!.totalTokens).toBe(50);
    expect(capturedBody!.now).toBe(5000);
  });

  it("sends retryable failure via POST without throwing", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const namespace = {
      idFromName: (name: string) => name,
      get(_id: unknown) {
        return {
          async fetch(request: Request) {
            capturedBody = (await request.json()) as Record<string, unknown>;
            return Response.json({ consecutiveRetryableFailures: 1 });
          }
        };
      }
    };
    const backend = createPersistentCircuitBreakerBackend(namespace);
    await backend.recordRetryableFailure(openaiTarget, defaultPolicy, 1000);

    expect(capturedBody).toBeDefined();
    expect(capturedBody!.kind).toBe("retryable_failure");
    expect(capturedBody!.threshold).toBe(3);
    expect(capturedBody!.now).toBe(1000);
  });
});

describe("isProviderTargetCircuitOpen", () => {
  it("returns false when target has no state", async () => {
    const backend = createInMemoryCircuitBreakerBackend();
    const isOpen = await isProviderTargetCircuitOpen(
      openaiTarget,
      defaultPolicy,
      () => Date.now(),
      backend
    );
    expect(isOpen).toBe(false);
  });

  it("returns false when failures are below threshold", async () => {
    const backend = createInMemoryCircuitBreakerBackend();
    await backend.recordRetryableFailure(openaiTarget, defaultPolicy, 1000);
    await backend.recordRetryableFailure(openaiTarget, defaultPolicy, 2000);

    const isOpen = await isProviderTargetCircuitOpen(
      openaiTarget,
      defaultPolicy,
      () => 3000,
      backend
    );
    expect(isOpen).toBe(false);
  });

  it("returns true when failures reach threshold", async () => {
    const backend = createInMemoryCircuitBreakerBackend();
    await backend.recordRetryableFailure(openaiTarget, defaultPolicy, 1000);
    await backend.recordRetryableFailure(openaiTarget, defaultPolicy, 2000);
    await backend.recordRetryableFailure(openaiTarget, defaultPolicy, 3000);

    const isOpen = await isProviderTargetCircuitOpen(
      openaiTarget,
      defaultPolicy,
      () => 4000,
      backend
    );
    expect(isOpen).toBe(true);
  });
});

describe("getProviderTargetCircuitState", () => {
  it("returns undefined when target has no state", async () => {
    const backend = createInMemoryCircuitBreakerBackend();
    const state = await getProviderTargetCircuitState(
      openaiTarget,
      defaultPolicy,
      () => Date.now(),
      backend
    );
    expect(state).toBeUndefined();
  });

  it("returns state without halfOpen when not in recovery window", async () => {
    const backend = createInMemoryCircuitBreakerBackend();
    await backend.recordSuccess(openaiTarget, 100, 50, 1000);

    const state = await getProviderTargetCircuitState(
      openaiTarget,
      defaultPolicy,
      () => 2000,
      backend
    );
    expect(state).toBeDefined();
    expect(state!.halfOpen).toBeUndefined();
  });

  it("returns halfOpen state when circuit is open and probe is claimed", async () => {
    const policy = { threshold: 1, cooldownMs: 1000 };
    const backend = createInMemoryCircuitBreakerBackend();

    // Open the circuit
    await backend.recordRetryableFailure(openaiTarget, policy, 1000);

    // After cooldown, get state should trigger half-open probe
    const state = await getProviderTargetCircuitState(
      openaiTarget,
      policy,
      () => 3000,
      backend
    );

    expect(state).toBeDefined();
    expect(state!.halfOpen).toBe(true);
    expect(state!.probeStartedAt).toBe(3000);
  });

  it("returns open state when probe cannot be claimed", async () => {
    const policy = { threshold: 1, cooldownMs: 10_000 };
    const backend = createInMemoryCircuitBreakerBackend();

    // Open the circuit
    await backend.recordRetryableFailure(openaiTarget, policy, 1000);

    // Try before cooldown
    const state = await getProviderTargetCircuitState(
      openaiTarget,
      policy,
      () => 2000,
      backend
    );

    expect(state).toBeDefined();
    expect(state!.halfOpen).toBeUndefined();
    expect(state!.openedAt).toBe(1000);
  });
});

describe("getAllInMemoryCircuitBreakerStates", () => {
  it("returns empty map when no states exist", () => {
    const states = getAllInMemoryCircuitBreakerStates();
    expect(states.size).toBe(0);
  });

  it("returns all recorded states", async () => {
    const backend = createInMemoryCircuitBreakerBackend();
    await backend.recordSuccess(openaiTarget, 100, 50, 1000);
    await backend.recordRetryableFailure(anthropicTarget, defaultPolicy, 1000);

    const states = getAllInMemoryCircuitBreakerStates();
    expect(states.size).toBe(2);
    expect(states.has("openai:gpt-4.1-mini")).toBe(true);
    expect(states.has("anthropic:claude-haiku-4-5")).toBe(true);
  });
});

describe("resetProviderCircuitBreakerState", () => {
  it("clears all in-memory states", async () => {
    const backend = createInMemoryCircuitBreakerBackend();
    await backend.recordSuccess(openaiTarget, 100, 50, 1000);
    await backend.recordRetryableFailure(anthropicTarget, defaultPolicy, 1000);

    expect(getAllInMemoryCircuitBreakerStates().size).toBe(2);

    resetProviderCircuitBreakerState();

    expect(getAllInMemoryCircuitBreakerStates().size).toBe(0);
  });
});
