import type { Context } from "hono";

import {
  encodeCanonicalToOpenAIChatResponse,
  encodeCanonicalToOpenAIChatStreamChunk,
  normalizeOpenAIChatRequest
} from "@airlock/canonical";
import { openAIChatCompletionRequestSchema } from "@airlock/protocols";
import { resolveModelRoute } from "@airlock/routing";
import type { ProviderTarget } from "@airlock/routing";
import { GatewayError } from "@airlock/shared";
import type { TelemetrySink } from "@airlock/telemetry";

import {
  assertGatewayKeyAllowsModel,
  assertGatewayKeyAllowsRoute,
  requireGatewayAuthorization
} from "../auth.js";
import { resolveGatewayConfig } from "../config.js";
import type { GatewayBindings } from "../env.js";
import { enforceGatewayKeyRequestQuota } from "../gateway-key-quota.js";
import {
  executeRoutedRequest,
  executeRoutedStreamRequest
} from "../provider-execution.js";
import { parseRequestShapingExtension } from "../request-extensions.js";
import {
  emitGatewayRequestSuccessTelemetry,
  emitGatewayRequestErrorTelemetry
} from "../telemetry.js";

export async function handleChatCompletions(
  context: Context<{
    Bindings: GatewayBindings;
  }>
): Promise<Response> {
  const requestId = context.get("requestId") as string;
  const config = resolveGatewayConfig(context.env);
  const requestStartedAt = context.get("requestStartedAt") as number;
  const telemetrySink = context.get("telemetrySink") as TelemetrySink | undefined;
  const gatewayApiKey = await requireGatewayAuthorization(
    context,
    config,
    requestId
  );

  const json: unknown = await context.req.json();
  const parsed = openAIChatCompletionRequestSchema.parse(json);
  const route = resolveModelRoute(parsed.model, config.modelAliases, requestId);
  assertGatewayKeyAllowsRoute(gatewayApiKey, route, requestId);
  assertGatewayKeyAllowsModel(
    gatewayApiKey,
    route.externalModel,
    requestId,
    config.modelGroups
  );
  const canonicalRequest = normalizeOpenAIChatRequest({
    ...parsed,
    model: route.target.providerModel
  });
  const requestShaping = parseRequestShapingExtension(
    parsed.airlock?.requestShaping
  );
  await enforceGatewayKeyRequestQuota(context.env, gatewayApiKey, requestId);
  const fetcher = context.get("fetcher") as typeof fetch | undefined;
  let attemptedTarget: ProviderTarget | undefined;

  if (canonicalRequest.stream) {
    const streamId = `chatcmpl_${requestId}`;
    const encoder = new TextEncoder();
    const responseStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of executeRoutedStreamRequest(
            route,
            canonicalRequest,
            {
              config,
              gatewayApiKey,
              requestId,
              onAttemptTarget(target) {
                attemptedTarget = target;
              },
              ...(requestShaping ? { requestShaping } : {}),
              ...(fetcher ? { fetcher } : {})
            }
          )) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify(
                  encodeCanonicalToOpenAIChatStreamChunk(event, streamId)
                )}\n\n`
              )
            );
          }

          await emitGatewayRequestSuccessTelemetry({
            telemetrySink,
            requestId,
            routePath: "/v1/chat/completions",
            mode: config.mode,
            startedAt: requestStartedAt,
            stream: true,
            statusCode: 200,
            gatewayApiKey,
            externalModel: route.externalModel,
            providerTarget: attemptedTarget,
            fallbackUsed:
              attemptedTarget !== undefined &&
              (attemptedTarget.provider !== route.target.provider ||
                attemptedTarget.providerModel !== route.target.providerModel)
          });
        } catch (error) {
          if (error instanceof GatewayError) {
            await emitGatewayRequestErrorTelemetry(
              {
                telemetrySink,
                requestId,
                routePath: "/v1/chat/completions",
                mode: config.mode,
                startedAt: requestStartedAt,
                stream: true,
                statusCode: error.httpStatus,
                gatewayApiKey,
                externalModel: route.externalModel,
                providerTarget: attemptedTarget,
                fallbackUsed:
                  attemptedTarget !== undefined &&
                  (attemptedTarget.provider !== route.target.provider ||
                    attemptedTarget.providerModel !== route.target.providerModel)
              },
              error
            );
          }

          throw error;
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

  let canonicalResponse;

  try {
    canonicalResponse = await executeRoutedRequest(route, canonicalRequest, {
      config,
      gatewayApiKey,
      requestId,
      onAttemptTarget(target) {
        attemptedTarget = target;
      },
      ...(requestShaping ? { requestShaping } : {}),
      ...(fetcher ? { fetcher } : {})
    });
  } catch (error) {
    if (error instanceof GatewayError) {
      context.set("telemetryErrorEmitted", true);
      await emitGatewayRequestErrorTelemetry(
        {
          telemetrySink,
          requestId,
          routePath: "/v1/chat/completions",
          mode: config.mode,
          startedAt: requestStartedAt,
          stream: false,
          statusCode: error.httpStatus,
          gatewayApiKey,
          externalModel: route.externalModel,
          providerTarget: attemptedTarget,
          fallbackUsed:
            attemptedTarget !== undefined &&
            (attemptedTarget.provider !== route.target.provider ||
              attemptedTarget.providerModel !== route.target.providerModel)
        },
        error
      );
    }

    throw error;
  }

  await emitGatewayRequestSuccessTelemetry({
    telemetrySink,
    requestId,
    routePath: "/v1/chat/completions",
    mode: config.mode,
    startedAt: requestStartedAt,
    stream: false,
    statusCode: 200,
    gatewayApiKey,
    externalModel: route.externalModel,
    providerTarget: attemptedTarget,
    fallbackUsed:
      attemptedTarget !== undefined &&
      (attemptedTarget.provider !== route.target.provider ||
        attemptedTarget.providerModel !== route.target.providerModel),
    usage: canonicalResponse.usage
  });

  return context.json(encodeCanonicalToOpenAIChatResponse(canonicalResponse), 200, {
    "x-request-id": requestId
  });
}
