import type { RequestShapingProfile, OutboundSigningStrategy } from "@airlock/request-shaping";

import type { ProviderId } from "@airlock/shared";

import type { ProviderAdapter } from "./types.js";
import { AnthropicProviderAdapter } from "./anthropic-adapter.js";
import { GeminiProviderAdapter } from "./gemini-adapter.js";
import { OpenAIProviderAdapter } from "./openai-adapter.js";

/**
 * Common options for constructing any provider adapter.
 * Provider-specific fields (e.g. `defaultMaxTokens`) are optional
 * and ignored by adapters that don't need them.
 */
export interface ProviderAdapterConstructionOptions {
  apiKey: string;
  baseUrl: string;
  defaultMaxTokens?: number;
  shaping?: RequestShapingProfile;
  signing?: OutboundSigningStrategy;
  signingSecrets?: Record<string, string>;
  fetcher?: typeof fetch;
}

/**
 * Factory function that creates a ProviderAdapter from common options.
 */
export type ProviderAdapterFactory = (
  options: ProviderAdapterConstructionOptions
) => ProviderAdapter;

const adapterFactories = new Map<ProviderId, ProviderAdapterFactory>();

function openAIFactory(options: ProviderAdapterConstructionOptions): ProviderAdapter {
  return new OpenAIProviderAdapter({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    ...(options.shaping ? { shaping: options.shaping } : {}),
    ...(options.signing ? { signing: options.signing } : {}),
    signingSecrets: options.signingSecrets ?? {},
    ...(options.fetcher ? { fetcher: options.fetcher } : {})
  });
}

function anthropicFactory(options: ProviderAdapterConstructionOptions): ProviderAdapter {
  return new AnthropicProviderAdapter({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    defaultMaxTokens: options.defaultMaxTokens ?? 256,
    ...(options.shaping ? { shaping: options.shaping } : {}),
    ...(options.signing ? { signing: options.signing } : {}),
    signingSecrets: options.signingSecrets ?? {},
    ...(options.fetcher ? { fetcher: options.fetcher } : {})
  });
}

function geminiFactory(options: ProviderAdapterConstructionOptions): ProviderAdapter {
  return new GeminiProviderAdapter({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    ...(options.shaping ? { shaping: options.shaping } : {}),
    ...(options.signing ? { signing: options.signing } : {}),
    signingSecrets: options.signingSecrets ?? {},
    ...(options.fetcher ? { fetcher: options.fetcher } : {})
  });
}

/**
 * Register a factory for a given provider. This allows extending the
 * gateway with new providers without modifying the core adapter selection
 * logic.
 */
export function registerProviderAdapterFactory(
  providerId: ProviderId,
  factory: ProviderAdapterFactory
): void {
  adapterFactories.set(providerId, factory);
}

/**
 * Create a provider adapter by looking up the registered factory.
 * Throws if no factory is registered for the given provider.
 */
export function createProviderAdapterFromRegistry(
  providerId: ProviderId,
  options: ProviderAdapterConstructionOptions
): ProviderAdapter {
  const factory = adapterFactories.get(providerId);
  if (!factory) {
    throw new Error(`No adapter factory registered for provider: ${providerId}`);
  }
  return factory(options);
}

// Register built-in providers
registerProviderAdapterFactory("openai", openAIFactory);
registerProviderAdapterFactory("anthropic", anthropicFactory);
registerProviderAdapterFactory("gemini", geminiFactory);
