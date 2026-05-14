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
  "previous_response_id",
  "conversation",
  "max_output_tokens",
  "temperature",
  "top_p",
  "instructions",
  "text",
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

  const json: unknown = await context.req.json();
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
    let startedTextOutput = false;
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
    const streamExecution = executeRoutedStreamRequest(route, canonicalRequest, {
      config,
      gatewayApiKey,
      requestId,
      requestMode: "openai_responses",
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
        currentToolCall.outputIndex = startedTextOutput
          ? event.toolIndex + 1
          : event.toolIndex;
        streamedToolCalls.set(event.toolCallId, currentToolCall);
      }

      const encodedBatch = encodeCanonicalToOpenAIResponsesStreamEvent(event, {
        sequenceNumber: responsesSequenceNumber,
        outputIndex:
          event.type === "tool_call_delta"
            ? (streamedToolCalls.get(event.toolCallId)?.outputIndex ?? event.toolIndex)
            : 0,
        contentIndex: 0,
        ...(startedTextOutput ? { startedTextOutput } : {}),
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
                    toolCallArguments:
                      streamedToolCalls.get(event.toolCallId)!.toolCallArguments
                  }
                : {})
            }
          : {}),
        ...(streamedToolCalls.size > 0
          ? {
              toolCalls: Array.from(streamedToolCalls.values()).sort((left, right) => {
                return left.outputIndex - right.outputIndex;
              })
            }
          : {}),
        ...(event.type === "response_completed"
          ? { outputText: accumulatedOutputText }
          : {})
      });

      if (event.type === "output_text_delta") {
        startedTextOutput = true;
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
      requestMode: "openai_responses",
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
