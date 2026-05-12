import type { CanonicalRequest, CanonicalResponse } from "@airlock/canonical";
import type { RequestShapingProfile } from "@airlock/request-shaping";
import type { ProviderId } from "@airlock/shared";

export type { ProviderId } from "@airlock/shared";

export interface ProviderCapabilityDescriptor {
  provider: ProviderId;
  displayName: string;
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsMultimodalInput: boolean;
  supportsSystemMessages: boolean;
  supportsRouteScopedShaping: boolean;
  supportsStaticFallbackSameProvider: boolean;
}

export interface ProviderRequestContext {
  requestId: string;
  timeoutMs?: number;
  requestShaping?: RequestShapingProfile;
}

export interface ProviderAdapter {
  complete(
    request: CanonicalRequest,
    context: ProviderRequestContext
  ): Promise<CanonicalResponse>;
}
