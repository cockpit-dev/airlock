import type { Hono } from "hono";
import type { TelemetrySink } from "@airlock/telemetry";
import {
  authorizeInternalAdminRequest,
  parseInternalAdminCredentials,
  type InternalAdminScope
} from "@airlock/governance";

import {
  archiveAdminGatewayKey,
  bulkArchiveAdminGatewayKeys,
  bulkCancelAdminGatewayKeyRotations,
  bulkCreateAdminGatewayKeys,
  bulkDeleteAdminGatewayKeys,
  bulkFinalizeAdminGatewayKeyRotations,
  bulkRotateAdminGatewayKeys,
  bulkRestoreAdminGatewayKeys,
  cancelAdminGatewayKeyRotation,
  bulkUpdateAdminGatewayKeys,
  clearAdminGatewayKeyRegistryOverride,
  clearAdminGatewayKeyRevocation,
  createAdminGatewayKey,
  deleteAdminGatewayKey,
  finalizeAdminGatewayKeyRotation,
  getAdminGatewayKey,
  getAdminGatewayKeyEvents,
  getAdminGatewayKeyOperationEvents,
  getAdminGatewayKeyRegistryView,
  getAdminGatewayKeyRevocationStatus,
  getAdminGatewayKeyStatus,
  listAdminGatewayKeys,
  revokeAdminGatewayKey,
  restoreAdminGatewayKey,
  rotateAdminGatewayKey,
  updateAdminGatewayKey,
  updateAdminGatewayKeyRegistryOverride
} from "../admin-key-governance-service.js";
import type { GatewayBindings } from "../env.js";

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
  const requireAdminScope = async (
    context: {
      req: {
        header(name: string): string | undefined;
      };
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

  app.get("/_airlock/keys", async (context) => {
    const requestId = context.get("requestId");
    await requireAdminScope(context, "keys.read");

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
    await requireAdminScope(context, "keys.write");

    return context.json(
      await createAdminGatewayKey(
        context.env,
        context.req.raw,
        requestId,
        await context.req.json()
      )
    );
  });

  app.post("/_airlock/keys/bulk-create", async (context) => {
    const requestId = context.get("requestId");
    await requireAdminScope(context, "keys.write");

    return context.json(
      await bulkCreateAdminGatewayKeys(
        context.env,
        context.req.raw,
        requestId,
        await context.req.json()
      )
    );
  });

  app.patch("/_airlock/keys", async (context) => {
    const requestId = context.get("requestId");
    await requireAdminScope(context, "keys.write");

    return context.json(
      await bulkUpdateAdminGatewayKeys(
        context.env,
        context.req.raw,
        requestId,
        await context.req.json()
      )
    );
  });

  app.post("/_airlock/keys/bulk-rotate", async (context) => {
    const requestId = context.get("requestId");
    await requireAdminScope(context, "keys.write");

    return context.json(
      await bulkRotateAdminGatewayKeys(
        context.env,
        context.req.raw,
        requestId,
        await context.req.json()
      )
    );
  });

  app.post("/_airlock/keys/bulk-delete", async (context) => {
    const requestId = context.get("requestId");
    await requireAdminScope(context, "keys.write");

    return context.json(
      await bulkDeleteAdminGatewayKeys(
        context.env,
        context.req.raw,
        requestId,
        await context.req.json()
      )
    );
  });

  app.post("/_airlock/keys/bulk-archive", async (context) => {
    const requestId = context.get("requestId");
    await requireAdminScope(context, "keys.write");

    return context.json(
      await bulkArchiveAdminGatewayKeys(
        context.env,
        context.req.raw,
        requestId,
        await context.req.json()
      )
    );
  });

  app.post("/_airlock/keys/bulk-restore", async (context) => {
    const requestId = context.get("requestId");
    await requireAdminScope(context, "keys.write");

    return context.json(
      await bulkRestoreAdminGatewayKeys(
        context.env,
        context.req.raw,
        requestId,
        await context.req.json()
      )
    );
  });

  app.post("/_airlock/keys/bulk-rotate/finalize", async (context) => {
    const requestId = context.get("requestId");
    await requireAdminScope(context, "keys.write");

    return context.json(
      await bulkFinalizeAdminGatewayKeyRotations(
        context.env,
        context.req.raw,
        requestId,
        await context.req.json()
      )
    );
  });

  app.post("/_airlock/keys/bulk-rotate/cancel", async (context) => {
    const requestId = context.get("requestId");
    await requireAdminScope(context, "keys.write");

    return context.json(
      await bulkCancelAdminGatewayKeyRotations(
        context.env,
        context.req.raw,
        requestId,
        await context.req.json()
      )
    );
  });

  app.get("/_airlock/keys/:keyId", async (context) => {
    const requestId = context.get("requestId");
    await requireAdminScope(context, "keys.read");

    return context.json(
      await getAdminGatewayKey(
        context.env,
        context.req.param("keyId"),
        requestId
      )
    );
  });

  app.put("/_airlock/keys/:keyId", async (context) => {
    const requestId = context.get("requestId");
    await requireAdminScope(context, "keys.write");

    return context.json(
      await updateAdminGatewayKey(
        context.env,
        context.req.raw,
        context.req.param("keyId"),
        requestId,
        await context.req.json()
      )
    );
  });

  app.delete("/_airlock/keys/:keyId", async (context) => {
    const requestId = context.get("requestId");
    await requireAdminScope(context, "keys.write");

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
    await requireAdminScope(context, "keys.write");

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

  app.post("/_airlock/keys/:keyId/archive", async (context) => {
    const requestId = context.get("requestId");
    await requireAdminScope(context, "keys.write");

    const payload = await readOptionalJsonBody(context.req.raw);
    return context.json(
      await archiveAdminGatewayKey(
        context.env,
        context.req.raw,
        context.req.param("keyId"),
        requestId,
        payload
      )
    );
  });

  app.post("/_airlock/keys/:keyId/restore", async (context) => {
    const requestId = context.get("requestId");
    await requireAdminScope(context, "keys.write");

    const payload = await readOptionalJsonBody(context.req.raw);
    return context.json(
      await restoreAdminGatewayKey(
        context.env,
        context.req.raw,
        context.req.param("keyId"),
        requestId,
        payload
      )
    );
  });

  app.post("/_airlock/keys/:keyId/rotate/finalize", async (context) => {
    const requestId = context.get("requestId");
    await requireAdminScope(context, "keys.write");

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
    await requireAdminScope(context, "keys.write");

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
    await requireAdminScope(context, "keys.read");

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
    await requireAdminScope(context, "keys.read");

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
    await requireAdminScope(context, "keys.read");

    return context.json(
      await getAdminGatewayKeyEvents(
        context.env,
        context.req.param("keyId"),
        requestId
      )
    );
  });

  app.get("/_airlock/keys/operations/:operationId/events", async (context) => {
    const requestId = context.get("requestId");
    await requireAdminScope(context, "keys.read");

    return context.json(
      await getAdminGatewayKeyOperationEvents(
        context.env,
        context.req.param("operationId"),
        requestId
      )
    );
  });

  app.get("/_airlock/keys/:keyId/registry", async (context) => {
    const requestId = context.get("requestId");
    await requireAdminScope(context, "keys.read");

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
    await requireAdminScope(context, "keys.write");

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
    await requireAdminScope(context, "keys.write");

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
    await requireAdminScope(context, "keys.write");

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
    await requireAdminScope(context, "keys.write");

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
