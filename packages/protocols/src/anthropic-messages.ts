import { z } from "zod";

import { airlockRequestExtensionsSchema } from "./airlock-extensions.js";

const anthropicTextContentBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string().min(1)
});

const anthropicTextBlockArraySchema = z.array(anthropicTextContentBlockSchema).min(1);

const anthropicToolUseContentBlockSchema = z.object({
  type: z.literal("tool_use"),
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.record(z.string(), z.unknown())
});

const anthropicToolResultContentBlockSchema = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string().min(1),
  content: z.union([z.string(), anthropicTextBlockArraySchema])
});

const anthropicToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  input_schema: z.record(z.string(), z.unknown())
});

const anthropicToolChoiceSchema = z.union([
  z.object({
    type: z.literal("auto")
  }),
  z.object({
    type: z.literal("any")
  }),
  z.object({
    type: z.literal("none")
  }),
  z.object({
    type: z.literal("tool"),
    name: z.string().min(1)
  })
]);

const anthropicMetadataSchema = z.object({
  user_id: z.string().min(1)
});

const anthropicMessageInputSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.union([
    z.string().min(1),
    z.array(
      z.union([
        anthropicTextContentBlockSchema,
        anthropicToolUseContentBlockSchema,
        anthropicToolResultContentBlockSchema
      ])
    ).min(1)
  ])
});

export const anthropicMessagesRequestSchema = z.object({
  model: z.string().min(1),
  max_tokens: z.number().int().positive(),
  stream: z.boolean().default(false),
  system: z.union([z.string().min(1), anthropicTextBlockArraySchema]).optional(),
  temperature: z.number().min(0).max(1).optional(),
  top_p: z.number().min(0).max(1).optional(),
  stop_sequences: z.array(z.string().min(1)).min(1).optional(),
  metadata: anthropicMetadataSchema.optional(),
  tools: z.array(anthropicToolSchema).min(1).optional(),
  tool_choice: anthropicToolChoiceSchema.optional(),
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
