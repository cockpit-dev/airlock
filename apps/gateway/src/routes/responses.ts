import type { Context } from "hono";

import {
  encodeCanonicalToOpenAIResponsesStreamEvent,
  encodeCanonicalToOpenAIResponsesResponse,
  normalizeOpenAIResponsesRequest
} from "@airlock/canonical";
import { openAIResponsesRequestSchema } from "@airlock/protocols";
import { resolveModelRoute } from "@airlock/routing";

import {
  assertGatewayKeyAllowsModel,
  assertGatewayKeyAllowsRoute,
  requireGatewayAuthorization
} from "../auth.js";
import { resolveGatewayConfig } from "../config.js";
import type { GatewayBindings } from "../env.js";
import {
  executeRoutedRequest,
  executeRoutedStreamRequest
} from "../provider-execution.js";
import { parseRequestShapingExtension } from "../request-extensions.js";

export async function handleResponses(context: Context): Promise<Response> {
  const requestId = context.get("requestId") as string;
  const config = resolveGatewayConfig(context.env as GatewayBindings);
  const gatewayApiKey = requireGatewayAuthorization(context, config, requestId);

  const json = (await context.req.json()) as unknown;
  const parsed = openAIResponsesRequestSchema.parse(json);
  const route = resolveModelRoute(parsed.model, config.modelAliases, requestId);
  assertGatewayKeyAllowsRoute(gatewayApiKey, route, requestId);
  assertGatewayKeyAllowsModel(
    gatewayApiKey,
    route.externalModel,
    requestId,
    config.modelGroups
  );
  const canonicalRequest = normalizeOpenAIResponsesRequest({
    ...parsed,
    model: route.target.providerModel
  });
  const requestShaping = parseRequestShapingExtension(
    parsed.airlock?.requestShaping
  );
  const fetcher = context.get("fetcher") as typeof fetch | undefined;

  if (canonicalRequest.stream) {
    const encoder = new TextEncoder();
    const responseStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        for await (const event of executeRoutedStreamRequest(
          route,
          canonicalRequest,
          {
            config,
            gatewayApiKey,
            requestId,
            ...(requestShaping ? { requestShaping } : {}),
            ...(fetcher ? { fetcher } : {})
          }
        )) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify(
                encodeCanonicalToOpenAIResponsesStreamEvent(event)
              )}\n\n`
            )
          );
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    });

    return new Response(responseStream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-request-id": requestId
      }
    });
  }

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

  return context.json(encodeCanonicalToOpenAIResponsesResponse(canonicalResponse), 200, {
    "x-request-id": requestId
  });
}
