import { SvelteKitAuth } from "@auth/sveltekit";
import Google from "@auth/sveltekit/providers/google";

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function getOAuthCapability(
  env: Record<string, string | undefined> | undefined
): {
  enabled: boolean;
  secret: string;
  clientId?: string;
  clientSecret?: string;
} {
  const authSecret = env?.AUTH_SECRET?.trim();
  const clientId = env?.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env?.GOOGLE_CLIENT_SECRET?.trim();
  const enabled =
    isNonEmptyString(authSecret) &&
    isNonEmptyString(clientId) &&
    isNonEmptyString(clientSecret);

  return {
    enabled,
    secret:
      authSecret && authSecret.length >= 32
        ? authSecret
        : "dev-auth-secret-for-local-dashboard-only-0001",
    ...(clientId ? { clientId } : {}),
    ...(clientSecret ? { clientSecret } : {})
  };
}

export const { handle, signIn, signOut } = SvelteKitAuth(async (event) => {
  const env = event.platform?.env;
  const superAdminEmail = env?.AIRLOCK_GOOGLE_SUPER_ADMIN_EMAIL ?? "";
  const oauth = getOAuthCapability(env);

  return {
    providers: oauth.enabled
      ? [
          Google({
            clientId: oauth.clientId!,
            clientSecret: oauth.clientSecret!
          })
        ]
      : [],
    secret: oauth.secret,
    trustHost: true,
    pages: {
      signIn: "/login"
    },
    callbacks: {
      async signIn({ user }) {
        if (!oauth.enabled) {
          return false;
        }
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
          session.user.role = String(token.role);
        }
        return session;
      }
    }
  };
});
