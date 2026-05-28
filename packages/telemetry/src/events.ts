import { runtimeModeSchema } from "@airlock/shared";
import { z } from "zod";

export const tokenUsageSchema = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  totalTokens: z.number().int().min(0),
  cacheReadTokens: z.number().int().min(0).optional(),
  cacheWriteTokens: z.number().int().min(0).optional(),
  cachedInputTokens: z.number().int().min(0).optional()
});

const gatewayRequestTelemetryBaseSchema = z.object({
  kind: z.literal("gateway_request"),
  occurredAt: z.string().datetime({ offset: true }),
  requestId: z.string().min(1),
  mode: runtimeModeSchema,
  routePath: z.string().min(1),
  stream: z.boolean(),
  durationMs: z.number().int().min(0),
  statusCode: z.number().int().min(100).max(599),
  gatewayKeyId: z.string().min(1).optional(),
  externalModel: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  providerModel: z.string().min(1).optional(),
  fallbackUsed: z.boolean().optional(),
  usage: tokenUsageSchema.optional(),
  routingStrategy: z.string().min(1).optional(),
  attemptCount: z.number().int().min(1).optional(),
  primaryTargetOpen: z.boolean().optional(),
  timeoutBudgetMs: z.number().int().min(0).optional(),
  timeoutBudgetRemainingMs: z.number().int().min(0).optional(),
  malformedSseEventCount: z.number().int().min(0).optional()
});

const gatewayRequestTelemetrySuccessSchema =
  gatewayRequestTelemetryBaseSchema.extend({
    outcome: z.literal("success")
  });

const gatewayRequestTelemetryErrorSchema =
  gatewayRequestTelemetryBaseSchema.extend({
    outcome: z.literal("error"),
    errorCode: z.string().min(1),
    errorCategory: z.string().min(1),
    retryable: z.boolean(),
    upstreamErrorCode: z.string().min(1).optional()
  });

export const gatewayRequestTelemetryEventSchema = z.union([
  gatewayRequestTelemetrySuccessSchema,
  gatewayRequestTelemetryErrorSchema
]);

export type TokenUsage = z.infer<typeof tokenUsageSchema>;
export type GatewayRequestTelemetryEvent = z.infer<
  typeof gatewayRequestTelemetryEventSchema
>;
