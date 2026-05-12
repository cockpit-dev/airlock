import { z } from "zod";

export const runtimeModeSchema = z.enum(["free", "scale"]);

export type RuntimeMode = z.infer<typeof runtimeModeSchema>;
