// @ts-nocheck
import { redirect } from "@sveltejs/kit";
import { getStoredCredentials } from "$lib/auth.js";
import type { LayoutLoad } from "./$types.js";

export const load = async ({ url }: Parameters<LayoutLoad>[0]) => {
  const creds = getStoredCredentials();
  const isLoginPage = url.pathname === "/login";

  if (!creds && !isLoginPage) {
    redirect(302, "/login");
  }

  if (creds && isLoginPage) {
    redirect(302, "/");
  }

  return {};
};
