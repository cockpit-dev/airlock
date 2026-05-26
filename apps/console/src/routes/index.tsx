import { createFileRoute } from "@tanstack/react-router";
import {
  Card,
  Chip,
  ProgressBar,
  Spinner,
  Table,
} from "@heroui/react";
import { useStatus, useMetrics, useRoutingHealth } from "../hooks/use-queries";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

function DashboardPage() {
  const status = useStatus();
  const metrics = useMetrics();
  const health = useRoutingHealth();

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {status.isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : status.data ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatusCard
              title="Providers"
              value={String(status.data.providers.length)}
              subtitle={`${status.data.providers.filter((p) => p.configured).length} configured`}
              color="accent"
            />
            <StatusCard
              title="Routes"
              value={String(status.data.routes.length)}
              subtitle={`${status.data.providers.reduce((a, p) => a + p.routeCount, 0)} targets`}
              color="default"
            />
            <StatusCard
              title="Keys"
              value={String(status.data.keys.total)}
              subtitle={`${status.data.keys.registryOwned} registry`}
              color="success"
            />
            <StatusCard
              title="Circuit Breakers"
              value={String(status.data.circuitBreaker.openTargets.length)}
              subtitle={`${status.data.circuitBreaker.halfOpenTargets.length} half-open`}
              color={
                status.data.circuitBreaker.openTargets.length > 0
                  ? "danger"
                  : "success"
              }
            />
          </div>

          {metrics.data && (
            <Card.Root>
              <Card.Header>
                <h2 className="text-lg font-semibold">
                  Metrics{" "}
                  <span className="text-sm text-default-400 font-normal">
                    (live, 10s refresh)
                  </span>
                </h2>
              </Card.Header>
              <Card.Content>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <MetricItem
                    label="Requests"
                    value={metrics.data.requests}
                  />
                  <MetricItem
                    label="Errors"
                    value={metrics.data.errors}
                    color={metrics.data.errorRate > 0.05 ? "danger" : "default"}
                  />
                  <MetricItem
                    label="Error Rate"
                    value={`${(metrics.data.errorRate * 100).toFixed(1)}%`}
                    color={metrics.data.errorRate > 0.05 ? "danger" : "default"}
                  />
                  <MetricItem
                    label="Avg Latency"
                    value={`${metrics.data.avgDurationMs.toFixed(0)}ms`}
                  />
                  <MetricItem
                    label="Streams"
                    value={`${(metrics.data.streamRatio * 100).toFixed(0)}%`}
                  />
                </div>
              </Card.Content>
            </Card.Root>
          )}

          {health.data && (
            <Card.Root>
              <Card.Header>
                <h2 className="text-lg font-semibold">Route Health</h2>
              </Card.Header>
              <Card.Content>
                <Table.Root aria-label="Route health">
                  <Table.Header>
                    <Table.Column isRowHeader>Route</Table.Column>
                    <Table.Column>Status</Table.Column>
                    <Table.Column>Strategy</Table.Column>
                    <Table.Column>Targets</Table.Column>
                    <Table.Column>Health</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {Object.entries(health.data.routes).map(
                      ([route, info]) => (
                        <Table.Row key={route}>
                          <Table.Cell className="font-mono text-sm">
                            {route}
                          </Table.Cell>
                          <Table.Cell>
                            <HealthChip status={info.healthStatus} />
                          </Table.Cell>
                          <Table.Cell className="text-sm">
                            {info.strategy}
                          </Table.Cell>
                          <Table.Cell className="text-sm">
                            {info.healthyTargetCount}/{info.totalTargetCount}
                          </Table.Cell>
                          <Table.Cell>
                            <ProgressBar.Root
                              value={
                                (info.healthyTargetCount /
                                  info.totalTargetCount) *
                                100
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
                      )
                    )}
                  </Table.Body>
                </Table.Root>
              </Card.Content>
            </Card.Root>
          )}
        </>
      ) : (
        <p className="text-danger">{String(status.error)}</p>
      )}
    </div>
  );
}

function StatusCard({
  title,
  value,
  subtitle,
  color,
}: {
  title: string;
  value: string;
  subtitle: string;
  color: "accent" | "default" | "success" | "danger" | "warning";
}) {
  return (
    <Card.Root>
      <Card.Content className="gap-1">
        <p className="text-sm text-default-500">{title}</p>
        <p className="text-2xl font-bold">{value}</p>
        <Chip size="sm" variant="soft" color={color}>
          {subtitle}
        </Chip>
      </Card.Content>
    </Card.Root>
  );
}

function MetricItem({
  label,
  value,
  color = "default",
}: {
  label: string;
  value: string | number;
  color?: "default" | "danger";
}) {
  return (
    <div className="text-center">
      <p className="text-sm text-default-400">{label}</p>
      <p
        className={`text-xl font-semibold ${
          color === "danger" ? "text-danger" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function HealthChip({
  status,
}: {
  status: "healthy" | "degraded" | "down";
}) {
  const color = { healthy: "success", degraded: "warning", down: "danger" }[
    status
  ] as "success" | "warning" | "danger";
  return (
    <Chip size="sm" variant="soft" color={color}>
      {status}
    </Chip>
  );
}
