import { redirect } from "@sveltejs/kit";
import { getStoredCredentials } from "$lib/auth.js";
import type { LayoutLoad } from "./$types.js";

export const ssr = false;

export const load: LayoutLoad = async ({ data, url }) => {
  const creds = getStoredCredentials();
  const isLoginPage = url.pathname === "/login";
  const layoutData = data as {
    session: import("@auth/sveltekit").Session | null;
    googleOAuthEnabled?: boolean;
  };

  if (!creds && !isLoginPage) {
    redirect(302, "/login");
  }

  if (creds && isLoginPage) {
    redirect(302, "/");
  }

  return {
    session: layoutData.session,
    googleOAuthEnabled: layoutData.googleOAuthEnabled ?? false
  };
};
