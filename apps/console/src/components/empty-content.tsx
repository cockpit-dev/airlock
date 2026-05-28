import type { ReactNode } from "react";
import { EmptyState } from "@heroui/react";

export function EmptyContent({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <EmptyState className="flex min-h-48 w-full flex-col items-center justify-center gap-3 text-center">
      {icon ? <div className="text-muted [&_svg]:size-6">{icon}</div> : null}
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted">{description}</p>
      </div>
      {action}
    </EmptyState>
  );
}
