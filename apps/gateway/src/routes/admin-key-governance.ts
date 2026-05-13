import type { Hono } from "hono";
import type { TelemetrySink } from "@airlock/telemetry";
import { parseInternalAdminCredentials } from "@airlock/governance";

import {
  cancelAdminGatewayKeyRotation,
  clearAdminGatewayKeyRegistryOverride,
  clearAdminGatewayKeyRevocation,
  createAdminGatewayKey,
  deleteAdminGatewayKey,
  finalizeAdminGatewayKeyRotation,
  getAdminGatewayKey,
  getAdminGatewayKeyEvents,
  getAdminGatewayKeyRegistryView,
  getAdminGatewayKeyRevocationStatus,
  getAdminGatewayKeyStatus,
  listAdminGatewayKeys,
  revokeAdminGatewayKey,
  rotateAdminGatewayKey,
  updateAdminGatewayKeyRegistryOverride
} from "../admin-key-governance-service.js";
import type { GatewayBindings } from "../env.js";
import {
  authorizeInternalAdminRequest,
} from "../gateway-key-revocation.js";

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

export function registerAdminKeyGovernanceRoutes(app: GatewayApp) {
  const hasStructuredAdminCredentials = (
    value: string | undefined
  ): boolean => {
    return typeof value === "string" && value.length > 0;
  };

  app.get("/_airlock/keys", async (context) => {
    const requestId = context.get("requestId");
    await authorizeInternalAdminRequest(
      context.req.header("authorization"),
      context.env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
      parseInternalAdminCredentials(context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
      hasStructuredAdminCredentials(context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
      "keys.read",
      requestId
    );

    return context.json(
      await listAdminGatewayKeys(
        context.env,
        context.req.raw,
        requestId,
        new URL(context.req.url).searchParams
      )
    );
  });

  app.post("/_airlock/keys", async (context) => {
    const requestId = context.get("requestId");
    await authorizeInternalAdminRequest(
      context.req.header("authorization"),
      context.env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
      parseInternalAdminCredentials(context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
      hasStructuredAdminCredentials(context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
      "keys.write",
      requestId
    );

    return context.json(
      await createAdminGatewayKey(
        context.env,
        context.req.raw,
        requestId,
        await context.req.json()
      )
    );
  });

  app.get("/_airlock/keys/:keyId", async (context) => {
    const requestId = context.get("requestId");
    await authorizeInternalAdminRequest(
      context.req.header("authorization"),
      context.env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
      parseInternalAdminCredentials(context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
      hasStructuredAdminCredentials(context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
      "keys.read",
      requestId
    );

    return context.json(
      await getAdminGatewayKey(
        context.env,
        context.req.param("keyId"),
        requestId
      )
    );
  });

  app.delete("/_airlock/keys/:keyId", async (context) => {
    const requestId = context.get("requestId");
    await authorizeInternalAdminRequest(
      context.req.header("authorization"),
      context.env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
      parseInternalAdminCredentials(context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
      hasStructuredAdminCredentials(context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
      "keys.write",
      requestId
    );

    const payload = await readOptionalJsonBody(context.req.raw);
    return context.json(
      await deleteAdminGatewayKey(
        context.env,
        context.req.raw,
        context.req.param("keyId"),
        requestId,
        payload
      )
    );
  });

  app.post("/_airlock/keys/:keyId/rotate", async (context) => {
    const requestId = context.get("requestId");
    await authorizeInternalAdminRequest(
      context.req.header("authorization"),
      context.env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
      parseInternalAdminCredentials(context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
      hasStructuredAdminCredentials(context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
      "keys.write",
      requestId
    );

    return context.json(
      await rotateAdminGatewayKey(
        context.env,
        context.req.raw,
        context.req.param("keyId"),
        requestId,
        await context.req.json()
      )
    );
  });

  app.post("/_airlock/keys/:keyId/rotate/finalize", async (context) => {
    const requestId = context.get("requestId");
    await authorizeInternalAdminRequest(
      context.req.header("authorization"),
      context.env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
      parseInternalAdminCredentials(context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
      hasStructuredAdminCredentials(context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
      "keys.write",
      requestId
    );

    const payload = await readOptionalJsonBody(context.req.raw);
    return context.json(
      await finalizeAdminGatewayKeyRotation(
        context.env,
        context.req.raw,
        context.req.param("keyId"),
        requestId,
        payload
      )
    );
  });

  app.post("/_airlock/keys/:keyId/rotate/cancel", async (context) => {
    const requestId = context.get("requestId");
    await authorizeInternalAdminRequest(
      context.req.header("authorization"),
      context.env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
      parseInternalAdminCredentials(context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
      hasStructuredAdminCredentials(context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
      "keys.write",
      requestId
    );

    const payload = await readOptionalJsonBody(context.req.raw);
    return context.json(
      await cancelAdminGatewayKeyRotation(
        context.env,
        context.req.raw,
        context.req.param("keyId"),
        requestId,
        payload
      )
    );
  });

  app.get("/_airlock/keys/:keyId/revocation", async (context) => {
    const requestId = context.get("requestId");
    await authorizeInternalAdminRequest(
      context.req.header("authorization"),
      context.env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
      parseInternalAdminCredentials(context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
      hasStructuredAdminCredentials(context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
      "keys.read",
      requestId
    );

    return context.json(
      await getAdminGatewayKeyRevocationStatus(
        context.env,
        context.req.param("keyId"),
        requestId
      )
    );
  });

  app.get("/_airlock/keys/:keyId/status", async (context) => {
    const requestId = context.get("requestId");
    await authorizeInternalAdminRequest(
      context.req.header("authorization"),
      context.env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
      parseInternalAdminCredentials(context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
      hasStructuredAdminCredentials(context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
      "keys.read",
      requestId
    );

    return context.json(
      await getAdminGatewayKeyStatus(
        context.env,
        context.req.param("keyId"),
        requestId
      )
    );
  });

  app.get("/_airlock/keys/:keyId/events", async (context) => {
    const requestId = context.get("requestId");
    await authorizeInternalAdminRequest(
      context.req.header("authorization"),
      context.env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
      parseInternalAdminCredentials(context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
      hasStructuredAdminCredentials(context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
      "keys.read",
      requestId
    );

    return context.json(
      await getAdminGatewayKeyEvents(
        context.env,
        context.req.param("keyId"),
        requestId
      )
    );
  });

  app.get("/_airlock/keys/:keyId/registry", async (context) => {
    const requestId = context.get("requestId");
    await authorizeInternalAdminRequest(
      context.req.header("authorization"),
      context.env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
      parseInternalAdminCredentials(context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
      hasStructuredAdminCredentials(context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
      "keys.read",
      requestId
    );

    return context.json(
      await getAdminGatewayKeyRegistryView(
        context.env,
        context.req.param("keyId"),
        requestId
      )
    );
  });

  app.put("/_airlock/keys/:keyId/registry", async (context) => {
    const requestId = context.get("requestId");
    await authorizeInternalAdminRequest(
      context.req.header("authorization"),
      context.env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
      parseInternalAdminCredentials(context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
      hasStructuredAdminCredentials(context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
      "keys.write",
      requestId
    );

    return context.json(
      await updateAdminGatewayKeyRegistryOverride(
        context.env,
        context.req.param("keyId"),
        requestId,
        await context.req.json()
      )
    );
  });

  app.delete("/_airlock/keys/:keyId/registry", async (context) => {
    const requestId = context.get("requestId");
    await authorizeInternalAdminRequest(
      context.req.header("authorization"),
      context.env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
      parseInternalAdminCredentials(context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
      hasStructuredAdminCredentials(context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
      "keys.write",
      requestId
    );

    return context.json(
      await clearAdminGatewayKeyRegistryOverride(
        context.env,
        context.req.param("keyId"),
        requestId
      )
    );
  });

  app.post("/_airlock/keys/:keyId/revocation", async (context) => {
    const requestId = context.get("requestId");
    await authorizeInternalAdminRequest(
      context.req.header("authorization"),
      context.env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
      parseInternalAdminCredentials(context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
      hasStructuredAdminCredentials(context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
      "keys.write",
      requestId
    );

    const payload = await readOptionalJsonBody(context.req.raw);
    return context.json(
      await revokeAdminGatewayKey(
        context.env,
        context.req.raw,
        context.req.param("keyId"),
        requestId,
        payload
      )
    );
  });

  app.delete("/_airlock/keys/:keyId/revocation", async (context) => {
    const requestId = context.get("requestId");
    await authorizeInternalAdminRequest(
      context.req.header("authorization"),
      context.env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
      parseInternalAdminCredentials(context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
      hasStructuredAdminCredentials(context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS),
      "keys.write",
      requestId
    );

    const payload = await readOptionalJsonBody(context.req.raw);
    return context.json(
      await clearAdminGatewayKeyRevocation(
        context.env,
        context.req.raw,
        context.req.param("keyId"),
        requestId,
        payload
      )
    );
  });
}

async function readOptionalJsonBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return undefined;
  }

  return request.json();
}
