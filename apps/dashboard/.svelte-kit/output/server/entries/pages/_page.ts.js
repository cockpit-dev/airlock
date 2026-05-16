import { c as createClient } from "../../chunks/auth.js";
const load = async () => {
  const client = createClient();
  if (!client) return { status: null, metrics: null, routingHealth: null };
  const [status, metrics, routingHealth] = await Promise.allSettled([
    client.getStatus(),
    client.getMetrics(),
    client.getRoutingHealth()
  ]);
  return {
    status: status.status === "fulfilled" ? status.value : null,
    metrics: metrics.status === "fulfilled" ? metrics.value : null,
    routingHealth: routingHealth.status === "fulfilled" ? routingHealth.value : null
  };
};
export {
  load
};
