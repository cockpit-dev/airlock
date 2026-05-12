import type { Context } from "hono";

export function handleHealth(context: Context) {
  return context.json({ ok: true });
}
