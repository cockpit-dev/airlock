import { sequence } from "@sveltejs/kit/hooks";
import { handle as authHandle } from "./auth.js";

async function authorizationHandle({ event, resolve }) {
  return resolve(event);
}

export const handle = sequence(authHandle, authorizationHandle);
