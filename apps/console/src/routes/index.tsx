import { createFileRoute } from "@tanstack/react-router";
import {
  Button,
  Card,
  Chip,
  ProgressBar,
  Skeleton,
} from "@heroui/react";
import {
  FiServer,
  FiGitBranch,
  FiKey,
  FiAlertTriangle,
  FiActivity,
  FiAlertCircle,
  FiRefreshCw,
  FiPieChart,
  FiBarChart2,
  FiClock,
  FiCpu,
} from "react-icons/fi";
import { useStatus, useMetrics, useRoutingHealth } from "../hooks/use-queries";
import { HealthChip } from "../components/health-chip";
import {
  CacheUsageByModelChart,
  StatusCodeChart,
  ProviderRequestsChart,
  RouteLatencyChart,
  TokenUsageByKeyChart,
  TokenUsageByModelChart,
  TokenUsageByProtocolChart,
} from "../components/dashboard-charts";
import { DataTable, Table } from "../components/data-table";

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
      <div className="console-page console-stack animate-fade-in">
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-3 flex items-start gap-2">
          <FiAlertCircle className="text-danger mt-0.5 shrink-0" size={16} />
          <div className="min-w-0">
            <p className="font-medium text-sm text-danger">
              Failed to load dashboard
            </p>
            <p className="text-xs text-muted mt-0.5">
              {status.error.message}
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto shrink-0"
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
    <div className="console-page console-stack animate-fade-in">
      <div className="console-header">
        <div>
          <h1 className="console-title">Dashboard</h1>
          <p className="console-subtitle">
            System overview and real-time metrics
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
          </span>
          <span>Live</span>
          <span className="text-muted/50 mx-0.5">|</span>
          <span>10s</span>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <StatCard
          icon={<FiServer size={15} />}
          iconBg="bg-accent-soft text-accent-soft-foreground"
          label="Providers"
          value={data.providers.length}
          subtitle={
            <span className="text-[11px] text-muted">
              {data.providers.filter((p) => p.configured).length} configured
            </span>
          }
        />
        <StatCard
          icon={<FiGitBranch size={15} />}
          iconBg="bg-accent/10 text-accent"
          label="Routes"
          value={data.routes.length}
          subtitle={
            <span className="text-[11px] text-muted">
              {data.routes.reduce((sum, r) => sum + 1 + r.fallbackCount, 0)}{" "}
              targets
            </span>
          }
        />
        <StatCard
          icon={<FiKey size={15} />}
          iconBg="bg-success/10 text-success"
          label="Keys"
          value={data.keys.total}
          subtitle={
            <span className="text-[11px] text-muted">registry</span>
          }
        />
        <StatCard
          icon={<FiAlertTriangle size={15} />}
          iconBg={
            circuitBreakerColor === "danger"
              ? "bg-danger/10 text-danger"
              : "bg-warning/10 text-warning"
          }
          label="Breakers"
          value={data.circuitBreaker.openTargets.length}
          subtitle={
            <span className="text-[11px] text-muted">
              {data.circuitBreaker.halfOpenTargets.length} half-open
            </span>
          }
        />
      </div>

      <Card.Root>
        <Card.Header className="flex-row items-center justify-between">
          <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
            <FiActivity size={14} className="text-muted" />
            <h2>Request Health</h2>
          </div>
          <span className="text-[11px] text-muted">Live 10s</span>
        </Card.Header>
        <Card.Content>
          {metrics.isLoading ? (
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-2.5 w-12 rounded" />
                  <Skeleton className="h-5 w-16 rounded" />
                </div>
              ))}
            </div>
          ) : metrics.data ? (
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
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
            <p className="text-xs text-muted">No metrics available</p>
          )}
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header className="flex-row items-center justify-between">
          <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
            <FiCpu size={14} className="text-muted" />
            <h2>Token Usage</h2>
          </div>
          <span className="text-[11px] text-muted">Live 10s</span>
        </Card.Header>
        <Card.Content>
          {metrics.isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-2.5 w-16 rounded" />
                  <Skeleton className="h-5 w-20 rounded" />
                </div>
              ))}
            </div>
          ) : metrics.data ? (
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
              <MetricItem
                label="Input Tokens"
                value={metrics.data.inputTokens.toLocaleString()}
              />
              <MetricItem
                label="Output Tokens"
                value={metrics.data.outputTokens.toLocaleString()}
              />
              <MetricItem
                label="Total Tokens"
                value={metrics.data.totalTokens.toLocaleString()}
              />
              <MetricItem
                label="Usage Coverage"
                value={`${(metrics.data.usageCoverage * 100).toFixed(0)}%`}
              />
              <MetricItem
                label="Cache Read"
                value={metrics.data.cacheReadTokens.toLocaleString()}
              />
              <MetricItem
                label="Cache Write"
                value={metrics.data.cacheWriteTokens.toLocaleString()}
              />
            </div>
          ) : (
            <p className="text-xs text-muted">No token usage available</p>
          )}
        </Card.Content>
      </Card.Root>

      {metrics.data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-3">
          <Card.Root>
            <Card.Header>
              <Card.Title className="flex items-center gap-2">
                <FiPieChart size={14} className="text-muted" />
                Status Codes
              </Card.Title>
            </Card.Header>
            <Card.Content>
              <StatusCodeChart statusCodes={metrics.data.statusCodes} />
            </Card.Content>
          </Card.Root>

          <Card.Root>
            <Card.Header>
              <Card.Title className="flex items-center gap-2">
                <FiBarChart2 size={14} className="text-muted" />
                Requests by Provider
              </Card.Title>
            </Card.Header>
            <Card.Content>
              <ProviderRequestsChart byProvider={metrics.data.byProvider} />
            </Card.Content>
          </Card.Root>

          <Card.Root className="lg:col-span-2">
            <Card.Header>
              <Card.Title className="flex items-center gap-2">
                <FiClock size={14} className="text-muted" />
                Latency by Route
              </Card.Title>
            </Card.Header>
            <Card.Content>
              <RouteLatencyChart byRoute={metrics.data.byRoute} />
            </Card.Content>
          </Card.Root>

          <Card.Root>
            <Card.Header>
              <Card.Title className="flex items-center gap-2">
                <FiCpu size={14} className="text-muted" />
                Token Usage by Protocol
              </Card.Title>
            </Card.Header>
            <Card.Content>
              <TokenUsageByProtocolChart
                byProtocol={metrics.data.byProtocol}
              />
            </Card.Content>
          </Card.Root>

          <Card.Root>
            <Card.Header>
              <Card.Title className="flex items-center gap-2">
                <FiCpu size={14} className="text-muted" />
                Token Usage by Model
              </Card.Title>
            </Card.Header>
            <Card.Content>
              <TokenUsageByModelChart byModel={metrics.data.byModel} />
            </Card.Content>
          </Card.Root>

          <Card.Root>
            <Card.Header>
              <Card.Title className="flex items-center gap-2">
                <FiKey size={14} className="text-muted" />
                Token Usage by Key
              </Card.Title>
            </Card.Header>
            <Card.Content>
              <TokenUsageByKeyChart byKey={metrics.data.byKey} />
            </Card.Content>
          </Card.Root>

          <Card.Root>
            <Card.Header>
              <Card.Title className="flex items-center gap-2">
                <FiCpu size={14} className="text-muted" />
                Cached Input by Model
              </Card.Title>
            </Card.Header>
            <Card.Content>
              <CacheUsageByModelChart byModel={metrics.data.byModel} />
            </Card.Content>
          </Card.Root>
        </div>
      )}

      {health.data && (
        <Card.Root>
          <Card.Header>
            <Card.Title>Route Health</Card.Title>
          </Card.Header>
          <Card.Content className="p-0">
            <DataTable aria-label="Route health">
              <Table.Header>
                <Table.Column id="route" isRowHeader>Route</Table.Column>
                <Table.Column id="status">Status</Table.Column>
                <Table.Column id="strategy">Strategy</Table.Column>
                <Table.Column id="targets">Targets</Table.Column>
                <Table.Column id="health">Health</Table.Column>
              </Table.Header>
              <Table.Body>
                {Object.entries(health.data.routes).map(([route, info]) => (
                  <Table.Row key={route}>
                    <Table.Cell>
                      <span className="font-mono text-[11px]">{route}</span>
                    </Table.Cell>
                    <Table.Cell>
                      <HealthChip status={info.healthStatus} />
                    </Table.Cell>
                    <Table.Cell>
                      <span className="text-xs capitalize">
                        {info.strategy.replace(/_/g, " ")}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="text-xs">
                        {info.healthyTargetCount}/{info.totalTargetCount}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <ProgressBar.Root
                        aria-label={`${route} healthy target coverage`}
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
                        className="w-20"
                      />
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </DataTable>
          </Card.Content>
        </Card.Root>
      )}
    </div>
  );
}

function StatCard({
  icon,
  iconBg,
  label,
  value,
  subtitle,
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: number;
  subtitle: React.ReactNode;
}) {
  return (
    <Card.Root>
      <Card.Content className="flex-row items-center gap-2.5 p-3">
        <div
          className={`flex size-8 shrink-0 items-center justify-center rounded-xl ${iconBg}`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted leading-tight">
            {label}
          </p>
          <p className="text-lg font-bold leading-tight">{value}</p>
          <div className="mt-0.5">{subtitle}</div>
        </div>
      </Card.Content>
    </Card.Root>
  );
}

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
      <p className="text-[10px] uppercase tracking-wider text-muted">
        {label}
      </p>
      <p className={`text-base font-semibold ${valueClass ?? ""}`}>
        {value}
      </p>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="console-page console-stack animate-fade-in">
      <div className="console-header">
        <div className="space-y-1.5">
          <Skeleton className="h-6 w-32 rounded" />
          <Skeleton className="h-3 w-48 rounded" />
        </div>
        <Skeleton className="h-4 w-20 rounded" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card.Root key={i}>
            <Card.Content className="flex items-center gap-2 py-1.5 px-2.5">
              <Skeleton className="h-7 w-7 rounded-full shrink-0" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-2.5 w-12 rounded" />
                <Skeleton className="h-5 w-8 rounded" />
              </div>
            </Card.Content>
          </Card.Root>
        ))}
      </div>

      <Card.Root>
        <Card.Content className="p-2.5 sm:p-3">
          <Skeleton className="h-4 w-24 rounded mb-3" />
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-2.5 w-12 rounded" />
                <Skeleton className="h-5 w-16 rounded" />
              </div>
            ))}
          </div>
        </Card.Content>
      </Card.Root>
    </div>
  );
}
