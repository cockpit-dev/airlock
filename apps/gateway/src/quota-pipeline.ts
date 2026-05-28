import type { ProviderTarget } from "@airlock/routing";
import type {
  GatewayApiKeyRecord,
  GatewayKeyConcurrencyDecision,
  GatewayKeyTokenQuotaDecision,
  GatewayKeyTokenReservationHandle,
  RateLimitDecision
} from "@airlock/governance";
import type { TelemetrySink, TokenUsage } from "@airlock/telemetry";
import type { RuntimeMode } from "@airlock/shared";
import { GatewayError } from "@airlock/shared";

import { createPersistentCircuitBreakerBackend } from "./circuit-breaker.js";
import type { GatewayBindings } from "./env.js";
import {
  acquireGatewayKeyConcurrencyLease,
  releaseGatewayKeyConcurrencyLease
} from "./gateway-key-concurrency.js";
import { enforceGatewayKeyRequestQuota } from "./gateway-key-quota.js";
import {
  assertGatewayKeyTokenUsageAvailable,
  enforceGatewayKeyTokenQuotaPrecheck,
  reconcileGatewayKeyTokenQuotaReservation,
  releaseGatewayKeyTokenQuotaReservation,
  reserveGatewayKeyTokenQuota
} from "./gateway-key-token-quota.js";
import {
  enforceIpRateLimit,
  type IpRateLimitDecision,
  type IpRateLimitPolicy
} from "./ip-rate-limit.js";
import { collectRateLimitHeaders } from "./rate-limit-headers.js";
import type { RoutingMetadataAccumulator } from "./provider-execution.js";
import {
  emitGatewayRequestErrorTelemetry,
  emitGatewayRequestSuccessTelemetry,
  emitGatewayRequestUnknownErrorTelemetry
} from "./telemetry.js";

export interface QuotaResources {
  ipRateLimitDecision: IpRateLimitDecision | undefined;
  tokenReservationResult:
    | {
        handle: GatewayKeyTokenReservationHandle;
        decision: GatewayKeyTokenQuotaDecision;
      }
    | undefined;
  tokenReservation: GatewayKeyTokenReservationHandle | undefined;
  requestQuotaDecision: RateLimitDecision | undefined;
  concurrencyResult:
    | { leaseId: string; decision: GatewayKeyConcurrencyDecision }
    | undefined;
  concurrencyLeaseId: string | undefined;
  circuitBreakerBackend:
    | ReturnType<typeof createPersistentCircuitBreakerBackend>
    | undefined;
  routingMetadata: RoutingMetadataAccumulator;
  attemptedTarget: ProviderTarget | undefined;
}

export interface QuotaAcquireOptions {
  env: GatewayBindings;
  headers: Headers;
  config: {
    ipRateLimitPolicy: IpRateLimitPolicy | undefined;
    providerCircuitBreakerPersistent: boolean | undefined;
    providerTimeoutMs: number;
  };
  gatewayApiKey: GatewayApiKeyRecord;
  requestId: string;
  maxOutputTokens: number;
}

export async function acquireQuotaResources(
  options: QuotaAcquireOptions
): Promise<QuotaResources> {
  const { env, headers, config, gatewayApiKey, requestId, maxOutputTokens } =
    options;

  const [
    ipRateLimitDecision,
    requestQuotaDecision,
    concurrencyResult,
    tokenPrecheckResult
  ] = await Promise.all([
    enforceIpRateLimit(env, config.ipRateLimitPolicy, headers, requestId),
    enforceGatewayKeyRequestQuota(env, gatewayApiKey, requestId),
    acquireGatewayKeyConcurrencyLease(
      env,
      gatewayApiKey,
      requestId,
      config.providerTimeoutMs
    ),
    enforceGatewayKeyTokenQuotaPrecheck(env, gatewayApiKey, requestId)
  ]);
  void tokenPrecheckResult;
  const tokenReservationResult = await reserveGatewayKeyTokenQuota(
    env,
    gatewayApiKey,
    requestId,
    maxOutputTokens,
    config.providerTimeoutMs + 5_000
  );
  const tokenReservation = tokenReservationResult?.handle;
  const concurrencyLeaseId = concurrencyResult?.leaseId;

  const circuitBreakerBackend =
    config.providerCircuitBreakerPersistent &&
    env.AIRLOCK_PROVIDER_CIRCUIT_BREAKER
      ? createPersistentCircuitBreakerBackend(
          env.AIRLOCK_PROVIDER_CIRCUIT_BREAKER
        )
      : undefined;

  return {
    ipRateLimitDecision,
    tokenReservationResult,
    tokenReservation,
    requestQuotaDecision,
    concurrencyResult,
    concurrencyLeaseId,
    circuitBreakerBackend,
    routingMetadata: {},
    attemptedTarget: undefined
  };
}

export function didUseFallback(
  quota: QuotaResources,
  primaryTarget: ProviderTarget
): boolean {
  return (
    quota.attemptedTarget !== undefined &&
    (quota.attemptedTarget.provider !== primaryTarget.provider ||
      quota.attemptedTarget.providerModel !== primaryTarget.providerModel)
  );
}

export function routingSignals(quota: QuotaResources): {
  attemptCount: number | undefined;
  primaryTargetOpen: boolean | undefined;
  timeoutBudgetMs: number | undefined;
  timeoutBudgetRemainingMs: number | undefined;
  malformedSseEventCount: number | undefined;
} {
  const rm = quota.routingMetadata;
  return {
    attemptCount: rm.attemptCount,
    primaryTargetOpen: rm.primaryTargetOpen,
    timeoutBudgetMs: rm.timeoutBudgetMs,
    timeoutBudgetRemainingMs: rm.timeoutBudgetRemainingMs,
    malformedSseEventCount: rm.malformedSseEventCount
  };
}

export async function reconcileTokenQuota(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string,
  tokenReservation: GatewayKeyTokenReservationHandle | undefined,
  totalTokens: number
): Promise<void> {
  try {
    await reconcileGatewayKeyTokenQuotaReservation(
      env,
      gatewayApiKey,
      requestId,
      tokenReservation,
      totalTokens
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "Token quota reconciliation failed",
        requestId,
        keyId: gatewayApiKey.id,
        totalTokens,
        error: error instanceof Error ? error.message : String(error)
      })
    );
    void releaseGatewayKeyTokenQuotaReservation(
      env,
      gatewayApiKey,
      requestId,
      tokenReservation
    );
  }
}

export function releaseTokenReservation(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string,
  tokenReservation: GatewayKeyTokenReservationHandle | undefined
): void {
  void releaseGatewayKeyTokenQuotaReservation(
    env,
    gatewayApiKey,
    requestId,
    tokenReservation
  );
}

export async function releaseConcurrencyLease(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  concurrencyLeaseId: string | undefined,
  requestId: string
): Promise<void> {
  try {
    await releaseGatewayKeyConcurrencyLease(
      env,
      gatewayApiKey,
      concurrencyLeaseId,
      requestId
    );
  } catch {
    // Lease release failure must not mask the original response
  }
}

export function releaseStreamResources(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string,
  quota: QuotaResources,
  streamUsage: TokenUsage | undefined
): void {
  if (!streamUsage) {
    releaseTokenReservation(
      env,
      gatewayApiKey,
      requestId,
      quota.tokenReservation
    );
  }
  void releaseConcurrencyLease(
    env,
    gatewayApiKey,
    quota.concurrencyLeaseId,
    requestId
  );
}

export function cancelStreamResources(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string,
  quota: QuotaResources,
  streamIterator: AsyncIterator<unknown>
): void {
  void streamIterator.return?.();
  releaseTokenReservation(
    env,
    gatewayApiKey,
    requestId,
    quota.tokenReservation
  );
  void releaseConcurrencyLease(
    env,
    gatewayApiKey,
    quota.concurrencyLeaseId,
    requestId
  );
}

export interface QuotaTelemetryBase {
  telemetrySink: TelemetrySink | undefined;
  requestId: string;
  routePath: string;
  mode: RuntimeMode;
  startedAt: number;
  gatewayApiKey: GatewayApiKeyRecord;
  externalModel: string;
  primaryTarget: ProviderTarget;
  quota: QuotaResources;
  routingStrategy: string | undefined;
}

export async function handleQuotaError(
  env: GatewayBindings,
  base: QuotaTelemetryBase,
  stream: boolean,
  error: unknown
): Promise<void> {
  await releaseGatewayKeyTokenQuotaReservation(
    env,
    base.gatewayApiKey,
    base.requestId,
    base.quota.tokenReservation
  );

  const fb = didUseFallback(base.quota, base.primaryTarget);
  const signals = routingSignals(base.quota);

  if (error instanceof GatewayError) {
    void emitGatewayRequestErrorTelemetry(
      {
        telemetrySink: base.telemetrySink,
        requestId: base.requestId,
        routePath: base.routePath,
        mode: base.mode,
        startedAt: base.startedAt,
        stream,
        statusCode: error.httpStatus,
        gatewayApiKey: base.gatewayApiKey,
        externalModel: base.externalModel,
        providerTarget: base.quota.attemptedTarget,
        fallbackUsed: fb,
        routingStrategy: base.routingStrategy,
        ...signals
      },
      error
    );
  } else {
    void emitGatewayRequestUnknownErrorTelemetry({
      telemetrySink: base.telemetrySink,
      requestId: base.requestId,
      routePath: base.routePath,
      mode: base.mode,
      startedAt: base.startedAt,
      stream,
      statusCode: 500,
      gatewayApiKey: base.gatewayApiKey,
      externalModel: base.externalModel,
      providerTarget: base.quota.attemptedTarget,
      fallbackUsed: fb,
      routingStrategy: base.routingStrategy,
      ...signals
    });
  }
}

export function emitSuccessTelemetry(
  base: QuotaTelemetryBase,
  stream: boolean,
  statusCode: number,
  usage?: TokenUsage
): void {
  const fb = didUseFallback(base.quota, base.primaryTarget);
  const signals = routingSignals(base.quota);

  void emitGatewayRequestSuccessTelemetry({
    telemetrySink: base.telemetrySink,
    requestId: base.requestId,
    routePath: base.routePath,
    mode: base.mode,
    startedAt: base.startedAt,
    stream,
    statusCode,
    gatewayApiKey: base.gatewayApiKey,
    externalModel: base.externalModel,
    providerTarget: base.quota.attemptedTarget,
    fallbackUsed: fb,
    ...(usage ? { usage } : {}),
    routingStrategy: base.routingStrategy,
    ...signals
  });
}

export function quotaRateLimitHeaders(
  quota: QuotaResources
): Record<string, string> {
  return collectRateLimitHeaders(
    quota.ipRateLimitDecision,
    quota.tokenReservationResult?.decision,
    quota.requestQuotaDecision,
    quota.concurrencyResult?.decision
  );
}

export { assertGatewayKeyTokenUsageAvailable };
