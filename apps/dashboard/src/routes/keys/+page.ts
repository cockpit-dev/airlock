import { createClient } from "$lib/auth.js";
import type { PageLoad } from "./$types.js";

export const load: PageLoad = async ({ fetch }) => {
  const client = createClient(undefined, undefined, fetch);
  if (!client) return { keys: null };

  try {
    const keys = await client.listKeys();
    return { keys };
  } catch {
    return { keys: null };
  }
};
