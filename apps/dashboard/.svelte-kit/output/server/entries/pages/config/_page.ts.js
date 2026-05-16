import { c as createClient } from "../../../chunks/auth.js";
const load = async () => {
  const client = createClient();
  if (!client) return { config: null };
  try {
    const config = await client.getConfig();
    return { config };
  } catch {
    return { config: null };
  }
};
export {
  load
};
