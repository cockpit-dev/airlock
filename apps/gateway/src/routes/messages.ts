import type { Context } from "hono";

import {
  type CanonicalStreamEvent,
  encodeCanonicalToAnthropicMessagesStreamEvents,
  encodeCanonicalToAnthropicMessagesResponse,
  normalizeAnthropicMessagesRequest
} from "@airlock/canonical";
import { anthropicMessagesRequestSchema } from "@airlock/protocols";
import { resolveModelRoute } from "@airlock/routing";
import { GatewayError } from "@airlock/shared";
import type { TelemetrySink } from "@airlock/telemetry";

import {
  assertGatewayKeyAllowsModel,
  assertGatewayKeyAllowsRoute,
  requireGatewayAuthorization
} from "../auth.js";
import { resolveGatewayConfig } from "../config.js";
import type { GatewayBindings } from "../env.js";
import { parseRequestShapingExtension } from "../request-extensions.js";
import type { CreateAppOptions } from "../app.js";
import {
  assertAllowedAnthropicTopLevelFields,
  assertAnthropicForcedToolChoiceMatchesDeclaredTools,
  assertSupportedAnthropicMetadataSemantics,
  assertSupportedAnthropicToolsSemantics,
  parseAnthropicRequestSchema
} from "../anthropic-request-validation.js";
import {
  acquireQuotaResources,
  assertGatewayKeyTokenUsageAvailable,
  cancelStreamResources,
  emitSuccessTelemetry,
  handleQuotaError,
  quotaRateLimitHeaders,
  reconcileTokenQuota,
  releaseConcurrencyLease,
  releaseStreamResources,
  routingSignals,
  type QuotaResources
} from "../quota-pipeline.js";
import {
  executeRoutedRequest,
  executeRoutedStreamRequest
} from "../provider-execution.js";

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
    routePath: "/v1/messages",
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

  if (canonicalRequest.stream) {
    const encoder = new TextEncoder();
    const anthropicStreamEncodingState = {
      startedTextBlock: false,
      startedToolBlocks: [] as number[],
      pendingToolStops: [] as number[]
    };
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
        requestMode: "openai_responses",
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
        ...(fetcher ? { fetcher } : {})
      }
    );
    const streamIterator = streamExecution[Symbol.asyncIterator]();

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

          emitSuccessTelemetry(
            telemetryBase,
            true,
            200,
            streamUsage
          );
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
        "request-id": requestId,
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
      requestMode: "openai_responses",
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
      ...(fetcher ? { fetcher } : {})
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

  emitSuccessTelemetry(
    telemetryBase,
    false,
    200,
    canonicalResponse.usage
  );

  return context.json(
    encodeCanonicalToAnthropicMessagesResponse(canonicalResponse),
    200,
    {
      "x-request-id": requestId,
      ...quotaRateLimitHeaders(quota)
    }
  );
}
