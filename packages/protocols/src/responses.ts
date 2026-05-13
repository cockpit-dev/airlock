import { z } from "zod";

import { airlockRequestExtensionsSchema } from "./airlock-extensions.js";

const openAIResponsesInputMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1)
});

export const openAIResponsesRequestSchema = z.object({
  model: z.string().min(1),
  stream: z.boolean().default(false),
  max_output_tokens: z.number().int().positive().optional(),
  input: z.union([
    z.string().min(1),
    z.array(openAIResponsesInputMessageSchema).min(1)
  ]),
  airlock: airlockRequestExtensionsSchema.optional()
});

export const openAIResponsesResponseSchema = z.object({
  id: z.string().min(1),
  object: z.literal("response"),
  model: z.string().min(1),
  status: z.literal("completed"),
  output: z.array(z.unknown()),
  output_text: z.string()
});

export type OpenAIResponsesRequest = z.infer<typeof openAIResponsesRequestSchema>;
export type OpenAIResponsesResponse = z.infer<typeof openAIResponsesResponseSchema>;
