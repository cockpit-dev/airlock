import {
  authorizeInternalAdminRequest,
  parseInternalAdminCredentials,
  type AdminScope
} from "@airlock/governance";

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
  await authorizeInternalAdminRequest({
    authorization: context.req.header("authorization"),
    adminToken: context.env.AIRLOCK_INTERNAL_ADMIN_TOKEN,
    adminCredentials: parseInternalAdminCredentials(
      context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS
    ),
    structuredCredentialsConfig: context.env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS,
    requiredScope,
    requestId: context.get("requestId")
  });
}

export type { AdminScope };
