import type { Context } from "hono";

import {
  encodeCanonicalToAnthropicMessagesStreamEvents,
  encodeCanonicalToAnthropicMessagesResponse,
  normalizeAnthropicMessagesRequest
} from "@airlock/canonical";
import type { TelemetrySink } from "@airlock/telemetry";
import { anthropicMessagesRequestSchema } from "@airlock/protocols";
import { resolveModelRoute, type ProviderTarget } from "@airlock/routing";
import { GatewayError } from "@airlock/shared";

import {
  assertGatewayKeyAllowsModel,
  assertGatewayKeyAllowsRoute,
  requireGatewayAuthorization
} from "../auth.js";
import { createPersistentCircuitBreakerBackend } from "../circuit-breaker.js";
import { resolveGatewayConfig } from "../config.js";
import type { GatewayBindings } from "../env.js";
import {
  acquireGatewayKeyConcurrencyLease,
  releaseGatewayKeyConcurrencyLease
} from "../gateway-key-concurrency.js";
import { enforceGatewayKeyRequestQuota } from "../gateway-key-quota.js";
import {
  executeRoutedRequest,
  executeRoutedStreamRequest
} from "../provider-execution.js";
import { parseRequestShapingExtension } from "../request-extensions.js";
import {
  emitGatewayRequestErrorTelemetry,
  emitGatewayRequestSuccessTelemetry
} from "../telemetry.js";
import type { CreateAppOptions } from "../app.js";

export async function handleMessages(
  context: Context<{
    Bindings: GatewayBindings;
    Variables: {
      requestId: string;
      fetcher?: CreateAppOptions["fetcher"];
      requestStartedAt: number;
      telemetrySink?: TelemetrySink;
      telemetryErrorEmitted?: boolean;
    };
  }>
): Promise<Response> {
  const requestId = context.get("requestId");
  const config = resolveGatewayConfig(context.env);
  const requestStartedAt = context.get("requestStartedAt");
  const telemetrySink = context.get("telemetrySink");
  const gatewayApiKey = await requireGatewayAuthorization(
    context,
    config,
    requestId
  );

  const json: unknown = await context.req.json();
  const parsed = anthropicMessagesRequestSchema.parse(json);
  const route = resolveModelRoute(parsed.model, config.modelAliases, requestId);
  assertGatewayKeyAllowsRoute(gatewayApiKey, route, requestId);
  assertGatewayKeyAllowsModel(
    gatewayApiKey,
    route.externalModel,
    requestId,
    config.modelGroups
  );
  const canonicalRequest = normalizeAnthropicMessagesRequest({
    ...parsed,
    model: route.target.providerModel
  });
  const requestShaping = parseRequestShapingExtension(
    parsed.airlock?.requestShaping
  );
  await enforceGatewayKeyRequestQuota(context.env, gatewayApiKey, requestId);
  const concurrencyLeaseId = await acquireGatewayKeyConcurrencyLease(
    context.env,
    gatewayApiKey,
    requestId,
    config.providerTimeoutMs
  );
  const circuitBreakerBackend =
    config.providerCircuitBreakerPersistent && context.env.AIRLOCK_PROVIDER_CIRCUIT_BREAKER
      ? createPersistentCircuitBreakerBackend(
          context.env.AIRLOCK_PROVIDER_CIRCUIT_BREAKER
        )
      : undefined;
  const fetcher = context.get("fetcher");
  let attemptedTarget: ProviderTarget | undefined;

  if (canonicalRequest.stream) {
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
              ...(circuitBreakerBackend ? { circuitBreakerBackend } : {}),
              onAttemptTarget(target) {
                attemptedTarget = target;
              },
              ...(requestShaping ? { requestShaping } : {}),
              ...(fetcher ? { fetcher } : {})
            }
          )) {
            for (const anthropicEvent of encodeCanonicalToAnthropicMessagesStreamEvents(
              event
            )) {
              controller.enqueue(
                encoder.encode(
                  `event: ${anthropicEvent.type}\ndata: ${JSON.stringify(
                    anthropicEvent
                  )}\n\n`
                )
              );
            }
          }

          await emitGatewayRequestSuccessTelemetry({
            telemetrySink,
            requestId,
            routePath: "/v1/messages",
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
                routePath: "/v1/messages",
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
        } finally {
          await releaseGatewayKeyConcurrencyLease(
            context.env,
            gatewayApiKey,
            concurrencyLeaseId,
            requestId
          );
          controller.close();
        }
      }
    });

    return new Response(responseStream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "request-id": requestId,
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
      ...(circuitBreakerBackend ? { circuitBreakerBackend } : {}),
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
          routePath: "/v1/messages",
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
  } finally {
    await releaseGatewayKeyConcurrencyLease(
      context.env,
      gatewayApiKey,
      concurrencyLeaseId,
      requestId
    );
  }

  await emitGatewayRequestSuccessTelemetry({
    telemetrySink,
    requestId,
    routePath: "/v1/messages",
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

  return context.json(
    encodeCanonicalToAnthropicMessagesResponse(canonicalResponse),
    200,
    {
      "x-request-id": requestId
    }
  );
}
