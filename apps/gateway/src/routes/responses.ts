import type { Context } from "hono";

import {
  encodeCanonicalToOpenAIResponsesResponse,
  normalizeOpenAIResponsesRequest
} from "@airlock/canonical";
import { openAIResponsesRequestSchema } from "@airlock/protocols";
import { resolveModelRoute } from "@airlock/routing";

import { requireGatewayAuthorization } from "../auth.js";
import { resolveGatewayConfig } from "../config.js";
import type { GatewayBindings } from "../env.js";
import { executeRoutedRequest } from "../provider-execution.js";
import { parseRequestShapingExtension } from "../request-extensions.js";

export async function handleResponses(context: Context) {
  const requestId = context.get("requestId") as string;
  const config = resolveGatewayConfig(context.env as GatewayBindings);
  requireGatewayAuthorization(context, config, requestId);

  const json = (await context.req.json()) as unknown;
  const parsed = openAIResponsesRequestSchema.parse(json);
  const route = resolveModelRoute(parsed.model, config.modelAliases, requestId);
  const canonicalRequest = normalizeOpenAIResponsesRequest({
    ...parsed,
    model: route.target.providerModel
  });
  const requestShaping = parseRequestShapingExtension(
    parsed.airlock?.requestShaping
  );
  const fetcher = context.get("fetcher") as typeof fetch | undefined;
  const canonicalResponse = await executeRoutedRequest(
    route,
    canonicalRequest,
    {
      config,
      requestId,
      ...(requestShaping ? { requestShaping } : {}),
      ...(fetcher ? { fetcher } : {})
    }
  );

  return context.json(encodeCanonicalToOpenAIResponsesResponse(canonicalResponse), 200, {
    "x-request-id": requestId
  });
}
