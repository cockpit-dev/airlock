import { Hono } from "hono";
import type { TelemetrySink } from "@airlock/telemetry";
import { GatewayError } from "@airlock/shared";

import { AdminRateLimiter, extractIp } from "./admin-rate-limit.js";
import {
  corsHeaders,
  createPreflightResponse,
  parseCorsOrigins
} from "./cors.js";
import {
  toErrorResponse,
  toMethodNotAllowedResponse,
  toNotFoundResponse
} from "./errors.js";
import type { GatewayBindings } from "./env.js";
import { createRequestId, resolveRequestId } from "./request-id.js";
import { logRequest } from "./request-logger.js";
import { getMetricsCollector, type MetricsRecord } from "./metrics.js";
import { resolveDashboardOverlay } from "./config.js";
import { registerAdminConfigRoutes } from "./routes/admin-config.js";
import { registerAdminConfigManageRoutes } from "./routes/admin-config-manage.js";
import { registerAdminKeyGovernanceRoutes } from "./routes/admin-key-governance.js";
import { registerAdminGatewayStatusRoutes } from "./routes/admin-gateway-status.js";
import { registerAdminMetricsRoutes } from "./routes/admin-metrics.js";
import { registerAdminRoutingHealthRoutes } from "./routes/admin-routing-health.js";
import { handleChatCompletions } from "./routes/chat-completions.js";
import { handleHealth } from "./routes/health.js";
import { handleMessages } from "./routes/messages.js";
import { handleModelById, handleModels } from "./routes/models.js";
import { handleReady } from "./routes/ready.js";
import { handleResponses } from "./routes/responses.js";
import {
  emitGatewayRequestErrorTelemetry,
  emitGatewayRequestUnknownErrorTelemetry
} from "./telemetry.js";

export interface CreateAppOptions {
  fetcher?: typeof fetch;
  now?: () => number;
  telemetrySink?: TelemetrySink;
  adminRateLimiter?: AdminRateLimiter;
}

type AppVariables = {
  requestId: string;
  fetcher?: typeof fetch;
  now?: () => number;
  requestStartedAt: number;
  telemetrySink?: TelemetrySink;
  telemetryErrorEmitted?: boolean;
  _airlock_metrics_provider?: string;
  _airlock_metrics_model?: string;
  _airlock_metrics_stream?: boolean;
};

function getRequestStartTime(): number {
  return globalThis.performance?.now() ?? Date.now();
}

async function resolveRuntimeFeatureConfig(
  env: GatewayBindings
): Promise<{ corsOrigins?: string; requestLogging: boolean }> {
  const overlay = await resolveDashboardOverlay(env);
  const features = overlay?.sections["features"]?.data;
  const featureRecord =
    typeof features === "object" &&
    features !== null &&
    !Array.isArray(features)
      ? (features as Record<string, unknown>)
      : undefined;

  const corsOrigins =
    typeof featureRecord?.corsOrigins === "string"
      ? featureRecord.corsOrigins
      : env.AIRLOCK_CORS_ORIGINS;
  const requestLogging =
    typeof featureRecord?.requestLogging === "boolean"
      ? featureRecord.requestLogging
      : env.AIRLOCK_REQUEST_LOGGING === true;

  return {
    ...(corsOrigins ? { corsOrigins } : {}),
    requestLogging
  };
}

export function createApp(options: CreateAppOptions = {}) {
  const app = new Hono<{
    Bindings: GatewayBindings;
    Variables: AppVariables;
  }>();

  app.onError((error, context) => {
    const requestId = context.get("requestId") ?? createRequestId();
    const telemetrySink = context.get("telemetrySink");
    const requestStartedAt = context.get("requestStartedAt");
    const telemetryErrorEmitted = context.get("telemetryErrorEmitted");
    let pathname: string;
    try {
      pathname = new URL(context.req.url).pathname;
    } catch {
      pathname = context.req.path ?? "/unknown";
    }

    if (!telemetryErrorEmitted && requestStartedAt !== undefined) {
      if (error instanceof GatewayError) {
        void emitGatewayRequestErrorTelemetry(
          {
            telemetrySink,
            requestId,
            routePath: pathname,
            mode: context.env.AIRLOCK_MODE ?? "free",
            startedAt: requestStartedAt,
            stream: false,
            statusCode: error.httpStatus
          },
          error
        );
      } else {
        void emitGatewayRequestUnknownErrorTelemetry({
          telemetrySink,
          requestId,
          routePath: pathname,
          mode: context.env.AIRLOCK_MODE ?? "free",
          startedAt: requestStartedAt,
          stream: false,
          statusCode: 500
        });
        void resolveRuntimeFeatureConfig(context.env).then(
          (runtimeFeatures) => {
            if (!runtimeFeatures.requestLogging) {
              return;
            }

            console.error(
              JSON.stringify({
                level: "error",
                msg: "Unhandled error in request",
                requestId,
                path: pathname,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
              })
            );
          }
        );
      }
    }

    return toErrorResponse(error, requestId, pathname);
  });

  app.notFound((context) => {
    const requestId = context.get("requestId") ?? createRequestId();
    let pathname: string;
    try {
      pathname = new URL(context.req.url).pathname;
    } catch {
      pathname = context.req.path ?? "/unknown";
    }
    return toNotFoundResponse(requestId, pathname);
  });

  app.use("*", async (context, next) => {
    const runtimeFeatures = await resolveRuntimeFeatureConfig(context.env);
    context.set(
      "requestId",
      resolveRequestId(context.req.header("x-request-id"))
    );
    context.set("fetcher", options.fetcher);
    context.set("now", options.now);
    context.set("requestStartedAt", getRequestStartTime());
    context.set("telemetrySink", options.telemetrySink);
    context.set("telemetryErrorEmitted", false);
    await next();
    context.header("request-id", context.get("requestId"));
    context.header("x-request-id", context.get("requestId"));

    let pathname: string;
    try {
      pathname = new URL(context.req.url).pathname;
    } catch {
      pathname = context.req.path ?? "/unknown";
    }

    const durationMs = Math.round(
      getRequestStartTime() - context.get("requestStartedAt")
    );

    const metricsRecord: MetricsRecord = {
      routePath: pathname,
      statusCode: context.res.status,
      durationMs
    };
    const mp = context.get("_airlock_metrics_provider") as string | undefined;
    const mm = context.get("_airlock_metrics_model") as string | undefined;
    const ms = context.get("_airlock_metrics_stream") as boolean | undefined;
    if (mp) metricsRecord.providerId = mp;
    if (mm) metricsRecord.modelId = mm;
    if (ms !== undefined) metricsRecord.isStream = ms;
    getMetricsCollector().record(metricsRecord);

    if (runtimeFeatures.requestLogging) {
      logRequest({
        msg: "gateway_request",
        requestId: context.get("requestId"),
        method: context.req.method,
        path: pathname,
        status: context.res.status,
        durationMs
      });
    }
  });

  // CORS preflight for /v1/* public API endpoints
  app.options("/v1/*", async (context) => {
    const runtimeFeatures = await resolveRuntimeFeatureConfig(context.env);
    const config = parseCorsOrigins(runtimeFeatures.corsOrigins);
    return createPreflightResponse(context.req.header("Origin"), config, {
      requestHeaders: context.req.header("Access-Control-Request-Headers")
    });
  });

  // CORS headers on all /v1/* responses
  app.use("/v1/*", async (context, next) => {
    const runtimeFeatures = await resolveRuntimeFeatureConfig(context.env);
    await next();
    const config = parseCorsOrigins(runtimeFeatures.corsOrigins);
    const headers = corsHeaders(context.req.header("Origin"), config);
    for (const [key, value] of Object.entries(headers)) {
      context.header(key, value);
    }
  });

  // CORS preflight for browser-based admin dashboard requests
  app.options("/_airlock/*", async (context) => {
    const runtimeFeatures = await resolveRuntimeFeatureConfig(context.env);
    const config = parseCorsOrigins(runtimeFeatures.corsOrigins);
    return createPreflightResponse(context.req.header("Origin"), config, {
      allowAdminMethods: true,
      requestHeaders: context.req.header("Access-Control-Request-Headers")
    });
  });

  app.use("/_airlock/*", async (context, next) => {
    const runtimeFeatures = await resolveRuntimeFeatureConfig(context.env);
    await next();
    const config = parseCorsOrigins(runtimeFeatures.corsOrigins);
    const headers = corsHeaders(context.req.header("Origin"), config, {
      allowAdminMethods: true
    });
    for (const [key, value] of Object.entries(headers)) {
      context.header(key, value);
    }
  });

  app.get("/healthz", handleHealth);
  app.get("/readyz", handleReady);

  // Rate limiting for admin endpoints
  const rateLimiter = options.adminRateLimiter ?? new AdminRateLimiter();
  app.use("/_airlock/*", async (context, next) => {
    const ip = extractIp(context.req);
    const now = context.get("now")?.() ?? Date.now();
    const result = rateLimiter.check(ip, now);
    if (!result.allowed) {
      return context.json(
        {
          error: {
            message: "Admin endpoint rate limit exceeded",
            code: "admin_rate_limit_exceeded",
            request_id: context.get("requestId")
          }
        },
        429
      );
    }
    await next();
  });

  registerAdminKeyGovernanceRoutes(app);
  registerAdminGatewayStatusRoutes(app);
  registerAdminConfigRoutes(app);
  registerAdminConfigManageRoutes(app);
  registerAdminMetricsRoutes(app);
  registerAdminRoutingHealthRoutes(
    app,
    options.now ? () => options.now! : undefined
  );
  app.get("/v1/models", handleModels);
  app.get("/v1/models/:model", handleModelById);
  app.get("/v1/models/:provider/:model", handleModelById);
  app.post("/v1/chat/completions", handleChatCompletions);
  app.post("/v1/messages", handleMessages);
  app.post("/v1/responses", handleResponses);

  // Return 405 for non-POST methods on write endpoints (excluding OPTIONS — handled by CORS)
  for (const path of [
    "/v1/chat/completions",
    "/v1/messages",
    "/v1/responses"
  ]) {
    app.on(["GET", "PUT", "PATCH", "DELETE", "HEAD"], path, (c) => {
      const requestId = c.get("requestId");
      return toMethodNotAllowedResponse(requestId, path);
    });
  }

  return app;
}
