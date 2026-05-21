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
  supportsOpenAIResponsesEndpoint: boolean;
  supportsRouteScopedShaping: boolean;
  supportsStaticFallbackSameProvider: boolean;
  supportsToolChoice: boolean;
  supportsStopSequences: boolean;
  supportsSamplingParameters: boolean;
  supportsAnthropicRequestMetadata: boolean;
}

export interface ProviderRequestContext {
  requestId: string;
  /** Client abort signal. When the client disconnects, this signal is aborted, which also aborts the upstream fetch. */
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Per-read idle timeout for streaming responses. Resets on each successful reader.read(). */
  streamIdleTimeoutMs?: number;
  requestShaping?: RequestShapingProfile;
  requestMode?: "openai_chat" | "openai_responses" | "anthropic_messages";
  /** Mutable counter incremented by provider adapters when an SSE frame fails JSON.parse. */
  malformedSseEventCount?: number;
  /** Client-originated headers to forward to upstream, excluding gateway-internal headers. */
  forwardedHeaders?: Record<string, string>;
  /** Client-originated query parameters to forward to upstream. */
  forwardedQuery?: Record<string, string>;
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
