import type { Context } from "hono";
import { listExternalModels, resolveModelRoute } from "@airlock/routing";
import { GatewayError } from "@airlock/shared";

import { requireGatewayAuthorization } from "../auth.js";
import type { CreateAppOptions } from "../app.js";
import { resolveGatewayConfigWithOverlay } from "../config.js";
import type { GatewayBindings } from "../env.js";

let cachedEpoch: number | undefined;

function getModelCreatedEpoch(): number {
  if (cachedEpoch === undefined) {
    cachedEpoch = Math.floor(Date.now() / 1000);
  }
  return cachedEpoch;
}

function createModelDescriptor(modelId: string, created: number) {
  return {
    id: modelId,
    object: "model" as const,
    created,
    owned_by: "airlock"
  };
}

export async function handleModels(
  context: Context<{
    Bindings: GatewayBindings;
    Variables: {
      requestId: string;
      fetcher?: CreateAppOptions["fetcher"];
      requestStartedAt: number;
    };
  }>
) {
  const config = await resolveGatewayConfigWithOverlay(context.env);
  const requestId = context.get("requestId");

  await requireGatewayAuthorization(context, config, requestId);

  const routeModels = listExternalModels(config.modelAliases);
  const providerModels = config.providers.flatMap((p) =>
    (p.models ?? []).map((m) => `${p.id}/${m}`)
  );
  const allModels = [...new Set([...routeModels, ...providerModels])];
  const created = getModelCreatedEpoch();

  const data = allModels.map((modelId) =>
    createModelDescriptor(modelId, created)
  );

  // OpenAI-compatible pagination: ?after=<id>&limit=<n>
  const afterId = context.req.query("after");
  const limitParam = context.req.query("limit");
  const limit = limitParam ? Number(limitParam) : allModels.length;
  let startIndex = 0;
  if (afterId) {
    const idx = allModels.indexOf(afterId);
    if (idx >= 0) {
      startIndex = idx + 1;
    }
  }
  const sliced = data.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < data.length;

  return context.json({
    object: "list",
    data: sliced,
    ...(hasMore
      ? {
          has_more: true,
          first_id: sliced[0]?.id,
          last_id: sliced[sliced.length - 1]?.id
        }
      : {})
  });
}

function resolveModelIdFromContext(context: Context): string {
  const provider = context.req.param("provider");
  const model = context.req.param("model");

  if (provider && model) {
    return `${provider}/${model}`;
  }

  const modelOnly = context.req.param("model");
  if (modelOnly) {
    return modelOnly;
  }

  return "";
}

export async function handleModelById(
  context: Context<{
    Bindings: GatewayBindings;
    Variables: {
      requestId: string;
      fetcher?: CreateAppOptions["fetcher"];
      requestStartedAt: number;
    };
  }>
) {
  const config = await resolveGatewayConfigWithOverlay(context.env);
  const modelId = resolveModelIdFromContext(context);
  const requestId = context.get("requestId");

  await requireGatewayAuthorization(context, config, requestId);

  if (!modelId) {
    throw new GatewayError("Model route parameter is required", {
      code: "request_missing_model",
      category: "request",
      httpStatus: 400,
      retryable: false,
      requestId
    });
  }

  resolveModelRoute(modelId, config.modelAliases, requestId);

  return context.json(createModelDescriptor(modelId, getModelCreatedEpoch()));
}
