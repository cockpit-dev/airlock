import type { Context } from "hono";

import {
  type CanonicalStreamEvent,
  encodeCanonicalToAnthropicMessagesStreamEvents,
  encodeCanonicalToAnthropicMessagesResponse,
  normalizeAnthropicMessagesRequest
} from "@airlock/canonical";
import { resolveModelRoute, type ProviderTarget } from "@airlock/routing";
import { GatewayError } from "@airlock/shared";
import type { TelemetrySink } from "@airlock/telemetry";
import { anthropicMessagesRequestSchema } from "@airlock/protocols";

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
import { collectRateLimitHeaders } from "../rate-limit-headers.js";
import {
  assertGatewayKeyTokenUsageAvailable,
  enforceGatewayKeyTokenQuotaPrecheck,
  reconcileGatewayKeyTokenQuotaReservation,
  releaseGatewayKeyTokenQuotaReservation,
  reserveGatewayKeyTokenQuota
} from "../gateway-key-token-quota.js";
import {
  executeRoutedRequest,
  executeRoutedStreamRequest,
  type RoutingMetadataAccumulator
} from "../provider-execution.js";
import { parseRequestShapingExtension } from "../request-extensions.js";
import {
  emitGatewayRequestErrorTelemetry,
  emitGatewayRequestUnknownErrorTelemetry,
  emitGatewayRequestSuccessTelemetry
} from "../telemetry.js";
import type { CreateAppOptions } from "../app.js";
import {
  assertAllowedAnthropicTopLevelFields,
  assertAnthropicForcedToolChoiceMatchesDeclaredTools,
  assertSupportedAnthropicMetadataSemantics,
  assertSupportedAnthropicToolsSemantics,
  parseAnthropicRequestSchema
} from "../anthropic-request-validation.js";

const allowedAnthropicTopLevelFields = [
  "model",
  "max_tokens",
  "stream",
  "system",
  "temperature",
  "top_p",
  "stop_sequences",
  "metadata",
  "tools",
  "tool_choice",
  "messages",
  "airlock"
] as const;

export async function handleMessages(
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

  const contentType = context.req.header("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    throw new GatewayError("Content-Type must be application/json", {
      code: "request_invalid_content_type",
      category: "request",
      httpStatus: 415,
      retryable: false,
      requestId
    });
  }

  const contentLength = context.req.header("content-length");
  if (
    contentLength !== undefined &&
    Number(contentLength) > config.maxRequestBodyBytes
  ) {
    throw new GatewayError("Request body exceeds maximum allowed size", {
      code: "request_body_too_large",
      category: "request",
      httpStatus: 413,
      retryable: false,
      requestId
    });
  }

  let json: unknown;
  try {
    json = await context.req.json();
  } catch {
    throw new GatewayError("Request body must be valid JSON", {
      code: "request_invalid_json",
      category: "request",
      httpStatus: 400,
      retryable: false,
      requestId
    });
  }
  assertAllowedAnthropicTopLevelFields(
    json,
    requestId,
    allowedAnthropicTopLevelFields
  );
  assertSupportedAnthropicMetadataSemantics(json, requestId);
  assertSupportedAnthropicToolsSemantics(json, requestId);
  assertAnthropicForcedToolChoiceMatchesDeclaredTools(json, requestId);
  const parsed = parseAnthropicRequestSchema(
    anthropicMessagesRequestSchema,
    json,
    requestId
  );
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
  await enforceGatewayKeyTokenQuotaPrecheck(
    context.env,
    gatewayApiKey,
    requestId
  );
  const tokenReservationResult = await reserveGatewayKeyTokenQuota(
    context.env,
    gatewayApiKey,
    requestId,
    canonicalRequest.maxOutputTokens ?? 0,
    config.providerTimeoutMs + 5_000
  );
  const tokenReservation = tokenReservationResult?.handle;
  const requestQuotaDecision = await enforceGatewayKeyRequestQuota(
    context.env,
    gatewayApiKey,
    requestId
  );
  const concurrencyResult = await acquireGatewayKeyConcurrencyLease(
    context.env,
    gatewayApiKey,
    requestId,
    config.providerTimeoutMs
  );
  const concurrencyLeaseId = concurrencyResult?.leaseId;
  const circuitBreakerBackend =
    config.providerCircuitBreakerPersistent &&
    context.env.AIRLOCK_PROVIDER_CIRCUIT_BREAKER
      ? createPersistentCircuitBreakerBackend(
          context.env.AIRLOCK_PROVIDER_CIRCUIT_BREAKER
        )
      : undefined;
  const fetcher = context.get("fetcher");
  const now = context.get("now");
  let attemptedTarget: ProviderTarget | undefined;
  const routingMetadata: RoutingMetadataAccumulator = {};
  const routingSignals = () => ({
    routingStrategy: route.targetSelection?.strategy,
    attemptCount: routingMetadata.attemptCount,
    primaryTargetOpen: routingMetadata.primaryTargetOpen,
    timeoutBudgetMs: routingMetadata.timeoutBudgetMs,
    timeoutBudgetRemainingMs: routingMetadata.timeoutBudgetRemainingMs
  });

  if (canonicalRequest.stream) {
    const encoder = new TextEncoder();
    const anthropicStreamEncodingState = {
      startedTextBlock: false,
      startedToolBlocks: [] as number[],
      pendingToolStops: [] as number[]
    };
    let streamUsage:
      | {
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
        }
      | undefined;
    const streamExecution = executeRoutedStreamRequest(
      route,
      canonicalRequest,
      {
        config,
        gatewayApiKey,
        requestId,
        requestMode: "openai_responses",
        ...(circuitBreakerBackend ? { circuitBreakerBackend } : {}),
        onAttemptTarget(target) {
          attemptedTarget = target;
        },
        routingMetadata,
        ...(now ? { now } : {}),
        ...(requestShaping ? { requestShaping } : {}),
        ...(fetcher ? { fetcher } : {})
      }
    );
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
      context.set("telemetryErrorEmitted", true);
      if (error instanceof GatewayError) {
        void emitGatewayRequestErrorTelemetry(
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
            fallbackUsed: didUseFallback(),
            ...routingSignals()
          },
          error
        );
      } else {
        void emitGatewayRequestUnknownErrorTelemetry({
          telemetrySink,
          requestId,
          routePath: "/v1/messages",
          mode: config.mode,
          startedAt: requestStartedAt,
          stream: true,
          statusCode: 500,
          gatewayApiKey,
          externalModel: route.externalModel,
          providerTarget: attemptedTarget,
          fallbackUsed: didUseFallback(),
          ...routingSignals()
        });
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

      for (const anthropicEvent of encodeCanonicalToAnthropicMessagesStreamEvents(
        event,
        anthropicStreamEncodingState
      )) {
        controller.enqueue(
          encoder.encode(
            `event: ${anthropicEvent.type}\ndata: ${JSON.stringify(
              anthropicEvent
            )}\n\n`
          )
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

          void emitGatewayRequestSuccessTelemetry({
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
            fallbackUsed: didUseFallback(),
            ...(streamUsage ? { usage: streamUsage } : {}),
            ...routingSignals()
          });
          controller.close();
        } catch (error) {
          await handleStreamingError(error);
          try {
            const errorMessage =
              error instanceof GatewayError
                ? error.message
                : "Internal server error";
            controller.enqueue(
              encoder.encode(
                `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "internal_error", message: errorMessage } })}\n\n`
              )
            );
            controller.close();
          } catch {
            // Controller may already be closed or errored
          }
        } finally {
          await releaseGatewayKeyConcurrencyLease(
            context.env,
            gatewayApiKey,
            concurrencyLeaseId,
            requestId
          );
        }
      },
      cancel() {
        void streamIterator.return?.();
        void releaseGatewayKeyTokenQuotaReservation(
          context.env,
          gatewayApiKey,
          requestId,
          tokenReservation
        );
      }
    });

    return new Response(responseStream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "request-id": requestId,
        "x-request-id": requestId,
        ...collectRateLimitHeaders(
          tokenReservationResult?.decision,
          requestQuotaDecision,
          concurrencyResult?.decision
        )
      }
    });
  }

  let canonicalResponse;

  try {
    canonicalResponse = await executeRoutedRequest(route, canonicalRequest, {
      config,
      gatewayApiKey,
      requestId,
      requestMode: "openai_responses",
      ...(circuitBreakerBackend ? { circuitBreakerBackend } : {}),
      onAttemptTarget(target) {
        attemptedTarget = target;
      },
      routingMetadata,
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
      void emitGatewayRequestErrorTelemetry(
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
              attemptedTarget.providerModel !== route.target.providerModel),
          ...routingSignals()
        },
        error
      );
    } else {
      context.set("telemetryErrorEmitted", true);
      void emitGatewayRequestUnknownErrorTelemetry({
        telemetrySink,
        requestId,
        routePath: "/v1/messages",
        mode: config.mode,
        startedAt: requestStartedAt,
        stream: false,
        statusCode: 500,
        gatewayApiKey,
        externalModel: route.externalModel,
        providerTarget: attemptedTarget,
        fallbackUsed:
          attemptedTarget !== undefined &&
          (attemptedTarget.provider !== route.target.provider ||
            attemptedTarget.providerModel !== route.target.providerModel),
        ...routingSignals()
      });
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

  void emitGatewayRequestSuccessTelemetry({
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
    usage: canonicalResponse.usage,
    ...routingSignals()
  });

  return context.json(
    encodeCanonicalToAnthropicMessagesResponse(canonicalResponse),
    200,
    {
      "x-request-id": requestId,
      ...collectRateLimitHeaders(
        tokenReservationResult?.decision,
        requestQuotaDecision,
        concurrencyResult?.decision
      )
    }
  );
}
