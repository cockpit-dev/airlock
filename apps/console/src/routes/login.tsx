import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Card, Input, Spinner } from "@heroui/react";
import { FiAlertCircle, FiGlobe, FiKey, FiLock } from "react-icons/fi";
import {
  getStoredCredentials,
  storeCredentials,
  verifyCredentials,
} from "../lib/auth";

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
        setError("Invalid credentials. Please check your admin token.");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Connection failed. Please check the gateway URL."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-content1 via-content1 to-content2 p-4">
      <Card.Root className="w-full max-w-sm rounded-2xl shadow-2xl animate-fade-in">
        <Card.Header className="flex-col items-center gap-4 pt-8 pb-2">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
            <FiLock size={22} />
          </div>
          <div className="flex flex-col items-center gap-1">
            <h1 className="text-xl font-bold tracking-tight">Airlock Console</h1>
            <p className="text-sm text-default-400">AI Gateway Management</p>
          </div>
        </Card.Header>

        <Card.Content className="px-6 pb-2">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-default-600">
                Gateway URL
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-default-400 pointer-events-none">
                  <FiGlobe size={16} />
                </span>
                <Input
                  placeholder="https://your-gateway.workers.dev"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="pl-9"
                  required
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-default-600">
                Admin Token
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-default-400 pointer-events-none">
                  <FiKey size={16} />
                </span>
                <Input
                  type="password"
                  placeholder="Your admin token"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="pl-9"
                  required
                />
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2.5 text-sm text-danger animate-fade-in">
                <FiAlertCircle size={16} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              isDisabled={loading}
              fullWidth
              className="mt-1"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <Spinner size="sm" />
                  Connecting...
                </span>
              ) : (
                "Connect"
              )}
            </Button>
          </form>
        </Card.Content>

        <div className="px-6 pb-6 pt-4 text-center">
          <p className="text-xs text-default-300">Secured by Airlock</p>
        </div>
      </Card.Root>
    </div>
  );
}
