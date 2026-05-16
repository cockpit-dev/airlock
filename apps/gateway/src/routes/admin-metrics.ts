import type { Hono } from "hono";
import type { TelemetrySink } from "@airlock/telemetry";

import { requireAdminScope } from "../admin-auth.js";
import type { GatewayBindings } from "../env.js";
import { getMetricsCollector } from "../metrics.js";

type AppVariables = {
  requestId: string;
  fetcher?: typeof fetch;
  requestStartedAt: number;
  telemetrySink?: TelemetrySink;
  telemetryErrorEmitted?: boolean;
};

type GatewayApp = Hono<{
  Bindings: GatewayBindings;
  Variables: AppVariables;
}>;

export function registerAdminMetricsRoutes(app: GatewayApp): void {
  app.get("/_airlock/metrics", async (context) => {
    await requireAdminScope(context, "keys.read");
    return context.json(getMetricsCollector().snapshot());
  });
}
