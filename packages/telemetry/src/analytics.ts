import type { GatewayRequestTelemetryEvent } from "./events.js";

export interface AnalyticsEngineDataPoint {
  indexes: string[];
  blobs: string[];
  doubles: number[];
}

export interface AnalyticsEngineWriter {
  writeDataPoint(dataPoint: AnalyticsEngineDataPoint): void;
}

export function createAnalyticsEngineTelemetryDataPoint(
  event: GatewayRequestTelemetryEvent
): AnalyticsEngineDataPoint {
  return {
    indexes: [event.kind, event.mode, event.routePath],
    blobs: [
      event.outcome,
      event.provider ?? "",
      event.providerModel ?? "",
      event.externalModel ?? "",
      event.gatewayKeyId ?? "",
      event.routingStrategy ?? ""
    ],
    doubles: [
      event.durationMs,
      event.statusCode,
      event.fallbackUsed ? 1 : 0,
      event.usage?.inputTokens ?? 0,
      event.usage?.outputTokens ?? 0,
      event.usage?.totalTokens ?? 0,
      event.attemptCount ?? 0,
      event.primaryTargetOpen ? 1 : 0,
      event.timeoutBudgetMs ?? 0,
      event.timeoutBudgetRemainingMs ?? 0
    ]
  };
}
