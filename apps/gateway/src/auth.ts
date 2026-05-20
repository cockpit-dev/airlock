import type { Context } from "hono";
import type { TelemetrySink } from "@airlock/telemetry";

import {
  assertGatewayKeyAllowsModelAccess,
  assertGatewayKeyAllowsProviderAccess,
  assertGatewayKeyAllowsRouteAccess,
  authorizeGatewayKeyAccess,
  type GatewayApiKeyRecord
} from "@airlock/governance";
import type { ModelRoute } from "@airlock/routing";

import type { GatewayConfig } from "./config.js";
import type { CreateAppOptions } from "./app.js";
import type { GatewayBindings } from "./env.js";
import {
  findGatewayRegistryApiKeyByToken,
  resolveGatewayRuntimeApiKey
} from "./gateway-key-registry.js";
import { assertGatewayKeyNotRevoked } from "./gateway-key-revocation.js";

const ADMIN_KEY: GatewayApiKeyRecord = Object.freeze({
  id: "__admin__",
  label: "Admin Passthrough",
  status: "active",
  policy: {}
});

async function tryAdminPassthrough(
  authorization: string | undefined,
  config: GatewayConfig,
  requestId: string
): Promise<GatewayApiKeyRecord | undefined> {
  const adminToken = config.internalAdminToken;
  const adminCredentials = config.internalAdminCredentials;

  if (!adminToken && (!adminCredentials || adminCredentials.length === 0)) {
    return undefined;
  }

  if (!authorization?.startsWith("Bearer ")) return undefined;
  const bearerToken = authorization.slice("Bearer ".length);
  if (!bearerToken) return undefined;

  const tokenHash = await sha256Hex(bearerToken);

  if (adminCredentials?.length) {
    for (const cred of adminCredentials) {
      if (cred.tokenHash === tokenHash) return ADMIN_KEY;
    }
  }

  if (adminToken) {
    const adminTokenHash = await sha256Hex(adminToken);
    if (tokenHash === adminTokenHash) return ADMIN_KEY;
  }

  return undefined;
}

function resolveAuthorizationHeader(
  context: Context<{
    Bindings: GatewayBindings;
    Variables: {
      requestId: string;
      fetcher?: CreateAppOptions["fetcher"];
      requestStartedAt: number;
      telemetrySink?: TelemetrySink;
      telemetryErrorEmitted?: boolean;
    };
  }>
): string | undefined {
  const authorization = context.req.header("authorization");
  if (authorization) return authorization;
  const apiKey = context.req.header("x-api-key");
  if (apiKey) return `Bearer ${apiKey}`;
  return undefined;
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

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
  const authorization = resolveAuthorizationHeader(context);
  const adminKey = await tryAdminPassthrough(
    authorization,
    config,
    requestId
  );
  if (adminKey) return adminKey;

  return authorizeGatewayKeyAccess(
    authorization,
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
  provider: string,
  requestId: string
) {
  return assertGatewayKeyAllowsProviderAccess(
    gatewayApiKey,
    provider,
    requestId
  );
}
