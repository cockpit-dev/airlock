export interface GatewayErrorOptions {
  code: string;
  category: string;
  httpStatus: number;
  retryable: boolean;
  provider?: string;
  requestId?: string;
  cause?: unknown;
}

export class GatewayError extends Error {
  readonly code: string;
  readonly category: string;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly provider: string | undefined;
  readonly requestId: string | undefined;

  constructor(message: string, options: GatewayErrorOptions) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "GatewayError";
    this.code = options.code;
    this.category = options.category;
    this.httpStatus = options.httpStatus;
    this.retryable = options.retryable;
    this.provider = options.provider;
    this.requestId = options.requestId;
  }
}
