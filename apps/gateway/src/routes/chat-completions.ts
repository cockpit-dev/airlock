import type { Context } from "hono";

import {
  type CanonicalStreamEvent,
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
  emitGatewayRequestSuccessTelemetry,
  emitGatewayRequestErrorTelemetry,
  emitGatewayRequestUnknownErrorTelemetry
} from "../telemetry.js";
import type { CreateAppOptions } from "../app.js";
import {
  assertAllowedOpenAITopLevelFields,
  assertOpenAIForcedToolChoiceMatchesDeclaredTools,
  assertSupportedOpenAIChatLogprobsSemantics,
  assertSupportedOpenAIChatResponseFormat,
  assertSupportedOpenAIChatStreamOptions,
  assertSupportedOpenAIChatToolsSemantics,
  parseOpenAIRequestSchema
} from "../openai-request-validation.js";

const allowedOpenAIChatTopLevelFields = [
  "model",
  "stream",
  "user",
  "safety_identifier",
  "metadata",
  "service_tier",
  "store",
  "prompt_cache_key",
  "prompt_cache_retention",
  "max_tokens",
  "max_completion_tokens",
  "reasoning_effort",
  "temperature",
  "top_p",
  "logprobs",
  "top_logprobs",
  "frequency_penalty",
  "presence_penalty",
  "seed",
  "response_format",
  "modalities",
  "stop",
  "stream_options",
  "parallel_tool_calls",
  "tools",
  "tool_choice",
  "messages",
  "airlock"
] as const;

export async function handleChatCompletions(
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

  // Advisory body size check via Content-Length header.
  // Chunked transfer encoding (no Content-Length) relies on the
  // Cloudflare Workers platform body size limit as a safety net.
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
  assertAllowedOpenAITopLevelFields(
    json,
    requestId,
    "OpenAI Chat",
    allowedOpenAIChatTopLevelFields
  );
  assertSupportedOpenAIChatResponseFormat(json, requestId);
  assertSupportedOpenAIChatLogprobsSemantics(json);
  assertSupportedOpenAIChatStreamOptions(json, requestId);
  assertSupportedOpenAIChatToolsSemantics(json, requestId);
  assertOpenAIForcedToolChoiceMatchesDeclaredTools(
    json,
    requestId,
    "OpenAI Chat"
  );
  const parsed = parseOpenAIRequestSchema(
    openAIChatCompletionRequestSchema,
    json,
    requestId,
    "OpenAI Chat"
  );
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
  const includeUsageInStream =
    canonicalRequest.providerMetadata?.openai?.chatIncludeUsage === true;
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
    timeoutBudgetRemainingMs: routingMetadata.timeoutBudgetRemainingMs,
    malformedSseEventCount: routingMetadata.malformedSseEventCount
  });

  if (canonicalRequest.stream) {
    const streamId = `chatcmpl_${requestId}`;
    const encoder = new TextEncoder();
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
            routePath: "/v1/chat/completions",
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
          routePath: "/v1/chat/completions",
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
          try {
            await reconcileGatewayKeyTokenQuotaReservation(
              context.env,
              gatewayApiKey,
              requestId,
              tokenReservation,
              event.usage.totalTokens
            );
          } catch {
            // Reconcile failed — release the reservation instead of leaking it
            void releaseGatewayKeyTokenQuotaReservation(
              context.env,
              gatewayApiKey,
              requestId,
              tokenReservation
            );
          }
          streamUsage = event.usage;
        }
      }

      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify(
            encodeCanonicalToOpenAIChatStreamChunk(
              event,
              streamId,
              includeUsageInStream
            )
          )}\n\n`
        )
      );
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
        try {
          await releaseGatewayKeyConcurrencyLease(
            context.env,
            gatewayApiKey,
            concurrencyLeaseId,
            requestId
          );
        } catch {
          // Lease release failure must not mask the original response
        }
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
            routePath: "/v1/chat/completions",
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
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
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
                `data: ${JSON.stringify({ error: { message: errorMessage, type: "internal_error", code: "stream_error" } })}\n\n`
              )
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } catch {
            // Controller may already be closed or errored
          }
        } finally {
          try {
            await releaseGatewayKeyConcurrencyLease(
              context.env,
              gatewayApiKey,
              concurrencyLeaseId,
              requestId
            );
          } catch {
            // Lease release failure must not mask the original response
          }
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
        void releaseGatewayKeyConcurrencyLease(
          context.env,
          gatewayApiKey,
          concurrencyLeaseId,
          requestId
        );
      }
    });

    return new Response(responseStream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
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
        routePath: "/v1/chat/completions",
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
    try {
      await releaseGatewayKeyConcurrencyLease(
        context.env,
        gatewayApiKey,
        concurrencyLeaseId,
        requestId
      );
    } catch {
      // Lease release failure must not mask the original response
    }
  }

  assertGatewayKeyTokenUsageAvailable(
    gatewayApiKey,
    canonicalResponse.usage,
    requestId
  );
  if (canonicalResponse.usage) {
    try {
      await reconcileGatewayKeyTokenQuotaReservation(
        context.env,
        gatewayApiKey,
        requestId,
        tokenReservation,
        canonicalResponse.usage.totalTokens
      );
    } catch {
      // Reconcile failed — release the reservation instead of leaking it
      void releaseGatewayKeyTokenQuotaReservation(
        context.env,
        gatewayApiKey,
        requestId,
        tokenReservation
      );
    }
  }

  void emitGatewayRequestSuccessTelemetry({
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
    usage: canonicalResponse.usage,
    ...routingSignals()
  });

  return context.json(
    encodeCanonicalToOpenAIChatResponse(canonicalResponse),
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
