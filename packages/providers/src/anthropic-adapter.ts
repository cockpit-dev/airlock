import type { CanonicalRequest, CanonicalResponse } from "@airlock/canonical";
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
    };

    return {
      id: payload.id,
      model: payload.model,
      outputText: payload.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n"),
      finishReason: "stop"
    };
  }
}
