import type { Context } from "hono";
import { listExternalModels, resolveModelRoute } from "@airlock/routing";
import { GatewayError } from "@airlock/shared";

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

export function handleModels(context: Context) {
  const config = resolveGatewayConfig(context.env as GatewayBindings);

  return context.json({
    object: "list",
    data: listExternalModels(config.modelAliases).map((modelId) =>
      createModelDescriptor(modelId)
    )
  });
}

export function handleModelById(context: Context) {
  const config = resolveGatewayConfig(context.env as GatewayBindings);
  const modelId = context.req.param("model");
  const requestId = context.get("requestId") as string;

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
