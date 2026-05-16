import { SvelteKitAuth } from "@auth/sveltekit";
import Google from "@auth/sveltekit/providers/google";

export const { handle, signIn, signOut } = SvelteKitAuth(async (event) => {
  const env = event.platform?.env;
  const superAdminEmail = env?.AIRLOCK_GOOGLE_SUPER_ADMIN_EMAIL ?? "";

  return {
    providers: [
      Google({
        clientId: env?.GOOGLE_CLIENT_ID ?? "",
        clientSecret: env?.GOOGLE_CLIENT_SECRET ?? "",
      }),
    ],
    secret: env?.AUTH_SECRET,
    trustHost: true,
    pages: {
      signIn: "/login",
    },
    callbacks: {
      async signIn({ user }) {
        if (!user.email) return false;
        return true;
      },
      async jwt({ token, user }) {
        if (user?.email) {
          const isSuperAdmin =
            superAdminEmail && user.email === superAdminEmail;
          token.role = isSuperAdmin ? "super_admin" : "viewer";
        }
        return token;
      },
      async session({ session, token }) {
        if (session.user && token.role) {
          (session.user as Record<string, unknown>).role = token.role;
        }
        return session;
      },
    },
  };
});
