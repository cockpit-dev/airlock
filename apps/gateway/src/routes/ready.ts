import type { Context } from "hono";

import { resolveGatewayConfig } from "../config.js";
import type { GatewayBindings } from "../env.js";

export function handleReady(context: Context) {
  try {
    resolveGatewayConfig(context.env as GatewayBindings);
  } catch {
    return context.json(
      {
        ok: false,
        ready: false,
        code: "not_ready"
      },
      503
    );
  }

  return context.json({ ok: true, ready: true });
}
