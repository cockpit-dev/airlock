import { z } from "zod";

import { airlockRequestExtensionsSchema } from "./airlock-extensions.js";

export const openAIChatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1)
});

export const openAIChatCompletionRequestSchema = z.object({
  model: z.string().min(1),
  stream: z.literal(false).default(false),
  messages: z.array(openAIChatMessageSchema).min(1),
  airlock: airlockRequestExtensionsSchema.optional()
});

export type OpenAIChatMessage = z.infer<typeof openAIChatMessageSchema>;
export type OpenAIChatCompletionRequest = z.infer<
  typeof openAIChatCompletionRequestSchema
>;
