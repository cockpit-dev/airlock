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

const openAIResponsesForcedFunctionToolChoiceSchema = z.object({
  type: z.literal("function"),
  name: z.string().min(1)
});

const openAIResponsesTextFormatSchema = z.object({
  type: z.literal("text")
});

const openAIResponsesJsonObjectFormatSchema = z.object({
  type: z.literal("json_object")
});

const openAIResponsesJsonSchemaFormatSchema = z.object({
  type: z.literal("json_schema"),
  name: z.string().min(1),
  schema: z.record(z.string(), z.unknown()),
  strict: z.boolean().optional()
});

const openAIResponsesTextConfigSchema = z.object({
  format: z.union([
    openAIResponsesTextFormatSchema,
    openAIResponsesJsonObjectFormatSchema,
    openAIResponsesJsonSchemaFormatSchema
  ])
});

const openAIResponsesPromptSchema = z
  .object({
    id: z.string().min(1).optional(),
    prompt_id: z.string().min(1).optional(),
    version: z.union([z.string().min(1), z.number().int().positive()]).optional(),
    variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional()
  })
  .refine((value) => value.id !== undefined || value.prompt_id !== undefined, {
    message: "Prompt id is required",
    path: ["id"]
  });

const openAIResponsesReasoningSchema = z.object({
  effort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh"]).optional(),
  summary: z.enum(["auto", "concise", "detailed"]).optional(),
  generate_summary: z.enum(["auto", "concise", "detailed"]).optional()
}).superRefine((value, context) => {
  if (
    value.summary !== undefined &&
    value.generate_summary !== undefined &&
    value.summary !== value.generate_summary
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "reasoning.summary must match reasoning.generate_summary",
      path: ["summary"]
    });
  }
});

const openAIResponsesStreamOptionsSchema = z.object({
  include_obfuscation: z.literal(false)
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

const openAIResponsesReasoningSummaryTextSchema = z.object({
  type: z.literal("summary_text"),
  text: z.string().min(1)
});

const openAIResponsesReasoningItemSchema = z.object({
  type: z.literal("reasoning"),
  id: z.string().min(1).optional(),
  encrypted_content: z.string().min(1).optional(),
  summary: z.array(openAIResponsesReasoningSummaryTextSchema).optional()
});

const openAIResponsesTypedInputItemSchema = z.union([
  openAIResponsesTopLevelInputItemSchema,
  openAIResponsesMessageItemSchema,
  openAIResponsesFunctionCallItemSchema,
  openAIResponsesFunctionCallOutputItemSchema,
  openAIResponsesReasoningItemSchema
]);

export const openAIResponsesRequestSchema = z
  .object({
  model: z.string().min(1),
  stream: z.boolean().default(false),
  safety_identifier: z.string().min(1).optional(),
  service_tier: z.enum(["auto", "default", "flex", "priority", "scale"]).optional(),
  store: z.boolean().optional(),
  prompt_cache_key: z.string().min(1).optional(),
  prompt_cache_retention: z.enum(["in_memory", "24h"]).optional(),
  prompt: openAIResponsesPromptSchema.optional(),
  prompt_id: z.string().min(1).optional(),
  previous_response_id: z.string().min(1).optional(),
  conversation: z.string().min(1).optional(),
  stop: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
  max_output_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  instructions: z.string().min(1).optional(),
  reasoning: openAIResponsesReasoningSchema.optional(),
  text: openAIResponsesTextConfigSchema.optional(),
  stream_options: openAIResponsesStreamOptionsSchema.optional(),
  parallel_tool_calls: z.boolean().optional(),
  tools: z.array(openAIResponsesFunctionToolSchema).min(1).optional(),
  tool_choice: z.union([
    z.literal("auto"),
    z.literal("required"),
    z.literal("none"),
    openAIResponsesForcedFunctionToolChoiceSchema
  ]).optional(),
  input: z
    .union([
      z.string().min(1),
      z.array(openAIResponsesInputMessageSchema).min(1),
      z.array(openAIResponsesTypedInputItemSchema).min(1)
    ])
    .optional(),
  airlock: airlockRequestExtensionsSchema.optional()
  })
  .refine(
    (value) =>
      value.input !== undefined ||
      value.prompt !== undefined ||
      value.prompt_id !== undefined,
    {
    message: "Either input or prompt is required",
    path: ["input"]
    }
  )
  .superRefine((value, context) => {
    const nestedPromptId = value.prompt?.id ?? value.prompt?.prompt_id;

    if (
      value.prompt_id !== undefined &&
      nestedPromptId !== undefined &&
      value.prompt_id !== nestedPromptId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "prompt_id must match prompt.id when both are provided",
        path: ["prompt_id"]
      });
    }

    if (!value.stream && value.stream_options !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "OpenAI Responses stream_options requires stream=true",
        path: ["stream_options"]
      });
    }
  });

export const openAIResponsesResponseSchema = z.object({
  id: z.string().min(1),
  object: z.literal("response"),
  model: z.string().min(1),
  status: z.literal("completed"),
  output: z.array(z.unknown()),
  output_text: z.string(),
  service_tier: z.enum(["auto", "default", "flex", "priority", "scale"]).optional(),
  store: z.boolean().optional(),
  prompt_cache_key: z.string().min(1).optional(),
  prompt_cache_retention: z.enum(["in_memory", "24h"]).optional(),
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
