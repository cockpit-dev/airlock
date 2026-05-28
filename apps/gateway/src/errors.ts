import { GatewayError } from "@airlock/shared";

type ErrorProtocol = "openai" | "anthropic" | "gemini";

function detectErrorProtocol(pathname: string): ErrorProtocol {
  if (pathname.startsWith("/v1beta/")) return "gemini";
  return pathname.startsWith("/v1/messages") ? "anthropic" : "openai";
}

function googleRpcStatusForHttpStatus(status: number): string {
  if (status === 400) return "INVALID_ARGUMENT";
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 403) return "PERMISSION_DENIED";
  if (status === 404) return "NOT_FOUND";
  if (status === 405) return "METHOD_NOT_ALLOWED";
  if (status === 408) return "DEADLINE_EXCEEDED";
  if (status === 409) return "ABORTED";
  if (status === 413) return "RESOURCE_EXHAUSTED";
  if (status === 415) return "INVALID_ARGUMENT";
  if (status === 429) return "RESOURCE_EXHAUSTED";
  if (status === 499) return "CANCELLED";
  if (status >= 500) return "INTERNAL";
  return "UNKNOWN";
}

export function toMethodNotAllowedResponse(
  requestId: string,
  pathname: string
): Response {
  const protocol = detectErrorProtocol(pathname);

  if (protocol === "gemini") {
    return Response.json(
      {
        error: {
          code: 405,
          message: "Method not allowed",
          status: "METHOD_NOT_ALLOWED"
        }
      },
      {
        status: 405,
        headers: {
          "x-request-id": requestId,
          allow: "POST"
        }
      }
    );
  }

  if (protocol === "anthropic") {
    return Response.json(
      {
        type: "error",
        error: {
          type: "method_not_allowed",
          message: "Method not allowed"
        },
        request_id: requestId
      },
      {
        status: 405,
        headers: {
          "request-id": requestId,
          "x-request-id": requestId,
          allow: "POST"
        }
      }
    );
  }

  return Response.json(
    {
      error: {
        message: "Method not allowed",
        type: "invalid_request_error",
        code: "method_not_allowed"
      }
    },
    {
      status: 405,
      headers: {
        "x-request-id": requestId,
        allow: "POST"
      }
    }
  );
}

export function toNotFoundResponse(
  requestId: string,
  pathname: string
): Response {
  const protocol = detectErrorProtocol(pathname);

  if (protocol === "gemini") {
    return Response.json(
      {
        error: {
          code: 404,
          message: "Not found",
          status: "NOT_FOUND"
        }
      },
      {
        status: 404,
        headers: {
          "x-request-id": requestId
        }
      }
    );
  }

  if (protocol === "anthropic") {
    return Response.json(
      {
        type: "error",
        error: {
          type: "not_found",
          message: "Not found"
        },
        request_id: requestId
      },
      {
        status: 404,
        headers: {
          "request-id": requestId,
          "x-request-id": requestId
        }
      }
    );
  }

  return Response.json(
    {
      error: {
        message: "Not found",
        type: "invalid_request_error",
        code: "route_not_found"
      }
    },
    {
      status: 404,
      headers: {
        "x-request-id": requestId
      }
    }
  );
}

export function toErrorResponse(
  error: unknown,
  requestId: string,
  pathname: string
): Response {
  const protocol = detectErrorProtocol(pathname);

  if (error instanceof GatewayError) {
    if (protocol === "gemini") {
      return Response.json(
        {
          error: {
            code: error.httpStatus,
            message: error.message,
            status: googleRpcStatusForHttpStatus(error.httpStatus),
            details: [
              {
                "@type": "type.googleapis.com/airlock.gateway.ErrorInfo",
                reason: error.code,
                domain: "airlock.gateway"
              }
            ]
          }
        },
        {
          status: error.httpStatus,
          headers: {
            "x-request-id": requestId,
            ...(error.headers ?? {})
          }
        }
      );
    }

    if (protocol === "anthropic") {
      return Response.json(
        {
          type: "error",
          error: {
            type: error.category,
            message: error.message
          },
          request_id: requestId
        },
        {
          status: error.httpStatus,
          headers: {
            "request-id": requestId,
            "x-request-id": requestId,
            ...(error.headers ?? {})
          }
        }
      );
    }

    return Response.json(
      {
        error: {
          message: error.message,
          type: error.category,
          code: error.code
        }
      },
      {
        status: error.httpStatus,
        headers: {
          "x-request-id": requestId,
          ...(error.headers ?? {})
        }
      }
    );
  }

  if (protocol === "gemini") {
    return Response.json(
      {
        error: {
          code: 500,
          message: "Internal server error",
          status: "INTERNAL"
        }
      },
      {
        status: 500,
        headers: {
          "x-request-id": requestId
        }
      }
    );
  }

  if (protocol === "anthropic") {
    return Response.json(
      {
        type: "error",
        error: {
          type: "internal_error",
          message: "Internal server error"
        },
        request_id: requestId
      },
      {
        status: 500,
        headers: {
          "request-id": requestId,
          "x-request-id": requestId
        }
      }
    );
  }

  return Response.json(
    {
      error: {
        message: "Internal server error",
        type: "internal_error",
        code: "internal_error"
      }
    },
    {
      status: 500,
      headers: {
        "x-request-id": requestId
      }
    }
  );
}
