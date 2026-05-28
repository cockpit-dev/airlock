import { Table } from "@heroui/react";
import type { ComponentProps, ReactNode } from "react";

type DataTableProps = ComponentProps<typeof Table.Root> & {
  children: ReactNode;
  contentClassName?: string;
};

export function DataTable({
  children,
  contentClassName,
  ...props
}: DataTableProps) {
  return (
    <Table.Root variant="primary" {...props}>
      <Table.ScrollContainer>
        <Table.Content
          aria-label={props["aria-label"] ?? "Data table"}
          className={contentClassName}
        >
          {children}
        </Table.Content>
      </Table.ScrollContainer>
    </Table.Root>
  );
}

export { Table };
