import { z } from "zod";

import { airlockRequestExtensionsSchema } from "./airlock-extensions.js";

const openAIChatTextContentPartSchema = z.object({
  type: z.literal("text"),
  text: z.string().min(1)
});

const openAIChatStreamOptionsSchema = z.object({
  include_usage: z.boolean()
});

const openAIChatTextResponseFormatSchema = z.object({
  type: z.literal("text")
});

const openAIChatJsonObjectResponseFormatSchema = z.object({
  type: z.literal("json_object")
});

const openAIChatJsonSchemaResponseFormatSchema = z.object({
  type: z.literal("json_schema"),
  json_schema: z.object({
    name: z.string().min(1),
    schema: z.record(z.string(), z.unknown()),
    strict: z.boolean().optional()
  })
});

const openAIChatResponseFormatSchema = z.union([
  openAIChatTextResponseFormatSchema,
  openAIChatJsonObjectResponseFormatSchema,
  openAIChatJsonSchemaResponseFormatSchema
]);

const openAIChatFunctionToolSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1),
    description: z.string().min(1).optional(),
    parameters: z.record(z.string(), z.unknown())
  })
});

const openAIChatAssistantToolCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1),
    arguments: z.string()
  })
});

const openAIChatSystemUserDeveloperMessageSchema = z.object({
  role: z.enum(["system", "developer", "user"]),
  content: z.union([
    z.string(),
    z.array(openAIChatTextContentPartSchema).min(1)
  ])
});

const openAIChatAssistantPlainMessageSchema = z.object({
  role: z.literal("assistant"),
  content: z.union([
    z.string(),
    z.array(openAIChatTextContentPartSchema).min(1)
  ])
});

const openAIChatBaseMessageSchema = z.union([
  openAIChatSystemUserDeveloperMessageSchema,
  openAIChatAssistantPlainMessageSchema
]);

const openAIChatAssistantToolCallMessageSchema = z.object({
  role: z.literal("assistant"),
  content: z.string(),
  tool_calls: z.array(openAIChatAssistantToolCallSchema).min(1)
});

const openAIChatToolMessageSchema = z.object({
  role: z.literal("tool"),
  tool_call_id: z.string().min(1),
  content: z.string()
});

const openAIChatForcedFunctionToolChoiceSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1)
  })
});

export const openAIChatMessageSchema = z.union([
  openAIChatAssistantToolCallMessageSchema,
  openAIChatToolMessageSchema,
  openAIChatBaseMessageSchema
]);

export const openAIChatCompletionRequestSchema = z
  .object({
  model: z.string().min(1),
  stream: z.boolean().default(false),
  max_tokens: z.number().int().positive().optional(),
  max_completion_tokens: z.number().int().positive().optional(),
  reasoning_effort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh"]).optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  response_format: openAIChatResponseFormatSchema.optional(),
  modalities: z.array(z.literal("text")).length(1).optional(),
  stop: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
  stream_options: openAIChatStreamOptionsSchema.optional(),
  parallel_tool_calls: z.boolean().optional(),
  tools: z.array(openAIChatFunctionToolSchema).min(1).optional(),
  tool_choice: z.union([
    z.literal("auto"),
    z.literal("required"),
    z.literal("none"),
    openAIChatForcedFunctionToolChoiceSchema
  ]).optional(),
  messages: z.array(openAIChatMessageSchema).min(1),
  airlock: airlockRequestExtensionsSchema.optional()
  })
  .superRefine((value, context) => {
    if (!value.stream && value.stream_options !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "OpenAI Chat stream_options requires stream=true",
        path: ["stream_options"]
      });
    }
  });

export type OpenAIChatMessage = z.infer<typeof openAIChatMessageSchema>;
export type OpenAIChatCompletionRequest = z.infer<
  typeof openAIChatCompletionRequestSchema
>;
