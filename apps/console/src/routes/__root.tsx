import {
  Outlet,
  createRootRouteWithContext,
  redirect,
} from "@tanstack/react-router";
import { ClientProvider } from "../lib/client";
import { createClientFromStorage, getStoredCredentials } from "../lib/auth";
import { AppLayout } from "../components/app-layout";
import type { RouterContext } from "../router";

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: ({ location }) => {
    if (!getStoredCredentials() && location.pathname !== "/login") {
      throw redirect({ to: "/login" });
    }
  },
  component: RootLayout,
});

function RootLayout() {
  const client = createClientFromStorage();

  if (!client) {
    return <Outlet />;
  }

  return (
    <ClientProvider client={client}>
      <AppLayout>
        <Outlet />
      </AppLayout>
    </ClientProvider>
  );
}
