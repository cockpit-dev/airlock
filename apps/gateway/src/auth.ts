import type { Context } from "hono";
import type { TelemetrySink } from "@airlock/telemetry";

import {
  assertGatewayKeyAllowsModelAccess,
  assertGatewayKeyAllowsProviderAccess,
  assertGatewayKeyAllowsRouteAccess,
  authorizeGatewayKeyAccess,
  type GatewayApiKeyRecord
} from "@airlock/governance";
import { type ProviderId } from "@airlock/shared";
import type { ModelRoute } from "@airlock/routing";

import type { GatewayConfig } from "./config.js";
import type { CreateAppOptions } from "./app.js";
import type { GatewayBindings } from "./env.js";
import {
  findGatewayRegistryApiKeyByToken,
  resolveGatewayRuntimeApiKey
} from "./gateway-key-registry.js";
import { assertGatewayKeyNotRevoked } from "./gateway-key-revocation.js";

export async function requireGatewayAuthorization(
  context: Context<{
    Bindings: GatewayBindings;
    Variables: {
      requestId: string;
      fetcher?: CreateAppOptions["fetcher"];
      requestStartedAt: number;
      telemetrySink?: TelemetrySink;
      telemetryErrorEmitted?: boolean;
    };
  }>,
  config: GatewayConfig,
  requestId: string
) {
  return authorizeGatewayKeyAccess(
    context.req.header("authorization"),
    config.gatewayApiKeys,
    requestId,
    {
      registryEnabled: config.gatewayKeyRegistryEnabled === true,
      resolveConfiguredRuntimeKey: async (gatewayApiKey) => {
        return (
          await resolveGatewayRuntimeApiKey(
            context.env,
            gatewayApiKey,
            requestId
          )
        ).runtimeGatewayApiKey;
      },
      findRegistryKeyByToken: async (bearerToken) => {
        return findGatewayRegistryApiKeyByToken(
          context.env,
          bearerToken,
          requestId
        );
      },
      assertNotRevoked: async (gatewayApiKey) => {
        return assertGatewayKeyNotRevoked(
          context.env,
          gatewayApiKey,
          requestId
        );
      }
    }
  );
}

export function assertGatewayKeyAllowsModel(
  gatewayApiKey: GatewayApiKeyRecord,
  externalModel: string,
  requestId: string,
  modelGroups: Record<string, string[]>
) {
  return assertGatewayKeyAllowsModelAccess(
    gatewayApiKey,
    externalModel,
    requestId,
    modelGroups
  );
}

export function assertGatewayKeyAllowsRoute(
  gatewayApiKey: GatewayApiKeyRecord,
  route: ModelRoute,
  requestId: string
) {
  return assertGatewayKeyAllowsRouteAccess(
    gatewayApiKey,
    {
      ...(route.requiredKeyTier !== undefined
        ? { requiredKeyTier: route.requiredKeyTier }
        : {}),
      ...(route.requiredKeyTags !== undefined
        ? { requiredKeyTags: route.requiredKeyTags }
        : {})
    },
    requestId
  );
}

export function assertGatewayKeyAllowsProvider(
  gatewayApiKey: GatewayApiKeyRecord,
  provider: ProviderId,
  requestId: string
) {
  return assertGatewayKeyAllowsProviderAccess(
    gatewayApiKey,
    provider,
    requestId
  );
}
