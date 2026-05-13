import { Hono } from "hono";
import type { TelemetrySink } from "@airlock/telemetry";
import { GatewayError } from "@airlock/shared";

import { toErrorResponse } from "./errors.js";
import type { GatewayBindings } from "./env.js";
import {
  assertInternalAdminAuthorization,
  clearGatewayKeyRevocationById,
  getGatewayKeyRevocationEvents,
  getGatewayApiKeyStatusSnapshot,
  getGatewayKeyRevocationStatusById,
  listGatewayApiKeyStatuses,
  resolveGatewayApiKeyById,
  resolveGatewayApiKeyByIdWithRegistry,
  revokeGatewayKeyById
} from "./gateway-key-revocation.js";
import {
  createGatewayRegistryApiKey,
  deleteGatewayRegistryApiKey,
  getGatewayRegistryApiKeyEvents,
  getGatewayRegistryApiKey,
  rotateGatewayRegistryApiKey,
  clearGatewayKeyRegistryOverride,
  upsertGatewayKeyRegistryOverride
} from "./gateway-key-registry.js";
import { sortGatewayKeyAuditEventsDescending } from "./gateway-key-audit.js";
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
  app.post("/_airlock/keys", async (context) => {
    const requestId = context.get("requestId");
    assertInternalAdminAuthorization(
      context.req.header("authorization"),
      context.env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
      requestId
    );

    const config = resolveGatewayConfig(context.env);
    const key = await createGatewayRegistryApiKey(
      context.env,
      config.gatewayApiKeys,
      await context.req.json(),
      requestId
    );

    return context.json(key);
  });
  app.get("/_airlock/keys/:keyId", async (context) => {
    const requestId = context.get("requestId");
    assertInternalAdminAuthorization(
      context.req.header("authorization"),
      context.env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
      requestId
    );

    const key = await getGatewayRegistryApiKey(
      context.env,
      context.req.param("keyId"),
      requestId
    );

    if (!key) {
      throw new GatewayError("Gateway API key not found", {
        code: "gateway_key_not_found",
        category: "governance",
        httpStatus: 404,
        retryable: false,
        requestId
      });
    }

    return context.json(key);
  });
  app.delete("/_airlock/keys/:keyId", async (context) => {
    const requestId = context.get("requestId");
    assertInternalAdminAuthorization(
      context.req.header("authorization"),
      context.env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
      requestId
    );

    const config = resolveGatewayConfig(context.env);
    const payload = await readOptionalJsonBody(context.req.raw);
    await deleteGatewayRegistryApiKey(
      context.env,
      config.gatewayApiKeys,
      context.req.param("keyId"),
      payload,
      requestId
    );

    return context.json({
      keyId: context.req.param("keyId"),
      deleted: true
    });
  });
  app.post("/_airlock/keys/:keyId/rotate", async (context) => {
    const requestId = context.get("requestId");
    assertInternalAdminAuthorization(
      context.req.header("authorization"),
      context.env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
      requestId
    );

    const config = resolveGatewayConfig(context.env);
    const key = await rotateGatewayRegistryApiKey(
      context.env,
      config.gatewayApiKeys,
      context.req.param("keyId"),
      await context.req.json(),
      requestId
    );

    return context.json(key);
  });
  app.get("/_airlock/keys/:keyId/revocation", async (context) => {
    const requestId = context.get("requestId");
    assertInternalAdminAuthorization(
      context.req.header("authorization"),
      context.env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
      requestId
    );

    const config = resolveGatewayConfig(context.env);
    return context.json(
      await getGatewayKeyRevocationStatusById(
        context.env,
        config.gatewayApiKeys,
        context.req.param("keyId"),
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
    const { gatewayApiKey, ownership } = await resolveGatewayApiKeyByIdWithRegistry(
      context.env,
      config.gatewayApiKeys,
      context.req.param("keyId"),
      requestId
    );

    return context.json(
      await getGatewayApiKeyStatusSnapshot(
        context.env,
        gatewayApiKey,
        requestId,
        ownership
      )
    );
  });
  app.get("/_airlock/keys/:keyId/events", async (context) => {
    const requestId = context.get("requestId");
    assertInternalAdminAuthorization(
      context.req.header("authorization"),
      context.env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
      requestId
    );

    const keyId = context.req.param("keyId");
    const config = resolveGatewayConfig(context.env);
    const [registryEvents, revocationEvents] = await Promise.all([
      getGatewayRegistryApiKeyEvents(context.env, keyId, requestId),
      getGatewayKeyRevocationEvents(context.env, keyId, requestId)
    ]);

    if (registryEvents.length === 0 && revocationEvents.length === 0) {
      await resolveGatewayApiKeyByIdWithRegistry(
        context.env,
        config.gatewayApiKeys,
        keyId,
        requestId
      );
    }

    return context.json({
      keyId,
      events: sortGatewayKeyAuditEventsDescending([
        ...registryEvents,
        ...revocationEvents
      ])
    });
  });
  app.get("/_airlock/keys/:keyId/registry", async (context) => {
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
    const snapshot = await getGatewayApiKeyStatusSnapshot(
      context.env,
      gatewayApiKey,
      requestId
    );

    return context.json({
      keyId: snapshot.keyId,
      configured: snapshot.configured,
      runtime: snapshot.runtime,
      override: snapshot.registryOverride,
      registryOverrideApplied: snapshot.registryOverrideApplied,
      ...(snapshot.registryUpdatedAt
        ? { registryUpdatedAt: snapshot.registryUpdatedAt }
        : {})
    });
  });
  app.put("/_airlock/keys/:keyId/registry", async (context) => {
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
    const override = await upsertGatewayKeyRegistryOverride(
      context.env,
      gatewayApiKey,
      await context.req.json(),
      requestId
    );

    return context.json({
      keyId: gatewayApiKey.id,
      override
    });
  });
  app.delete("/_airlock/keys/:keyId/registry", async (context) => {
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

    await clearGatewayKeyRegistryOverride(
      context.env,
      gatewayApiKey,
      requestId
    );

    return context.json({
      keyId: gatewayApiKey.id,
      override: null
    });
  });
  app.post("/_airlock/keys/:keyId/revocation", async (context) => {
    const requestId = context.get("requestId");
    assertInternalAdminAuthorization(
      context.req.header("authorization"),
      context.env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
      requestId
    );

    const config = resolveGatewayConfig(context.env);
    const payload = await readOptionalJsonBody(context.req.raw);
    return context.json(
      await revokeGatewayKeyById(
        context.env,
        config.gatewayApiKeys,
        context.req.param("keyId"),
        payload,
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
    const payload = await readOptionalJsonBody(context.req.raw);
    return context.json(
      await clearGatewayKeyRevocationById(
        context.env,
        config.gatewayApiKeys,
        context.req.param("keyId"),
        payload,
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

async function readOptionalJsonBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return undefined;
  }

  return request.json();
}
