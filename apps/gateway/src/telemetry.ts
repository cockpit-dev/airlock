import type { GatewayError, RuntimeMode } from "@airlock/shared";
import {
  createAnalyticsEngineTelemetryDataPoint,
  createQueueTelemetrySink,
  emitTelemetryEvent,
  gatewayRequestTelemetryEventSchema,
  type GatewayRequestTelemetryEvent,
  type TelemetrySink,
  type TelemetryQueueProducer,
  type TelemetrySamplingPolicy,
  type TokenUsage
} from "@airlock/telemetry";
import type { GatewayApiKeyRecord } from "@airlock/governance";
import type { ProviderTarget } from "@airlock/routing";

export interface RequestTelemetryContext {
  telemetrySink?: TelemetrySink | undefined;
  requestId: string;
  routePath: string;
  mode: RuntimeMode;
  startedAt: number;
  stream: boolean;
  statusCode: number;
  gatewayApiKey?: GatewayApiKeyRecord | undefined;
  externalModel?: string | undefined;
  providerTarget?: ProviderTarget | undefined;
  fallbackUsed?: boolean | undefined;
  usage?: TokenUsage | undefined;
  routingStrategy?: string | undefined;
  attemptCount?: number | undefined;
  primaryTargetOpen?: boolean | undefined;
  timeoutBudgetMs?: number | undefined;
  timeoutBudgetRemainingMs?: number | undefined;
  malformedSseEventCount?: number | undefined;
}

function getTelemetryNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function createBaseEvent(
  context: RequestTelemetryContext
): Omit<GatewayRequestTelemetryEvent, "outcome"> {
  return {
    kind: "gateway_request",
    occurredAt: new Date().toISOString(),
    requestId: context.requestId,
    mode: context.mode,
    routePath: context.routePath,
    stream: context.stream,
    durationMs: Math.max(0, Math.round(getTelemetryNow() - context.startedAt)),
    statusCode: context.statusCode,
    ...(context.gatewayApiKey
      ? { gatewayKeyId: context.gatewayApiKey.id }
      : {}),
    ...(context.externalModel ? { externalModel: context.externalModel } : {}),
    ...(context.providerTarget
      ? {
          provider: context.providerTarget.provider,
          providerModel: context.providerTarget.providerModel
        }
      : {}),
    ...(context.fallbackUsed !== undefined
      ? { fallbackUsed: context.fallbackUsed }
      : {}),
    ...(context.usage ? { usage: context.usage } : {}),
    ...(context.routingStrategy
      ? { routingStrategy: context.routingStrategy }
      : {}),
    ...(context.attemptCount !== undefined
      ? { attemptCount: context.attemptCount }
      : {}),
    ...(context.primaryTargetOpen !== undefined
      ? { primaryTargetOpen: context.primaryTargetOpen }
      : {}),
    ...(context.timeoutBudgetMs !== undefined
      ? { timeoutBudgetMs: context.timeoutBudgetMs }
      : {}),
    ...(context.timeoutBudgetRemainingMs !== undefined
      ? { timeoutBudgetRemainingMs: context.timeoutBudgetRemainingMs }
      : {}),
    ...(context.malformedSseEventCount !== undefined
      ? { malformedSseEventCount: context.malformedSseEventCount }
      : {})
  };
}

export async function emitGatewayRequestSuccessTelemetry(
  context: RequestTelemetryContext
): Promise<void> {
  await emitTelemetryEvent(context.telemetrySink, {
    ...createBaseEvent(context),
    outcome: "success"
  });
}

export async function emitGatewayRequestErrorTelemetry(
  context: RequestTelemetryContext,
  error: GatewayError
): Promise<void> {
  await emitTelemetryEvent(context.telemetrySink, {
    ...createBaseEvent(context),
    outcome: "error",
    errorCode: error.code,
    errorCategory: error.category,
    retryable: error.retryable,
    ...(error.upstreamErrorCode
      ? { upstreamErrorCode: error.upstreamErrorCode }
      : {})
  });
}

export async function emitGatewayRequestUnknownErrorTelemetry(
  context: RequestTelemetryContext
): Promise<void> {
  await emitTelemetryEvent(context.telemetrySink, {
    ...createBaseEvent(context),
    outcome: "error",
    errorCode: "internal_error",
    errorCategory: "internal",
    retryable: false
  });
}

export function createGatewayTelemetrySink(
  producer: TelemetryQueueProducer,
  sampling: TelemetrySamplingPolicy
): TelemetrySink {
  return createQueueTelemetrySink(producer, sampling);
}

export async function processTelemetryQueueBatch(
  batch: {
    messages: Array<{
      body: unknown;
      ack(): void;
      retry(): void;
    }>;
  },
  dataset: {
    writeDataPoint(dataPoint: {
      indexes: string[];
      blobs: string[];
      doubles: number[];
    }): void;
  }
): Promise<void> {
  for (const message of batch.messages) {
    try {
      const event = gatewayRequestTelemetryEventSchema.parse(message.body);
      const dataPoint = createAnalyticsEngineTelemetryDataPoint(event);
      await Promise.resolve();
      dataset.writeDataPoint(dataPoint);
      message.ack();
    } catch {
      message.retry();
    }
  }
}
