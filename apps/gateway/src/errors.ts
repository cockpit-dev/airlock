import { GatewayError } from "@airlock/shared";

type ErrorProtocol = "openai" | "anthropic";

function detectErrorProtocol(pathname: string): ErrorProtocol {
  return pathname.startsWith("/v1/messages") ? "anthropic" : "openai";
}

export function toMethodNotAllowedResponse(
  requestId: string,
  pathname: string
): Response {
  const protocol = detectErrorProtocol(pathname);

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
