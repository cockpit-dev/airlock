import type { LayoutServerLoad } from "./$types.js";

export const load: LayoutServerLoad = async (event) => {
  const env = event.platform?.env;
  const googleOAuthEnabled =
    typeof env?.AUTH_SECRET === "string" &&
    env.AUTH_SECRET.trim().length >= 32 &&
    typeof env?.GOOGLE_CLIENT_ID === "string" &&
    env.GOOGLE_CLIENT_ID.trim().length > 0 &&
    typeof env?.GOOGLE_CLIENT_SECRET === "string" &&
    env.GOOGLE_CLIENT_SECRET.trim().length > 0;

  return {
    session: await event.locals.auth(),
    googleOAuthEnabled
  };
};
