import { createClient } from "$lib/auth.js";
import type { PageLoad } from "./$types.js";

export const load: PageLoad = async () => {
  const client = createClient();
  if (!client) return { config: null };

  try {
    const config = await client.getConfig();
    return { config };
  } catch {
    return { config: null };
  }
};
