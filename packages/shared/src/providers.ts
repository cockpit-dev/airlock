export const providerIds = ["openai", "anthropic", "gemini"] as const;

export type ProviderId = (typeof providerIds)[number];

export function isProviderId(value: string): value is ProviderId {
  return providerIds.includes(value as ProviderId);
}
