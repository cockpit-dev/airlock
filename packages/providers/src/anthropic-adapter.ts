import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalStreamEvent
} from "@airlock/canonical";
import {
  applyAuthStrategy,
  applyRequestShaping,
  buildRequestUrl,
  mergeRequestShapingProfiles,
  type OutboundAuthStrategy,
  type RequestShapingProfile
} from "@airlock/request-shaping";

import { GatewayError } from "@airlock/shared";

import type { ProviderAdapter, ProviderRequestContext } from "./types.js";

export interface AnthropicProviderAdapterOptions {
  apiKey: string;
  baseUrl: string;
  defaultMaxTokens: number;
  shaping?: RequestShapingProfile;
  fetcher?: typeof fetch;
}

export class AnthropicProviderAdapter implements ProviderAdapter {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #defaultMaxTokens: number;
  readonly #shaping: RequestShapingProfile;
  readonly #fetcher: typeof fetch;

  constructor(options: AnthropicProviderAdapterOptions) {
    this.#apiKey = options.apiKey;
    this.#baseUrl = options.baseUrl.replace(/\/$/, "");
    this.#defaultMaxTokens = options.defaultMaxTokens;
    this.#shaping = options.shaping ?? {};
    this.#fetcher = options.fetcher ?? fetch;
  }

  async complete(
    request: CanonicalRequest,
    context: ProviderRequestContext
  ): Promise<CanonicalResponse> {
    const systemMessage = request.messages.find((message) => {
      return message.role === "system";
    });
    const messages = request.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content
      }));

    const authStrategy: OutboundAuthStrategy = {
      type: "header_value",
      headerName: "x-api-key",
      credential: {
        secretRef: "anthropic-api-key"
      }
    };
    const outboundRequest = applyRequestShaping(
      applyAuthStrategy(
        {
          path: "/messages",
          method: "POST",
          headers: {
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
          },
          query: {},
          jsonBody: {
            model: request.model,
            max_tokens: this.#defaultMaxTokens,
            ...(systemMessage ? { system: systemMessage.content } : {}),
            messages
          }
        },
        authStrategy,
        {
          "anthropic-api-key": this.#apiKey
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
      const payload = (await response.json()) as {
        error?: { message?: string };
      };

      throw new GatewayError(payload.error?.message ?? "Upstream provider error", {
        code: "provider_upstream_error",
        category: "provider",
        httpStatus: response.status,
        retryable: response.status >= 500 || response.status === 429,
        provider: "anthropic",
        requestId: context.requestId
      });
    }

    const payload = (await response.json()) as {
      id: string;
      model: string;
      content: Array<{
        type: "text";
        text: string;
      }>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
      };
    };

    return {
      id: payload.id,
      model: payload.model,
      outputText: payload.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n"),
      finishReason: "stop",
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
    const systemMessage = request.messages.find((message) => {
      return message.role === "system";
    });
    const messages = request.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content
      }));

    const authStrategy: OutboundAuthStrategy = {
      type: "header_value",
      headerName: "x-api-key",
      credential: {
        secretRef: "anthropic-api-key"
      }
    };
    const outboundRequest = applyRequestShaping(
      applyAuthStrategy(
        {
          path: "/messages",
          method: "POST",
          headers: {
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
          },
          query: {},
          jsonBody: {
            model: request.model,
            max_tokens: this.#defaultMaxTokens,
            stream: true,
            ...(systemMessage ? { system: systemMessage.content } : {}),
            messages
          }
        },
        authStrategy,
        {
          "anthropic-api-key": this.#apiKey
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
          provider: "anthropic",
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
        provider: "anthropic",
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
        provider: "anthropic",
        requestId: context.requestId
      });
    }

    const responseBody = response.body as ReadableStream<Uint8Array>;
    const reader = responseBody.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let activeResponseId = `msg_${context.requestId}`;
    let activeModel = request.model;

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

          const payload =
            currentData.length > 0 ? (JSON.parse(currentData) as Record<string, unknown>) : {};

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
              | { type?: string; text?: string }
              | undefined;

            if (delta?.type === "text_delta" && delta.text) {
              yield {
                type: "output_text_delta",
                responseId: activeResponseId,
                model: activeModel,
                delta: delta.text
              };
            }
            continue;
          }

          if (currentEventType === "message_stop") {
            yield {
              type: "response_completed",
              responseId: activeResponseId,
              model: activeModel,
              finishReason: "stop"
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
      reader.releaseLock();
    }
  }
}
