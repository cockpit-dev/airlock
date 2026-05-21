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

const FETCH_TIMEOUT_MS = 10000;
const MAX_PAGES = 5;

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

export function registerAdminProviderModelsRoutes(app: GatewayApp): void {
  app.post("/_airlock/providers/fetch-models", async (context) => {
    await requireAdminScope(context, "config.write");
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

    let models: string[];
    try {
      if (type === "gemini") {
        models = await fetchGeminiModels(fetcher, baseUrl, apiKey);
      } else if (type === "anthropic") {
        models = await fetchAnthropicModels(fetcher, baseUrl, apiKey);
      } else {
        models = await fetchOpenAIModels(fetcher, baseUrl, apiKey);
      }
    } catch (e) {
      if (e instanceof GatewayError) throw e;
      throw new GatewayError("Failed to connect to provider", {
        code: "provider_connection_failed",
        category: "provider",
        httpStatus: 502,
        retryable: false,
        requestId
      });
    }

    return context.json({ models });
  });
}

async function fetcherWithError(
  fetcher: typeof fetch,
  url: string,
  headers: Record<string, string>
): Promise<Record<string, unknown>> {
  const response = await fetcher(url, {
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!response.ok) {
    throw new GatewayError(`Provider returned ${response.status}`, {
      code: "provider_error",
      category: "provider",
      httpStatus: 502,
      retryable: false,
      requestId: ""
    });
  }
  return (await response.json()) as Record<string, unknown>;
}

// OpenAI-compatible: GET {baseUrl}/models with Bearer auth
// Used by: OpenAI, DeepSeek, Mistral, GLM, any OpenAI-compatible provider
async function fetchOpenAIModels(
  fetcher: typeof fetch,
  baseUrl: string,
  apiKey: string
): Promise<string[]> {
  const url = `${stripTrailingSlash(baseUrl)}/models`;
  const data = await fetcherWithError(fetcher, url, {
    Authorization: `Bearer ${apiKey}`
  });
  const items = data.data;
  if (!Array.isArray(items)) return [];
  return items
    .map((m: Record<string, unknown>) => (m.id ?? "") as string)
    .filter((n: string) => n.length > 0);
}

// Anthropic: GET {baseUrl}/v1/models with x-api-key + anthropic-version
// Paginated with has_more / after_id cursor
async function fetchAnthropicModels(
  fetcher: typeof fetch,
  baseUrl: string,
  apiKey: string
): Promise<string[]> {
  const base = `${stripTrailingSlash(baseUrl)}/v1/models`;
  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01"
  };
  const allModels: string[] = [];
  let afterId: string | undefined;
  let pages = 0;

  while (pages < MAX_PAGES) {
    const url = afterId
      ? `${base}?after_id=${encodeURIComponent(afterId)}&limit=100`
      : `${base}?limit=100`;
    const data = await fetcherWithError(fetcher, url, headers);
    const items = data.data;
    if (Array.isArray(items)) {
      for (const m of items as Array<Record<string, unknown>>) {
        const id = (m.id ?? "") as string;
        if (id) allModels.push(id);
      }
    }
    if (data.has_more !== true) break;
    afterId = (data.last_id ?? undefined) as string | undefined;
    if (!afterId) break;
    pages++;
  }

  return allModels;
}

// Gemini: GET {baseUrl}/models?key={apiKey}
// Paginated with nextPageToken
// Filters to models that support generateContent
async function fetchGeminiModels(
  fetcher: typeof fetch,
  baseUrl: string,
  apiKey: string
): Promise<string[]> {
  const base = `${stripTrailingSlash(baseUrl)}/models`;
  const allModels: string[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  while (pages < MAX_PAGES) {
    let url = `${base}?key=${encodeURIComponent(apiKey)}&pageSize=100`;
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
    const data = await fetcherWithError(fetcher, url, {});
    const items = data.models;
    if (Array.isArray(items)) {
      for (const m of items as Array<Record<string, unknown>>) {
        // Only include models that support generateContent
        const methods = m.supportedGenerationMethods;
        if (!Array.isArray(methods) || !methods.includes("generateContent")) {
          continue;
        }
        // Prefer baseModelId (e.g. "gemini-2.5-pro") over name (e.g. "models/gemini-2.5-pro")
        const baseModelId = (m.baseModelId ?? "") as string;
        if (baseModelId) {
          allModels.push(baseModelId);
        } else {
          const name = (m.name ?? "") as string;
          const stripped = name.startsWith("models/") ? name.slice(7) : name;
          if (stripped) allModels.push(stripped);
        }
      }
    }
    const nextToken = (data.nextPageToken ?? "") as string;
    if (!nextToken) break;
    pageToken = nextToken;
    pages++;
  }

  // Deduplicate (Gemini may return multiple versions of same base model)
  return [...new Set(allModels)];
}
