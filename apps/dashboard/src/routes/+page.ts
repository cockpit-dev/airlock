import { createClient } from "$lib/auth.js";
import type { PageLoad } from "./$types.js";

export const load: PageLoad = async ({ fetch }) => {
  const client = createClient(undefined, undefined, fetch);
  if (!client) return { status: null, metrics: null, routingHealth: null };

  const [status, metrics, routingHealth] = await Promise.allSettled([
    client.getStatus(),
    client.getMetrics(),
    client.getRoutingHealth()
  ]);

  return {
    status: status.status === "fulfilled" ? status.value : null,
    metrics: metrics.status === "fulfilled" ? metrics.value : null,
    routingHealth:
      routingHealth.status === "fulfilled" ? routingHealth.value : null
  };
};
