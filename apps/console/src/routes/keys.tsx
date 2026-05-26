import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  Button,
  Card,
  Chip,
  Input,
  Modal,
  Select,
  Skeleton,
  Table,
  useOverlayState,
  ListBox,
  ListBoxItem,
  toast,
} from "@heroui/react";
import { FiPlus, FiSearch, FiKey } from "react-icons/fi";
import { useKeys, useCreateKey } from "../hooks/use-queries";

export const Route = createFileRoute("/keys")({
  component: KeysPage,
});

function KeysPage() {
  const navigate = useNavigate();
  const keys = useKeys();
  const createKey = useCreateKey();
  const modalState = useOverlayState();

  const [search, setSearch] = useState("");
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyTier, setNewKeyTier] = useState<string | null>(null);

  async function handleCreate() {
    try {
      await createKey.mutateAsync({
        name: newKeyName || undefined,
        tier: newKeyTier || undefined,
      });
      toast.success("Key created successfully");
      setNewKeyName("");
      setNewKeyTier(null);
      modalState.close();
    } catch {
      toast.danger("Failed to create key");
    }
  }

  const filteredKeys = keys.data?.keys?.filter(
    (k) =>
      !search ||
      k.name?.toLowerCase().includes(search.toLowerCase()) ||
      k.id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">API Keys</h1>
          <p className="text-sm text-default-400">
            Manage gateway access keys
          </p>
        </div>
        <Button variant="primary" onPress={modalState.open}>
          <FiPlus size={16} /> Create Key
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <FiSearch
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-default-400 pointer-events-none"
        />
        <Input
          placeholder="Search by name or ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Loading */}
      {keys.isLoading ? (
        <Card.Root>
          <Card.Content className="p-0">
            <Table.Root>
              <Table.Header>
                <Table.Column>Name</Table.Column>
                <Table.Column>ID</Table.Column>
                <Table.Column>Status</Table.Column>
                <Table.Column>Tier</Table.Column>
                <Table.Column>Created</Table.Column>
              </Table.Header>
              <Table.Body>
                {Array.from({ length: 4 }).map((_, i) => (
                  <Table.Row key={i}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <Table.Cell key={j}>
                        <Skeleton className="h-4 w-full rounded" />
                      </Table.Cell>
                    ))}
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Card.Content>
        </Card.Root>
      ) : /* Empty State */
      !filteredKeys?.length ? (
        <Card.Root>
          <Card.Content className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="flex items-center justify-center w-14 h-14 rounded-full bg-default-100 text-default-400">
              <FiKey size={24} />
            </div>
            <div className="text-center">
              <p className="font-semibold text-lg">No keys yet</p>
              <p className="text-sm text-default-400 mt-1">
                Create your first API key to get started
              </p>
            </div>
            <Button variant="primary" onPress={modalState.open}>
              <FiPlus size={16} /> Create Key
            </Button>
          </Card.Content>
        </Card.Root>
      ) : (
        /* Keys Table */
        <Card.Root>
          <Card.Content className="p-0">
            <Table.Root>
              <Table.Header>
                <Table.Column>Name</Table.Column>
                <Table.Column>ID</Table.Column>
                <Table.Column>Status</Table.Column>
                <Table.Column>Tier</Table.Column>
                <Table.Column>Created</Table.Column>
              </Table.Header>
              <Table.Body>
                {filteredKeys.map((key) => (
                  <Table.Row
                    key={key.id}
                    className="hover:bg-default-50 cursor-pointer"
                    onClick={() =>
                      navigate({
                        to: "/keys/$keyId",
                        params: { keyId: key.id },
                      })
                    }
                  >
                    <Table.Cell>
                      <span className="font-medium">
                        {key.name || "Untitled"}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="font-mono text-xs">
                        {key.id.slice(0, 12)}...
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <StatusChip status={key.status} />
                    </Table.Cell>
                    <Table.Cell>
                      <span className="text-sm">
                        {key.tier ? (
                          <Chip size="sm" variant="soft" color="accent">
                            {key.tier}
                          </Chip>
                        ) : (
                          "—"
                        )}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="text-sm text-default-400">
                        {new Date(key.createdAt).toLocaleDateString()}
                      </span>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Card.Content>
        </Card.Root>
      )}

      {/* Create Key Modal */}
      <Modal.Root state={modalState}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog>
              <Modal.Header>Create API Key</Modal.Header>
              <Modal.Body className="gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Name</label>
                  <Input
                    placeholder="Key name (optional)"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Tier</label>
                  <Select.Root
                    selectedKey={newKeyTier}
                    onSelectionChange={(key) =>
                      setNewKeyTier(key as string | null)
                    }
                  >
                    <Select.Trigger />
                    <Select.Value>
                      {({ isPlaceholder }) =>
                        isPlaceholder ? "Select tier (optional)" : undefined
                      }
                    </Select.Value>
                    <Select.Indicator />
                    <Select.Popover>
                      <ListBox>
                        <ListBoxItem key="free" textValue="Free">
                          Free
                        </ListBoxItem>
                        <ListBoxItem key="standard" textValue="Standard">
                          Standard
                        </ListBoxItem>
                        <ListBoxItem key="premium" textValue="Premium">
                          Premium
                        </ListBoxItem>
                      </ListBox>
                    </Select.Popover>
                  </Select.Root>
                </div>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" onPress={modalState.close}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onPress={handleCreate}
                  isDisabled={createKey.isPending}
                >
                  {createKey.isPending ? "Creating..." : "Create"}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal.Root>
    </div>
  );
}

/* ── Status Chip ────────────────────────────────────────────────────── */

function StatusChip({ status }: { status: string }) {
  const colorMap: Record<string, "success" | "warning" | "danger" | "default"> =
    {
      active: "success",
      archived: "warning",
      revoked: "danger",
      expired: "danger",
    };
  return (
    <Chip size="sm" variant="soft" color={colorMap[status] ?? "default"}>
      {status}
    </Chip>
  );
}
