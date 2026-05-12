import { z } from "zod";

export const airlockRequestExtensionsSchema = z
  .object({
    requestShaping: z.unknown().optional()
  })
  .strict();

export type AirlockRequestExtensions = z.infer<
  typeof airlockRequestExtensionsSchema
>;
