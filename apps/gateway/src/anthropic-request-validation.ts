import { GatewayError } from "@airlock/shared";
import { ZodError, type ZodType } from "zod";

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
