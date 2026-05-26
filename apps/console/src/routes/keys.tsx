import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  Button,
  Card,
  Chip,
  Input,
  Modal,
  Select,
  Spinner,
  Table,
  useOverlayState,
  ListBox,
  ListBoxItem,
} from "@heroui/react";
import { FiPlus } from "react-icons/fi";
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
    await createKey.mutateAsync({
      name: newKeyName || undefined,
      tier: newKeyTier || undefined,
    });
    setNewKeyName("");
    setNewKeyTier(null);
    modalState.close();
  }

  const filteredKeys = keys.data?.keys?.filter(
    (k) =>
      !search ||
      k.name?.toLowerCase().includes(search.toLowerCase()) ||
      k.id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">API Keys</h1>
        <Button variant="primary" onPress={modalState.open}>
          <FiPlus /> Create Key
        </Button>
      </div>

      <Input
        placeholder="Search keys..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {keys.isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : (
        <Card.Root>
          <Card.Content className="p-0">
            <Table.Root aria-label="API keys">
              <Table.Header>
                <Table.Column isRowHeader>Name</Table.Column>
                <Table.Column>ID</Table.Column>
                <Table.Column>Status</Table.Column>
                <Table.Column>Tier</Table.Column>
                <Table.Column>Scopes</Table.Column>
                <Table.Column>Created</Table.Column>
              </Table.Header>
              <Table.Body>
                {(filteredKeys ?? []).map((key) => (
                  <Table.Row
                    key={key.id}
                    className="cursor-pointer"
                    onClick={() => navigate({ to: "/keys/$keyId", params: { keyId: key.id } })}
                  >
                    <Table.Cell>{key.name || "—"}</Table.Cell>
                    <Table.Cell className="font-mono text-xs">
                      {key.id.slice(0, 12)}...
                    </Table.Cell>
                    <Table.Cell>
                      <StatusChip status={key.status} />
                    </Table.Cell>
                    <Table.Cell>{key.tier || "—"}</Table.Cell>
                    <Table.Cell>
                      <div className="flex gap-1 flex-wrap">
                        {key.scopes?.map((s) => (
                          <Chip key={s} size="sm" variant="soft">
                            {s}
                          </Chip>
                        ))}
                      </div>
                    </Table.Cell>
                    <Table.Cell className="text-sm text-default-400">
                      {new Date(key.createdAt).toLocaleDateString()}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Card.Content>
        </Card.Root>
      )}

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
                    onSelectionChange={(key) => setNewKeyTier(key as string | null)}
                  >
                    <Select.Trigger />
                    <Select.Value>{({ isPlaceholder }) =>
                      isPlaceholder ? "Select tier (optional)" : undefined
                    }</Select.Value>
                    <Select.Indicator />
                    <Select.Popover>
                      <ListBox>
                        <ListBoxItem key="free" textValue="Free">Free</ListBoxItem>
                        <ListBoxItem key="standard" textValue="Standard">Standard</ListBoxItem>
                        <ListBoxItem key="premium" textValue="Premium">Premium</ListBoxItem>
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

function StatusChip({ status }: { status: string }) {
  const map: Record<string, "success" | "warning" | "danger" | "default"> = {
    active: "success",
    archived: "warning",
    revoked: "danger",
    expired: "danger",
  };
  return (
    <Chip size="sm" variant="soft" color={map[status] ?? "default"}>
      {status}
    </Chip>
  );
}
