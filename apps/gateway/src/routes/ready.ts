import type { Context } from "hono";

import type { GatewayConfig } from "../config.js";
import { resolveGatewayConfigWithOverlay } from "../config.js";
import type { GatewayBindings } from "../env.js";

interface ReadinessDetail {
  ok: boolean;
  ready: boolean;
  config: boolean;
  providers: {
    openai: boolean;
    anthropic: boolean;
    gemini: boolean;
  };
  code?: string;
}

function computeProviderReadiness(config: GatewayConfig): {
  openai: boolean;
  anthropic: boolean;
  gemini: boolean;
} {
  const usedProviders = new Set<string>();
  for (const route of config.modelAliases) {
    usedProviders.add(route.target.provider);
    for (const fallback of route.fallbacks ?? []) {
      usedProviders.add(fallback.provider);
    }
  }

  return {
    openai: !!config.openAI,
    anthropic: !usedProviders.has("anthropic") || !!config.anthropic,
    gemini: !usedProviders.has("gemini") || !!config.gemini
  };
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
        providers: { openai: false, anthropic: false, gemini: false },
        code: "not_ready"
      } satisfies ReadinessDetail,
      503
    );
  }
}
