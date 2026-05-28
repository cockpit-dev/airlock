import type { Context } from "hono";

import {
  type CanonicalResponse,
  type CanonicalStreamEvent,
  createStreamReassemblyIterable,
  encodeCanonicalToOpenAIResponsesStreamEvent,
  encodeCanonicalToOpenAIResponsesResponse,
  encodeOpenAIResponsesStreamError,
  normalizeOpenAIResponsesRequest
} from "@airlock/canonical";
import { openAIResponsesRequestSchema } from "@airlock/protocols";
import { resolveModelRoute } from "@airlock/routing";
import { GatewayError } from "@airlock/shared";
import type { TelemetrySink } from "@airlock/telemetry";

import {
  assertGatewayKeyAllowsModel,
  assertGatewayKeyAllowsRoute,
  requireGatewayAuthorization
} from "../auth.js";
import { resolveGatewayConfigWithOverlay } from "../config.js";
import type { GatewayBindings } from "../env.js";
import {
  extractForwardedHeaders,
  extractForwardedQuery,
  parseRequestShapingExtension
} from "../request-extensions.js";
import type { CreateAppOptions } from "../app.js";
import {
  assertOpenAIForcedToolChoiceMatchesDeclaredTools,
  assertSupportedOpenAIResponsesSemantics,
  assertSupportedOpenAIResponsesStreamOptions,
  assertSupportedOpenAIResponsesToolsSemantics,
  parseOpenAIRequestSchema
} from "../openai-request-validation.js";
import {
  acquireQuotaResources,
  assertGatewayKeyTokenUsageAvailable,
  cancelStreamResources,
  emitSuccessTelemetry,
  handleQuotaError,
  quotaRateLimitHeaders,
  reconcileTokenQuota,
  releaseConcurrencyLease,
  releaseStreamResources
} from "../quota-pipeline.js";
import {
  executeRoutedRequest,
  executeRoutedStreamRequest
} from "../provider-execution.js";
import { dispatchBackgroundTask, recordGatewayMetrics } from "../metrics.js";

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
      _airlock_metrics_key_id?: string;
      _airlock_metrics_provider?: string;
      _airlock_metrics_model?: string;
      _airlock_metrics_stream?: boolean;
      _airlock_metrics_protocol?: string;
      _airlock_metrics_usage?: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
    };
  }>
): Promise<Response> {
  const requestId = context.get("requestId");
  const config = await resolveGatewayConfigWithOverlay(context.env);
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
  const contentLength = Number(context.req.header("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > config.maxRequestBodyBytes
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
    [route.externalModel, parsed.model],
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
  const forwardedHeaders = extractForwardedHeaders(context.req.raw.headers);
  const forwardedQuery = extractForwardedQuery(context.req.url);
  const requestMode = "openai_responses" as const;

  const quota = await acquireQuotaResources({
    env: context.env,
    headers: context.req.raw.headers,
    config: {
      ipRateLimitPolicy: config.ipRateLimitPolicy,
      providerCircuitBreakerPersistent: config.providerCircuitBreakerPersistent,
      providerTimeoutMs: config.providerTimeoutMs
    },
    gatewayApiKey,
    requestId,
    maxOutputTokens: canonicalRequest.maxOutputTokens ?? 0
  });

  const telemetryBase = {
    telemetrySink,
    requestId,
    routePath: "/v1/responses",
    mode: config.mode,
    startedAt: requestStartedAt,
    gatewayApiKey,
    externalModel: route.externalModel,
    primaryTarget: route.target,
    quota,
    routingStrategy: route.targetSelection?.strategy
  };

  const fetcher = context.get("fetcher");
  const now = context.get("now");

  context.set("_airlock_metrics_provider", route.target.provider);
  context.set("_airlock_metrics_key_id", gatewayApiKey.id);
  context.set("_airlock_metrics_model", route.target.providerModel);
  context.set("_airlock_metrics_stream", canonicalRequest.stream);
  context.set("_airlock_metrics_protocol", "openai_responses");

  if (canonicalRequest.stream) {
    const encoder = new TextEncoder();
    let responsesSequenceNumber = 0;
    let accumulatedOutputText = "";
    let accumulatedReasoningSummary = "";
    let accumulatedReasoningRawContent = "";
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
        toolType?: "function_call" | "custom_tool_call";
      }
    >();
    let streamUsage:
      | { inputTokens: number; outputTokens: number; totalTokens: number }
      | undefined;
    const streamExecution = executeRoutedStreamRequest(
      route,
      canonicalRequest,
      {
        config,
        gatewayApiKey,
        requestId,
        requestMode,
        signal: context.req.raw.signal,
        ...(quota.circuitBreakerBackend
          ? { circuitBreakerBackend: quota.circuitBreakerBackend }
          : {}),
        onAttemptTarget(target) {
          quota.attemptedTarget = target;
        },
        routingMetadata: quota.routingMetadata,
        ...(now ? { now } : {}),
        ...(requestShaping ? { requestShaping } : {}),
        ...(fetcher ? { fetcher } : {}),
        ...(forwardedHeaders ? { forwardedHeaders } : {}),
        ...(forwardedQuery ? { forwardedQuery } : {})
      }
    );
    const reassembledStream = createStreamReassemblyIterable(
      streamExecution,
      `resp_${requestId}`,
      route.target.providerModel
    );
    const streamIterator = reassembledStream[Symbol.asyncIterator]();

    const handleStreamingError = async (error: unknown) => {
      await handleQuotaError(context.env, telemetryBase, true, error);
      context.set("telemetryErrorEmitted", true);
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
          await reconcileTokenQuota(
            context.env,
            gatewayApiKey,
            requestId,
            quota.tokenReservation,
            event.usage.totalTokens
          );
          streamUsage = event.usage;
          dispatchBackgroundTask(
            recordGatewayMetrics(
              context.env,
              {
                routePath: "/v1/responses",
                statusCode: 200,
                durationMs: 0,
                providerId: route.target.provider,
                modelId: route.target.providerModel,
                isStream: true,
                protocol: "openai_responses",
                usageOnly: true,
                usage: event.usage
              },
              context.get("now")?.()
            ),
            context
          );
        }
      }

      if (event.type === "output_text_delta") {
        accumulatedOutputText += event.delta;
      }

      if (event.type === "reasoning_summary_delta") {
        accumulatedReasoningSummary += event.delta;
      }

      if (event.type === "reasoning_raw_content_delta") {
        accumulatedReasoningRawContent += event.delta;
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
        currentToolCall.toolType =
          event.nativeEvent?.openaiResponses &&
          typeof event.nativeEvent.openaiResponses === "object" &&
          event.nativeEvent.openaiResponses !== null &&
          "type" in
            (event.nativeEvent.openaiResponses as Record<string, unknown>) &&
          (event.nativeEvent.openaiResponses as Record<string, unknown>)
            .type === "response.custom_tool_call_input.delta"
            ? "custom_tool_call"
            : (currentToolCall.toolType ?? "function_call");
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
              ...(streamedToolCalls.get(event.toolCallId)?.toolType !==
              undefined
                ? {
                    toolCallType: streamedToolCalls.get(event.toolCallId)!
                      .toolType
                  }
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
        ...(accumulatedReasoningRawContent.length > 0
          ? { reasoningRawContent: accumulatedReasoningRawContent }
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
        await releaseConcurrencyLease(
          context.env,
          gatewayApiKey,
          quota.concurrencyLeaseId,
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

          emitSuccessTelemetry(telemetryBase, true, 200, streamUsage);
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (error) {
          await handleStreamingError(error);
          try {
            controller.enqueue(
              encoder.encode(encodeOpenAIResponsesStreamError(error))
            );
            controller.close();
          } catch {
            // Controller may already be closed or errored
          }
        } finally {
          releaseStreamResources(
            context.env,
            gatewayApiKey,
            requestId,
            quota,
            streamUsage
          );
        }
      },
      cancel() {
        cancelStreamResources(
          context.env,
          gatewayApiKey,
          requestId,
          quota,
          streamIterator
        );
      }
    });

    return new Response(responseStream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        "x-request-id": requestId,
        ...quotaRateLimitHeaders(quota)
      }
    });
  }

  let canonicalResponse;

  try {
    canonicalResponse = await executeRoutedRequest(route, canonicalRequest, {
      config,
      gatewayApiKey,
      requestId,
      requestMode,
      signal: context.req.raw.signal,
      ...(quota.circuitBreakerBackend
        ? { circuitBreakerBackend: quota.circuitBreakerBackend }
        : {}),
      onAttemptTarget(target) {
        quota.attemptedTarget = target;
      },
      routingMetadata: quota.routingMetadata,
      ...(now ? { now } : {}),
      ...(requestShaping ? { requestShaping } : {}),
      ...(fetcher ? { fetcher } : {}),
      ...(forwardedHeaders ? { forwardedHeaders } : {}),
      ...(forwardedQuery ? { forwardedQuery } : {})
    });
  } catch (error) {
    await handleQuotaError(context.env, telemetryBase, false, error);
    context.set("telemetryErrorEmitted", true);
    throw error;
  } finally {
    await releaseConcurrencyLease(
      context.env,
      gatewayApiKey,
      quota.concurrencyLeaseId,
      requestId
    );
  }

  assertGatewayKeyTokenUsageAvailable(
    gatewayApiKey,
    canonicalResponse.usage,
    requestId
  );
  if (canonicalResponse.usage) {
    await reconcileTokenQuota(
      context.env,
      gatewayApiKey,
      requestId,
      quota.tokenReservation,
      canonicalResponse.usage.totalTokens
    );
    context.set("_airlock_metrics_usage", canonicalResponse.usage);
  }

  emitSuccessTelemetry(telemetryBase, false, 200, canonicalResponse.usage);

  return context.json(
    encodeCanonicalToOpenAIResponsesResponse(
      canonicalResponse as CanonicalResponse & {
        nativeResponse?: CanonicalResponse["nativeResponse"] & {
          openaiResponses?: undefined;
        };
      }
    ),
    200,
    {
      "x-request-id": requestId,
      ...quotaRateLimitHeaders(quota)
    }
  );
}
