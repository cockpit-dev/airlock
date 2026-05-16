import { createClient } from "$lib/auth.js";
import type { PageLoad } from "./$types.js";

export const load: PageLoad = async ({ params }) => {
  const client = createClient();
  if (!client) return { key: null, status: null, events: null };

  try {
    const [key, status, events] = await Promise.allSettled([
      client.getKey(params.id),
      client.getKeyStatus(params.id),
      client.getKeyEvents(params.id)
    ]);
    return {
      key: key.status === "fulfilled" ? key.value : null,
      status: status.status === "fulfilled" ? status.value : null,
      events: events.status === "fulfilled" ? events.value : null
    };
  } catch {
    return { key: null, status: null, events: null };
  }
};
