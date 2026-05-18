import type { Context } from "hono";

import type { GatewayConfig } from "../config.js";
import { getProviderById, resolveGatewayConfigWithOverlay } from "../config.js";
import type { GatewayBindings } from "../env.js";

interface ReadinessDetail {
  ok: boolean;
  ready: boolean;
  config: boolean;
  providers: Record<string, boolean>;
  code?: string;
}

function computeProviderReadiness(
  config: GatewayConfig
): Record<string, boolean> {
  const providers: Record<string, boolean> = {};
  for (const route of config.modelAliases) {
    providers[route.target.provider] =
      getProviderById(config, route.target.provider) !== undefined;
    for (const fallback of route.fallbacks ?? []) {
      providers[fallback.provider] =
        getProviderById(config, fallback.provider) !== undefined;
    }
  }

  for (const provider of config.providers) {
    providers[provider.id] = true;
  }

  return providers;
}

export function buildReadinessResponse(config: GatewayConfig): ReadinessDetail {
  const providers = computeProviderReadiness(config);
  const allProvidersReady = Object.values(providers).every(Boolean);

  return {
    ok: allProvidersReady,
    ready: allProvidersReady,
    config: true,
    providers
  };
}

export async function handleReady(context: Context) {
  try {
    const config = await resolveGatewayConfigWithOverlay(
      context.env as GatewayBindings
    );
    const result = buildReadinessResponse(config);
    if (!result.ready) {
      return context.json(
        {
          ...result,
          code: "provider_not_ready"
        } satisfies ReadinessDetail,
        503
      );
    }
    return context.json(result);
  } catch {
    return context.json(
      {
        ok: false,
        ready: false,
        config: false,
        providers: {},
        code: "not_ready"
      } satisfies ReadinessDetail,
      503
    );
  }
}
