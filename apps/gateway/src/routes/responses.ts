import type { Context } from "hono";

import {
  type CanonicalStreamEvent,
  encodeCanonicalToOpenAIResponsesStreamEvent,
  encodeCanonicalToOpenAIResponsesResponse,
  normalizeOpenAIResponsesRequest
} from "@airlock/canonical";
import {
  createRateLimitHeaders,
  type RateLimitDecision
} from "@airlock/governance";
import type { TelemetrySink } from "@airlock/telemetry";
import { openAIResponsesRequestSchema } from "@airlock/protocols";
import { resolveModelRoute, type ProviderTarget } from "@airlock/routing";
import { GatewayError } from "@airlock/shared";

function collectRateLimitHeaders(
  ...decisions: (RateLimitDecision | undefined)[]
): Record<string, string> {
  const defined = decisions.filter(
    (d): d is RateLimitDecision => d !== undefined
  );
  if (defined.length === 0) {
    return {};
  }

  const mostRestrictive: RateLimitDecision = {
    allowed: true,
    limit: Math.min(...defined.map((d) => d.limit)),
    remaining: Math.min(...defined.map((d) => d.remaining)),
    resetAt: defined.map((d) => d.resetAt).sort()[0]!,
    retryAfterSeconds: 0
  };

  return createRateLimitHeaders(mostRestrictive);
}

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
  assertAllowedOpenAITopLevelFields,
  assertOpenAIForcedToolChoiceMatchesDeclaredTools,
  assertSupportedOpenAIResponsesSemantics,
  assertSupportedOpenAIResponsesStreamOptions,
  assertSupportedOpenAIResponsesToolsSemantics,
  parseOpenAIRequestSchema
} from "../openai-request-validation.js";

const allowedOpenAIResponsesTopLevelFields = [
  "model",
  "stream",
  "safety_identifier",
  "metadata",
  "service_tier",
  "store",
  "prompt_cache_key",
  "prompt_cache_retention",
  "prompt",
  "prompt_id",
  "previous_response_id",
  "conversation",
  "max_output_tokens",
  "temperature",
  "top_p",
  "stop",
  "instructions",
  "reasoning",
  "text",
  "include",
  "top_logprobs",
  "truncation",
  "stream_options",
  "parallel_tool_calls",
  "tools",
  "tool_choice",
  "input",
  "airlock"
] as const;

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
  assertAllowedOpenAITopLevelFields(
    json,
    requestId,
    "OpenAI Responses",
    allowedOpenAIResponsesTopLevelFields
  );
  assertSupportedOpenAIResponsesSemantics(json, requestId);
  assertSupportedOpenAIResponsesStreamOptions(json, requestId);
  assertSupportedOpenAIResponsesToolsSemantics(json, requestId);
  assertOpenAIForcedToolChoiceMatchesDeclaredTools(
    json,
    requestId,
    "OpenAI Responses"
  );
  const parsed = parseOpenAIRequestSchema(
    openAIResponsesRequestSchema,
    json,
    requestId,
    "OpenAI Responses"
  );
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
    primaryTargetOpen: routingMetadata.primaryTargetOpen
  });

  if (canonicalRequest.stream) {
    const encoder = new TextEncoder();
    let responsesSequenceNumber = 0;
    let accumulatedOutputText = "";
    let accumulatedReasoningSummary = "";
    let startedTextOutput = false;
    let startedReasoningOutput = false;
    let parallelToolCallsState: boolean | undefined;
    const startedToolCallIds = new Set<string>();
    const streamedToolCalls = new Map<
      string,
      {
        toolCallId: string;
        toolCallName?: string;
        toolCallArguments: string;
        outputIndex: number;
      }
    >();
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
            routePath: "/v1/responses",
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
          routePath: "/v1/responses",
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

      if (event.type === "output_text_delta") {
        accumulatedOutputText += event.delta;
      }

      if (event.type === "reasoning_summary_delta") {
        accumulatedReasoningSummary += event.delta;
      }

      if (event.type === "tool_call_delta") {
        const currentToolCall = streamedToolCalls.get(event.toolCallId) ?? {
          toolCallId: event.toolCallId,
          toolCallArguments: "",
          outputIndex: event.toolIndex
        };
        if (event.toolName !== undefined) {
          currentToolCall.toolCallName = event.toolName;
        }
        currentToolCall.toolCallArguments += event.argumentsDelta;
        currentToolCall.outputIndex =
          event.toolIndex +
          (startedReasoningOutput ? 1 : 0) +
          (startedTextOutput ? 1 : 0);
        streamedToolCalls.set(event.toolCallId, currentToolCall);
      }

      if (
        (event.type === "response_started" ||
          event.type === "response_completed") &&
        event.parallelToolCalls !== undefined
      ) {
        parallelToolCallsState = event.parallelToolCalls;
      }

      const encodedBatch = encodeCanonicalToOpenAIResponsesStreamEvent(event, {
        sequenceNumber: responsesSequenceNumber,
        outputIndex:
          event.type === "tool_call_delta"
            ? (streamedToolCalls.get(event.toolCallId)?.outputIndex ??
              event.toolIndex)
            : 0,
        contentIndex: 0,
        ...(startedTextOutput ? { startedTextOutput } : {}),
        ...(startedReasoningOutput ? { startedReasoningOutput } : {}),
        ...(startedToolCallIds.size > 0
          ? { startedToolCallIds: Array.from(startedToolCallIds) }
          : {}),
        ...(event.type === "tool_call_delta"
          ? {
              toolCallId: event.toolCallId,
              ...(event.toolName !== undefined
                ? { toolCallName: event.toolName }
                : {}),
              ...(startedToolCallIds.has(event.toolCallId) &&
              streamedToolCalls.get(event.toolCallId) !== undefined
                ? {
                    toolCallArguments: streamedToolCalls.get(event.toolCallId)!
                      .toolCallArguments
                  }
                : {})
            }
          : {}),
        ...(streamedToolCalls.size > 0
          ? {
              toolCalls: Array.from(streamedToolCalls.values()).sort(
                (left, right) => {
                  return left.outputIndex - right.outputIndex;
                }
              )
            }
          : {}),
        ...(parallelToolCallsState !== undefined
          ? { parallelToolCalls: parallelToolCallsState }
          : {}),
        ...(accumulatedReasoningSummary.length > 0
          ? { reasoningSummary: accumulatedReasoningSummary }
          : {}),
        ...(event.type === "response_completed"
          ? { outputText: accumulatedOutputText }
          : {})
      });

      if (event.type === "output_text_delta") {
        startedTextOutput = true;
      }

      if (event.type === "reasoning_summary_delta") {
        startedReasoningOutput = true;
      }

      if (event.type === "tool_call_delta") {
        startedToolCallIds.add(event.toolCallId);
      }

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

          void emitGatewayRequestSuccessTelemetry({
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
            ...(streamUsage ? { usage: streamUsage } : {}),
            ...routingSignals()
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
        routePath: "/v1/responses",
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
    usage: canonicalResponse.usage,
    ...routingSignals()
  });

  return context.json(
    encodeCanonicalToOpenAIResponsesResponse(canonicalResponse),
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
