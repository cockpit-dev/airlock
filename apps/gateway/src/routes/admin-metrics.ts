import type { Hono } from "hono";
import type { TelemetrySink } from "@airlock/telemetry";
import {
  authorizeInternalAdminRequest,
  parseInternalAdminCredentials,
  type InternalAdminScope
} from "@airlock/governance";

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
  const requireAdminScope = async (
    context: {
      req: { header(name: string): string | undefined };
      env: GatewayBindings;
      get(key: "requestId"): string;
    },
    requiredScope: InternalAdminScope
  ): Promise<void> => {
    await authorizeInternalAdminRequest({
      authorization: context.req.header("authorization"),
      adminToken: context.env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
      adminCredentials: parseInternalAdminCredentials(
        context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS
      ),
      structuredCredentialsConfig:
        context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS,
      requiredScope,
      requestId: context.get("requestId")
    });
  };

  app.get("/_airlock/metrics", async (context) => {
    await requireAdminScope(context, "keys.read");
    return context.json(getMetricsCollector().snapshot());
  });
}
