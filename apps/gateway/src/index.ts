import { createApp } from "./app.js";
import type { GatewayBindings } from "./env.js";
import { gatewayEnvSchema } from "./env.js";
import { GatewayKeyQuotaDurableObject } from "./gateway-key-quota.js";
import {
  createGatewayTelemetrySink,
  processTelemetryQueueBatch
} from "./telemetry.js";

type GatewayFetchContext = Parameters<ReturnType<typeof createApp>["fetch"]>[2];

export default {
  async fetch(
    request: Request,
    env: GatewayBindings,
    executionContext: GatewayFetchContext
  ): Promise<Response> {
    const parsedEnv = gatewayEnvSchema.parse(env);
    const telemetrySink = parsedEnv.AIRLOCK_TELEMETRY
      ? createGatewayTelemetrySink(
          {
            send(message) {
              return parsedEnv.AIRLOCK_TELEMETRY!.send(message);
            }
          },
          {
            freeSuccessSampleRate: parsedEnv.AIRLOCK_TELEMETRY_SUCCESS_SAMPLE_RATE_FREE,
            scaleSuccessSampleRate: parsedEnv.AIRLOCK_TELEMETRY_SUCCESS_SAMPLE_RATE_SCALE
          }
        )
      : undefined;
    const app = createApp(
      telemetrySink === undefined ? {} : { telemetrySink }
    );

    return app.fetch(request, env, executionContext);
  },
  async queue(
    batch: {
      messages: Array<{
        body: unknown;
        ack(): void;
        retry(): void;
      }>;
    },
    env: GatewayBindings
  ): Promise<void> {
    const parsedEnv = gatewayEnvSchema.parse(env);

    if (!parsedEnv.AIRLOCK_TELEMETRY_DATASET) {
      return;
    }

    await processTelemetryQueueBatch(batch, parsedEnv.AIRLOCK_TELEMETRY_DATASET);
  }
};

export { GatewayKeyQuotaDurableObject };
