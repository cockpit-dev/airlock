import { GatewayError } from "@airlock/shared";

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
