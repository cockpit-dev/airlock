import { createClient } from "$lib/auth.js";
import type { PageLoad } from "./$types.js";

export const load: PageLoad = async () => {
  const client = createClient();
  if (!client) return { keys: null };

  try {
    const keys = await client.listKeys();
    return { keys };
  } catch {
    return { keys: null };
  }
};
