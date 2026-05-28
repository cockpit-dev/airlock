import type { Context } from "hono";

import {
  type CanonicalStreamEvent,
  createStreamReassemblyIterable,
  encodeCanonicalToGeminiGenerateContentResponse,
  encodeCanonicalToGeminiGenerateContentStreamEvents,
  normalizeGeminiGenerateContentRequest
} from "@airlock/canonical";
import { geminiGenerateContentRequestSchema } from "@airlock/protocols";
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
import { parseGeminiRequestSchema } from "../gemini-request-validation.js";
import {
  extractForwardedHeaders,
  extractForwardedQuery,
  parseRequestShapingExtension
} from "../request-extensions.js";
import type { CreateAppOptions } from "../app.js";
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

type GeminiRouteAction = "generateContent" | "streamGenerateContent";

function parseGeminiRouteTarget(
  rest: string | undefined,
  requestId: string
): { model: string; action: GeminiRouteAction } {
  if (!rest) {
    throw new GatewayError("Invalid Gemini route", {
      code: "request_invalid_gemini_route",
      category: "request",
      httpStatus: 404,
      retryable: false,
      requestId
    });
  }

  const separatorIndex = rest.lastIndexOf(":");

  if (separatorIndex <= 0 || separatorIndex === rest.length - 1) {
    throw new GatewayError("Invalid Gemini route", {
      code: "request_invalid_gemini_route",
      category: "request",
      httpStatus: 404,
      retryable: false,
      requestId
    });
  }

  const model = rest.slice(0, separatorIndex);
  const action = rest.slice(separatorIndex + 1);

  if (action !== "generateContent" && action !== "streamGenerateContent") {
    throw new GatewayError("Invalid Gemini route", {
      code: "request_invalid_gemini_route",
      category: "request",
      httpStatus: 404,
      retryable: false,
      requestId
    });
  }

  return { model, action };
}

function stripGeminiControlQuery(
  query: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!query) return undefined;
  const { alt: _alt, ...forwarded } = query;
  return Object.keys(forwarded).length > 0 ? forwarded : undefined;
}

export async function handleGeminiGenerateContent(
  context: Context<{
    Bindings: GatewayBindings;
    Variables: {
      requestId: string;
      fetcher?: CreateAppOptions["fetcher"];
      now?: () => number;
      requestStartedAt: number;
      telemetrySink?: TelemetrySink;
      telemetryErrorEmitted?: boolean;
      _airlock_metrics_provider?: string;
      _airlock_metrics_model?: string;
      _airlock_metrics_stream?: boolean;
    };
  }>
): Promise<Response> {
  const requestId = context.get("requestId");
  const { model, action } = parseGeminiRouteTarget(
    context.req.param("rest"),
    requestId
  );
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

  const parsed = parseGeminiRequestSchema(
    geminiGenerateContentRequestSchema,
    json,
    requestId
  );
  const stream = action === "streamGenerateContent";
  const route = resolveModelRoute(model, config.modelAliases, requestId);
  assertGatewayKeyAllowsRoute(gatewayApiKey, route, requestId);
  assertGatewayKeyAllowsModel(
    gatewayApiKey,
    [route.externalModel, model],
    requestId,
    config.modelGroups
  );

  const canonicalRequest = normalizeGeminiGenerateContentRequest({
    ...parsed,
    model: route.target.providerModel,
    stream
  });
  const requestShaping = parseRequestShapingExtension(
    parsed.airlock?.requestShaping
  );
  const forwardedHeaders = extractForwardedHeaders(context.req.raw.headers);
  const forwardedQuery = stripGeminiControlQuery(
    extractForwardedQuery(context.req.url)
  );

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
    routePath: `/v1beta/models/:model:${action}`,
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
  context.set("_airlock_metrics_model", route.target.providerModel);
  context.set("_airlock_metrics_stream", stream);

  if (stream) {
    const encoder = new TextEncoder();
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
        requestMode: "openai_chat",
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
      `gemini_${requestId}`,
      route.target.providerModel
    );
    const streamIterator = reassembledStream[Symbol.asyncIterator]();

    const handleStreamingError = async (error: unknown) => {
      await handleQuotaError(context.env, telemetryBase, true, error);
      context.set("telemetryErrorEmitted", true);
    };

    const writeStreamEvent = async (
      event: CanonicalStreamEvent,
      state: Parameters<
        typeof encodeCanonicalToGeminiGenerateContentStreamEvents
      >[1],
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
        }
      }

      for (const geminiEvent of encodeCanonicalToGeminiGenerateContentStreamEvents(
        event,
        state
      )) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(geminiEvent)}\n\n`)
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
        const geminiStreamEncodingState = {
          toolCalls: new Map()
        };

        try {
          if (firstEvent) {
            await writeStreamEvent(
              firstEvent,
              geminiStreamEncodingState,
              controller
            );
          }

          while (true) {
            const nextChunk = await streamIterator.next();

            if (nextChunk.done) {
              break;
            }

            await writeStreamEvent(
              nextChunk.value,
              geminiStreamEncodingState,
              controller
            );
          }

          emitSuccessTelemetry(telemetryBase, true, 200, streamUsage);
          controller.close();
        } catch (error) {
          await handleStreamingError(error);
          try {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  error: {
                    message:
                      error instanceof Error
                        ? error.message
                        : "Internal server error"
                  }
                })}\n\n`
              )
            );
            controller.close();
          } catch {
            // Controller may already be closed or errored.
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
      requestMode: "openai_chat",
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
  }

  emitSuccessTelemetry(telemetryBase, false, 200, canonicalResponse.usage);

  return context.json(
    encodeCanonicalToGeminiGenerateContentResponse(canonicalResponse),
    200,
    {
      "x-request-id": requestId,
      ...quotaRateLimitHeaders(quota)
    }
  );
}
