import type { GatewayRequestTelemetryEvent } from "./events.js";
import type { TelemetrySink } from "./sink.js";

export interface TelemetrySamplingPolicy {
  freeSuccessSampleRate: number;
  scaleSuccessSampleRate: number;
}

export interface TelemetryQueueProducer {
  send(event: GatewayRequestTelemetryEvent): Promise<void>;
}

function clampSampleRate(value: number): number {
  if (value <= 0) {
    return 0;
  }

  if (value >= 1) {
    return 1;
  }

  return value;
}

function hashString(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function shouldEnqueueTelemetryEvent(
  event: GatewayRequestTelemetryEvent,
  sampling: TelemetrySamplingPolicy
): boolean {
  if (event.outcome === "error") {
    return true;
  }

  const sampleRate =
    event.mode === "scale"
      ? clampSampleRate(sampling.scaleSuccessSampleRate)
      : clampSampleRate(sampling.freeSuccessSampleRate);

  if (sampleRate === 0) {
    return false;
  }

  if (sampleRate === 1) {
    return true;
  }

  const threshold = Math.floor(sampleRate * 0xffffffff);
  return hashString(event.requestId) <= threshold;
}

export function createQueueTelemetrySink(
  producer: TelemetryQueueProducer,
  sampling: TelemetrySamplingPolicy
): TelemetrySink {
  return {
    async emit(event) {
      if (!shouldEnqueueTelemetryEvent(event, sampling)) {
        return;
      }

      await producer.send(event);
    }
  };
}
