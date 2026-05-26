import { createFileRoute } from "@tanstack/react-router";
import {
  Button,
  Card,
  Chip,
  ProgressBar,
  Skeleton,
  Table,
} from "@heroui/react";
import {
  FiServer,
  FiGitBranch,
  FiKey,
  FiAlertTriangle,
  FiActivity,
  FiAlertCircle,
  FiRefreshCw,
} from "react-icons/fi";
import { useStatus, useMetrics, useRoutingHealth } from "../hooks/use-queries";
import { HealthChip } from "../components/health-chip";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

function DashboardPage() {
  const status = useStatus();
  const metrics = useMetrics(10_000);
  const health = useRoutingHealth();

  if (status.isLoading) return <DashboardSkeleton />;

  if (status.error) {
    return (
      <div className="p-6 space-y-6 animate-fade-in">
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-4 flex items-start gap-3">
          <FiAlertCircle className="text-danger mt-0.5 shrink-0" size={20} />
          <div>
            <p className="font-semibold text-danger">
              Failed to load dashboard
            </p>
            <p className="text-sm text-default-400 mt-1">
              {status.error.message}
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onPress={() => status.refetch()}
          >
            <FiRefreshCw size={14} />
          </Button>
        </div>
      </div>
    );
  }

  const data = status.data;
  if (!data) return null;

  const circuitBreakerColor =
    data.circuitBreaker.openTargets.length > 0 ? "danger" : "warning";

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-default-400">
            System overview and real-time metrics
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-default-400">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success" />
          </span>
          <span>Live</span>
          <span className="text-default-300">|</span>
          <span>10s refresh</span>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<FiServer size={18} />}
          iconBg="bg-primary/10 text-primary"
          borderClass="border-l-primary"
          label="Providers"
          value={data.providers.length}
          subtitle={
            <Chip size="sm" variant="soft" color="accent">
              {data.providers.filter((p) => p.configured).length} configured
            </Chip>
          }
        />
        <StatCard
          icon={<FiGitBranch size={18} />}
          iconBg="bg-accent/10 text-accent"
          borderClass="border-l-accent"
          label="Routes"
          value={data.routes.length}
          subtitle={
            <Chip size="sm" variant="soft" color="accent">
              {data.routes.reduce((sum, r) => sum + 1 + r.fallbackCount, 0)}{" "}
              targets
            </Chip>
          }
        />
        <StatCard
          icon={<FiKey size={18} />}
          iconBg="bg-success/10 text-success"
          borderClass="border-l-success"
          label="Keys"
          value={data.keys.total}
          subtitle={
            <Chip size="sm" variant="soft" color="success">
              registry
            </Chip>
          }
        />
        <StatCard
          icon={<FiAlertTriangle size={18} />}
          iconBg={
            circuitBreakerColor === "danger"
              ? "bg-danger/10 text-danger"
              : "bg-warning/10 text-warning"
          }
          borderClass={`border-l-${circuitBreakerColor}`}
          label="Circuit Breakers"
          value={data.circuitBreaker.openTargets.length}
          subtitle={
            <Chip size="sm" variant="soft" color={circuitBreakerColor}>
              {data.circuitBreaker.halfOpenTargets.length} half-open
            </Chip>
          }
        />
      </div>

      {/* Metrics Card */}
      <Card.Root>
        <Card.Header className="px-5 pt-5 pb-0">
          <div className="flex items-center gap-2">
            <FiActivity size={16} className="text-default-400" />
            <h2 className="text-lg font-semibold">Metrics (live)</h2>
          </div>
        </Card.Header>
        <Card.Content className="p-5">
          {metrics.isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-3 w-16 rounded" />
                  <Skeleton className="h-7 w-20 rounded" />
                </div>
              ))}
            </div>
          ) : metrics.data ? (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <MetricItem
                label="Requests"
                value={metrics.data.requests.toLocaleString()}
              />
              <MetricItem
                label="Errors"
                value={metrics.data.errors.toLocaleString()}
                valueClass={
                  metrics.data.errors > 0 ? "text-danger" : undefined
                }
              />
              <MetricItem
                label="Error Rate"
                value={`${(metrics.data.errorRate * 100).toFixed(1)}%`}
                valueClass={
                  metrics.data.errorRate > 0.05 ? "text-danger" : undefined
                }
              />
              <MetricItem
                label="Avg Latency"
                value={`${metrics.data.avgDurationMs.toFixed(0)}ms`}
              />
              <MetricItem
                label="Streams"
                value={metrics.data.streamCount.toLocaleString()}
              />
            </div>
          ) : (
            <p className="text-sm text-default-400">No metrics available</p>
          )}
        </Card.Content>
      </Card.Root>

      {/* Route Health Table */}
      {health.data && (
        <Card.Root>
          <Card.Header className="px-5 pt-5 pb-0">
            <h2 className="text-lg font-semibold">Route Health</h2>
          </Card.Header>
          <Card.Content className="p-5">
            <Table.Root>
              <Table.Header>
                <Table.Column>Route</Table.Column>
                <Table.Column>Status</Table.Column>
                <Table.Column>Strategy</Table.Column>
                <Table.Column>Targets</Table.Column>
                <Table.Column>Health</Table.Column>
              </Table.Header>
              <Table.Body>
                {Object.entries(health.data.routes).map(([route, info]) => (
                  <Table.Row key={route}>
                    <Table.Cell>
                      <span className="font-mono text-xs">{route}</span>
                    </Table.Cell>
                    <Table.Cell>
                      <HealthChip status={info.healthStatus} />
                    </Table.Cell>
                    <Table.Cell>
                      <span className="text-sm capitalize">
                        {info.strategy.replace(/_/g, " ")}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="text-sm">
                        {info.healthyTargetCount}/{info.totalTargetCount}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <ProgressBar.Root
                        value={
                          info.totalTargetCount > 0
                            ? (info.healthyTargetCount /
                                info.totalTargetCount) *
                              100
                            : 0
                        }
                        color={
                          info.healthStatus === "healthy"
                            ? "success"
                            : info.healthStatus === "degraded"
                              ? "warning"
                              : "danger"
                        }
                        className="w-24"
                      />
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Card.Content>
        </Card.Root>
      )}
    </div>
  );
}

/* ── Stat Card ──────────────────────────────────────────────────────── */

function StatCard({
  icon,
  iconBg,
  borderClass,
  label,
  value,
  subtitle,
}: {
  icon: React.ReactNode;
  iconBg: string;
  borderClass: string;
  label: string;
  value: number;
  subtitle: React.ReactNode;
}) {
  return (
    <Card.Root className={`border-l-4 ${borderClass}`}>
      <Card.Content className="flex items-start gap-3">
        <div
          className={`flex items-center justify-center w-9 h-9 rounded-full shrink-0 ${iconBg}`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-default-400">
            {label}
          </p>
          <p className="text-2xl font-bold">{value}</p>
          <div className="mt-1">{subtitle}</div>
        </div>
      </Card.Content>
    </Card.Root>
  );
}

/* ── Metric Item ────────────────────────────────────────────────────── */

function MetricItem({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-default-400">
        {label}
      </p>
      <p className={`text-xl font-semibold ${valueClass ?? ""}`}>{value}</p>
    </div>
  );
}

/* ── Skeleton Loading State ─────────────────────────────────────────── */

function DashboardSkeleton() {
  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40 rounded" />
          <Skeleton className="h-4 w-60 rounded" />
        </div>
        <Skeleton className="h-5 w-28 rounded" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card.Root key={i}>
            <Card.Content className="flex items-start gap-3">
              <Skeleton className="h-9 w-9 rounded-full shrink-0" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-3 w-16 rounded" />
                <Skeleton className="h-7 w-12 rounded" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
            </Card.Content>
          </Card.Root>
        ))}
      </div>

      <Card.Root>
        <Card.Content className="p-5">
          <Skeleton className="h-5 w-32 rounded mb-4" />
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-16 rounded" />
                <Skeleton className="h-7 w-20 rounded" />
              </div>
            ))}
          </div>
        </Card.Content>
      </Card.Root>
    </div>
  );
}
