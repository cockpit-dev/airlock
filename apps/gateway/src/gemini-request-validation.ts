import { GatewayError } from "@airlock/shared";
import { ZodError } from "zod";

interface PayloadParser<T> {
  parse(payload: unknown): T;
}

export function parseGeminiRequestSchema<T>(
  schema: PayloadParser<T>,
  payload: unknown,
  requestId: string
) {
  try {
    return schema.parse(payload);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new GatewayError("Invalid Gemini request payload", {
        code: "request_invalid_gemini_payload",
        category: "request",
        httpStatus: 400,
        retryable: false,
        requestId
      });
    }

    throw error;
  }
}
