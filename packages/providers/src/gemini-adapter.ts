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

export interface GeminiProviderAdapterOptions {
  apiKey: string;
  baseUrl: string;
  shaping?: RequestShapingProfile;
  fetcher?: typeof fetch;
}

export class GeminiProviderAdapter implements ProviderAdapter {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #shaping: RequestShapingProfile;
  readonly #fetcher: typeof fetch;

  constructor(options: GeminiProviderAdapterOptions) {
    this.#apiKey = options.apiKey;
    this.#baseUrl = options.baseUrl.replace(/\/$/, "");
    this.#shaping = options.shaping ?? {};
    this.#fetcher = options.fetcher ?? fetch;
  }

  async complete(
    request: CanonicalRequest,
    context: ProviderRequestContext
  ): Promise<CanonicalResponse> {
    const systemMessages = request.messages.filter((message) => {
      return message.role === "system";
    });
    const contents = request.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [
          {
            text: message.content
          }
        ]
      }));

    const authStrategy: OutboundAuthStrategy = {
      type: "header_value",
      headerName: "x-goog-api-key",
      credential: {
        secretRef: "gemini-api-key"
      }
    };
    const outboundRequest = applyRequestShaping(
      applyAuthStrategy(
        {
          path: `/models/${request.model}:generateContent`,
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          query: {},
          jsonBody: {
            ...(systemMessages.length > 0
              ? {
                  system_instruction: {
                    parts: systemMessages.map((message) => ({
                      text: message.content
                    }))
                  }
                }
              : {}),
            contents
          }
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
      const payload = (await response.json()) as {
        error?: { message?: string };
      };

      throw new GatewayError(payload.error?.message ?? "Upstream provider error", {
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
        content?: {
          parts?: Array<{
            text?: string;
          }>;
        };
      }>;
    };

    const outputText =
      payload.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("")
        .trim() ?? "";

    return {
      id: payload.responseId ?? `gemini_${context.requestId}`,
      model: payload.modelVersion ?? request.model,
      outputText,
      finishReason: "stop"
    };
  }
}
