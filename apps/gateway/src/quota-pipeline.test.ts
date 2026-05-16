import { describe, it, expect } from "vitest";
import {
  didUseFallback,
  routingSignals,
  collectRateLimitHeaders
} from "./quota-pipeline.js";
import type { QuotaResources } from "./quota-pipeline.js";

function makeQuota(overrides: Partial<QuotaResources> = {}): QuotaResources {
  return {
    ipRateLimitDecision: undefined,
    tokenReservationResult: undefined,
    tokenReservation: undefined,
    requestQuotaDecision: undefined,
    concurrencyResult: undefined,
    concurrencyLeaseId: undefined,
    circuitBreakerBackend: undefined,
    routingMetadata: {},
    attemptedTarget: undefined,
    ...overrides
  };
}

describe("didUseFallback", () => {
  it("returns false when no target was attempted", () => {
    const quota = makeQuota();
    expect(
      didUseFallback(quota, { provider: "openai", providerModel: "gpt-4" })
    ).toBe(false);
  });

  it("returns false when attempted target matches primary", () => {
    const quota = makeQuota({
      attemptedTarget: { provider: "openai", providerModel: "gpt-4" }
    });
    expect(
      didUseFallback(quota, { provider: "openai", providerModel: "gpt-4" })
    ).toBe(false);
  });

  it("returns true when provider differs", () => {
    const quota = makeQuota({
      attemptedTarget: { provider: "anthropic", providerModel: "gpt-4" }
    });
    expect(
      didUseFallback(quota, { provider: "openai", providerModel: "gpt-4" })
    ).toBe(true);
  });

  it("returns true when model differs", () => {
    const quota = makeQuota({
      attemptedTarget: { provider: "openai", providerModel: "gpt-4o-mini" }
    });
    expect(
      didUseFallback(quota, { provider: "openai", providerModel: "gpt-4" })
    ).toBe(true);
  });
});

describe("routingSignals", () => {
  it("returns all undefined for empty routing metadata", () => {
    const quota = makeQuota();
    const signals = routingSignals(quota);
    expect(signals).toEqual({
      attemptCount: undefined,
      primaryTargetOpen: undefined,
      timeoutBudgetMs: undefined,
      timeoutBudgetRemainingMs: undefined,
      malformedSseEventCount: undefined
    });
  });

  it("extracts all routing metadata fields", () => {
    const quota = makeQuota({
      routingMetadata: {
        attemptCount: 3,
        primaryTargetOpen: true,
        timeoutBudgetMs: 30000,
        timeoutBudgetRemainingMs: 15000,
        malformedSseEventCount: 2
      }
    });
    const signals = routingSignals(quota);
    expect(signals.attemptCount).toBe(3);
    expect(signals.primaryTargetOpen).toBe(true);
    expect(signals.timeoutBudgetMs).toBe(30000);
    expect(signals.timeoutBudgetRemainingMs).toBe(15000);
    expect(signals.malformedSseEventCount).toBe(2);
  });
});
