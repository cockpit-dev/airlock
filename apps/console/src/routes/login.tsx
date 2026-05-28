import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Alert, Button, Card, Input, Label, TextField } from "@heroui/react";
import { FiGlobe, FiKey, FiLock } from "react-icons/fi";
import {
  getStoredCredentials,
  storeCredentials,
  verifyCredentials
} from "../lib/auth";

export const Route = createFileRoute("/login")({
  beforeLoad: () => {
    if (getStoredCredentials()) throw redirect({ to: "/" });
  },
  component: LoginPage
});

function LoginPage() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const valid = await verifyCredentials(url, token);
      if (valid) {
        storeCredentials(url, token);
        await navigate({ to: "/" });
      } else {
        setError("Invalid credentials. Please check your admin token.");
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Connection failed. Please check the gateway URL."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card.Root className="w-full max-w-sm animate-fade-in">
        <Card.Header className="flex-col items-center gap-4 pt-8 pb-2">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-accent text-accent-foreground">
            <FiLock size={22} />
          </div>
          <div className="flex flex-col items-center gap-1">
            <h1 className="text-xl font-bold tracking-tight">
              Airlock Console
            </h1>
            <p className="text-sm text-muted">AI Gateway Management</p>
          </div>
        </Card.Header>

        <Card.Content className="px-6 pb-2">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <TextField isRequired value={url} onChange={setUrl}>
              <Label>Gateway URL</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
                  <FiGlobe size={16} />
                </span>
                <Input
                  placeholder="https://your-gateway.workers.dev"
                  value={url}
                  className="pl-9"
                  required
                />
              </div>
            </TextField>

            <TextField isRequired value={token} onChange={setToken}>
              <Label>Admin Token</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
                  <FiKey size={16} />
                </span>
                <Input
                  type="password"
                  placeholder="Your admin token"
                  value={token}
                  className="pl-9"
                  required
                />
              </div>
            </TextField>

            {error && (
              <Alert status="danger" className="animate-fade-in">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Description>{error}</Alert.Description>
                </Alert.Content>
              </Alert>
            )}

            <Button
              type="submit"
              variant="primary"
              isPending={loading}
              fullWidth
              className="mt-1"
            >
              Connect
            </Button>
          </form>
        </Card.Content>

        <div className="px-6 pb-6 pt-4 text-center">
          <p className="text-xs text-muted">Secured by Airlock</p>
        </div>
      </Card.Root>
    </div>
  );
}
