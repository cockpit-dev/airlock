export interface StreamErrorInput {
  message: string;
  code: string;
  type: string;
}

function toStreamErrorInput(error: unknown): StreamErrorInput {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as Record<string, unknown>).code === "string" &&
    "message" in error &&
    typeof (error as Record<string, unknown>).message === "string"
  ) {
    const e = error as { message: string; code: string; category?: string };
    return {
      message: e.message,
      code: e.code,
      type: e.category ?? "internal_error",
    };
  }
  return {
    message: error instanceof Error ? error.message : "Internal server error",
    code: "stream_error",
    type: "internal_error",
  };
}

export function encodeOpenAIChatStreamError(error: unknown): string {
  const e = toStreamErrorInput(error);
  return `data: ${JSON.stringify({
    error: {
      message: e.message,
      type: e.type,
      code: e.code,
    },
  })}\n\ndata: [DONE]\n\n`;
}

export function encodeOpenAIResponsesStreamError(error: unknown): string {
  const e = toStreamErrorInput(error);
  return `data: ${JSON.stringify({
    type: "error",
    code: e.code,
    message: e.message,
  })}\n\ndata: [DONE]\n\n`;
}

export function encodeAnthropicMessagesStreamError(error: unknown): string {
  const e = toStreamErrorInput(error);
  return `event: error\ndata: ${JSON.stringify({
    type: "error",
    error: {
      type: e.type,
      message: e.message,
    },
  })}\n\n`;
}
