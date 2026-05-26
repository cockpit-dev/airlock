import { useMemo } from "react";
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
  FiAlertCircle,
  FiRefreshCw,
  FiCheckCircle,
  FiAlertTriangle,
  FiXCircle,
  FiTarget,
} from "react-icons/fi";
import { useRoutingHealth } from "../hooks/use-queries";
import { HealthChip } from "../components/health-chip";

export const Route = createFileRoute("/routes")({
  component: RoutesPage,
});

function RoutesPage() {
  const health = useRoutingHealth();

  const summary = useMemo(() => {
    if (!health.data?.routes) return null;
    const entries = Object.values(health.data.routes);
    return {
      healthy: entries.filter((r) => r.healthStatus === "healthy").length,
      degraded: entries.filter((r) => r.healthStatus === "degraded").length,
      down: entries.filter((r) => r.healthStatus === "down").length,
      totalTargets: entries.reduce((sum, r) => sum + r.totalTargetCount, 0),
    };
  }, [health.data]);

  if (health.isLoading) return <RoutesSkeleton />;

  if (health.error) {
    return (
      <div className="p-6 space-y-6 animate-fade-in">
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-4 flex items-start gap-3">
          <FiAlertCircle className="text-danger mt-0.5 shrink-0" size={20} />
          <div>
            <p className="font-semibold text-danger">
              Failed to load routes health
            </p>
            <p className="text-sm text-default-400 mt-1">
              {health.error.message}
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onPress={() => health.refetch()}
          >
            <FiRefreshCw size={14} />
          </Button>
        </div>
      </div>
    );
  }

  if (!health.data) return null;

  const { config } = health.data;
  const cooldownLabel =
    config.circuitBreakerPolicy.cooldownMs > 1000
      ? `${(config.circuitBreakerPolicy.cooldownMs / 1000).toFixed(1)}s`
      : `${config.circuitBreakerPolicy.cooldownMs}ms`;

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Routes Health</h1>
        <p className="text-sm text-default-400">
          Circuit breaker and target monitoring
        </p>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryCard
            icon={<FiCheckCircle size={18} />}
            iconBg="bg-success/10 text-success"
            borderClass="border-l-success"
            label="Healthy"
            value={summary.healthy}
            valueClass="text-success"
          />
          <SummaryCard
            icon={<FiAlertTriangle size={18} />}
            iconBg="bg-warning/10 text-warning"
            borderClass="border-l-warning"
            label="Degraded"
            value={summary.degraded}
            valueClass="text-warning"
          />
          <SummaryCard
            icon={<FiXCircle size={18} />}
            iconBg="bg-danger/10 text-danger"
            borderClass="border-l-danger"
            label="Down"
            value={summary.down}
            valueClass="text-danger"
          />
          <SummaryCard
            icon={<FiTarget size={18} />}
            iconBg="bg-default/10 text-default-500"
            borderClass="border-l-default"
            label="Total Targets"
            value={summary.totalTargets}
            valueClass=""
          />
        </div>
      )}

      {/* Circuit Breaker Config */}
      <Card.Root>
        <Card.Header className="px-5 pt-5 pb-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-default-400 mb-3">
            Circuit Breaker Configuration
          </p>
        </Card.Header>
        <Card.Content className="p-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <ConfigItem label="Threshold" value={String(config.circuitBreakerPolicy.threshold)} />
            <ConfigItem label="Cooldown" value={cooldownLabel} />
            <ConfigItem
              label="Persistent"
              value={config.persistentBackend ? "Yes" : "No"}
            />
            <ConfigItem
              label="Total Targets"
              value={String(Object.keys(health.data.targets).length)}
            />
          </div>
        </Card.Content>
      </Card.Root>

      {/* Routes Table */}
      <Card.Root>
        <Card.Header className="px-5 pt-5 pb-0">
          <h2 className="text-lg font-semibold">Routes</h2>
        </Card.Header>
        <Card.Content className="p-5">
          <Table.Root>
            <Table.Header>
              <Table.Column>Route</Table.Column>
              <Table.Column>Status</Table.Column>
              <Table.Column>Strategy</Table.Column>
              <Table.Column>Targets</Table.Column>
              <Table.Column>Healthy</Table.Column>
              <Table.Column>Error Rate</Table.Column>
            </Table.Header>
            <Table.Body>
              {Object.entries(health.data.routes).map(([route, info]) => {
                const targetMetrics = info.targets
                  .map((t) => health.data!.targets[t])
                  .filter(Boolean);
                const avgErrorRate =
                  targetMetrics.length > 0
                    ? targetMetrics.reduce((a, t) => a + t.metrics.errorRate, 0) /
                      targetMetrics.length
                    : 0;

                return (
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
                      <span className="text-sm font-mono">
                        {info.targets.join(", ")}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="text-sm">
                        {info.healthyTargetCount}/{info.totalTargetCount}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <ProgressBar.Root
                        value={avgErrorRate * 100}
                        color={
                          avgErrorRate > 0.5
                            ? "danger"
                            : avgErrorRate > 0.2
                              ? "warning"
                              : "success"
                        }
                        className="w-24"
                      />
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
        </Card.Content>
      </Card.Root>

      {/* Targets Detail Table */}
      <Card.Root>
        <Card.Header className="px-5 pt-5 pb-0">
          <h2 className="text-lg font-semibold">Targets</h2>
        </Card.Header>
        <Card.Content className="p-5">
          <Table.Root>
            <Table.Header>
              <Table.Column>Target</Table.Column>
              <Table.Column>Error Rate</Table.Column>
              <Table.Column>Recovery Score</Table.Column>
              <Table.Column>Latency</Table.Column>
            </Table.Header>
            <Table.Body>
              {Object.entries(health.data.targets).map(([target, info]) => (
                <Table.Row key={target}>
                  <Table.Cell>
                    <span className="font-mono text-xs">{target}</span>
                  </Table.Cell>
                  <Table.Cell>
                    <Chip
                      size="sm"
                      variant="soft"
                      color={
                        info.metrics.errorRate > 0.5
                          ? "danger"
                          : info.metrics.errorRate > 0.2
                            ? "warning"
                            : "success"
                      }
                    >
                      {(info.metrics.errorRate * 100).toFixed(1)}%
                    </Chip>
                  </Table.Cell>
                  <Table.Cell>
                    <ProgressBar.Root
                      value={info.metrics.recoveryScore * 100}
                      className="w-24"
                    />
                  </Table.Cell>
                  <Table.Cell>
                    <span className="text-sm">
                      {info.metrics.freshness.latencyFreshMs != null
                        ? `${info.metrics.freshness.latencyFreshMs}ms`
                        : "—"}
                    </span>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Card.Content>
      </Card.Root>
    </div>
  );
}

/* ── Summary Card ───────────────────────────────────────────────────── */

function SummaryCard({
  icon,
  iconBg,
  borderClass,
  label,
  value,
  valueClass,
}: {
  icon: React.ReactNode;
  iconBg: string;
  borderClass: string;
  label: string;
  value: number;
  valueClass: string;
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
          <p className={`text-2xl font-bold ${valueClass}`}>{value}</p>
        </div>
      </Card.Content>
    </Card.Root>
  );
}

/* ── Config Item ────────────────────────────────────────────────────── */

function ConfigItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-default-400">
        {label}
      </p>
      <p className="text-lg font-semibold mt-0.5">{value}</p>
    </div>
  );
}

/* ── Skeleton Loading State ─────────────────────────────────────────── */

function RoutesSkeleton() {
  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48 rounded" />
        <Skeleton className="h-4 w-64 rounded" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card.Root key={i}>
            <Card.Content className="flex items-start gap-3">
              <Skeleton className="h-9 w-9 rounded-full shrink-0" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-3 w-16 rounded" />
                <Skeleton className="h-7 w-8 rounded" />
              </div>
            </Card.Content>
          </Card.Root>
        ))}
      </div>

      <Card.Root>
        <Card.Content className="p-5">
          <Skeleton className="h-4 w-48 rounded mb-4" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-16 rounded" />
                <Skeleton className="h-5 w-12 rounded" />
              </div>
            ))}
          </div>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Content className="p-5 space-y-3">
          <Skeleton className="h-5 w-24 rounded mb-2" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded" />
          ))}
        </Card.Content>
      </Card.Root>
    </div>
  );
}
