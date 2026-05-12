import type { GatewayRequestTelemetryEvent } from "./events.js";
import { gatewayRequestTelemetryEventSchema } from "./events.js";

export interface TelemetrySink {
  emit(event: GatewayRequestTelemetryEvent): Promise<void>;
}

export async function emitTelemetryEvent(
  sink: TelemetrySink | undefined,
  event: GatewayRequestTelemetryEvent
): Promise<void> {
  if (!sink) {
    return;
  }

  gatewayRequestTelemetryEventSchema.parse(event);

  try {
    await sink.emit(event);
  } catch {
    // Telemetry must never affect request correctness.
  }
}
