import { createClient } from "$lib/auth.js";
import type { PageLoad } from "./$types.js";

export const load: PageLoad = async ({ fetch }) => {
  const client = createClient(undefined, undefined, fetch);
  if (!client) return { routingHealth: null };

  try {
    const routingHealth = await client.getRoutingHealth();
    return { routingHealth };
  } catch {
    return { routingHealth: null };
  }
};
