import { Chip } from "@heroui/react";

export function HealthChip({
  status
}: {
  status: "healthy" | "degraded" | "down";
}) {
  const color = {
    healthy: "success",
    degraded: "warning",
    down: "danger"
  }[status] as "success" | "warning" | "danger";

  return (
    <Chip size="sm" variant="soft" color={color}>
      {status}
    </Chip>
  );
}
