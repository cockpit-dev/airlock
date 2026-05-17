import { createClient } from "$lib/auth.js";
import type { PageLoad } from "./$types.js";

export const load: PageLoad = async ({ fetch }) => {
  const client = createClient(undefined, undefined, fetch);
  if (!client) return { config: null };

  try {
    const config = await client.getConfig();
    return { config };
  } catch {
    return { config: null };
  }
};
