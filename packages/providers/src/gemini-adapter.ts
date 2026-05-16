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

export interface GeminiProviderAdapterOptions {
  apiKey: string;
  baseUrl: string;
  shaping?: RequestShapingProfile;
  signing?: OutboundSigningStrategy;
  signingSecrets?: Record<string, string>;
  fetcher?: typeof fetch;
}

export class GeminiProviderAdapter implements ProviderAdapter {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #shaping: RequestShapingProfile;
  readonly #signing: OutboundSigningStrategy | undefined;
  readonly #signingSecrets: Record<string, string>;
  readonly #fetcher: typeof fetch;

  constructor(options: GeminiProviderAdapterOptions) {
    this.#apiKey = options.apiKey;
    this.#baseUrl = options.baseUrl.replace(/\/$/, "");
    this.#shaping = options.shaping ?? {};
    this.#signing = options.signing;
    this.#signingSecrets = options.signingSecrets ?? {};
    this.#fetcher = options.fetcher ?? fetch;
  }

  async complete(
    request: CanonicalRequest,
    context: ProviderRequestContext
  ): Promise<CanonicalResponse> {
    const requestBody = buildGeminiRequestBody(request);

    const authStrategy: OutboundAuthStrategy = {
      type: "header_value",
      headerName: "x-goog-api-key",
      credential: {
        secretRef: "gemini-api-key"
      }
    };
    const outboundRequest = this.#signing
      ? await applySigningStrategy(
          applyRequestShaping(
            applyAuthStrategy(
              {
                path: `/models/${request.model}:generateContent`,
                method: "POST",
                headers: {
                  "content-type": "application/json"
                },
                query: {},
                jsonBody: requestBody
              },
              authStrategy,
              {
                "gemini-api-key": this.#apiKey
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
              path: `/models/${request.model}:generateContent`,
              method: "POST",
              headers: {
                "content-type": "application/json"
              },
              query: {},
              jsonBody: requestBody
            },
            authStrategy,
            {
              "gemini-api-key": this.#apiKey
            }
          ),
          mergeRequestShapingProfiles(this.#shaping, context.requestShaping)
        );
    const abortController = new AbortController();
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
          provider: "gemini",
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
      try {
        const payload = (await response.json()) as {
          error?: { message?: string };
        };
        errorMessage = payload.error?.message ?? errorMessage;
      } catch {
        // Non-JSON error body — use generic message
      }

      throw new GatewayError(errorMessage, {
        code: "provider_upstream_error",
        category: "provider",
        httpStatus: response.status,
        retryable: response.status >= 500 || response.status === 429,
        provider: "gemini",
        requestId: context.requestId
      });
    }

    const payload = (await response.json()) as {
      responseId?: string;
      modelVersion?: string;
      candidates?: Array<{
        finishReason?: string;
        content?: {
          parts?: Array<{
            text?: string;
          }>;
        };
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };

    const candidate = payload.candidates?.[0];
    const outputText =
      candidate?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("")
        .trim() ?? "";
    const toolCalls = extractGeminiToolCalls(candidate?.content?.parts);
    const finishReason =
      toolCalls.length > 0
        ? "tool_calls"
        : (normalizeGeminiFinishReason(candidate?.finishReason) ?? "stop");

    return {
      id: payload.responseId ?? `gemini_${context.requestId}`,
      model: payload.modelVersion ?? request.model,
      outputText,
      finishReason,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(payload.usageMetadata
        ? {
            usage: {
              inputTokens: payload.usageMetadata.promptTokenCount ?? 0,
              outputTokens: payload.usageMetadata.candidatesTokenCount ?? 0,
              totalTokens:
                payload.usageMetadata.totalTokenCount ??
                (payload.usageMetadata.promptTokenCount ?? 0) +
                  (payload.usageMetadata.candidatesTokenCount ?? 0)
            }
          }
        : {})
    };
  }

  async *stream(
    request: CanonicalRequest,
    context: ProviderRequestContext
  ): AsyncIterable<CanonicalStreamEvent> {
    const requestBody = buildGeminiRequestBody(request);
    const authStrategy: OutboundAuthStrategy = {
      type: "header_value",
      headerName: "x-goog-api-key",
      credential: {
        secretRef: "gemini-api-key"
      }
    };
    const outboundRequest = this.#signing
      ? await applySigningStrategy(
          applyRequestShaping(
            applyAuthStrategy(
              {
                path: `/models/${request.model}:streamGenerateContent`,
                method: "POST",
                headers: {
                  "content-type": "application/json"
                },
                query: {
                  alt: "sse"
                },
                jsonBody: requestBody
              },
              authStrategy,
              {
                "gemini-api-key": this.#apiKey
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
              path: `/models/${request.model}:streamGenerateContent`,
              method: "POST",
              headers: {
                "content-type": "application/json"
              },
              query: {
                alt: "sse"
              },
              jsonBody: requestBody
            },
            authStrategy,
            {
              "gemini-api-key": this.#apiKey
            }
          ),
          mergeRequestShapingProfiles(this.#shaping, context.requestShaping)
        );
    const abortController = new AbortController();
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
          provider: "gemini",
          requestId: context.requestId,
          cause: error
        });
      }

      throw error;
    }

    if (!response.ok) {
      let errorMessage = "Upstream provider error";
      try {
        const payload = (await response.json()) as {
          error?: { message?: string };
        };
        errorMessage = payload.error?.message ?? errorMessage;
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
        provider: "gemini",
        requestId: context.requestId
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
          provider: "gemini",
          requestId: context.requestId
        }
      );
    }

    const responseBody = response.body as ReadableStream<Uint8Array>;
    const reader = responseBody.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let activeResponseId = `gemini_${context.requestId}`;
    let activeModel = request.model;
    let hasStarted = false;
    let sawToolCall = false;
    let nextToolIndex = 0;
    const toolCallsById = new Map<
      string,
      {
        id: string;
        name: string;
        arguments: string;
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

        while (true) {
          const separatorIndex = buffer.indexOf("\n\n");

          if (separatorIndex < 0) {
            break;
          }

          const frame = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);

          for (const rawLine of frame.split("\n")) {
            const line = rawLine.trim();

            if (!line.startsWith("data:")) {
              continue;
            }

            const data = line.slice("data:".length).trim();

            if (data === "[DONE]" || data.length === 0) {
              continue;
            }

            let payload: GeminiGenerateContentResponse;
            try {
              payload = JSON.parse(data) as GeminiGenerateContentResponse;
            } catch {
              continue;
            }
            const responseId = payload.responseId ?? activeResponseId;
            const model = payload.modelVersion ?? activeModel;
            const candidate = payload.candidates?.[0];
            const parts = candidate?.content?.parts ?? [];
            const deltaText = parts.map((part) => part.text ?? "").join("");

            activeResponseId = responseId;
            activeModel = model;

            if (!hasStarted) {
              hasStarted = true;
              yield {
                type: "response_started",
                responseId,
                model
              };
            }

            if (deltaText.length > 0) {
              yield {
                type: "output_text_delta",
                responseId,
                model,
                delta: deltaText
              };
            }

            for (const part of parts) {
              if (!part.functionCall?.name) {
                continue;
              }

              sawToolCall = true;
              const toolIndex = nextToolIndex;
              nextToolIndex += 1;
              const argumentsPayload =
                part.functionCall.args === undefined
                  ? ""
                  : JSON.stringify(part.functionCall.args);
              const toolCall = {
                id: `${responseId}_tool_${toolIndex}`,
                name: part.functionCall.name,
                arguments: argumentsPayload
              };
              toolCallsById.set(toolCall.id, toolCall);

              yield {
                type: "tool_call_delta",
                responseId,
                model,
                toolCallId: toolCall.id,
                toolIndex,
                toolName: toolCall.name,
                argumentsDelta: toolCall.arguments
              };
            }

            const normalizedFinishReason = normalizeGeminiFinishReason(
              candidate?.finishReason
            );

            if (
              normalizedFinishReason === "stop" ||
              normalizedFinishReason === "max_tokens"
            ) {
              yield {
                type: "response_completed",
                responseId,
                model,
                finishReason: sawToolCall
                  ? "tool_calls"
                  : (normalizedFinishReason ?? "stop"),
                ...(toolCallsById.size > 0
                  ? { toolCalls: Array.from(toolCallsById.values()) }
                  : {}),
                ...(payload.usageMetadata
                  ? {
                      usage: {
                        inputTokens:
                          payload.usageMetadata.promptTokenCount ?? 0,
                        outputTokens:
                          payload.usageMetadata.candidatesTokenCount ?? 0,
                        totalTokens:
                          payload.usageMetadata.totalTokenCount ??
                          (payload.usageMetadata.promptTokenCount ?? 0) +
                            (payload.usageMetadata.candidatesTokenCount ?? 0)
                      }
                    }
                  : {})
              };
            }
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
          provider: "gemini",
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

interface GeminiContentPart {
  text?: string;
  functionCall?: {
    name?: string;
    args?: Record<string, unknown>;
  };
  functionResponse?: {
    name?: string;
    response?: Record<string, unknown>;
  };
}

interface GeminiCandidate {
  finishReason?: string;
  content?: {
    parts?: GeminiContentPart[];
  };
}

interface GeminiGenerateContentResponse {
  responseId?: string;
  modelVersion?: string;
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

function buildGeminiRequestBody(request: CanonicalRequest) {
  const systemMessages = request.messages.filter((message) => {
    return message.role === "system";
  });
  const declaredToolNames = new Set(
    request.tools?.map((tool) => tool.name) ?? []
  );
  const contents = request.messages
    .filter((message) => message.role !== "system")
    .map((message) => {
      if (message.role === "assistant") {
        if (message.toolCalls && message.toolCalls.length > 0) {
          return {
            role: "model" as const,
            parts: [
              ...(message.content.length > 0
                ? [
                    {
                      text: message.content
                    }
                  ]
                : []),
              ...message.toolCalls.map((toolCall) => ({
                functionCall: {
                  name: toolCall.name,
                  ...(toolCall.arguments.length > 0
                    ? {
                        args: parseGeminiToolArguments(
                          toolCall.arguments,
                          toolCall.name
                        )
                      }
                    : {})
                }
              }))
            ]
          };
        }

        return {
          role: "model" as const,
          parts: [
            {
              text: message.content
            }
          ]
        };
      }

      if (message.role === "tool") {
        const matchingToolCall = request.messages
          .filter(
            (
              candidate
            ): candidate is Extract<
              CanonicalRequest["messages"][number],
              { role: "assistant" }
            > => {
              return candidate.role === "assistant";
            }
          )
          .flatMap((candidate) => candidate.toolCalls ?? [])
          .find((toolCall) => toolCall.id === message.toolCallId);

        if (
          !matchingToolCall ||
          !declaredToolNames.has(matchingToolCall.name)
        ) {
          throw new GatewayError(
            "Provider gemini cannot encode tool replay without a matching declared tool definition",
            {
              code: "request_invalid_tool_arguments",
              category: "request",
              httpStatus: 400,
              retryable: false
            }
          );
        }

        return {
          role: "user" as const,
          parts: [
            {
              functionResponse: {
                name: matchingToolCall.name,
                response: parseGeminiToolResponse(message.content)
              }
            }
          ]
        };
      }

      return {
        role: "user" as const,
        parts: [
          {
            text: message.content
          }
        ]
      };
    });

  return {
    ...(systemMessages.length > 0
      ? {
          system_instruction: {
            parts: systemMessages.map((message) => ({
              text: message.content
            }))
          }
        }
      : {}),
    contents,
    ...(request.tools && request.tools.length > 0
      ? {
          tools: [
            {
              functionDeclarations: request.tools.map((tool) => ({
                name: tool.name,
                ...(tool.description ? { description: tool.description } : {}),
                parameters: tool.inputSchema
              }))
            }
          ],
          toolConfig: {
            functionCallingConfig:
              request.toolChoice === "required"
                ? { mode: "ANY" as const }
                : request.toolChoice === "none"
                  ? { mode: "NONE" as const }
                  : typeof request.toolChoice === "object" &&
                      request.toolChoice.type === "tool"
                    ? {
                        mode: "ANY" as const,
                        allowedFunctionNames: [request.toolChoice.name]
                      }
                    : { mode: "AUTO" as const }
          }
        }
      : {}),
    ...(request.maxOutputTokens !== undefined ||
    request.outputFormat !== undefined ||
    request.temperature !== undefined ||
    request.topP !== undefined ||
    request.stopSequences !== undefined
      ? {
          generationConfig: {
            ...(request.maxOutputTokens !== undefined
              ? { maxOutputTokens: request.maxOutputTokens }
              : {}),
            ...(request.outputFormat?.type === "json_object"
              ? { responseMimeType: "application/json" }
              : {}),
            ...(request.outputFormat?.type === "json_schema"
              ? {
                  responseMimeType: "application/json",
                  responseJsonSchema: request.outputFormat.schema
                }
              : {}),
            ...(request.temperature !== undefined
              ? { temperature: request.temperature }
              : {}),
            ...(request.topP !== undefined ? { topP: request.topP } : {}),
            ...(request.stopSequences !== undefined
              ? { stopSequences: request.stopSequences }
              : {})
          }
        }
      : {})
  };
}

function extractGeminiToolCalls(parts: GeminiContentPart[] | undefined) {
  if (!parts) {
    return [];
  }

  let toolIndex = 0;

  return parts.flatMap((part) => {
    if (!part.functionCall?.name) {
      return [];
    }

    const toolCallId = `gemini_call_${toolIndex}`;
    toolIndex += 1;

    return [
      {
        id: toolCallId,
        name: part.functionCall.name,
        arguments:
          part.functionCall.args === undefined
            ? ""
            : JSON.stringify(part.functionCall.args)
      }
    ];
  });
}

function parseGeminiToolArguments(
  value: string,
  toolName: string
): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new Error("Tool arguments must be a JSON object");
    }

    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new GatewayError(
      `Provider gemini cannot encode tool replay for ${toolName}: tool arguments must be a JSON object`,
      {
        code: "request_invalid_tool_arguments",
        category: "request",
        httpStatus: 400,
        retryable: false,
        cause: error
      }
    );
  }
}

function parseGeminiToolResponse(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return {
        result: parsed
      };
    }

    return parsed as Record<string, unknown>;
  } catch {
    return {
      result: value
    };
  }
}

function normalizeGeminiFinishReason(
  finishReason: string | undefined
): "stop" | "max_tokens" | undefined {
  if (!finishReason) {
    return undefined;
  }

  const normalized = finishReason.toUpperCase();

  if (normalized === "STOP") {
    return "stop";
  }

  if (normalized === "MAX_TOKENS") {
    return "max_tokens";
  }

  return undefined;
}
