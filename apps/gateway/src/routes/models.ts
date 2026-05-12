import type { Context } from "hono";
import { listExternalModels, resolveModelRoute } from "@airlock/routing";

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

  if (!modelId) {
    throw new Error("model route parameter is required");
  }

  resolveModelRoute(
    modelId,
    config.modelAliases,
    context.get("requestId") as string
  );

  return context.json(createModelDescriptor(modelId));
}
