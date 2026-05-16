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
