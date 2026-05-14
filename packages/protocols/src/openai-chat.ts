import { z } from "zod";

import { airlockRequestExtensionsSchema } from "./airlock-extensions.js";

const openAIChatTextContentPartSchema = z.object({
  type: z.literal("text"),
  text: z.string().min(1)
});

export const openAIChatMessageSchema = z.object({
  role: z.enum(["system", "developer", "user", "assistant"]),
  content: z.union([
    z.string().min(1),
    z.array(openAIChatTextContentPartSchema).min(1)
  ])
});

export const openAIChatCompletionRequestSchema = z.object({
  model: z.string().min(1),
  stream: z.boolean().default(false),
  max_tokens: z.number().int().positive().optional(),
  max_completion_tokens: z.number().int().positive().optional(),
  messages: z.array(openAIChatMessageSchema).min(1),
  airlock: airlockRequestExtensionsSchema.optional()
});

export type OpenAIChatMessage = z.infer<typeof openAIChatMessageSchema>;
export type OpenAIChatCompletionRequest = z.infer<
  typeof openAIChatCompletionRequestSchema
>;
