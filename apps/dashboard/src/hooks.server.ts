import { sequence } from "@sveltejs/kit/hooks";
import type { Handle } from "@sveltejs/kit";
import { handle as authHandle } from "./auth.js";

const authorizationHandle: Handle = async ({ event, resolve }) => {
  return resolve(event);
};

export const handle = sequence(authHandle, authorizationHandle);
