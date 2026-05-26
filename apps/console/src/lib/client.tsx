import { createContext, useContext, type ReactNode } from "react";
import { AirlockClient } from "./api";

const ClientContext = createContext<AirlockClient | null>(null);

export function ClientProvider({
  client,
  children,
}: {
  client: AirlockClient;
  children: ReactNode;
}) {
  return (
    <ClientContext.Provider value={client}>{children}</ClientContext.Provider>
  );
}

export function useClient(): AirlockClient {
  const client = useContext(ClientContext);
  if (!client) throw new Error("AirlockClient not available");
  return client;
}
