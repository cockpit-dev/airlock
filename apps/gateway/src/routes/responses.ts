import type { Context } from "hono";

import {
  type CanonicalStreamEvent,
  encodeCanonicalToOpenAIResponsesStreamEvent,
  encodeCanonicalToOpenAIResponsesResponse,
  normalizeOpenAIResponsesRequest
} from "@airlock/canonical";
import type { TelemetrySink } from "@airlock/telemetry";
import { openAIResponsesRequestSchema } from "@airlock/protocols";
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
  assertGatewayKeyTokenUsageAvailable,
  enforceGatewayKeyTokenQuotaPrecheck
  ,
  reconcileGatewayKeyTokenQuotaReservation,
  releaseGatewayKeyTokenQuotaReservation,
  reserveGatewayKeyTokenQuota
} from "../gateway-key-token-quota.js";
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

const unsupportedOpenAIResponsesSemanticFields = [
  "previous_response_id",
  "conversation",
  "tools",
  "tool_choice",
  "text",
  "reasoning",
  "prompt"
] as const;

function assertSupportedOpenAIResponsesSemantics(
  payload: unknown,
  requestId: string
) {
  if (typeof payload !== "object" || payload === null) {
    return;
  }

  for (const field of unsupportedOpenAIResponsesSemanticFields) {
    if (field in payload) {
      throw new GatewayError(
        `Unsupported OpenAI Responses semantic field: ${field}`,
        {
          code: "request_unsupported_openai_semantics",
          category: "request",
          httpStatus: 400,
          retryable: false,
          requestId
        }
      );
    }
  }
}

export async function handleResponses(
  context: Context<{
    Bindings: GatewayBindings;
    Variables: {
      requestId: string;
      fetcher?: CreateAppOptions["fetcher"];
      now?: () => number;
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
  assertSupportedOpenAIResponsesSemantics(json, requestId);
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
  await enforceGatewayKeyTokenQuotaPrecheck(context.env, gatewayApiKey, requestId);
  const tokenReservation = await reserveGatewayKeyTokenQuota(
    context.env,
    gatewayApiKey,
    requestId,
    canonicalRequest.maxOutputTokens ?? 0,
    config.providerTimeoutMs + 5_000
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
  const now = context.get("now");
  let attemptedTarget: ProviderTarget | undefined;

  if (canonicalRequest.stream) {
    const encoder = new TextEncoder();
    let responsesSequenceNumber = 0;
    let accumulatedOutputText = "";
    let streamUsage:
      | {
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
        }
      | undefined;
    const streamExecution = executeRoutedStreamRequest(route, canonicalRequest, {
      config,
      gatewayApiKey,
      requestId,
      ...(circuitBreakerBackend ? { circuitBreakerBackend } : {}),
      onAttemptTarget(target) {
        attemptedTarget = target;
      },
      ...(now ? { now } : {}),
      ...(requestShaping ? { requestShaping } : {}),
      ...(fetcher ? { fetcher } : {})
    });
    const streamIterator = streamExecution[Symbol.asyncIterator]();
    const didUseFallback = () => {
      return (
        attemptedTarget !== undefined &&
        (attemptedTarget.provider !== route.target.provider ||
          attemptedTarget.providerModel !== route.target.providerModel)
      );
    };
    const handleStreamingError = async (error: unknown) => {
      await releaseGatewayKeyTokenQuotaReservation(
        context.env,
        gatewayApiKey,
        requestId,
        tokenReservation
      );
      if (error instanceof GatewayError) {
        context.set("telemetryErrorEmitted", true);
        await emitGatewayRequestErrorTelemetry(
          {
            telemetrySink,
            requestId,
            routePath: "/v1/responses",
            mode: config.mode,
            startedAt: requestStartedAt,
            stream: true,
            statusCode: error.httpStatus,
            gatewayApiKey,
            externalModel: route.externalModel,
            providerTarget: attemptedTarget,
            fallbackUsed: didUseFallback()
          },
          error
        );
      }
    };
    const writeStreamEvent = async (
      event: CanonicalStreamEvent,
      controller: ReadableStreamDefaultController<Uint8Array>
    ) => {
      if (event.type === "response_completed") {
        assertGatewayKeyTokenUsageAvailable(
          gatewayApiKey,
          event.usage,
          requestId
        );

        if (event.usage) {
          await reconcileGatewayKeyTokenQuotaReservation(
            context.env,
            gatewayApiKey,
            requestId,
            tokenReservation,
            event.usage.totalTokens
          );
          streamUsage = event.usage;
        }
      }

      if (event.type === "output_text_delta") {
        accumulatedOutputText += event.delta;
      }

      const encodedBatch = encodeCanonicalToOpenAIResponsesStreamEvent(event, {
        sequenceNumber: responsesSequenceNumber,
        outputIndex: 0,
        contentIndex: 0,
        ...(event.type === "response_completed"
          ? { outputText: accumulatedOutputText }
          : {})
      });

      responsesSequenceNumber = encodedBatch.nextSequenceNumber;

      for (const encodedEvent of encodedBatch.events) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(encodedEvent)}\n\n`)
        );
      }
    };
    let firstEvent: CanonicalStreamEvent | undefined;

    try {
      const firstChunk = await streamIterator.next();

      if (!firstChunk.done) {
        firstEvent = firstChunk.value;
      }
    } catch (error) {
      try {
        await handleStreamingError(error);
      } finally {
        await releaseGatewayKeyConcurrencyLease(
          context.env,
          gatewayApiKey,
          concurrencyLeaseId,
          requestId
        );
      }
      throw error;
    }

    const responseStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          if (firstEvent) {
            await writeStreamEvent(firstEvent, controller);
          }

          while (true) {
            const nextChunk = await streamIterator.next();

            if (nextChunk.done) {
              break;
            }

            await writeStreamEvent(nextChunk.value, controller);
          }

          await emitGatewayRequestSuccessTelemetry({
            telemetrySink,
            requestId,
            routePath: "/v1/responses",
            mode: config.mode,
            startedAt: requestStartedAt,
            stream: true,
            statusCode: 200,
            gatewayApiKey,
            externalModel: route.externalModel,
            providerTarget: attemptedTarget,
            fallbackUsed: didUseFallback(),
            ...(streamUsage ? { usage: streamUsage } : {})
          });
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (error) {
          await handleStreamingError(error);
          throw error;
        } finally {
          await releaseGatewayKeyConcurrencyLease(
            context.env,
            gatewayApiKey,
            concurrencyLeaseId,
            requestId
          );
        }
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
      ...(circuitBreakerBackend ? { circuitBreakerBackend } : {}),
      onAttemptTarget(target) {
        attemptedTarget = target;
      },
      ...(now ? { now } : {}),
      ...(requestShaping ? { requestShaping } : {}),
      ...(fetcher ? { fetcher } : {})
    });
  } catch (error) {
    await releaseGatewayKeyTokenQuotaReservation(
      context.env,
      gatewayApiKey,
      requestId,
      tokenReservation
    );
    if (error instanceof GatewayError) {
      context.set("telemetryErrorEmitted", true);
      await emitGatewayRequestErrorTelemetry(
        {
          telemetrySink,
          requestId,
          routePath: "/v1/responses",
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

  assertGatewayKeyTokenUsageAvailable(
    gatewayApiKey,
    canonicalResponse.usage,
    requestId
  );
  if (canonicalResponse.usage) {
    await reconcileGatewayKeyTokenQuotaReservation(
      context.env,
      gatewayApiKey,
      requestId,
      tokenReservation,
      canonicalResponse.usage.totalTokens
    );
  }

  await emitGatewayRequestSuccessTelemetry({
    telemetrySink,
    requestId,
    routePath: "/v1/responses",
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

  return context.json(encodeCanonicalToOpenAIResponsesResponse(canonicalResponse), 200, {
    "x-request-id": requestId
  });
}
