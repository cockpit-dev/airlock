import { createFileRoute } from "@tanstack/react-router";
import {
  Card,
  Chip,
  ProgressBar,
  Spinner,
  Table,
} from "@heroui/react";
import { useRoutingHealth } from "../hooks/use-queries";

export const Route = createFileRoute("/routes")({
  component: RoutesPage,
});

function RoutesPage() {
  const health = useRoutingHealth();

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Routes Health</h1>

      {health.isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : health.data ? (
        <>
          <Card.Root>
            <Card.Header>
              <h2 className="text-lg font-semibold">Circuit Breaker Config</h2>
            </Card.Header>
            <Card.Content>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-default-400">Threshold</span>
                  <p className="font-semibold">
                    {health.data.config.circuitBreakerPolicy.threshold}
                  </p>
                </div>
                <div>
                  <span className="text-default-400">Cooldown</span>
                  <p className="font-semibold">
                    {health.data.config.circuitBreakerPolicy.cooldownMs}ms
                  </p>
                </div>
                <div>
                  <span className="text-default-400">Persistent</span>
                  <p className="font-semibold">
                    {health.data.config.persistentBackend ? "Yes" : "No"}
                  </p>
                </div>
                <div>
                  <span className="text-default-400">Targets</span>
                  <p className="font-semibold">
                    {Object.keys(health.data.targets).length}
                  </p>
                </div>
              </div>
            </Card.Content>
          </Card.Root>

          <Card.Root>
            <Card.Content className="p-0">
              <Table.Root aria-label="Routes health">
                <Table.Header>
                  <Table.Column isRowHeader>Route</Table.Column>
                  <Table.Column>Status</Table.Column>
                  <Table.Column>Strategy</Table.Column>
                  <Table.Column>Targets</Table.Column>
                  <Table.Column>Healthy</Table.Column>
                  <Table.Column>Error Rate</Table.Column>
                </Table.Header>
                <Table.Body>
                  {Object.entries(health.data.routes).map(
                    ([route, info]) => {
                      const targetMetrics = info.targets
                        .map((t) => health.data.targets[t])
                        .filter(Boolean);
                      const avgErrorRate =
                        targetMetrics.length > 0
                          ? targetMetrics.reduce(
                              (a, t) => a + t.metrics.errorRate,
                              0
                            ) / targetMetrics.length
                          : 0;

                      return (
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
                            {info.targets.join(", ")}
                          </Table.Cell>
                          <Table.Cell>
                            {info.healthyTargetCount}/{info.totalTargetCount}
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
                    }
                  )}
                </Table.Body>
              </Table.Root>
            </Card.Content>
          </Card.Root>

          <Card.Root>
            <Card.Header>
              <h2 className="text-lg font-semibold">Targets</h2>
            </Card.Header>
            <Card.Content className="p-0">
              <Table.Root aria-label="Target details">
                <Table.Header>
                  <Table.Column isRowHeader>Target</Table.Column>
                  <Table.Column>Error Rate</Table.Column>
                  <Table.Column>Recovery Score</Table.Column>
                  <Table.Column>Latency</Table.Column>
                </Table.Header>
                <Table.Body>
                  {Object.entries(health.data.targets).map(
                    ([target, info]) => (
                      <Table.Row key={target}>
                        <Table.Cell className="font-mono text-sm">
                          {target}
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
                        <Table.Cell className="text-sm">
                          {info.metrics.freshness.latencyFreshMs != null
                            ? `${info.metrics.freshness.latencyFreshMs}ms`
                            : "—"}
                        </Table.Cell>
                      </Table.Row>
                    )
                  )}
                </Table.Body>
              </Table.Root>
            </Card.Content>
          </Card.Root>
        </>
      ) : (
        <p className="text-danger">{String(health.error)}</p>
      )}
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
