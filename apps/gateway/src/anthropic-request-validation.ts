import { GatewayError } from "@airlock/shared";

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
