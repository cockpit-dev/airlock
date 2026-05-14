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

export function assertAllowedAnthropicTopLevelFields(
  payload: unknown,
  requestId: string,
  allowedFields: readonly string[]
) {
  if (typeof payload !== "object" || payload === null) {
    return;
  }

  const allowedFieldSet = new Set(allowedFields);

  for (const field of Object.keys(payload)) {
    if (!allowedFieldSet.has(field)) {
      throw new GatewayError(
        `Unsupported Anthropic semantic field: ${field}`,
        {
          code: "request_unsupported_anthropic_semantics",
          category: "request",
          httpStatus: 400,
          retryable: false,
          requestId
        }
      );
    }
  }
}

export function parseAnthropicRequestSchema<T>(
  schema: ZodType<T>,
  payload: unknown,
  requestId: string
) {
  try {
    return schema.parse(payload);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new GatewayError("Invalid Anthropic request payload", {
        code: "request_invalid_anthropic_payload",
        category: "request",
        httpStatus: 400,
        retryable: false,
        requestId
      });
    }

    throw error;
  }
}

export function assertSupportedAnthropicToolsSemantics(
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
      "Unsupported Anthropic tools semantics: streaming tool calls are not yet supported",
      {
        code: "request_unsupported_anthropic_semantics",
        category: "request",
        httpStatus: 400,
        retryable: false,
        requestId
      }
    );
  }
}

export function assertAnthropicForcedToolChoiceMatchesDeclaredTools(
  payload: unknown,
  requestId: string
) {
  if (typeof payload !== "object" || payload === null) {
    return;
  }

  if (!("tool_choice" in payload) || payload.tool_choice === undefined) {
    return;
  }

  if (!("tools" in payload) || !Array.isArray(payload.tools)) {
    return;
  }

  if (
    typeof payload.tool_choice !== "object" ||
    payload.tool_choice === null ||
    !("type" in payload.tool_choice)
  ) {
    return;
  }

  if (payload.tool_choice.type !== "tool") {
    return;
  }

  if (
    !("name" in payload.tool_choice) ||
    typeof payload.tool_choice.name !== "string"
  ) {
    return;
  }

  const declaredToolNames = payload.tools
    .map((tool) => {
      return isRecord(tool) ? getRecordString(tool, "name") : undefined;
    })
    .filter((name): name is string => name !== undefined);

  if (!declaredToolNames.includes(payload.tool_choice.name)) {
    throw new GatewayError(
      "Unsupported Anthropic tools semantics: tool_choice must reference a declared tool",
      {
        code: "request_unsupported_anthropic_semantics",
        category: "request",
        httpStatus: 400,
        retryable: false,
        requestId
      }
    );
  }
}
