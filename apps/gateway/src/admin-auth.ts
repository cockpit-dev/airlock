import {
  authorizeInternalAdminRequest,
  parseInternalAdminCredentials,
  type AdminScope
} from "@airlock/governance";

import {
  resolveGatewayAdminAuthConfig,
  resolveGatewayConfigWithOverlay
} from "./config.js";
import type { GatewayBindings } from "./env.js";

type AdminAuthContext = {
  req: { header(name: string): string | undefined };
  env: GatewayBindings;
  get(key: "requestId"): string;
};

export async function requireAdminScope(
  context: AdminAuthContext,
  requiredScope: AdminScope
): Promise<void> {
  const bootstrapConfig = resolveGatewayAdminAuthConfig(context.env);
  let adminToken = bootstrapConfig.internalAdminToken;
  let adminCredentials = bootstrapConfig.internalAdminCredentials;

  try {
    const runtimeConfig = await resolveGatewayConfigWithOverlay(context.env);
    adminToken = runtimeConfig.internalAdminToken ?? adminToken;
    adminCredentials =
      runtimeConfig.internalAdminCredentials ?? adminCredentials;
  } catch {
    // Admin bootstrap must stay usable even when business config is incomplete.
  }

  await authorizeInternalAdminRequest({
    authorization: context.req.header("authorization"),
    adminToken,
    adminCredentials:
      adminCredentials ??
      parseInternalAdminCredentials(
        context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS
      ),
    structuredCredentialsConfig: context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS,
    requiredScope,
    requestId: context.get("requestId")
  });
}

export type { AdminScope };
