import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Card, Input, Button } from "@heroui/react";
import { FiLock } from "react-icons/fi";
import { verifyCredentials, storeCredentials, getStoredCredentials } from "../lib/auth";

export const Route = createFileRoute("/login")({
  beforeLoad: () => {
    if (getStoredCredentials()) throw redirect({ to: "/" });
  },
  component: LoginPage,
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
        setError("Invalid credentials");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-content1">
      <Card.Root className="w-full max-w-md">
        <Card.Header className="flex gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary text-primary-foreground">
            <FiLock size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold">Airlock Console</h1>
            <p className="text-sm text-default-500">AI Gateway</p>
          </div>
        </Card.Header>
        <Card.Content>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">Gateway URL</label>
              <Input
                placeholder="https://your-gateway.workers.dev"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">Admin Token</label>
              <Input
                type="password"
                placeholder="Your admin token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button
              type="submit"
              variant="primary"
              isDisabled={loading}
              fullWidth
            >
              {loading ? "Connecting..." : "Connect"}
            </Button>
          </form>
        </Card.Content>
      </Card.Root>
    </div>
  );
}
