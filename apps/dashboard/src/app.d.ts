import type { Session } from "@auth/sveltekit";

declare module "@auth/sveltekit" {
  interface Session {
    user?: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role?: string;
    };
  }
}

declare global {
  namespace App {
    interface Platform {
      env?: Record<string, string | undefined>;
    }

    interface Locals {
      auth(): Promise<import("@auth/sveltekit").Session | null>;
    }
  }
}
