import { GatewayError } from "@airlock/shared";
import { ZodError, type ZodType } from "zod";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getRecordString(
  record: Record<string, unknown>,
  key: string
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

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

  if ("parallel_tool_calls" in payload && typeof payload.parallel_tool_calls !== "boolean") {
    throw new GatewayError(
      "Unsupported OpenAI Chat tools semantics: parallel_tool_calls must be a boolean",
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

export function assertSupportedOpenAIResponsesToolsSemantics(
  payload: unknown,
  requestId: string
) {
  if (typeof payload !== "object" || payload === null) {
    return;
  }

  if (!("tools" in payload) || payload.tools === undefined) {
    return;
  }

  if ("parallel_tool_calls" in payload && typeof payload.parallel_tool_calls !== "boolean") {
    throw new GatewayError(
      "Unsupported OpenAI Responses tools semantics: parallel_tool_calls must be a boolean",
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

export function assertSupportedOpenAIResponsesSemantics(
  payload: unknown,
  requestId: string
) {
  if (typeof payload !== "object" || payload === null) {
    return;
  }

  if ("reasoning" in payload && payload.reasoning !== undefined) {
    if (
      typeof payload.reasoning !== "object" ||
      payload.reasoning === null
    ) {
      throw new GatewayError(
        "Unsupported OpenAI Responses reasoning config",
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

  if (!("text" in payload) || payload.text === undefined) {
    return;
  }

  if (
    typeof payload.text !== "object" ||
    payload.text === null ||
    !("format" in payload.text) ||
    typeof payload.text.format !== "object" ||
    payload.text.format === null ||
    !("type" in payload.text.format) ||
    (payload.text.format.type !== "text" &&
      payload.text.format.type !== "json_object" &&
      payload.text.format.type !== "json_schema")
  ) {
    throw new GatewayError(
      "Unsupported OpenAI Responses text config: only text.format.type=text, json_object, or json_schema is supported",
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

export function assertSupportedOpenAIChatResponseFormat(
  payload: unknown,
  requestId: string
) {
  if (typeof payload !== "object" || payload === null) {
    return;
  }

  if (!("response_format" in payload) || payload.response_format === undefined) {
    return;
  }

  const responseFormat = payload.response_format;

  if (
    typeof responseFormat !== "object" ||
    responseFormat === null ||
    !("type" in responseFormat) ||
    (responseFormat.type !== "text" &&
      responseFormat.type !== "json_object" &&
      responseFormat.type !== "json_schema")
  ) {
    throw new GatewayError(
      "Unsupported OpenAI Chat response_format: only type=text, json_object, or json_schema is supported",
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

export function assertSupportedOpenAIResponsesStreamOptions(
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
    !("include_obfuscation" in streamOptions) ||
    Object.keys(streamOptions).length !== 1 ||
    streamOptions.include_obfuscation !== false
  ) {
    throw new GatewayError(
      "Unsupported OpenAI Responses stream_options: only include_obfuscation=false is supported",
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

function getOpenAIDeclaredToolNames(payload: Record<string, unknown>) {
  if (!Array.isArray(payload.tools)) {
    return [];
  }

  return payload.tools
    .map((tool) => {
      if (isRecord(tool) && isRecord(tool.function)) {
        const nestedName = getRecordString(tool.function, "name");
        if (nestedName) {
          return nestedName;
        }
      }

      if (isRecord(tool)) {
        return getRecordString(tool, "name");
      }

      return undefined;
    })
    .filter((name): name is string => name !== undefined);
}

export function assertOpenAIForcedToolChoiceMatchesDeclaredTools(
  payload: unknown,
  requestId: string,
  routeLabel: "OpenAI Chat" | "OpenAI Responses"
) {
  if (typeof payload !== "object" || payload === null) {
    return;
  }

  if (!("tool_choice" in payload) || payload.tool_choice === undefined) {
    return;
  }

  if (!("tools" in payload) || payload.tools === undefined) {
    return;
  }

  if (payload.tool_choice === "auto") {
    return;
  }

  if (typeof payload.tool_choice !== "object" || payload.tool_choice === null) {
    return;
  }

  let forcedName: string | undefined;

  if (isRecord(payload.tool_choice)) {
    if (isRecord(payload.tool_choice.function)) {
      forcedName = getRecordString(payload.tool_choice.function, "name");
    } else {
      forcedName = getRecordString(payload.tool_choice, "name");
    }
  }

  if (!forcedName) {
    return;
  }

  const declaredToolNames = getOpenAIDeclaredToolNames(payload);

  if (!declaredToolNames.includes(forcedName)) {
    throw new GatewayError(
      `Unsupported ${routeLabel} tools semantics: tool_choice must reference a declared tool`,
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
