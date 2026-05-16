import { Hono } from "hono";
import type { TelemetrySink } from "@airlock/telemetry";
import { GatewayError } from "@airlock/shared";

import {
  toErrorResponse,
  toMethodNotAllowedResponse,
  toNotFoundResponse
} from "./errors.js";
import type { GatewayBindings } from "./env.js";
import { createRequestId } from "./request-id.js";
import { registerAdminKeyGovernanceRoutes } from "./routes/admin-key-governance.js";
import { registerAdminGatewayStatusRoutes } from "./routes/admin-gateway-status.js";
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
}

type AppVariables = {
  requestId: string;
  fetcher?: typeof fetch;
  now?: () => number;
  requestStartedAt: number;
  telemetrySink?: TelemetrySink;
  telemetryErrorEmitted?: boolean;
};

function getRequestStartTime(): number {
  return globalThis.performance?.now() ?? Date.now();
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
    context.set("requestId", createRequestId());
    context.set("fetcher", options.fetcher);
    context.set("now", options.now);
    context.set("requestStartedAt", getRequestStartTime());
    context.set("telemetrySink", options.telemetrySink);
    context.set("telemetryErrorEmitted", false);
    await next();
    context.header("request-id", context.get("requestId"));
    context.header("x-request-id", context.get("requestId"));
  });

  app.get("/healthz", handleHealth);
  app.get("/readyz", handleReady);
  registerAdminKeyGovernanceRoutes(app);
  registerAdminGatewayStatusRoutes(app);
  registerAdminRoutingHealthRoutes(
    app,
    options.now ? () => options.now! : undefined
  );
  app.get("/v1/models", handleModels);
  app.get("/v1/models/:model", handleModelById);
  app.post("/v1/chat/completions", handleChatCompletions);
  app.post("/v1/messages", handleMessages);
  app.post("/v1/responses", handleResponses);

  // Return 405 for non-POST methods on write endpoints
  for (const path of [
    "/v1/chat/completions",
    "/v1/messages",
    "/v1/responses"
  ]) {
    app.on(["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"], path, (c) => {
      const requestId = c.get("requestId");
      return toMethodNotAllowedResponse(requestId, path);
    });
  }

  return app;
}
