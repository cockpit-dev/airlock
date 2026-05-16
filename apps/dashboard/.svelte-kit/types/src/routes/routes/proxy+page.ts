// @ts-nocheck
import { createClient } from "$lib/auth.js";
import type { PageLoad } from "./$types.js";

export const load = async () => {
  const client = createClient();
  if (!client) return { routingHealth: null };

  try {
    const routingHealth = await client.getRoutingHealth();
    return { routingHealth };
  } catch {
    return { routingHealth: null };
  }
};
;null as any as PageLoad;