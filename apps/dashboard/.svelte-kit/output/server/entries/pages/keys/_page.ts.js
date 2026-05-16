import { c as createClient } from "../../../chunks/auth.js";
const load = async () => {
  const client = createClient();
  if (!client) return { keys: null };
  try {
    const keys = await client.listKeys();
    return { keys };
  } catch {
    return { keys: null };
  }
};
export {
  load
};
