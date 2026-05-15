import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalStreamEvent
} from "@airlock/canonical";
import type { RequestShapingProfile } from "@airlock/request-shaping";
import type { ProviderId } from "@airlock/shared";

export type { ProviderId } from "@airlock/shared";

export interface ProviderCapabilityDescriptor {
  provider: ProviderId;
  displayName: string;
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsToolReplay: boolean;
  supportsStreamingTools: boolean;
  supportsMultimodalInput: boolean;
  supportsSystemMessages: boolean;
  supportsEndUserId: boolean;
  supportsPreviousResponseId: boolean;
  supportsConversationId: boolean;
  supportsPrompt: boolean;
  supportsReasoning: boolean;
  supportsStructuredOutputs: boolean;
  supportsParallelToolCallControl: boolean;
  supportsOpenAIRequestMetadata: boolean;
  supportsOpenAIResponsesTextControls: boolean;
  supportsRouteScopedShaping: boolean;
  supportsStaticFallbackSameProvider: boolean;
}

export interface ProviderRequestContext {
  requestId: string;
  timeoutMs?: number;
  requestShaping?: RequestShapingProfile;
  requestMode?: "default" | "openai_responses";
}

export interface ProviderAdapter {
  complete(
    request: CanonicalRequest,
    context: ProviderRequestContext
  ): Promise<CanonicalResponse>;
  stream?(
    request: CanonicalRequest,
    context: ProviderRequestContext
  ): AsyncIterable<CanonicalStreamEvent>;
}
