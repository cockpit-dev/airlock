import { redirect } from "@sveltejs/kit";
import { g as getStoredCredentials } from "../../chunks/auth.js";
const load = async ({ url }) => {
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
export {
  load
};
