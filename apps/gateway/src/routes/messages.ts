import type { Context } from "hono";

import {
  encodeCanonicalToAnthropicMessagesResponse,
  normalizeAnthropicMessagesRequest
} from "@airlock/canonical";
import { anthropicMessagesRequestSchema } from "@airlock/protocols";
import { resolveModelRoute } from "@airlock/routing";

import {
  assertGatewayKeyAllowsModel,
  requireGatewayAuthorization
} from "../auth.js";
import { resolveGatewayConfig } from "../config.js";
import type { GatewayBindings } from "../env.js";
import { executeRoutedRequest } from "../provider-execution.js";
import { parseRequestShapingExtension } from "../request-extensions.js";

export async function handleMessages(context: Context) {
  const requestId = context.get("requestId") as string;
  const config = resolveGatewayConfig(context.env as GatewayBindings);
  const gatewayApiKey = requireGatewayAuthorization(context, config, requestId);

  const json = (await context.req.json()) as unknown;
  const parsed = anthropicMessagesRequestSchema.parse(json);
  const route = resolveModelRoute(parsed.model, config.modelAliases, requestId);
  assertGatewayKeyAllowsModel(gatewayApiKey, route.externalModel, requestId);
  const canonicalRequest = normalizeAnthropicMessagesRequest({
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
      gatewayApiKey,
      requestId,
      ...(requestShaping ? { requestShaping } : {}),
      ...(fetcher ? { fetcher } : {})
    }
  );

  return context.json(
    encodeCanonicalToAnthropicMessagesResponse(canonicalResponse),
    200,
    {
      "x-request-id": requestId
    }
  );
}
