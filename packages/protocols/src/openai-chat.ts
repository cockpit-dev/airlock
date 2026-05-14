import { z } from "zod";

import { airlockRequestExtensionsSchema } from "./airlock-extensions.js";

const openAIChatTextContentPartSchema = z.object({
  type: z.literal("text"),
  text: z.string().min(1)
});

const openAIChatStreamOptionsSchema = z.object({
  include_usage: z.boolean()
});

const openAIChatFunctionToolSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1),
    description: z.string().min(1).optional(),
    parameters: z.record(z.string(), z.unknown())
  })
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
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  stop: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
  stream_options: openAIChatStreamOptionsSchema.optional(),
  tools: z.array(openAIChatFunctionToolSchema).min(1).optional(),
  tool_choice: z.literal("auto").optional(),
  messages: z.array(openAIChatMessageSchema).min(1),
  airlock: airlockRequestExtensionsSchema.optional()
});

export type OpenAIChatMessage = z.infer<typeof openAIChatMessageSchema>;
export type OpenAIChatCompletionRequest = z.infer<
  typeof openAIChatCompletionRequestSchema
>;
