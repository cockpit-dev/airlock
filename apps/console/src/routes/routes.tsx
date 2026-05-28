import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Button,
  Card,
  Chip,
  ProgressBar,
  Skeleton,
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
import { DataTable, Table } from "../components/data-table";

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
      <div className="console-page console-stack animate-fade-in">
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-3 flex items-start gap-2">
          <FiAlertCircle className="text-danger mt-0.5 shrink-0" size={16} />
          <div className="min-w-0">
            <p className="font-medium text-sm text-danger">
              Failed to load routes health
            </p>
            <p className="text-xs text-muted mt-0.5">
              {health.error.message}
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto shrink-0"
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
    <div className="console-page console-stack animate-fade-in">
      <div className="console-header">
        <div>
          <h1 className="console-title">Routes Health</h1>
          <p className="console-subtitle">
            Circuit breaker and target monitoring
          </p>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <SummaryCard
            icon={<FiCheckCircle size={15} />}
            iconBg="bg-success/10 text-success"
            label="Healthy"
            value={summary.healthy}
            valueClass="text-success"
          />
          <SummaryCard
            icon={<FiAlertTriangle size={15} />}
            iconBg="bg-warning/10 text-warning"
            label="Degraded"
            value={summary.degraded}
            valueClass="text-warning"
          />
          <SummaryCard
            icon={<FiXCircle size={15} />}
            iconBg="bg-danger/10 text-danger"
            label="Down"
            value={summary.down}
            valueClass="text-danger"
          />
          <SummaryCard
            icon={<FiTarget size={15} />}
            iconBg="bg-default-soft text-default-soft-foreground"
            label="Total Targets"
            value={summary.totalTargets}
            valueClass=""
          />
        </div>
      )}

      <Card.Root>
        <Card.Header>
          <Card.Title>Circuit Breaker Configuration</Card.Title>
        </Card.Header>
        <Card.Content>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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

      <Card.Root>
        <Card.Header>
          <Card.Title>Routes</Card.Title>
        </Card.Header>
        <Card.Content className="p-0">
          <DataTable aria-label="Route health">
            <Table.Header>
              <Table.Column id="route" isRowHeader>Route</Table.Column>
              <Table.Column id="status">Status</Table.Column>
              <Table.Column id="strategy">Strategy</Table.Column>
              <Table.Column id="targets">Targets</Table.Column>
              <Table.Column id="healthy">Healthy</Table.Column>
              <Table.Column id="errorRate">Error Rate</Table.Column>
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
                      <span className="text-xs font-mono">
                        {info.targets.join(", ")}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="text-xs">
                        {info.healthyTargetCount}/{info.totalTargetCount}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <ProgressBar.Root
                        aria-label={`${route} average error rate`}
                        value={avgErrorRate * 100}
                        color={
                          avgErrorRate > 0.5
                            ? "danger"
                            : avgErrorRate > 0.2
                              ? "warning"
                              : "success"
                        }
                        className="w-20"
                      />
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </DataTable>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header>
          <Card.Title>Targets</Card.Title>
        </Card.Header>
        <Card.Content className="p-0">
          <DataTable aria-label="Target health">
            <Table.Header>
              <Table.Column id="target" isRowHeader>Target</Table.Column>
              <Table.Column id="errorRate">Error Rate</Table.Column>
              <Table.Column id="recoveryScore">Recovery Score</Table.Column>
              <Table.Column id="latency">Latency</Table.Column>
            </Table.Header>
            <Table.Body>
              {Object.entries(health.data.targets).map(([target, info]) => (
                <Table.Row key={target}>
                  <Table.Cell>
                    <span className="font-mono text-[11px]">{target}</span>
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
                      aria-label={`${target} recovery score`}
                      value={info.metrics.recoveryScore * 100}
                      className="w-20"
                    />
                  </Table.Cell>
                  <Table.Cell>
                    <span className="text-xs">
                      {info.metrics.freshness.latencyFreshMs != null
                        ? `${info.metrics.freshness.latencyFreshMs}ms`
                        : "—"}
                    </span>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </DataTable>
        </Card.Content>
      </Card.Root>
    </div>
  );
}

function SummaryCard({
  icon,
  iconBg,
  label,
  value,
  valueClass,
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: number;
  valueClass: string;
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
          <p className={`text-lg font-bold leading-tight ${valueClass}`}>
            {value}
          </p>
        </div>
      </Card.Content>
    </Card.Root>
  );
}

function ConfigItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </p>
      <p className="text-sm font-semibold mt-0.5">{value}</p>
    </div>
  );
}

function RoutesSkeleton() {
  return (
    <div className="p-4 space-y-4 animate-fade-in">
      <div className="space-y-1.5">
        <Skeleton className="h-6 w-36 rounded" />
        <Skeleton className="h-3 w-52 rounded" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card.Root key={i}>
            <Card.Content className="flex items-center gap-2 py-1.5 px-2.5">
              <Skeleton className="h-7 w-7 rounded-full shrink-0" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-2.5 w-12 rounded" />
                <Skeleton className="h-5 w-6 rounded" />
              </div>
            </Card.Content>
          </Card.Root>
        ))}
      </div>

      <Card.Root>
        <Card.Content className="p-2.5 sm:p-3">
          <Skeleton className="h-3 w-36 rounded mb-3" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-2.5 w-12 rounded" />
                <Skeleton className="h-4 w-10 rounded" />
              </div>
            ))}
          </div>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Content className="p-0 space-y-2 p-3">
          <Skeleton className="h-4 w-20 rounded mb-1" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full rounded" />
          ))}
        </Card.Content>
      </Card.Root>
    </div>
  );
}
