import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalStreamEvent
} from "@airlock/canonical";
import {
  applyAuthStrategy,
  applyRequestShaping,
  applySigningStrategy,
  buildRequestUrl,
  mergeRequestShapingProfiles,
  type OutboundAuthStrategy,
  type OutboundSigningStrategy,
  type RequestShapingProfile
} from "@airlock/request-shaping";

import { GatewayError } from "@airlock/shared";

import type { ProviderAdapter, ProviderRequestContext } from "./types.js";
import { assertSseBufferSize } from "./sse-buffer.js";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

function normalizeAnthropicFinishReason(
  stopReason: string | undefined
): "stop" | "max_tokens" | "tool_calls" {
  if (stopReason === "tool_use") {
    return "tool_calls";
  }

  return stopReason === "max_tokens" ? "max_tokens" : "stop";
}

function mapCanonicalToolChoiceToAnthropic(
  toolChoice: CanonicalRequest["toolChoice"]
) {
  if (toolChoice === undefined) {
    return undefined;
  }

  if (toolChoice === "auto") {
    return {
      type: "auto" as const
    };
  }

  if (toolChoice === "required") {
    return {
      type: "any" as const
    };
  }

  if (toolChoice === "none") {
    return {
      type: "none" as const
    };
  }

  return {
    type: "tool" as const,
    name: toolChoice.name
  };
}

function parseAnthropicToolInput(
  argumentsJson: string,
  requestId: string
): JsonValue {
  try {
    return JSON.parse(argumentsJson) as JsonValue;
  } catch (error) {
    throw new GatewayError(
      "Invalid tool call arguments for Anthropic: function arguments must be valid JSON",
      {
        code: "request_invalid_tool_arguments",
        category: "request",
        httpStatus: 400,
        retryable: false,
        requestId,
        cause: error
      }
    );
  }
}

function buildAnthropicMessages(request: CanonicalRequest, requestId: string) {
  const sourceMessages = request.messages.filter(
    (message) => message.role !== "system"
  );
  const outboundMessages: Array<
    | {
        role: "user";
        content:
          | string
          | Array<
              | {
                  type: "text";
                  text: string;
                }
              | {
                  type: "tool_result";
                  tool_use_id: string;
                  content: string;
                }
            >;
      }
    | {
        role: "assistant";
        content:
          | string
          | Array<
              | {
                  type: "text";
                  text: string;
                }
              | {
                  type: "tool_use";
                  id: string;
                  name: string;
                  input: JsonValue;
                }
            >;
      }
  > = [];

  let pendingUserContentBlocks: Array<
    | {
        type: "text";
        text: string;
      }
    | {
        type: "tool_result";
        tool_use_id: string;
        content: string;
      }
  > = [];

  const flushPendingUserContentBlocks = () => {
    if (pendingUserContentBlocks.length === 0) {
      return;
    }

    outboundMessages.push({
      role: "user",
      content:
        pendingUserContentBlocks.length === 1 &&
        pendingUserContentBlocks[0]?.type === "text"
          ? pendingUserContentBlocks[0].text
          : pendingUserContentBlocks
    });
    pendingUserContentBlocks = [];
  };

  for (const message of sourceMessages) {
    if (message.role === "tool") {
      pendingUserContentBlocks.push({
        type: "tool_result",
        tool_use_id: message.toolCallId,
        content: message.content
      });
      continue;
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      flushPendingUserContentBlocks();
      outboundMessages.push({
        role: "assistant",
        content: [
          ...(message.content.length > 0
            ? [
                {
                  type: "text" as const,
                  text: message.content
                }
              ]
            : []),
          ...message.toolCalls.map((toolCall) => ({
            type: "tool_use" as const,
            id: toolCall.id,
            name: toolCall.name,
            input: parseAnthropicToolInput(toolCall.arguments, requestId)
          }))
        ]
      });
      continue;
    }

    if (message.role === "user") {
      pendingUserContentBlocks.push({
        type: "text",
        text: message.content
      });
      continue;
    }

    flushPendingUserContentBlocks();
    outboundMessages.push({
      role: "assistant",
      content: message.content
    });
  }

  flushPendingUserContentBlocks();

  return outboundMessages;
}

function buildAnthropicRequestBody(
  request: CanonicalRequest,
  defaultMaxTokens: number,
  requestId: string,
  stream: boolean
) {
  const systemMessage = request.messages.find((message) => {
    return message.role === "system";
  });
  const messages = buildAnthropicMessages(request, requestId);
  const toolChoice = mapCanonicalToolChoiceToAnthropic(request.toolChoice);

  return {
    model: request.model,
    max_tokens: request.maxOutputTokens ?? defaultMaxTokens,
    ...(stream ? { stream: true } : {}),
    ...(systemMessage
      ? {
          system: [
            {
              type: "text" as const,
              text: systemMessage.content
            }
          ]
        }
      : {}),
    ...(request.endUserId !== undefined
      ? {
          metadata: {
            user_id: request.endUserId
          }
        }
      : {}),
    ...(request.temperature !== undefined
      ? { temperature: request.temperature }
      : {}),
    ...(request.topP !== undefined ? { top_p: request.topP } : {}),
    ...(request.stopSequences !== undefined
      ? { stop_sequences: request.stopSequences }
      : {}),
    ...(request.tools !== undefined
      ? {
          tools: request.tools.map((tool) => ({
            name: tool.name,
            ...(tool.description ? { description: tool.description } : {}),
            input_schema: tool.inputSchema
          }))
        }
      : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    messages
  };
}

export interface AnthropicProviderAdapterOptions {
  apiKey: string;
  baseUrl: string;
  defaultMaxTokens: number;
  shaping?: RequestShapingProfile;
  signing?: OutboundSigningStrategy;
  signingSecrets?: Record<string, string>;
  fetcher?: typeof fetch;
}

export class AnthropicProviderAdapter implements ProviderAdapter {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #defaultMaxTokens: number;
  readonly #shaping: RequestShapingProfile;
  readonly #signing: OutboundSigningStrategy | undefined;
  readonly #signingSecrets: Record<string, string>;
  readonly #fetcher: typeof fetch;

  constructor(options: AnthropicProviderAdapterOptions) {
    this.#apiKey = options.apiKey;
    this.#baseUrl = options.baseUrl.replace(/\/$/, "");
    this.#defaultMaxTokens = options.defaultMaxTokens;
    this.#shaping = options.shaping ?? {};
    this.#signing = options.signing;
    this.#signingSecrets = options.signingSecrets ?? {};
    this.#fetcher = options.fetcher ?? fetch;
  }

  async complete(
    request: CanonicalRequest,
    context: ProviderRequestContext
  ): Promise<CanonicalResponse> {
    const requestBody = buildAnthropicRequestBody(
      request,
      this.#defaultMaxTokens,
      context.requestId,
      false
    );

    const authStrategy: OutboundAuthStrategy = {
      type: "header_value",
      headerName: "x-api-key",
      credential: {
        secretRef: "anthropic-api-key"
      }
    };
    const outboundRequest = this.#signing
      ? await applySigningStrategy(
          applyRequestShaping(
            applyAuthStrategy(
              {
                path: "/messages",
                method: "POST",
                headers: {
                  "anthropic-version": "2023-06-01",
                  "content-type": "application/json"
                },
                query: {},
                jsonBody: requestBody
              },
              authStrategy,
              {
                "anthropic-api-key": this.#apiKey
              }
            ),
            mergeRequestShapingProfiles(this.#shaping, context.requestShaping)
          ),
          this.#signing,
          this.#signingSecrets
        )
      : applyRequestShaping(
          applyAuthStrategy(
            {
              path: "/messages",
              method: "POST",
              headers: {
                "anthropic-version": "2023-06-01",
                "content-type": "application/json"
              },
              query: {},
              jsonBody: requestBody
            },
            authStrategy,
            {
              "anthropic-api-key": this.#apiKey
            }
          ),
          mergeRequestShapingProfiles(this.#shaping, context.requestShaping)
        );
    const abortController = new AbortController();
    context.signal?.addEventListener("abort", () => abortController.abort(), { once: true });
    const timeoutHandle =
      context.timeoutMs !== undefined
        ? setTimeout(() => {
            abortController.abort();
          }, context.timeoutMs)
        : undefined;

    let response: Response;

    try {
      response = await this.#fetcher(
        buildRequestUrl(this.#baseUrl, outboundRequest),
        {
          method: outboundRequest.method,
          headers: outboundRequest.headers,
          body: JSON.stringify(outboundRequest.jsonBody),
          signal: abortController.signal
        }
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new GatewayError("Upstream provider timed out", {
          code: "provider_timeout",
          category: "provider",
          httpStatus: 504,
          retryable: true,
          provider: "anthropic",
          requestId: context.requestId,
          cause: error
        });
      }

      throw error;
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }

    if (!response.ok) {
      let errorMessage = "Upstream provider error";
      let upstreamErrorCode: string | undefined;
      try {
        const payload = (await response.json()) as {
          error?: { message?: string; type?: string };
        };
        errorMessage = payload.error?.message ?? errorMessage;
        upstreamErrorCode = payload.error?.type;
      } catch {
        // Non-JSON error body — use generic message
      }

      throw new GatewayError(errorMessage, {
        code: "provider_upstream_error",
        category: "provider",
        httpStatus: response.status,
        retryable: response.status >= 500 || response.status === 429,
        provider: "anthropic",
        requestId: context.requestId,
        ...(upstreamErrorCode ? { upstreamErrorCode } : {})
      });
    }

    const payload = (await response.json()) as {
      id: string;
      model: string;
      stop_reason?: string | null;
      content: Array<
        | {
            type: "text";
            text: string;
          }
        | {
            type: "tool_use";
            id: string;
            name: string;
            input: unknown;
          }
      >;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
      };
    };

    const content = payload.content ?? [];

    return {
      id: payload.id,
      model: payload.model,
      outputText: content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n"),
      ...(content.some((block) => block.type === "tool_use")
        ? {
            toolCalls: content
              .filter((block) => block.type === "tool_use")
              .map((block) => ({
                id: block.id,
                name: block.name,
                arguments: JSON.stringify(block.input ?? {})
              }))
          }
        : {}),
      finishReason: normalizeAnthropicFinishReason(
        payload.stop_reason ?? undefined
      ),
      ...(payload.usage
        ? {
            usage: {
              inputTokens: payload.usage.input_tokens ?? 0,
              outputTokens: payload.usage.output_tokens ?? 0,
              totalTokens:
                (payload.usage.input_tokens ?? 0) +
                (payload.usage.output_tokens ?? 0)
            }
          }
        : {})
    };
  }

  async *stream(
    request: CanonicalRequest,
    context: ProviderRequestContext
  ): AsyncIterable<CanonicalStreamEvent> {
    const requestBody = buildAnthropicRequestBody(
      request,
      this.#defaultMaxTokens,
      context.requestId,
      true
    );

    const authStrategy: OutboundAuthStrategy = {
      type: "header_value",
      headerName: "x-api-key",
      credential: {
        secretRef: "anthropic-api-key"
      }
    };
    const outboundRequest = this.#signing
      ? await applySigningStrategy(
          applyRequestShaping(
            applyAuthStrategy(
              {
                path: "/messages",
                method: "POST",
                headers: {
                  "anthropic-version": "2023-06-01",
                  "content-type": "application/json"
                },
                query: {},
                jsonBody: requestBody
              },
              authStrategy,
              {
                "anthropic-api-key": this.#apiKey
              }
            ),
            mergeRequestShapingProfiles(this.#shaping, context.requestShaping)
          ),
          this.#signing,
          this.#signingSecrets
        )
      : applyRequestShaping(
          applyAuthStrategy(
            {
              path: "/messages",
              method: "POST",
              headers: {
                "anthropic-version": "2023-06-01",
                "content-type": "application/json"
              },
              query: {},
              jsonBody: requestBody
            },
            authStrategy,
            {
              "anthropic-api-key": this.#apiKey
            }
          ),
          mergeRequestShapingProfiles(this.#shaping, context.requestShaping)
        );
    const abortController = new AbortController();
    context.signal?.addEventListener("abort", () => abortController.abort(), { once: true });
    const timeoutHandle =
      context.timeoutMs !== undefined
        ? setTimeout(() => {
            abortController.abort();
          }, context.timeoutMs)
        : undefined;
    let idleTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const resetIdleTimeout = (): void => {
      if (idleTimeoutHandle !== undefined) {
        clearTimeout(idleTimeoutHandle);
      }
      if (context.streamIdleTimeoutMs !== undefined) {
        idleTimeoutHandle = setTimeout(() => {
          abortController.abort();
        }, context.streamIdleTimeoutMs);
      }
    };
    resetIdleTimeout();

    let response: Response;

    try {
      response = await this.#fetcher(
        buildRequestUrl(this.#baseUrl, outboundRequest),
        {
          method: outboundRequest.method,
          headers: outboundRequest.headers,
          body: JSON.stringify(outboundRequest.jsonBody),
          signal: abortController.signal
        }
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new GatewayError("Upstream provider timed out", {
          code: "provider_timeout",
          category: "provider",
          httpStatus: 504,
          retryable: true,
          provider: "anthropic",
          requestId: context.requestId,
          cause: error
        });
      }

      throw error;
    }

    if (!response.ok) {
      let errorMessage = "Upstream provider error";
      let upstreamErrorCode: string | undefined;
      try {
        const payload = (await response.json()) as {
          error?: { message?: string; type?: string };
        };
        errorMessage = payload.error?.message ?? errorMessage;
        upstreamErrorCode = payload.error?.type;
      } catch {
        // Non-JSON error body — use generic message
      }

      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
      if (idleTimeoutHandle !== undefined) {
        clearTimeout(idleTimeoutHandle);
      }

      throw new GatewayError(errorMessage, {
        code: "provider_upstream_error",
        category: "provider",
        httpStatus: response.status,
        retryable: response.status >= 500 || response.status === 429,
        provider: "anthropic",
        requestId: context.requestId,
        ...(upstreamErrorCode ? { upstreamErrorCode } : {})
      });
    }

    if (!response.body) {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
      if (idleTimeoutHandle !== undefined) {
        clearTimeout(idleTimeoutHandle);
      }

      throw new GatewayError(
        "Upstream provider returned an empty stream body",
        {
          code: "provider_upstream_error",
          category: "provider",
          httpStatus: 502,
          retryable: true,
          provider: "anthropic",
          requestId: context.requestId
        }
      );
    }

    const responseBody = response.body as ReadableStream<Uint8Array>;
    const reader = responseBody.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let activeResponseId = `msg_${context.requestId}`;
    let activeModel = request.model;
    let streamStopReason: string | undefined;
    let usage:
      | {
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
        }
      | undefined;
    const streamedToolCalls = new Map<
      number,
      {
        id: string;
        name: string;
      }
    >();

    try {
      while (true) {
        const readResult = await reader.read();

        if (readResult.done) {
          break;
        }

        const chunk = readResult.value;

        if (!chunk) {
          continue;
        }

        resetIdleTimeout();

        buffer += decoder.decode(chunk, { stream: true });
        assertSseBufferSize(buffer, "anthropic");

        while (true) {
          const separatorIndex = buffer.indexOf("\n\n");

          if (separatorIndex < 0) {
            break;
          }

          const frame = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);
          let currentEventType = "";
          let currentData = "";

          for (const rawLine of frame.split("\n")) {
            const line = rawLine.trim();

            if (line.startsWith("event:")) {
              currentEventType = line.slice("event:".length).trim();
              continue;
            }

            if (line.startsWith("data:")) {
              currentData = line.slice("data:".length).trim();
            }
          }

          if (currentData === "[DONE]") {
            continue;
          }

          let payload: Record<string, unknown>;
          try {
            payload =
              currentData.length > 0
                ? (JSON.parse(currentData) as Record<string, unknown>)
                : {};
          } catch {
            context.malformedSseEventCount =
              (context.malformedSseEventCount ?? 0) + 1;
            continue;
          }

          if (currentEventType === "message_start") {
            const message = payload.message as
              | { id?: string; model?: string }
              | undefined;

            activeResponseId = message?.id ?? activeResponseId;
            activeModel = message?.model ?? activeModel;

            yield {
              type: "response_started",
              responseId: activeResponseId,
              model: activeModel
            };
            continue;
          }

          if (currentEventType === "content_block_delta") {
            const delta = payload.delta as
              | {
                  type?: string;
                  text?: string;
                  partial_json?: string;
                }
              | undefined;
            const index =
              typeof payload.index === "number" ? payload.index : undefined;

            if (delta?.type === "text_delta" && delta.text) {
              yield {
                type: "output_text_delta",
                responseId: activeResponseId,
                model: activeModel,
                delta: delta.text
              };
            }

            if (
              delta?.type === "input_json_delta" &&
              delta.partial_json !== undefined &&
              index !== undefined
            ) {
              const toolCall = streamedToolCalls.get(index);

              if (toolCall) {
                yield {
                  type: "tool_call_delta",
                  responseId: activeResponseId,
                  model: activeModel,
                  toolCallId: toolCall.id,
                  toolIndex: index,
                  toolName: toolCall.name,
                  argumentsDelta: delta.partial_json
                };
              }
            }
            continue;
          }

          if (currentEventType === "content_block_start") {
            const index =
              typeof payload.index === "number" ? payload.index : undefined;
            const contentBlock = payload.content_block as
              | {
                  type?: string;
                  id?: string;
                  name?: string;
                }
              | undefined;

            if (
              index !== undefined &&
              contentBlock?.type === "tool_use" &&
              typeof contentBlock.id === "string" &&
              typeof contentBlock.name === "string"
            ) {
              streamedToolCalls.set(index, {
                id: contentBlock.id,
                name: contentBlock.name
              });

              yield {
                type: "tool_call_delta",
                responseId: activeResponseId,
                model: activeModel,
                toolCallId: contentBlock.id,
                toolIndex: index,
                toolName: contentBlock.name,
                argumentsDelta: ""
              };
            }
            continue;
          }

          if (currentEventType === "message_delta") {
            const delta = payload.delta as
              | {
                  stop_reason?: string | null;
                }
              | undefined;
            const eventUsage = payload.usage as
              | {
                  input_tokens?: number;
                  output_tokens?: number;
                }
              | undefined;

            if (typeof delta?.stop_reason === "string") {
              streamStopReason = delta.stop_reason;
            }

            if (eventUsage) {
              usage = {
                inputTokens: eventUsage.input_tokens ?? 0,
                outputTokens: eventUsage.output_tokens ?? 0,
                totalTokens:
                  (eventUsage.input_tokens ?? 0) +
                  (eventUsage.output_tokens ?? 0)
              };
            }
            continue;
          }

          if (currentEventType === "message_stop") {
            yield {
              type: "response_completed",
              responseId: activeResponseId,
              model: activeModel,
              finishReason: normalizeAnthropicFinishReason(streamStopReason),
              ...(usage ? { usage } : {})
            };
          }
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new GatewayError("Upstream provider timed out", {
          code: "provider_timeout",
          category: "provider",
          httpStatus: 504,
          retryable: true,
          provider: "anthropic",
          requestId: context.requestId,
          cause: error
        });
      }

      throw error;
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
      if (idleTimeoutHandle !== undefined) {
        clearTimeout(idleTimeoutHandle);
      }
      reader.releaseLock();
    }
  }
}
