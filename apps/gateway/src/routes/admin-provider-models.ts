import type { Hono } from "hono";
import { GatewayError } from "@airlock/shared";

import { requireAdminScope } from "../admin-auth.js";
import type { GatewayBindings } from "../env.js";

type AppVariables = {
  requestId: string;
  fetcher?: typeof fetch;
  requestStartedAt: number;
};

type GatewayApp = Hono<{
  Bindings: GatewayBindings;
  Variables: AppVariables;
}>;

export function registerAdminProviderModelsRoutes(app: GatewayApp): void {
  app.post("/_airlock/providers/fetch-models", async (context) => {
    await requireAdminScope(context, "config.read");
    const requestId = context.get("requestId");
    const fetcher = context.get("fetcher") ?? fetch;

    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      throw new GatewayError("Request body must be valid JSON", {
        code: "request_invalid_json",
        category: "request",
        httpStatus: 400,
        retryable: false,
        requestId
      });
    }

    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as Record<string, unknown>).baseUrl !== "string" ||
      typeof (body as Record<string, unknown>).apiKey !== "string"
    ) {
      throw new GatewayError("baseUrl and apiKey are required", {
        code: "request_invalid_body",
        category: "request",
        httpStatus: 400,
        retryable: false,
        requestId
      });
    }

    const { baseUrl, apiKey, type } = body as {
      baseUrl: string;
      apiKey: string;
      type?: string;
    };

    let modelUrl: string;
    const headers: Record<string, string> = {};

    if (type === "anthropic") {
      modelUrl = `${baseUrl.replace(/\/$/, "")}/v1/models`;
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else if (type === "gemini") {
      const sep = baseUrl.includes("?") ? "&" : "?";
      modelUrl = `${baseUrl.replace(/\/$/, "")}/models${sep}key=${apiKey}`;
    } else {
      modelUrl = `${baseUrl.replace(/\/$/, "")}/models`;
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    let response: Response;
    try {
      response = await fetcher(modelUrl, {
        headers,
        signal: AbortSignal.timeout(10000)
      });
    } catch {
      throw new GatewayError("Failed to connect to provider", {
        code: "provider_connection_failed",
        category: "provider",
        httpStatus: 502,
        retryable: false,
        requestId
      });
    }

    if (!response.ok) {
      throw new GatewayError(
        `Provider returned ${response.status}`,
        {
          code: "provider_error",
          category: "provider",
          httpStatus: 502,
          retryable: false,
          requestId
        }
      );
    }

    const data = await response.json() as Record<string, unknown>;

    // Normalize to OpenAI-style model list
    let models: string[];
    if (type === "gemini") {
      // Gemini: { models: [{ name: "models/gemini-2.5-pro", ... }] }
      const items = (data.models ?? data.data ?? []) as Array<Record<string, unknown>>;
      models = items
        .map((m) => {
          const name = (m.name ?? m.id ?? "") as string;
          // Strip "models/" prefix from Gemini model names
          return name.startsWith("models/") ? name.slice(7) : name;
        })
        .filter((n) => n.length > 0);
    } else if (Array.isArray(data.data)) {
      // OpenAI / Anthropic: { data: [{ id: "..." }] }
      models = (data.data as Array<Record<string, unknown>>)
        .map((m) => (m.id ?? "") as string)
        .filter((n) => n.length > 0);
    } else {
      models = [];
    }

    return context.json({ models });
  });
}
