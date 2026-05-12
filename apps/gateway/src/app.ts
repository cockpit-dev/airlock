import { Hono } from "hono";
import type { TelemetrySink } from "@airlock/telemetry";
import { GatewayError } from "@airlock/shared";

import { toErrorResponse } from "./errors.js";
import type { GatewayBindings } from "./env.js";
import {
  assertInternalAdminAuthorization,
  clearGatewayKeyRevocation,
  getGatewayApiKeyStatus,
  getGatewayKeyRevocationStatus,
  listGatewayApiKeyStatuses,
  resolveGatewayApiKeyById,
  revokeGatewayKey
} from "./gateway-key-revocation.js";
import { createRequestId } from "./request-id.js";
import { handleChatCompletions } from "./routes/chat-completions.js";
import { handleHealth } from "./routes/health.js";
import { handleMessages } from "./routes/messages.js";
import { handleModelById, handleModels } from "./routes/models.js";
import { handleReady } from "./routes/ready.js";
import { handleResponses } from "./routes/responses.js";
import { emitGatewayRequestErrorTelemetry } from "./telemetry.js";
import { resolveGatewayConfig } from "./config.js";

export interface CreateAppOptions {
  fetcher?: typeof fetch;
  telemetrySink?: TelemetrySink;
}

type AppVariables = {
  requestId: string;
  fetcher?: typeof fetch;
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

    if (
      !telemetryErrorEmitted &&
      error instanceof GatewayError &&
      requestStartedAt !== undefined
    ) {
      void emitGatewayRequestErrorTelemetry(
        {
          telemetrySink,
          requestId,
          routePath: new URL(context.req.url).pathname,
          mode: context.env.AIRLOCK_MODE ?? "free",
          startedAt: requestStartedAt,
          stream: false,
          statusCode: error.httpStatus
        },
        error
      );
    }

    return toErrorResponse(
      error,
      requestId,
      new URL(context.req.url).pathname
    );
  });

  app.use("*", async (context, next) => {
    context.set("requestId", createRequestId());
    context.set("fetcher", options.fetcher);
    context.set("requestStartedAt", getRequestStartTime());
    context.set("telemetrySink", options.telemetrySink);
    context.set("telemetryErrorEmitted", false);
    await next();
  });

  app.get("/healthz", handleHealth);
  app.get("/readyz", handleReady);
  app.get("/_airlock/keys", async (context) => {
    const requestId = context.get("requestId");
    assertInternalAdminAuthorization(
      context.req.header("authorization"),
      context.env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
      requestId
    );

    const config = resolveGatewayConfig(context.env);
    const acceptedNowParam = context.req.query("acceptedNow");
    const effectiveStatusParam = context.req.query("effectiveStatus");
    const acceptedNow =
      acceptedNowParam === undefined
        ? undefined
        : acceptedNowParam === "true"
          ? true
          : acceptedNowParam === "false"
            ? false
            : undefined;
    const effectiveStatus =
      effectiveStatusParam === "active" ||
      effectiveStatusParam === "revoked" ||
      effectiveStatusParam === "not_yet_active" ||
      effectiveStatusParam === "expired"
        ? effectiveStatusParam
        : undefined;

    return context.json({
      keys: await listGatewayApiKeyStatuses(
        context.env,
        config.gatewayApiKeys,
        requestId,
        {
          ...(acceptedNow !== undefined ? { acceptedNow } : {}),
          ...(effectiveStatus !== undefined ? { effectiveStatus } : {})
        }
      )
    });
  });
  app.get("/_airlock/keys/:keyId/revocation", async (context) => {
    const requestId = context.get("requestId");
    assertInternalAdminAuthorization(
      context.req.header("authorization"),
      context.env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
      requestId
    );

    const config = resolveGatewayConfig(context.env);
    const gatewayApiKey = resolveGatewayApiKeyById(
      config.gatewayApiKeys,
      context.req.param("keyId"),
      requestId
    );

    return context.json(
      await getGatewayKeyRevocationStatus(
        context.env,
        gatewayApiKey,
        requestId
      )
    );
  });
  app.get("/_airlock/keys/:keyId/status", async (context) => {
    const requestId = context.get("requestId");
    assertInternalAdminAuthorization(
      context.req.header("authorization"),
      context.env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
      requestId
    );

    const config = resolveGatewayConfig(context.env);
    const gatewayApiKey = resolveGatewayApiKeyById(
      config.gatewayApiKeys,
      context.req.param("keyId"),
      requestId
    );

    return context.json(
      await getGatewayApiKeyStatus(
        context.env,
        gatewayApiKey,
        requestId
      )
    );
  });
  app.post("/_airlock/keys/:keyId/revocation", async (context) => {
    const requestId = context.get("requestId");
    assertInternalAdminAuthorization(
      context.req.header("authorization"),
      context.env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
      requestId
    );

    const config = resolveGatewayConfig(context.env);
    const gatewayApiKey = resolveGatewayApiKeyById(
      config.gatewayApiKeys,
      context.req.param("keyId"),
      requestId
    );

    return context.json(
      await revokeGatewayKey(
        context.env,
        gatewayApiKey,
        requestId
      )
    );
  });
  app.delete("/_airlock/keys/:keyId/revocation", async (context) => {
    const requestId = context.get("requestId");
    assertInternalAdminAuthorization(
      context.req.header("authorization"),
      context.env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
      requestId
    );

    const config = resolveGatewayConfig(context.env);
    const gatewayApiKey = resolveGatewayApiKeyById(
      config.gatewayApiKeys,
      context.req.param("keyId"),
      requestId
    );

    return context.json(
      await clearGatewayKeyRevocation(
        context.env,
        gatewayApiKey,
        requestId
      )
    );
  });
  app.get("/v1/models", handleModels);
  app.get("/v1/models/:model", handleModelById);
  app.post("/v1/chat/completions", handleChatCompletions);
  app.post("/v1/messages", handleMessages);
  app.post("/v1/responses", handleResponses);

  return app;
}
