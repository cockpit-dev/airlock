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

function normalizeOpenAIFinishReason(
  finishReason: "stop" | "length" | "tool_calls" | null | undefined
): "stop" | "max_tokens" | "tool_calls" {
  if (finishReason === "tool_calls") {
    return "tool_calls";
  }

  return finishReason === "length" ? "max_tokens" : "stop";
}

function normalizeOpenAIMessageContent(
  content: string | null | undefined
) {
  return content ?? "";
}

function mapCanonicalToolChoiceToOpenAI(
  toolChoice: CanonicalRequest["toolChoice"]
) {
  if (toolChoice === undefined) {
    return undefined;
  }

  if (toolChoice === "auto") {
    return "auto" as const;
  }

  return {
    type: "function" as const,
    function: {
      name: toolChoice.name
    }
  };
}

function buildOpenAIChatMessages(
  request: CanonicalRequest
) {
  return request.messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool" as const,
        tool_call_id: message.toolCallId,
        content: message.content
      };
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant" as const,
        content: message.content,
        tool_calls: message.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: "function" as const,
          function: {
            name: toolCall.name,
            arguments: toolCall.arguments
          }
        }))
      };
    }

    return {
      role: message.role,
      content: message.content
    };
  });
}

export interface OpenAIProviderAdapterOptions {
  apiKey: string;
  baseUrl: string;
  shaping?: RequestShapingProfile;
  signing?: OutboundSigningStrategy;
  signingSecrets?: Record<string, string>;
  fetcher?: typeof fetch;
}

export class OpenAIProviderAdapter implements ProviderAdapter {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #shaping: RequestShapingProfile;
  readonly #signing: OutboundSigningStrategy | undefined;
  readonly #signingSecrets: Record<string, string>;
  readonly #fetcher: typeof fetch;

  constructor(options: OpenAIProviderAdapterOptions) {
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
    const authStrategy: OutboundAuthStrategy = {
      type: "header_bearer",
      headerName: "authorization",
      credential: {
        secretRef: "openai-api-key"
      }
    };
    const outboundRequest = this.#signing
      ? await applySigningStrategy(
          applyRequestShaping(
            applyAuthStrategy(
              {
                path: "/chat/completions",
                method: "POST",
                headers: {
                  "content-type": "application/json"
                },
                query: {},
                jsonBody: {
                  model: request.model,
                  stream: false,
                  messages: buildOpenAIChatMessages(request),
                  ...(request.maxOutputTokens !== undefined
                    ? { max_tokens: request.maxOutputTokens }
                    : {}),
                  ...(request.temperature !== undefined
                    ? { temperature: request.temperature }
                    : {}),
                  ...(request.topP !== undefined ? { top_p: request.topP } : {}),
                  ...(request.stopSequences !== undefined
                    ? { stop: request.stopSequences }
                    : {}),
                  ...(request.tools !== undefined
                    ? {
                        tools: request.tools.map((tool) => ({
                          type: "function" as const,
                          function: {
                            name: tool.name,
                            ...(tool.description
                              ? { description: tool.description }
                              : {}),
                            parameters: tool.inputSchema
                          }
                        }))
                      }
                    : {}),
                  ...(mapCanonicalToolChoiceToOpenAI(request.toolChoice)
                    ? {
                        tool_choice: mapCanonicalToolChoiceToOpenAI(
                          request.toolChoice
                        )
                      }
                    : {})
                }
              },
              authStrategy,
              {
                "openai-api-key": this.#apiKey
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
              path: "/chat/completions",
              method: "POST",
              headers: {
                "content-type": "application/json"
              },
              query: {},
              jsonBody: {
                model: request.model,
                stream: false,
                messages: buildOpenAIChatMessages(request),
                ...(request.maxOutputTokens !== undefined
                  ? { max_tokens: request.maxOutputTokens }
                  : {}),
                ...(request.temperature !== undefined
                  ? { temperature: request.temperature }
                  : {}),
                ...(request.topP !== undefined ? { top_p: request.topP } : {}),
                ...(request.stopSequences !== undefined
                  ? { stop: request.stopSequences }
                  : {}),
                ...(request.tools !== undefined
                  ? {
                      tools: request.tools.map((tool) => ({
                        type: "function" as const,
                        function: {
                          name: tool.name,
                          ...(tool.description ? { description: tool.description } : {}),
                          parameters: tool.inputSchema
                        }
                      }))
                    }
                  : {}),
                ...(mapCanonicalToolChoiceToOpenAI(request.toolChoice)
                  ? {
                      tool_choice: mapCanonicalToolChoiceToOpenAI(
                        request.toolChoice
                      )
                    }
                  : {})
              }
            },
            authStrategy,
            {
              "openai-api-key": this.#apiKey
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
      response = await this.#fetcher(buildRequestUrl(this.#baseUrl, outboundRequest), {
        method: outboundRequest.method,
        headers: outboundRequest.headers,
        body: JSON.stringify(outboundRequest.jsonBody),
        signal: abortController.signal
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new GatewayError("Upstream provider timed out", {
          code: "provider_timeout",
          category: "provider",
          httpStatus: 504,
          retryable: true,
          provider: "openai",
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
      const payload = (await response.json()) as {
        error?: { message?: string };
      };

      throw new GatewayError(payload.error?.message ?? "Upstream provider error", {
        code: "provider_upstream_error",
        category: "provider",
        httpStatus: response.status,
        retryable: response.status >= 500 || response.status === 429,
        provider: "openai",
        requestId: context.requestId
      });
    }

    const payload = (await response.json()) as {
      id: string;
      model: string;
      choices: Array<{
        finish_reason: "stop" | "length" | "tool_calls";
        message: {
          content: string | null;
          tool_calls?: Array<{
            id: string;
            type: "function";
            function: {
              name: string;
              arguments: string;
            };
          }>;
        };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    return {
      id: payload.id,
      model: payload.model,
      outputText: normalizeOpenAIMessageContent(payload.choices[0]?.message.content),
      ...(payload.choices[0]?.message.tool_calls
        ? {
            toolCalls: payload.choices[0].message.tool_calls.map((toolCall) => ({
              id: toolCall.id,
              name: toolCall.function.name,
              arguments: toolCall.function.arguments
            }))
          }
        : {}),
      finishReason: payload.choices[0]?.message.tool_calls?.length
        ? "tool_calls"
        : normalizeOpenAIFinishReason(payload.choices[0]?.finish_reason),
      ...(payload.usage
        ? {
            usage: {
              inputTokens: payload.usage.prompt_tokens ?? 0,
              outputTokens: payload.usage.completion_tokens ?? 0,
              totalTokens:
                payload.usage.total_tokens ??
                (payload.usage.prompt_tokens ?? 0) +
                  (payload.usage.completion_tokens ?? 0)
            }
          }
        : {})
    };
  }

  async *stream(
    request: CanonicalRequest,
    context: ProviderRequestContext
  ): AsyncIterable<CanonicalStreamEvent> {
    const authStrategy: OutboundAuthStrategy = {
      type: "header_bearer",
      headerName: "authorization",
      credential: {
        secretRef: "openai-api-key"
      }
    };
    const outboundRequest = this.#signing
      ? await applySigningStrategy(
          applyRequestShaping(
            applyAuthStrategy(
              {
                path: "/chat/completions",
                method: "POST",
                headers: {
                  "content-type": "application/json"
                },
                query: {},
                jsonBody: {
                  model: request.model,
                  stream: true,
                  messages: buildOpenAIChatMessages(request),
                  ...(request.maxOutputTokens !== undefined
                    ? { max_tokens: request.maxOutputTokens }
                    : {}),
                  ...(request.temperature !== undefined
                    ? { temperature: request.temperature }
                    : {}),
                  ...(request.topP !== undefined ? { top_p: request.topP } : {}),
                  ...(request.stopSequences !== undefined
                    ? { stop: request.stopSequences }
                    : {}),
                  stream_options: {
                    include_usage: true
                  }
                }
              },
              authStrategy,
              {
                "openai-api-key": this.#apiKey
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
              path: "/chat/completions",
              method: "POST",
              headers: {
                "content-type": "application/json"
              },
              query: {},
                jsonBody: {
                  model: request.model,
                  stream: true,
                  messages: buildOpenAIChatMessages(request),
                ...(request.maxOutputTokens !== undefined
                  ? { max_tokens: request.maxOutputTokens }
                  : {}),
                ...(request.temperature !== undefined
                  ? { temperature: request.temperature }
                  : {}),
                ...(request.topP !== undefined ? { top_p: request.topP } : {}),
                ...(request.stopSequences !== undefined
                  ? { stop: request.stopSequences }
                  : {}),
                stream_options: {
                  include_usage: true
                }
              }
            },
            authStrategy,
            {
              "openai-api-key": this.#apiKey
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
      response = await this.#fetcher(buildRequestUrl(this.#baseUrl, outboundRequest), {
        method: outboundRequest.method,
        headers: outboundRequest.headers,
        body: JSON.stringify(outboundRequest.jsonBody),
        signal: abortController.signal
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new GatewayError("Upstream provider timed out", {
          code: "provider_timeout",
          category: "provider",
          httpStatus: 504,
          retryable: true,
          provider: "openai",
          requestId: context.requestId,
          cause: error
        });
      }

      throw error;
    }

    if (!response.ok) {
      const payload = (await response.json()) as {
        error?: { message?: string };
      };

      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }

      throw new GatewayError(payload.error?.message ?? "Upstream provider error", {
        code: "provider_upstream_error",
        category: "provider",
        httpStatus: response.status,
        retryable: response.status >= 500 || response.status === 429,
        provider: "openai",
        requestId: context.requestId
      });
    }

    if (!response.body) {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }

      throw new GatewayError("Upstream provider returned an empty stream body", {
        code: "provider_upstream_error",
        category: "provider",
        httpStatus: 502,
        retryable: true,
        provider: "openai",
        requestId: context.requestId
      });
    }

    const responseBody = response.body as ReadableStream<Uint8Array>;
    const reader = responseBody.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let hasStarted = false;

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

            if (data === "[DONE]") {
              continue;
            }

            const payload = JSON.parse(data) as {
              id?: string;
              model?: string;
              choices?: Array<{
                delta?: {
                  role?: "assistant";
                  content?: string;
                };
                finish_reason?: "stop" | "length" | null;
              }>;
              usage?: {
                prompt_tokens?: number;
                completion_tokens?: number;
                total_tokens?: number;
              };
            };
            const choice = payload.choices?.[0];
            const responseId = payload.id ?? `chatcmpl_${context.requestId}`;
            const model = payload.model ?? request.model;

            if (!hasStarted) {
              hasStarted = true;
              yield {
                type: "response_started",
                responseId,
                model
              };
            }

            if (choice?.delta?.content) {
              yield {
                type: "output_text_delta",
                responseId,
                model,
                delta: choice.delta.content
              };
            }

            if (choice?.finish_reason === "stop" || choice?.finish_reason === "length") {
              yield {
                type: "response_completed",
                responseId,
                model,
                finishReason: normalizeOpenAIFinishReason(choice.finish_reason),
                ...(payload.usage
                  ? {
                      usage: {
                        inputTokens: payload.usage.prompt_tokens ?? 0,
                        outputTokens: payload.usage.completion_tokens ?? 0,
                        totalTokens:
                          payload.usage.total_tokens ??
                          (payload.usage.prompt_tokens ?? 0) +
                            (payload.usage.completion_tokens ?? 0)
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
          provider: "openai",
          requestId: context.requestId,
          cause: error
        });
      }

      throw error;
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
      reader.releaseLock();
    }
  }
}
