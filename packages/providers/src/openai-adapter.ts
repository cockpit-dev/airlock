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

export interface OpenAIProviderAdapterOptions {
  apiKey: string;
  baseUrl: string;
  shaping?: RequestShapingProfile;
  fetcher?: typeof fetch;
}

export class OpenAIProviderAdapter implements ProviderAdapter {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #shaping: RequestShapingProfile;
  readonly #fetcher: typeof fetch;

  constructor(options: OpenAIProviderAdapterOptions) {
    this.#apiKey = options.apiKey;
    this.#baseUrl = options.baseUrl.replace(/\/$/, "");
    this.#shaping = options.shaping ?? {};
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
    const outboundRequest = applyRequestShaping(
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
            messages: request.messages
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
        finish_reason: "stop";
        message: {
          content: string;
        };
      }>;
    };

    return {
      id: payload.id,
      model: payload.model,
      outputText: payload.choices[0]?.message.content ?? "",
      finishReason: payload.choices[0]?.finish_reason ?? "stop"
    };
  }
}
