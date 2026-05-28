import { z } from "zod";

import { airlockRequestExtensionsSchema } from "./airlock-extensions.js";

const geminiTextPartSchema = z.object({
  text: z.string().min(1)
});

const geminiFunctionCallPartSchema = z.object({
  functionCall: z.object({
    name: z.string().min(1),
    args: z.record(z.string(), z.unknown()).optional()
  })
});

const geminiFunctionResponsePartSchema = z.object({
  functionResponse: z.object({
    name: z.string().min(1),
    response: z.record(z.string(), z.unknown()).optional()
  })
});

export const geminiPartSchema = z.union([
  geminiTextPartSchema,
  geminiFunctionCallPartSchema,
  geminiFunctionResponsePartSchema
]);

export const geminiContentSchema = z.object({
  role: z.enum(["user", "model"]).optional(),
  parts: z.array(geminiPartSchema).min(1)
});

const geminiFunctionDeclarationSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  parameters: z.record(z.string(), z.unknown()).optional()
});

const geminiToolSchema = z.object({
  functionDeclarations: z.array(geminiFunctionDeclarationSchema).min(1)
});

const geminiFunctionCallingConfigSchema = z.object({
  mode: z.enum(["AUTO", "ANY", "NONE"]).optional(),
  allowedFunctionNames: z.array(z.string().min(1)).min(1).optional()
});

const geminiGenerationConfigSchema = z
  .object({
    maxOutputTokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),
    topP: z.number().min(0).max(1).optional(),
    stopSequences: z.array(z.string().min(1)).min(1).optional(),
    responseMimeType: z.string().min(1).optional(),
    responseJsonSchema: z.record(z.string(), z.unknown()).optional()
  })
  .passthrough();

export const geminiGenerateContentRequestSchema = z
  .object({
    system_instruction: geminiContentSchema.optional(),
    contents: z.array(geminiContentSchema).min(1),
    tools: z.array(geminiToolSchema).min(1).optional(),
    toolConfig: z
      .object({
        functionCallingConfig: geminiFunctionCallingConfigSchema.optional()
      })
      .optional(),
    generationConfig: geminiGenerationConfigSchema.optional(),
    airlock: airlockRequestExtensionsSchema.optional()
  })
  .passthrough();

export type GeminiPart = z.infer<typeof geminiPartSchema>;
export type GeminiContent = z.infer<typeof geminiContentSchema>;
export type GeminiGenerateContentRequest = z.infer<
  typeof geminiGenerateContentRequestSchema
>;
