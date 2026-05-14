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

  if (toolChoice === "required") {
    return "required" as const;
  }

  if (toolChoice === "none") {
    return "none" as const;
  }

  return {
    type: "function" as const,
    function: {
      name: toolChoice.name
    }
  };
}

function mapCanonicalToolChoiceToOpenAIResponses(
  toolChoice: CanonicalRequest["toolChoice"]
) {
  if (toolChoice === undefined) {
    return undefined;
  }

  if (toolChoice === "auto") {
    return "auto" as const;
  }

  if (toolChoice === "required") {
    return "required" as const;
  }

  if (toolChoice === "none") {
    return "none" as const;
  }

  return {
    type: "function" as const,
    name: toolChoice.name
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

function buildOpenAIResponsesInput(
  request: CanonicalRequest
) {
  type OpenAIResponsesInputItem =
    | {
        type: "function_call_output";
        call_id: string;
        output: string;
      }
    | {
        type: "function_call";
        call_id: string;
        name: string;
        arguments: string;
      }
    | {
        type: "message";
        role: "system" | "user";
        content: string;
      }
    | {
        type: "message";
        role: "assistant";
        content: Array<{
          type: "output_text";
          text: string;
        }>;
      };

  return request.messages.flatMap<OpenAIResponsesInputItem>((message) => {
    if (message.role === "tool") {
      return [
        {
          type: "function_call_output" as const,
          call_id: message.toolCallId,
          output: message.content
        }
      ];
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      return [
        ...(message.content.length > 0
          ? [
              {
                type: "message" as const,
                role: "assistant" as const,
                content: [
                  {
                    type: "output_text" as const,
                    text: message.content
                  }
                ]
              }
            ]
          : []),
        ...message.toolCalls.map((toolCall) => ({
          type: "function_call" as const,
          call_id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments
        }))
      ];
    }

    if (message.role === "assistant") {
      return [
        {
          type: "message" as const,
          role: "assistant" as const,
          content: [
            {
              type: "output_text" as const,
              text: message.content
            }
          ]
        }
      ];
    }

    return [
      {
        type: "message" as const,
        role: message.role,
        content: message.content
      }
    ];
  });
}

function normalizeOpenAIResponsesFinishReason(
  status: string | undefined,
  incompleteReason: string | undefined,
  hasToolCalls: boolean
): "stop" | "max_tokens" | "tool_calls" {
  if (hasToolCalls) {
    return "tool_calls";
  }

  if (status === "incomplete" && incompleteReason === "max_output_tokens") {
    return "max_tokens";
  }

  return "stop";
}

function extractOutputTextFromOpenAIResponsesOutput(
  output:
    | Array<{
        type?: string;
        role?: string;
        content?: Array<{
          type?: string;
          text?: string;
        }>;
      }>
    | undefined
) {
  return (
    output
      ?.filter((item) => item.type === "message" && item.role === "assistant")
      .flatMap((item) => item.content ?? [])
      .filter((part) => part.type === "output_text")
      .map((part) => part.text ?? "")
      .join("") ?? ""
  );
}

function extractToolCallsFromOpenAIResponsesOutput(
  output:
    | Array<{
        type?: string;
        call_id?: string;
        name?: string;
        arguments?: string;
      }>
    | undefined
) {
  const toolCalls = output
    ?.filter((item) => item.type === "function_call")
    .map((item) => ({
      id: item.call_id ?? "",
      name: item.name ?? "tool_call",
      arguments: item.arguments ?? ""
    }))
    .filter((item) => item.id.length > 0);

  return toolCalls && toolCalls.length > 0 ? toolCalls : undefined;
}

interface OpenAIChatLikeUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface OpenAIResponsesLikeUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

function isOpenAIResponsesLikeUsage(
  usage: OpenAIChatLikeUsage | OpenAIResponsesLikeUsage | undefined
): usage is OpenAIResponsesLikeUsage {
  return usage !== undefined && "input_tokens" in usage;
}

function isOpenAIChatLikeUsage(
  usage: OpenAIChatLikeUsage | OpenAIResponsesLikeUsage | undefined
): usage is OpenAIChatLikeUsage {
  return usage !== undefined && "prompt_tokens" in usage;
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
    if (context.requestMode === "openai_responses") {
      return this.#completeResponses(request, context);
    }

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
    if (context.requestMode === "openai_responses") {
      yield* this.#streamResponses(request, context);
      return;
    }

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
    const streamedToolCalls = new Map<
      number,
      {
        id: string;
        name?: string;
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
                  tool_calls?: Array<{
                    index?: number;
                    id?: string;
                    type?: "function";
                    function?: {
                      name?: string;
                      arguments?: string;
                    };
                  }>;
                };
                finish_reason?: "stop" | "length" | "tool_calls" | null;
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

            for (const toolCallDelta of choice?.delta?.tool_calls ?? []) {
              const toolIndex = toolCallDelta.index ?? 0;
              const currentTool = streamedToolCalls.get(toolIndex) ?? {
                id: toolCallDelta.id ?? `${responseId}_tool_call_${toolIndex}`
              };

              if (toolCallDelta.id) {
                currentTool.id = toolCallDelta.id;
              }

              if (toolCallDelta.function?.name) {
                currentTool.name = toolCallDelta.function.name;
              }

              streamedToolCalls.set(toolIndex, currentTool);

              if (
                toolCallDelta.function?.arguments !== undefined ||
                toolCallDelta.id !== undefined ||
                toolCallDelta.function?.name !== undefined
              ) {
                yield {
                  type: "tool_call_delta",
                  responseId,
                  model,
                  toolCallId: currentTool.id,
                  toolIndex,
                  ...(currentTool.name ? { toolName: currentTool.name } : {}),
                  argumentsDelta: toolCallDelta.function?.arguments ?? ""
                };
              }
            }

            if (
              choice?.finish_reason === "stop" ||
              choice?.finish_reason === "length" ||
              choice?.finish_reason === "tool_calls"
            ) {
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

  async #completeResponses(
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
                path: "/responses",
                method: "POST",
                headers: {
                  "content-type": "application/json"
                },
                query: {},
                jsonBody: {
                  model: request.model,
                  stream: false,
                  input: buildOpenAIResponsesInput(request),
                  ...(request.previousResponseId !== undefined
                    ? { previous_response_id: request.previousResponseId }
                    : {}),
                  ...(request.conversationId !== undefined
                    ? { conversation: request.conversationId }
                    : {}),
                  ...(request.maxOutputTokens !== undefined
                    ? { max_output_tokens: request.maxOutputTokens }
                    : {}),
                  ...(request.temperature !== undefined
                    ? { temperature: request.temperature }
                    : {}),
                  ...(request.topP !== undefined ? { top_p: request.topP } : {}),
                  ...(request.tools !== undefined
                    ? {
                        tools: request.tools.map((tool) => ({
                          type: "function" as const,
                          name: tool.name,
                          ...(tool.description
                            ? { description: tool.description }
                            : {}),
                          parameters: tool.inputSchema
                        }))
                      }
                    : {}),
                  ...(mapCanonicalToolChoiceToOpenAIResponses(request.toolChoice)
                    ? {
                        tool_choice: mapCanonicalToolChoiceToOpenAIResponses(
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
              path: "/responses",
              method: "POST",
              headers: {
                "content-type": "application/json"
              },
              query: {},
              jsonBody: {
                model: request.model,
                stream: false,
                input: buildOpenAIResponsesInput(request),
                ...(request.previousResponseId !== undefined
                  ? { previous_response_id: request.previousResponseId }
                  : {}),
                ...(request.conversationId !== undefined
                  ? { conversation: request.conversationId }
                  : {}),
                ...(request.maxOutputTokens !== undefined
                  ? { max_output_tokens: request.maxOutputTokens }
                  : {}),
                ...(request.temperature !== undefined
                  ? { temperature: request.temperature }
                  : {}),
                ...(request.topP !== undefined ? { top_p: request.topP } : {}),
                ...(request.tools !== undefined
                  ? {
                      tools: request.tools.map((tool) => ({
                        type: "function" as const,
                        name: tool.name,
                        ...(tool.description ? { description: tool.description } : {}),
                        parameters: tool.inputSchema
                      }))
                    }
                  : {}),
                ...(mapCanonicalToolChoiceToOpenAIResponses(request.toolChoice)
                  ? {
                      tool_choice: mapCanonicalToolChoiceToOpenAIResponses(
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
      choices?: Array<{
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
      usage?: OpenAIChatLikeUsage | OpenAIResponsesLikeUsage;
      status?: string;
      incomplete_details?: {
        reason?: string;
      };
      output?: Array<{
        type?: string;
        role?: string;
        call_id?: string;
        name?: string;
        arguments?: string;
        content?: Array<{
          type?: string;
          text?: string;
        }>;
      }>;
    };

    if (payload.choices) {
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
        ...(isOpenAIChatLikeUsage(payload.usage)
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

    const toolCalls = extractToolCallsFromOpenAIResponsesOutput(payload.output);

    return {
      id: payload.id,
      model: payload.model,
      outputText: extractOutputTextFromOpenAIResponsesOutput(payload.output),
      ...(toolCalls ? { toolCalls } : {}),
      finishReason: normalizeOpenAIResponsesFinishReason(
        payload.status,
        payload.incomplete_details?.reason,
        (toolCalls?.length ?? 0) > 0
      ),
      ...(isOpenAIResponsesLikeUsage(payload.usage)
        ? {
            usage: {
              inputTokens: payload.usage.input_tokens ?? 0,
              outputTokens: payload.usage.output_tokens ?? 0,
              totalTokens:
                payload.usage.total_tokens ??
                (payload.usage.input_tokens ?? 0) +
                  (payload.usage.output_tokens ?? 0)
            }
          }
        : {})
    };
  }

  async *#streamResponses(
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
                path: "/responses",
                method: "POST",
                headers: {
                  "content-type": "application/json"
                },
                query: {},
                jsonBody: {
                  model: request.model,
                  stream: true,
                  input: buildOpenAIResponsesInput(request),
                  ...(request.previousResponseId !== undefined
                    ? { previous_response_id: request.previousResponseId }
                    : {}),
                  ...(request.conversationId !== undefined
                    ? { conversation: request.conversationId }
                    : {}),
                  ...(request.maxOutputTokens !== undefined
                    ? { max_output_tokens: request.maxOutputTokens }
                    : {}),
                  ...(request.temperature !== undefined
                    ? { temperature: request.temperature }
                    : {}),
                  ...(request.topP !== undefined ? { top_p: request.topP } : {}),
                  ...(request.tools !== undefined
                    ? {
                        tools: request.tools.map((tool) => ({
                          type: "function" as const,
                          name: tool.name,
                          ...(tool.description
                            ? { description: tool.description }
                            : {}),
                          parameters: tool.inputSchema
                        }))
                      }
                    : {}),
                  ...(mapCanonicalToolChoiceToOpenAIResponses(request.toolChoice)
                    ? {
                        tool_choice: mapCanonicalToolChoiceToOpenAIResponses(
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
              path: "/responses",
              method: "POST",
              headers: {
                "content-type": "application/json"
              },
              query: {},
              jsonBody: {
                model: request.model,
                stream: true,
                input: buildOpenAIResponsesInput(request),
                ...(request.previousResponseId !== undefined
                  ? { previous_response_id: request.previousResponseId }
                  : {}),
                ...(request.conversationId !== undefined
                  ? { conversation: request.conversationId }
                  : {}),
                ...(request.maxOutputTokens !== undefined
                  ? { max_output_tokens: request.maxOutputTokens }
                  : {}),
                ...(request.temperature !== undefined
                  ? { temperature: request.temperature }
                  : {}),
                ...(request.topP !== undefined ? { top_p: request.topP } : {}),
                ...(request.tools !== undefined
                  ? {
                      tools: request.tools.map((tool) => ({
                        type: "function" as const,
                        name: tool.name,
                        ...(tool.description ? { description: tool.description } : {}),
                        parameters: tool.inputSchema
                      }))
                    }
                  : {}),
                ...(mapCanonicalToolChoiceToOpenAIResponses(request.toolChoice)
                  ? {
                      tool_choice: mapCanonicalToolChoiceToOpenAIResponses(
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
    const responseIdToModel = new Map<string, string>();
    const streamedToolCalls = new Map<
      string,
      {
        outputIndex: number;
        name?: string;
      }
    >();
    const chatStreamedToolCalls = new Map<
      number,
      {
        id: string;
        name?: string;
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
              type?: string;
              id?: string;
              model?: string;
              choices?: Array<{
                delta?: {
                  role?: "assistant";
                  content?: string;
                  tool_calls?: Array<{
                    index?: number;
                    id?: string;
                    type?: "function";
                    function?: {
                      name?: string;
                      arguments?: string;
                    };
                  }>;
                };
                finish_reason?: "stop" | "length" | "tool_calls" | null;
              }>;
              usage?: {
                prompt_tokens?: number;
                completion_tokens?: number;
                total_tokens?: number;
              };
              response?: {
                id?: string;
                model?: string;
                status?: string;
                incomplete_details?: {
                  reason?: string;
                };
                usage?: {
                  input_tokens?: number;
                  output_tokens?: number;
                  total_tokens?: number;
                };
              };
              item?: {
                id?: string;
                type?: string;
                call_id?: string;
                name?: string;
              };
              item_id?: string;
              output_index?: number;
              delta?: string;
            };

            if (payload.choices) {
              const choice = payload.choices[0];
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

              for (const toolCallDelta of choice?.delta?.tool_calls ?? []) {
                const toolIndex = toolCallDelta.index ?? 0;
                const currentTool = chatStreamedToolCalls.get(toolIndex) ?? {
                  id: toolCallDelta.id ?? `${responseId}_tool_call_${toolIndex}`
                };

                if (toolCallDelta.id) {
                  currentTool.id = toolCallDelta.id;
                }

                if (toolCallDelta.function?.name) {
                  currentTool.name = toolCallDelta.function.name;
                }

                chatStreamedToolCalls.set(toolIndex, currentTool);

                if (
                  toolCallDelta.function?.arguments !== undefined ||
                  toolCallDelta.id !== undefined ||
                  toolCallDelta.function?.name !== undefined
                ) {
                  yield {
                    type: "tool_call_delta",
                    responseId,
                    model,
                    toolCallId: currentTool.id,
                    toolIndex,
                    ...(currentTool.name ? { toolName: currentTool.name } : {}),
                    argumentsDelta: toolCallDelta.function?.arguments ?? ""
                  };
                }
              }

              if (
                choice?.finish_reason === "stop" ||
                choice?.finish_reason === "length" ||
                choice?.finish_reason === "tool_calls"
              ) {
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

              continue;
            }

            if (payload.type === "response.created" && payload.response?.id) {
              const responseId = payload.response.id;
              const model = payload.response.model ?? request.model;
              responseIdToModel.set(responseId, model);

              if (!hasStarted) {
                hasStarted = true;
                yield {
                  type: "response_started",
                  responseId,
                  model
                };
              }

              continue;
            }

            if (payload.type === "response.output_text.delta" && payload.delta !== undefined) {
              const [responseId, model] =
                Array.from(responseIdToModel.entries())[0] ?? [
                  `resp_${context.requestId}`,
                  request.model
                ];

              if (!hasStarted) {
                hasStarted = true;
                yield {
                  type: "response_started",
                  responseId,
                  model
                };
              }

              yield {
                type: "output_text_delta",
                responseId,
                model,
                delta: payload.delta
              };
              continue;
            }

            if (
              payload.type === "response.output_item.added" &&
              payload.item?.type === "function_call" &&
              payload.item.call_id
            ) {
              streamedToolCalls.set(payload.item.call_id, {
                outputIndex: payload.output_index ?? 0,
                ...(payload.item.name ? { name: payload.item.name } : {})
              });
              continue;
            }

            if (
              payload.type === "response.function_call_arguments.delta" &&
              payload.item_id
            ) {
              const [responseId, model] =
                Array.from(responseIdToModel.entries())[0] ?? [
                  `resp_${context.requestId}`,
                  request.model
                ];
              const currentTool = streamedToolCalls.get(payload.item_id) ?? {
                outputIndex: payload.output_index ?? 0
              };

              streamedToolCalls.set(payload.item_id, currentTool);

              if (!hasStarted) {
                hasStarted = true;
                yield {
                  type: "response_started",
                  responseId,
                  model
                };
              }

              yield {
                type: "tool_call_delta",
                responseId,
                model,
                toolCallId: payload.item_id,
                toolIndex: currentTool.outputIndex,
                ...(currentTool.name ? { toolName: currentTool.name } : {}),
                argumentsDelta: payload.delta ?? ""
              };
              continue;
            }

            if (payload.type === "response.completed" && payload.response?.id) {
              const responseId = payload.response.id;
              const model =
                payload.response.model ??
                responseIdToModel.get(responseId) ??
                request.model;

              yield {
                type: "response_completed",
                responseId,
                model,
                finishReason: normalizeOpenAIResponsesFinishReason(
                  payload.response.status,
                  payload.response.incomplete_details?.reason,
                  streamedToolCalls.size > 0
                ),
                ...(payload.response.usage
                  ? {
                      usage: {
                        inputTokens: payload.response.usage.input_tokens ?? 0,
                        outputTokens: payload.response.usage.output_tokens ?? 0,
                        totalTokens:
                          payload.response.usage.total_tokens ??
                          (payload.response.usage.input_tokens ?? 0) +
                            (payload.response.usage.output_tokens ?? 0)
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
