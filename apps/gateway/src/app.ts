import { Hono } from "hono";

import { toErrorResponse } from "./errors.js";
import type { GatewayBindings } from "./env.js";
import { createRequestId } from "./request-id.js";
import { handleChatCompletions } from "./routes/chat-completions.js";
import { handleHealth } from "./routes/health.js";
import { handleMessages } from "./routes/messages.js";
import { handleModelById, handleModels } from "./routes/models.js";
import { handleReady } from "./routes/ready.js";
import { handleResponses } from "./routes/responses.js";

export interface CreateAppOptions {
  fetcher?: typeof fetch;
}

type AppVariables = {
  requestId: string;
  fetcher?: typeof fetch;
};

export function createApp(options: CreateAppOptions = {}) {
  const app = new Hono<{
    Bindings: GatewayBindings;
    Variables: AppVariables;
  }>();

  app.onError((error, context) => {
    return toErrorResponse(
      error,
      context.get("requestId") ?? createRequestId(),
      new URL(context.req.url).pathname
    );
  });

  app.use("*", async (context, next) => {
    context.set("requestId", createRequestId());
    context.set("fetcher", options.fetcher);
    await next();
  });

  app.get("/healthz", handleHealth);
  app.get("/readyz", handleReady);
  app.get("/v1/models", handleModels);
  app.get("/v1/models/:model", handleModelById);
  app.post("/v1/chat/completions", handleChatCompletions);
  app.post("/v1/messages", handleMessages);
  app.post("/v1/responses", handleResponses);

  return app;
}
