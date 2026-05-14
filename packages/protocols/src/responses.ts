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

const openAIResponsesFunctionToolSchema = z.object({
  type: z.literal("function"),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  parameters: z.record(z.string(), z.unknown())
});

const openAIResponsesOutputTextContentBlockSchema = z.object({
  type: z.literal("output_text"),
  text: z.string().min(1)
});

const openAIResponsesInputMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system", "developer"]),
  content: z.union([
    z.string().min(1),
    z.array(openAIResponsesTextContentBlockSchema).min(1)
  ])
});

const openAIResponsesMessageItemSchema = z.object({
  type: z.literal("message"),
  role: z.enum(["user", "assistant", "system", "developer"]),
  content: z.union([
    z.string().min(1),
    z.array(openAIResponsesTextContentBlockSchema).min(1),
    z.array(openAIResponsesOutputTextContentBlockSchema).min(1)
  ])
});

const openAIResponsesFunctionCallItemSchema = z.object({
  type: z.literal("function_call"),
  call_id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.string()
});

const openAIResponsesFunctionCallOutputItemSchema = z.object({
  type: z.literal("function_call_output"),
  call_id: z.string().min(1),
  output: z.string()
});

const openAIResponsesTypedInputItemSchema = z.union([
  openAIResponsesTopLevelInputItemSchema,
  openAIResponsesMessageItemSchema,
  openAIResponsesFunctionCallItemSchema,
  openAIResponsesFunctionCallOutputItemSchema
]);

export const openAIResponsesRequestSchema = z.object({
  model: z.string().min(1),
  stream: z.boolean().default(false),
  max_output_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  instructions: z.string().min(1).optional(),
  tools: z.array(openAIResponsesFunctionToolSchema).min(1).optional(),
  tool_choice: z.literal("auto").optional(),
  input: z.union([
    z.string().min(1),
    z.array(openAIResponsesInputMessageSchema).min(1),
    z.array(openAIResponsesTypedInputItemSchema).min(1)
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
