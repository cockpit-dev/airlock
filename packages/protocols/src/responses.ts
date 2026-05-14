import { z } from "zod";

import { airlockRequestExtensionsSchema } from "./airlock-extensions.js";

const openAIResponsesTextContentBlockSchema = z.object({
  type: z.literal("input_text"),
  text: z.string().min(1)
});

const openAIResponsesTopLevelInputItemSchema = z.object({
  type: z.literal("input_text"),
  text: z.string().min(1)
});

const openAIResponsesInputMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system", "developer"]),
  content: z.union([
    z.string().min(1),
    z.array(openAIResponsesTextContentBlockSchema).min(1)
  ])
});

export const openAIResponsesRequestSchema = z.object({
  model: z.string().min(1),
  stream: z.boolean().default(false),
  max_output_tokens: z.number().int().positive().optional(),
  instructions: z.string().min(1).optional(),
  input: z.union([
    z.string().min(1),
    z.array(openAIResponsesInputMessageSchema).min(1),
    z.array(openAIResponsesTopLevelInputItemSchema).min(1)
  ]),
  airlock: airlockRequestExtensionsSchema.optional()
});

export const openAIResponsesResponseSchema = z.object({
  id: z.string().min(1),
  object: z.literal("response"),
  model: z.string().min(1),
  status: z.literal("completed"),
  output: z.array(z.unknown()),
  output_text: z.string(),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
      total_tokens: z.number().int().nonnegative()
    })
    .optional()
});

export type OpenAIResponsesRequest = z.infer<typeof openAIResponsesRequestSchema>;
export type OpenAIResponsesResponse = z.infer<typeof openAIResponsesResponseSchema>;
