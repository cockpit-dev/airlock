import type { GatewayError, RuntimeMode } from "@airlock/shared";
import {
  emitTelemetryEvent,
  type GatewayRequestTelemetryEvent,
  type TelemetrySink,
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
    ...(context.gatewayApiKey ? { gatewayKeyId: context.gatewayApiKey.id } : {}),
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
    ...(context.usage ? { usage: context.usage } : {})
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
    retryable: error.retryable
  });
}
