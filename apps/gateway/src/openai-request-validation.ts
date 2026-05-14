import { GatewayError } from "@airlock/shared";
import { ZodError, type ZodType } from "zod";

export function assertAllowedOpenAITopLevelFields(
  payload: unknown,
  requestId: string,
  routeLabel: "OpenAI Chat" | "OpenAI Responses",
  allowedFields: readonly string[]
) {
  if (typeof payload !== "object" || payload === null) {
    return;
  }

  const allowedFieldSet = new Set(allowedFields);

  for (const field of Object.keys(payload)) {
    if (!allowedFieldSet.has(field)) {
      throw new GatewayError(
        `Unsupported ${routeLabel} semantic field: ${field}`,
        {
          code: "request_unsupported_openai_semantics",
          category: "request",
          httpStatus: 400,
          retryable: false,
          requestId
        }
      );
    }
  }
}

export function assertSupportedOpenAIChatStreamOptions(
  payload: unknown,
  requestId: string
) {
  if (typeof payload !== "object" || payload === null) {
    return;
  }

  if (!("stream_options" in payload) || payload.stream_options === undefined) {
    return;
  }

  const streamOptions = payload.stream_options;

  if (
    typeof streamOptions !== "object" ||
    streamOptions === null ||
    !("include_usage" in streamOptions) ||
    Object.keys(streamOptions).length !== 1 ||
    streamOptions.include_usage !== true
  ) {
    throw new GatewayError(
      "Unsupported OpenAI Chat stream_options: only include_usage=true is supported",
      {
        code: "request_unsupported_openai_semantics",
        category: "request",
        httpStatus: 400,
        retryable: false,
        requestId
      }
    );
  }
}

export function assertSupportedOpenAIChatToolsSemantics(
  payload: unknown,
  requestId: string
) {
  if (typeof payload !== "object" || payload === null) {
    return;
  }

  if (!("tools" in payload) || payload.tools === undefined) {
    return;
  }

  if ("stream" in payload && payload.stream === true) {
    throw new GatewayError(
      "Unsupported OpenAI Chat tools semantics: streaming tool calls are not yet supported",
      {
        code: "request_unsupported_openai_semantics",
        category: "request",
        httpStatus: 400,
        retryable: false,
        requestId
      }
    );
  }
}

export function parseOpenAIRequestSchema<T>(
  schema: ZodType<T>,
  payload: unknown,
  requestId: string,
  routeLabel: "OpenAI Chat" | "OpenAI Responses"
) {
  try {
    return schema.parse(payload);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new GatewayError(`Invalid ${routeLabel} request payload`, {
        code: "request_invalid_openai_payload",
        category: "request",
        httpStatus: 400,
        retryable: false,
        requestId
      });
    }

    throw error;
  }
}
