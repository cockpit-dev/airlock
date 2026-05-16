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
  supportsStreamingStructuredOutputs: boolean;
  supportsParallelToolCallControl: boolean;
  supportsOpenAIRequestMetadata: boolean;
  supportsOpenAIResponsesTextControls: boolean;
  supportsRouteScopedShaping: boolean;
  supportsStaticFallbackSameProvider: boolean;
  supportsToolChoice: boolean;
  supportsStopSequences: boolean;
  supportsSamplingParameters: boolean;
  supportsAnthropicRequestMetadata: boolean;
}

export interface ProviderRequestContext {
  requestId: string;
  timeoutMs?: number;
  /** Per-read idle timeout for streaming responses. Resets on each successful reader.read(). */
  streamIdleTimeoutMs?: number;
  requestShaping?: RequestShapingProfile;
  requestMode?: "default" | "openai_responses";
  /** Mutable counter incremented by provider adapters when an SSE frame fails JSON.parse. */
  malformedSseEventCount?: number;
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
