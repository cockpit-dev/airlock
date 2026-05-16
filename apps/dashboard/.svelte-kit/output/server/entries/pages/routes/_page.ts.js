import { c as createClient } from "../../../chunks/auth.js";
const load = async () => {
  const client = createClient();
  if (!client) return { routingHealth: null };
  try {
    const routingHealth = await client.getRoutingHealth();
    return { routingHealth };
  } catch {
    return { routingHealth: null };
  }
};
export {
  load
};
