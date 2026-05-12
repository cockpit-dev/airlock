import type { Context } from "hono";

import { requireGatewayAuthorization as requireAuthorization } from "@airlock/governance";

import type { GatewayConfig } from "./config.js";

export function requireGatewayAuthorization(
  context: Context,
  config: GatewayConfig,
  requestId: string
) {
  return requireAuthorization(
    context.req.header("authorization"),
    config.gatewayApiKeys,
    requestId
  );
}
