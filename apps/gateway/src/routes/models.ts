import type { Context } from "hono";
import { listExternalModels, resolveModelRoute } from "@airlock/routing";
import { GatewayError } from "@airlock/shared";

import { requireGatewayAuthorization } from "../auth.js";
import type { CreateAppOptions } from "../app.js";
import { resolveGatewayConfig } from "../config.js";
import type { GatewayBindings } from "../env.js";

function createModelDescriptor(modelId: string) {
  return {
    id: modelId,
    object: "model",
    created: 0,
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
  const config = resolveGatewayConfig(context.env);
  const requestId = context.get("requestId");

  await requireGatewayAuthorization(context, config, requestId);

  return context.json({
    object: "list",
    data: listExternalModels(config.modelAliases).map((modelId) =>
      createModelDescriptor(modelId)
    )
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
  const config = resolveGatewayConfig(context.env);
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

  return context.json(createModelDescriptor(modelId));
}
