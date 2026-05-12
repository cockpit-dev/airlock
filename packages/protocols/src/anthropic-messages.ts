import { z } from "zod";

import { airlockRequestExtensionsSchema } from "./airlock-extensions.js";

const anthropicTextContentBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string().min(1)
});

const anthropicMessageInputSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.union([
    z.string().min(1),
    z.array(anthropicTextContentBlockSchema).min(1)
  ])
});

export const anthropicMessagesRequestSchema = z.object({
  model: z.string().min(1),
  max_tokens: z.number().int().positive(),
  system: z.string().min(1).optional(),
  messages: z.array(anthropicMessageInputSchema).min(1),
  airlock: airlockRequestExtensionsSchema.optional()
});

export const anthropicMessagesResponseSchema = z.object({
  id: z.string().min(1),
  type: z.literal("message"),
  role: z.literal("assistant"),
  model: z.string().min(1),
  stop_reason: z.literal("end_turn"),
  content: z.array(anthropicTextContentBlockSchema).min(1)
});

export type AnthropicMessagesRequest = z.infer<
  typeof anthropicMessagesRequestSchema
>;
export type AnthropicMessagesResponse = z.infer<
  typeof anthropicMessagesResponseSchema
>;
